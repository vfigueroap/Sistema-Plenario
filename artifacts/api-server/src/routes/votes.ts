import { Router, type IRouter } from "express";
import { eq, and, sql } from "drizzle-orm";
import {
  db,
  topicsTable,
  topicCandidatesTable,
  topicEstamentosTable,
  votesTable,
  voteBallotsTable,
  attendanceTable,
  usersTable,
  plenariasTable,
  withInstitutionDb,
} from "@workspace/db";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { computeTopicResult, computeCandidateResult } from "../lib/results";
import { scopeMembersToSession } from "../lib/roster";
import {
  getSessionWeightMap,
  applySessionWeights,
  sessionWeightFor,
} from "../lib/sessionWeights";
import { emitVotesChanged } from "../lib/realtime";
import { sharedValue } from "../lib/shared-cache";
import { buildCandidatoRows, type DetailRow } from "../lib/candidate-votes";
import type { RequestUser } from "../lib/request-user";

const router: IRouter = Router();

const VOTE_OPTIONS = ["favor", "contra", "abstención"];

// Resolve the eligible estamento set for a topic (empty => open to everyone).
async function getEligibleEstamentos(topicId: number): Promise<Set<string>> {
  const rows = await db
    .select({ name: topicEstamentosTable.estamentoName })
    .from(topicEstamentosTable)
    .where(eq(topicEstamentosTable.voteTopicId, topicId));
  return new Set(rows.map((r) => r.name));
}

function isEligible(eligible: Set<string>, group: string | null): boolean {
  if (eligible.size === 0) return true;
  return group !== null && eligible.has(group);
}


async function getValidCandidateIds(topicId: number): Promise<Set<number>> {
  const rows = await db
    .select({ id: topicCandidatesTable.id })
    .from(topicCandidatesTable)
    .where(eq(topicCandidatesTable.voteTopicId, topicId));
  return new Set(rows.map((c) => c.id));
}

async function loadTopicData(topicId: number, institutionId?: string) {
  const load = async () => {
    const [topic] = await db.select().from(topicsTable).where(eq(topicsTable.id, topicId));
    if (!topic) return null;
    const [liveVotes, allMembers, attendanceRows, eligibleSet, [plenaria], weightMap, candidates] = await Promise.all([
      db.select().from(votesTable).where(eq(votesTable.voteTopicId, topicId)),
      db.select().from(usersTable).where(eq(usersTable.rol, "miembro")),
      db.select().from(attendanceTable).where(eq(attendanceTable.sessionId, topic.sessionId)),
      getEligibleEstamentos(topicId),
      db.select().from(plenariasTable).where(eq(plenariasTable.id, topic.sessionId)),
      getSessionWeightMap(topic.sessionId),
      db.select().from(topicCandidatesTable).where(eq(topicCandidatesTable.voteTopicId, topicId))
        .orderBy(topicCandidatesTable.position, topicCandidatesTable.id),
    ]);
    return { topic, liveVotes, allMembers, attendanceRows, eligibleSet, plenaria, weightMap, candidates };
  };
  return sharedValue(`topic-data:${topicId}`, () => institutionId ? withInstitutionDb(institutionId, load) : load());
}

router.post("/topics/:topicId/vote", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.topicId) ? req.params.topicId[0] : req.params.topicId;
  const topicId = parseInt(raw, 10);
  if (isNaN(topicId)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const userId = req.session.userId!;

  type VoteOutcome =
    | { ok: true; sessionId: number; isCandidate: boolean; option: string | null; weightAtVote: string }
    | { ok: false; status: number; error: string };

  const outcome = await db.transaction(async (tx): Promise<VoteOutcome> => {
    const topicRows = await tx.execute(sql`
      select t.session_id as "sessionId", t.status as "topicStatus", t.type, t.candidate_mode as "candidateMode",
        t.weight_source as "weightSource", t.votes_per_voter as "votesPerVoter", s.status as "sessionStatus",
        coalesce((select array_agg(e.estamento_name) from vote_topic_estamentos e where e.vote_topic_id = t.id), '{}') as estamentos
      from vote_topics t
      join plenarias s on s.id = t.session_id
      where t.id = ${topicId}
      for share of t, s
    `);
    const topic = topicRows.rows[0] as {
      sessionId: number; topicStatus: string; type: string; candidateMode: string | null;
      weightSource: string; votesPerVoter: number; sessionStatus: string; estamentos: string[];
    } | undefined;
    if (!topic) return { ok: false, status: 404, error: "Tema no encontrado" };
    if (topic.topicStatus !== "abierto") return { ok: false, status: 400, error: "La votación no está abierta" };
    if (topic.sessionStatus !== "abierta") return { ok: false, status: 400, error: "La sesión no está abierta" };

    const memberRows = await tx.execute(sql`
      select a.checked_out_at as "checkedOutAt", u.active, u."group" as "group",
        u.voting_weight as "votingWeight", u.voting_weight_alt as "votingWeightAlt",
        sw.weight as "snapWeight", sw.weight_alt as "snapWeightAlt"
      from attendance a
      join users u on u.id = a.user_id
      left join session_weights sw on sw.session_id = a.session_id and sw.user_id = a.user_id
      where a.session_id = ${topic.sessionId} and a.user_id = ${userId}
      for share of a, u
    `);
    const member = memberRows.rows[0] as {
      checkedOutAt: Date | null; active: boolean; group: string | null;
      votingWeight: string; votingWeightAlt: string; snapWeight: string | null; snapWeightAlt: string | null;
    } | undefined;
    if (!member) return { ok: false, status: 400, error: "No tienes asistencia registrada en esta sesión" };
    if (member.checkedOutAt !== null) {
      return { ok: false, status: 400, error: "Te has retirado de la sesión y no puedes votar" };
    }
    if (!member.active) return { ok: false, status: 403, error: "Tu cuenta está inhabilitada" };

    if (!isEligible(new Set(topic.estamentos), member.group)) {
      return { ok: false, status: 403, error: "Tu estamento no participa en esta votación" };
    }

    const useAlt = topic.weightSource === "alt";
    const weightAtVote = member.snapWeight !== null
      ? (useAlt ? member.snapWeightAlt! : member.snapWeight)
      : (useAlt ? member.votingWeightAlt : member.votingWeight);

    const isCandidate = topic.type === "candidato";
    let detailRows: DetailRow[] = [];

    if (isCandidate) {
      const candidateRows = await tx.select({ id: topicCandidatesTable.id }).from(topicCandidatesTable)
        .where(eq(topicCandidatesTable.voteTopicId, topicId));
      const built = buildCandidatoRows(topic, req.body?.allocations, new Set(candidateRows.map((c) => c.id)));
      if (!built.ok) return { ok: false, status: built.status, error: built.error };
      detailRows = built.rows;
    } else {
      const option = req.body?.option;
      if (!option || !VOTE_OPTIONS.includes(option)) {
        return { ok: false, status: 400, error: "Opción inválida. Use: favor, contra, abstención" };
      }
      detailRows = [{ candidateId: null, option }];
    }

    const written = await tx.execute(sql`
      with existing as (
        select 1 from votes where vote_topic_id = ${topicId} and user_id = ${userId} limit 1
      ), ballot as (
        insert into vote_ballots (vote_topic_id, user_id, weight_at_vote)
        select ${topicId}, ${userId}, ${weightAtVote}::numeric
        where not exists (select 1 from existing)
        on conflict do nothing
        returning id
      ), ins as (
        insert into votes (vote_topic_id, user_id, ballot_id, candidate_id, option, weight_at_vote)
        select ${topicId}, ${userId}, ballot.id, d.candidate_id, d.option, ${weightAtVote}::numeric
        from ballot
        cross join jsonb_to_recordset(${JSON.stringify(detailRows.map((d) => ({ candidate_id: d.candidateId, option: d.option })))}::jsonb) as d(candidate_id int, option text)
        returning id
      )
      select (select count(*) from ballot)::int as ballots
    `);
    if (Number((written.rows[0] as { ballots: number }).ballots) === 0) {
      return { ok: false, status: 409, error: "Ya emitiste tu voto en este tema" };
    }

    return {
      ok: true,
      sessionId: topic.sessionId,
      isCandidate,
      option: isCandidate ? null : detailRows[0].option,
      weightAtVote,
    };
  });

  if (!outcome.ok) {
    res.status(outcome.status).json({ error: outcome.error });
    return;
  }

  emitVotesChanged(outcome.sessionId, topicId);

  res.json({
    topicId,
    option: outcome.option,
    weightAtVote: parseFloat(outcome.weightAtVote),
  });
});

router.get("/topics/:topicId/results", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.topicId) ? req.params.topicId[0] : req.params.topicId;
  const topicId = parseInt(raw, 10);
  if (isNaN(topicId)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const userId = req.session.userId!;

  const shared = await loadTopicData(topicId, res.locals.sharedReadInstitutionId);
  if (!shared) {
    res.status(404).json({ error: "Tema no encontrado" });
    return;
  }
  const { topic, liveVotes, allMembers, attendanceRows, eligibleSet, plenaria, weightMap, candidates } = shared;
  const me = (res.locals.currentUser as RequestUser | undefined) ?? (await db.select().from(usersTable).where(eq(usersTable.id, userId)))[0];

  const allVotes = topic.electorateSnapshot?.votes ?? liveVotes;
  const attendeeIds = new Set(
    attendanceRows.filter((a) => a.checkedOutAt === null).map((a) => a.userId),
  );
  const checkedOutIds = new Set(
    attendanceRows.filter((a) => a.checkedOutAt !== null).map((a) => a.userId),
  );

  // Inactive members are excluded from every tally and denominator. Members
  // created after the session are excluded too (unless they participated) so
  // new accounts never retro-affect existing quorums/denominators. Weights are
  // frozen per session via the snapshot overlay.
  const participantIds = new Set(attendanceRows.map((a) => a.userId));
  const activeMembers = applySessionWeights(
    scopeMembersToSession(
      allMembers.filter((m) => m.active),
      plenaria?.createdAt ?? new Date(0),
      participantIds,
    ),
    weightMap,
  );

  // Restrict the denominator to eligible members when the votation is scoped,
  // and resolve each member's effective weight from the column the votación uses.
  const useAlt = topic.weightSource === "alt";
  const eligibleMembers = (
    eligibleSet.size === 0
      ? activeMembers
      : activeMembers.filter((m) => m.group !== null && eligibleSet.has(m.group))
  ).map((m) => ({ ...m, votingWeight: useAlt ? m.votingWeightAlt : m.votingWeight }));

  const eligible = isEligible(eligibleSet, me?.group ?? null) && (me?.active ?? false);

  const base = {
    topicId: topic.id,
    sessionId: topic.sessionId,
    title: topic.title,
    detail: topic.detail,
    status: topic.status,
    type: topic.type,
    candidateMode: topic.candidateMode,
    weighted: topic.weighted,
    weightSource: topic.weightSource,
    votesPerVoter: topic.votesPerVoter,
    eligible,
  };

  if (topic.type === "candidato") {
    const ballotUserIds = new Set(allVotes.map((v) => v.userId));
    const r = computeCandidateResult(
      allVotes,
      candidates,
      eligibleMembers,
      attendeeIds,
      checkedOutIds,
      ballotUserIds,
      topic.weighted,
      topic.electorateSnapshot,
      useAlt,
    );

    const myAllocations: { candidateId: number | null; count: number }[] = [];
    const myMap = new Map<number | null, number>();
    for (const v of allVotes) {
      if (v.userId !== userId) continue;
      myMap.set(v.candidateId, (myMap.get(v.candidateId) ?? 0) + 1);
    }
    for (const [candidateId, count] of myMap) myAllocations.push({ candidateId, count });

    res.json({
      ...base,
      candidates: r.candidates,
      abstenciónWeight: r.abstenciónWeight,
      abstenciónCount: r.abstenciónCount,
      sinVotoWeight: r.sinVotoWeight,
      ausenteWeight: r.ausenteWeight,
      eligibleCount: r.eligibleCount,
      votedCount: r.votedCount,
      approved: null,
      voteCount: r.voteCount,
      myAllocations,
      myVote: null,
    });
    return;
  }

  const { weights, percentages, approved, voteCount } = computeTopicResult(
    topic.status,
    allVotes,
    eligibleMembers,
    attendeeIds,
    checkedOutIds,
    topic.weighted,
    topic.electorateSnapshot,
    useAlt,
  );

  const myVote = allVotes.find((v) => v.userId === userId);

  res.json({
    ...base,
    weights,
    percentages,
    approved,
    voteCount,
    myVote: myVote?.option ?? null,
    myAllocations: [],
  });
});

// Per-member nominal ballot detail for a topic. Powers the live vote-detail
// panel (open topic), the histórico per-member accordion (closed topic), and
// the read-only detail every pleno member sees on their ballot page. Returns a
// flat list of eligible ACTIVE members with attendance status + their nominal
// vote; the frontend groups, reorders, and sinks absent/retired members to the
// bottom. Auth-only (any logged-in member) — usernames are stripped for
// non-admins since they double as login identifiers.
router.get("/topics/:topicId/ballots", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.topicId) ? req.params.topicId[0] : req.params.topicId;
  const topicId = parseInt(raw, 10);
  if (isNaN(topicId)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const shared = await loadTopicData(topicId, res.locals.sharedReadInstitutionId);
  if (!shared) {
    res.status(404).json({ error: "Tema no encontrado" });
    return;
  }

  const { topic, liveVotes, allMembers, attendanceRows, eligibleSet, candidates, plenaria, weightMap } = shared;

  const candidateNameById = new Map(candidates.map((c) => [c.id, c.name]));
  const allVotes = topic.electorateSnapshot?.votes ?? liveVotes;
  const attendeeIds = new Set(
    attendanceRows.filter((a) => a.checkedOutAt === null).map((a) => a.userId),
  );
  const checkedOutIds = new Set(
    attendanceRows.filter((a) => a.checkedOutAt !== null).map((a) => a.userId),
  );

  const votesByUser = new Map<number, typeof allVotes>();
  for (const v of allVotes) {
    let arr = votesByUser.get(v.userId);
    if (!arr) votesByUser.set(v.userId, (arr = []));
    arr.push(v);
  }

  const labelFor = (rows: typeof allVotes): string => {
    if (rows.length === 1 && rows[0].option) return rows[0].option;
    const counts = new Map<string, number>();
    for (const r of rows) {
      const label =
        r.candidateId === null ? "Abstención" : candidateNameById.get(r.candidateId) ?? "—";
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return [...counts.entries()].map(([name, n]) => (n > 1 ? `${name} ×${n}` : name)).join(", ");
  };

  const useAlt = topic.weightSource === "alt";
  const isAdmin = req.session.rol === "admin";
  // Session-scoped roster: members created after the session never appear in
  // its ballot detail (unless they actually participated). Weights come from
  // the session snapshot, not current user weights.
  const participantIds = new Set(attendanceRows.map((a) => a.userId));
  const activeMembers = applySessionWeights(
    scopeMembersToSession(
      allMembers.filter((m) => m.active),
      plenaria?.createdAt ?? new Date(0),
      participantIds,
    ),
    weightMap,
  );
  const eligibleMembers =
    eligibleSet.size === 0
      ? activeMembers
      : activeMembers.filter((m) => m.group !== null && eligibleSet.has(m.group));

  const snapshot = topic.electorateSnapshot;
  const historicalAttendees = snapshot ? new Set(snapshot.attendeeIds) : attendeeIds;
  const historicalRetired = snapshot ? new Set(snapshot.checkedOutIds) : checkedOutIds;
  const members = (snapshot?.members ?? eligibleMembers).map((m) => {
    const status = historicalAttendees.has(m.id)
      ? "present"
      : historicalRetired.has(m.id)
        ? "checkedOut"
        : "absent";
    const rows = votesByUser.get(m.id);
    // For candidato topics expose the raw per-candidate allocations (including
    // abstención as candidateId=null) so the admin editor can pre-select them.
    let allocations: { candidateId: number | null; count: number }[] = [];
    if (topic.type === "candidato" && rows) {
      const allocMap = new Map<number | null, number>();
      for (const r of rows) allocMap.set(r.candidateId, (allocMap.get(r.candidateId) ?? 0) + 1);
      allocations = [...allocMap.entries()].map(([candidateId, count]) => ({ candidateId, count }));
    }
    return {
      userId: m.id,
      displayName: m.displayName,
      username: isAdmin ? m.username : null,
      group: m.group,
      faculty: m.faculty,
      weight: parseFloat(useAlt ? m.votingWeightAlt : m.votingWeight),
      status,
      voted: !!rows,
      voteLabel: rows ? labelFor(rows) : null,
      allocations,
    };
  });

  res.json({
    topicId: topic.id,
    type: topic.type,
    candidateMode: topic.candidateMode,
    weighted: topic.weighted,
    weightSource: topic.weightSource,
    members,
  });
});

// Admin-only per-member vote override. Lets an admin set (or clear) what a
// specific member voted on an existing votación, e.g. to fix a mistake or
// register a vote cast by hand. Supports both mociones (option-based) and
// candidato votaciones (allocation-based, single or multiple). Weight is frozen
// from the column the votación tallies with (normal vs alt), like a fresh vote.
//
// Moción body: `{ option: "favor"|"contra"|"abstención"|null }` — `option` is
// required; explicit null clears. Candidato body: `{ allocations: [...] | null }`
// — `allocations` is required; explicit null clears, otherwise the same
// single/multiple rules as a member vote apply. Requiring the field is
// deliberate so a malformed body can't silently erase a vote.
router.put(
  "/topics/:topicId/ballots/:userId",
  requireAdmin,
  async (req, res): Promise<void> => {
    const topicRaw = Array.isArray(req.params.topicId) ? req.params.topicId[0] : req.params.topicId;
    const userRaw = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
    const topicId = parseInt(topicRaw, 10);
    const userId = parseInt(userRaw, 10);
    if (isNaN(topicId) || isNaN(userId)) {
      res.status(400).json({ error: "ID inválido" });
      return;
    }

    const [topic] = await db.select().from(topicsTable).where(eq(topicsTable.id, topicId));
    if (!topic) {
      res.status(404).json({ error: "Tema no encontrado" });
      return;
    }

    const [user] = await db
      .select()
      .from(usersTable)
      .where(and(eq(usersTable.id, userId), eq(usersTable.rol, "miembro")));
    if (!user) {
      res.status(404).json({ error: "Miembro no encontrado" });
      return;
    }
    if (!user.active) {
      res.status(400).json({ error: "El miembro está inhabilitado" });
      return;
    }

    // Estamento eligibility (empty set => open to everyone).
    const eligible = await getEligibleEstamentos(topicId);
    if (!isEligible(eligible, user.group)) {
      res.status(400).json({ error: "El miembro no participa en esta votación" });
      return;
    }

    // Frozen from the session's weight snapshot, like a fresh member vote.
    const weightAtVote = sessionWeightFor(
      await getSessionWeightMap(topic.sessionId),
      userId,
      topic.weightSource === "alt",
      user,
    );

    // Build the detail rows to persist (empty => clear the member's vote).
    let detailRows: DetailRow[] = [];
    let clearing = false;
    let responseOption: string | null = null;

    if (topic.type === "candidato") {
      if (!(req.body && Object.prototype.hasOwnProperty.call(req.body, "allocations"))) {
        res
          .status(400)
          .json({ error: "Debes enviar las asignaciones (arreglo de votos, o null para borrar)" });
        return;
      }
      if (req.body.allocations === null) {
        clearing = true;
      } else {
        const validCandidateIds = await getValidCandidateIds(topicId);
        const built = buildCandidatoRows(topic, req.body.allocations, validCandidateIds);
        if (!built.ok) {
          res.status(built.status).json({ error: built.error });
          return;
        }
        detailRows = built.rows;
      }
    } else {
      // `option` is required: explicit null clears; otherwise must be valid.
      if (!(req.body && Object.prototype.hasOwnProperty.call(req.body, "option"))) {
        res.status(400).json({ error: "Debes enviar la opción (favor, contra, abstención o null)" });
        return;
      }
      const option: string | null = req.body.option ?? null;
      if (option !== null && !VOTE_OPTIONS.includes(option)) {
        res.status(400).json({ error: "Opción inválida. Use: favor, contra, abstención" });
        return;
      }
      if (option === null) {
        clearing = true;
      } else {
        detailRows = [{ candidateId: null, option }];
        responseOption = option;
      }
    }

    const correctionAllowed = await db.transaction(async (tx) => {
      // Serialize corrections with closure and other ballot edits.
      const [current] = await tx.select().from(topicsTable)
        .where(eq(topicsTable.id, topicId)).for("update");
      if (!current || current.electorateSnapshot) return false;
      await tx
        .delete(votesTable)
        .where(and(eq(votesTable.voteTopicId, topicId), eq(votesTable.userId, userId)));
      await tx
        .delete(voteBallotsTable)
        .where(and(eq(voteBallotsTable.voteTopicId, topicId), eq(voteBallotsTable.userId, userId)));

      if (clearing) return true;

      const [ballot] = await tx
        .insert(voteBallotsTable)
        .values({ voteTopicId: topicId, userId, weightAtVote })
        .returning();

      await tx.insert(votesTable).values(
        detailRows.map((d) => ({
          voteTopicId: topicId,
          userId,
          ballotId: ballot.id,
          candidateId: d.candidateId,
          option: d.option,
          weightAtVote,
        })),
      );
      return true;
    });

    if (!correctionAllowed) {
      res.status(409).json({ error: "Reabre la votación antes de corregir un resultado cerrado" });
      return;
    }

    emitVotesChanged(topic.sessionId, topicId);

    // Echo the persisted candidate allocations (excluding the derived abstención
    // rows) so the client can reconcile without an extra round trip.
    const allocations = detailRows
      .filter((d) => d.candidateId !== null)
      .map((d) => ({ candidateId: d.candidateId as number, count: 1 }));

    res.json({
      topicId,
      userId,
      option: responseOption,
      allocations,
      weightAtVote: clearing ? null : parseFloat(weightAtVote),
    });
  },
);

router.get("/members/me/votes", requireAuth, async (req, res): Promise<void> => {
  const userId = req.session.userId!;

  const myVotes = await db
    .select({
      topicId: votesTable.voteTopicId,
      topicTitle: topicsTable.title,
      sessionTitle: plenariasTable.title,
      option: votesTable.option,
      candidateName: topicCandidatesTable.name,
      weightAtVote: votesTable.weightAtVote,
      timestamp: votesTable.timestamp,
    })
    .from(votesTable)
    .innerJoin(topicsTable, eq(votesTable.voteTopicId, topicsTable.id))
    .innerJoin(plenariasTable, eq(topicsTable.sessionId, plenariasTable.id))
    .leftJoin(topicCandidatesTable, eq(votesTable.candidateId, topicCandidatesTable.id))
    .where(eq(votesTable.userId, userId))
    .orderBy(sql`${votesTable.timestamp} DESC`);

  res.json(
    myVotes.map((v) => ({
      topicId: v.topicId,
      topicTitle: v.topicTitle,
      sessionTitle: v.sessionTitle,
      option: v.option ?? v.candidateName ?? "abstención",
      weightAtVote: parseFloat(v.weightAtVote),
      timestamp: v.timestamp,
    })),
  );
});

export default router;
