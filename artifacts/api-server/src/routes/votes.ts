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
import { buildCandidatoRows, type DetailRow } from "../lib/candidate-votes";

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

router.post("/topics/:topicId/vote", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.topicId) ? req.params.topicId[0] : req.params.topicId;
  const topicId = parseInt(raw, 10);
  if (isNaN(topicId)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const userId = req.session.userId!;

  const [topic] = await db.select().from(topicsTable).where(eq(topicsTable.id, topicId));
  if (!topic) {
    res.status(404).json({ error: "Tema no encontrado" });
    return;
  }
  if (topic.status !== "abierto") {
    res.status(400).json({ error: "La votación no está abierta" });
    return;
  }

  const [session] = await db.select({ status: plenariasTable.status })
    .from(plenariasTable).where(eq(plenariasTable.id, topic.sessionId));
  if (!session || session.status !== "abierta") {
    res.status(400).json({ error: "La sesión no está abierta" });
    return;
  }

  // Active attendance required (retired members cannot vote)
  const [attendance] = await db
    .select()
    .from(attendanceTable)
    .where(
      and(eq(attendanceTable.sessionId, topic.sessionId), eq(attendanceTable.userId, userId)),
    );
  if (!attendance) {
    res.status(400).json({ error: "No tienes asistencia registrada en esta sesión" });
    return;
  }
  if (attendance.checkedOutAt !== null) {
    res.status(400).json({ error: "Te has retirado de la sesión y no puedes votar" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) {
    res.status(400).json({ error: "Usuario no encontrado" });
    return;
  }
  if (!user.active) {
    res.status(403).json({ error: "Tu cuenta está inhabilitada" });
    return;
  }

  // Estamento eligibility
  const eligible = await getEligibleEstamentos(topicId);
  if (!isEligible(eligible, user.group)) {
    res.status(403).json({ error: "Tu estamento no participa en esta votación" });
    return;
  }

  // Freeze the weight from the column the votación tallies with (normal vs
  // alt), read from the session's weight snapshot so later user-weight edits
  // never shift a vote already scoped to this session.
  const sessionWeights = await getSessionWeightMap(topic.sessionId);
  const weightAtVote = sessionWeightFor(
    sessionWeights,
    userId,
    topic.weightSource === "alt",
    user,
  );
  // Candidato (single or multiple) is candidate-based; single just caps at 1 vote.
  const isCandidate = topic.type === "candidato";

  // Build the detail rows to insert
  let detailRows: { candidateId: number | null; option: string | null }[] = [];

  if (isCandidate) {
    const validCandidateIds = await getValidCandidateIds(topicId);
    const built = buildCandidatoRows(topic, req.body?.allocations, validCandidateIds);
    if (!built.ok) {
      res.status(built.status).json({ error: built.error });
      return;
    }
    detailRows = built.rows;
  } else {
    // moción: option-based (favor/contra/abstención)
    const option = req.body?.option;
    if (!option || !VOTE_OPTIONS.includes(option)) {
      res.status(400).json({ error: "Opción inválida. Use: favor, contra, abstención" });
      return;
    }
    detailRows = [{ candidateId: null, option }];
  }

  // Atomic guard: one ballot per (topic,user). Also reject any legacy vote rows.
  let inserted = false;
  const rejection = await db.transaction(async (tx) => {
    // Keep admission valid until COMMIT. Shared row locks allow other voters
    // through, while closure, edits and checkout wait for this ballot to finish.
    // Lock order: session -> topic -> user -> attendance.
    const [currentSession] = await tx.select().from(plenariasTable)
      .where(eq(plenariasTable.id, topic.sessionId)).for("share");
    if (!currentSession || currentSession.status !== "abierta") {
      return { status: 400, error: "La sesión no está abierta" };
    }
    const [currentTopic] = await tx.select().from(topicsTable)
      .where(eq(topicsTable.id, topicId)).for("share");
    if (!currentTopic || currentTopic.status !== "abierto") {
      return { status: 400, error: "La votación no está abierta" };
    }
    if ((["type", "candidateMode", "weighted", "weightSource", "votesPerVoter"] as const)
      .some((key) => currentTopic[key] !== topic[key])) {
      return { status: 409, error: "La configuración de la votación cambió. Actualiza e intenta nuevamente" };
    }
    const [currentUser] = await tx.select().from(usersTable)
      .where(eq(usersTable.id, userId)).for("share");
    if (!currentUser?.active) return { status: 403, error: "Tu cuenta está inhabilitada" };
    const [currentAttendance] = await tx.select().from(attendanceTable)
      .where(and(eq(attendanceTable.sessionId, topic.sessionId), eq(attendanceTable.userId, userId))).for("share");
    if (!currentAttendance || currentAttendance.checkedOutAt !== null) {
      return { status: 400, error: "No tienes asistencia activa en esta sesión" };
    }
    const currentEstamentos = await tx.select().from(topicEstamentosTable)
      .where(eq(topicEstamentosTable.voteTopicId, topicId));
    if (!isEligible(new Set(currentEstamentos.map((e) => e.estamentoName)), currentUser.group)) {
      return { status: 403, error: "Tu estamento no participa en esta votación" };
    }
    if (isCandidate) {
      const candidates = await tx.select({ id: topicCandidatesTable.id }).from(topicCandidatesTable)
        .where(eq(topicCandidatesTable.voteTopicId, topicId));
      const ids = new Set(candidates.map((c) => c.id));
      if (detailRows.some((d) => d.candidateId !== null && !ids.has(d.candidateId))) {
        return { status: 409, error: "Las candidaturas cambiaron. Actualiza e intenta nuevamente" };
      }
    }
    const existing = await tx
      .select({ id: votesTable.id })
      .from(votesTable)
      .where(and(eq(votesTable.voteTopicId, topicId), eq(votesTable.userId, userId)))
      .limit(1);
    if (existing.length > 0) return;

    const [ballot] = await tx
      .insert(voteBallotsTable)
      .values({ voteTopicId: topicId, userId, weightAtVote })
      .onConflictDoNothing()
      .returning();
    if (!ballot) return;

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
    inserted = true;
    return undefined;
  });

  if (rejection) {
    res.status(rejection.status).json({ error: rejection.error });
    return;
  }
  if (!inserted) {
    res.status(409).json({ error: "Ya emitiste tu voto en este tema" });
    return;
  }

  emitVotesChanged(topic.sessionId, topicId);

  res.json({
    topicId,
    option: isCandidate ? null : detailRows[0].option,
    weightAtVote: parseFloat(weightAtVote),
  });
});

router.get("/topics/:topicId/results", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.topicId) ? req.params.topicId[0] : req.params.topicId;
  const topicId = parseInt(raw, 10);
  if (isNaN(topicId)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const [topic] = await db.select().from(topicsTable).where(eq(topicsTable.id, topicId));
  if (!topic) {
    res.status(404).json({ error: "Tema no encontrado" });
    return;
  }

  const userId = req.session.userId!;

  const [liveVotes, allMembers, attendanceRows, eligibleSet, [me], [plenaria]] = await Promise.all([
    db.select().from(votesTable).where(eq(votesTable.voteTopicId, topicId)),
    db.select().from(usersTable).where(eq(usersTable.rol, "miembro")),
    db.select().from(attendanceTable).where(eq(attendanceTable.sessionId, topic.sessionId)),
    getEligibleEstamentos(topicId),
    db.select().from(usersTable).where(eq(usersTable.id, userId)),
    db.select().from(plenariasTable).where(eq(plenariasTable.id, topic.sessionId)),
  ]);

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
    await getSessionWeightMap(topic.sessionId),
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
    const candidates = await db
      .select()
      .from(topicCandidatesTable)
      .where(eq(topicCandidatesTable.voteTopicId, topicId))
      .orderBy(sql`${topicCandidatesTable.position} ASC, ${topicCandidatesTable.id} ASC`);

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

  const [topic] = await db.select().from(topicsTable).where(eq(topicsTable.id, topicId));
  if (!topic) {
    res.status(404).json({ error: "Tema no encontrado" });
    return;
  }

  const [liveVotes, allMembers, attendanceRows, eligibleSet, candidates, [plenaria]] =
    await Promise.all([
      db.select().from(votesTable).where(eq(votesTable.voteTopicId, topicId)),
      db.select().from(usersTable).where(eq(usersTable.rol, "miembro")),
      db.select().from(attendanceTable).where(eq(attendanceTable.sessionId, topic.sessionId)),
      getEligibleEstamentos(topicId),
      db.select().from(topicCandidatesTable).where(eq(topicCandidatesTable.voteTopicId, topicId)),
      db.select().from(plenariasTable).where(eq(plenariasTable.id, topic.sessionId)),
    ]);

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
    await getSessionWeightMap(topic.sessionId),
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
