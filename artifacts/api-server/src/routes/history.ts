import { Router, type IRouter } from "express";
import { Readable } from "stream";
import { and, eq, sql } from "drizzle-orm";
import {
  db,
  plenariasTable,
  topicsTable,
  topicCandidatesTable,
  topicEstamentosTable,
  votesTable,
  attendanceTable,
  usersTable,
  justifiedAbsencesTable,
  agendaPointsTable,
  speakingTurnsTable,
} from "@workspace/db";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { computeTopicResult, computeCandidateResult } from "../lib/results";
import { scopeMembersToSession } from "../lib/roster";
import {
  getAllSessionWeightMaps,
  applySessionWeights,
  type SessionWeightMap,
} from "../lib/sessionWeights";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";

const objectStorageService = new ObjectStorageService();

const router: IRouter = Router();

type TopicRow = typeof topicsTable.$inferSelect;
type VoteRow = typeof votesTable.$inferSelect;
type MemberRow = typeof usersTable.$inferSelect;

interface LoadedData {
  sessions: (typeof plenariasTable.$inferSelect)[];
  topics: TopicRow[];
  members: MemberRow[];
  allVotes: VoteRow[];
  attendanceBySession: Map<number, Set<number>>;
  checkedOutBySession: Map<number, Set<number>>;
  modalityBySession: Map<number, Map<number, "online" | "presencial">>;
  votesByTopic: Map<number, VoteRow[]>;
  candidatesByTopic: Map<number, { id: number; name: string; position: number }[]>;
  estamentosByTopic: Map<number, Set<string>>;
  candidateNameById: Map<number, string>;
  weightsBySession: Map<number, SessionWeightMap>;
  // Label-only overlay: absences marked "Inasistencia Justificada" by an admin.
  // Operationally these members are plain absentees (no attendance row).
  justifiedBySession: Map<number, Set<number>>;
  // Session agenda ("tabla"), ordered by position — the list of points the
  // pleno works through. Published so the public panel can show what each
  // session covered, and what an upcoming one will cover.
  agendaBySession: Map<number, { title: string; position: number; estimatedMinutes: number | null }[]>;
  // Uso de la palabra por sesión, agregado por orador. Solo turnos
  // finalizados: los que quedaron en cola o quedaron a medias no son registro
  // de nada. La palabra colectiva se atribuye a la unidad, no a una persona.
  speakersBySession: Map<
    number,
    { name: string; group: string | null; seconds: number; turns: number; collective: boolean }[]
  >;
  // Turnos propios por (sesión, integrante), para el histórico personal.
  // Clave: `${sessionId}:${userId}`.
  ownTurns: Map<string, { seconds: number; turns: number }>;
}

async function loadHistoryData(): Promise<LoadedData> {
  const [
    sessions,
    topics,
    members,
    allVotes,
    attendanceRows,
    candidates,
    estamentos,
    weightsBySession,
    justifiedRows,
    agendaRows,
    speakingRows,
  ] = await Promise.all([
    db.select().from(plenariasTable).orderBy(sql`${plenariasTable.createdAt} DESC`),
    db.select().from(topicsTable).orderBy(sql`${topicsTable.createdAt} ASC`),
    db.select().from(usersTable).where(eq(usersTable.rol, "miembro")),
    db.select().from(votesTable),
    db.select().from(attendanceTable),
    db.select().from(topicCandidatesTable),
    db.select().from(topicEstamentosTable),
    getAllSessionWeightMaps(),
    db.select().from(justifiedAbsencesTable),
    db.select().from(agendaPointsTable).orderBy(agendaPointsTable.position, agendaPointsTable.id),
    db.select().from(speakingTurnsTable).where(eq(speakingTurnsTable.status, "finalizada")),
  ]);

  const agendaBySession = new Map<
    number,
    { title: string; position: number; estimatedMinutes: number | null }[]
  >();
  for (const a of agendaRows) {
    let arr = agendaBySession.get(a.sessionId);
    if (!arr) agendaBySession.set(a.sessionId, (arr = []));
    arr.push({ title: a.title, position: a.position, estimatedMinutes: a.estimatedMinutes });
  }

  // Uso de la palabra, agregado por orador dentro de cada sesión.
  const memberById = new Map(members.map((m) => [m.id, m]));
  const speakersBySession = new Map<
    number,
    { name: string; group: string | null; seconds: number; turns: number; collective: boolean }[]
  >();
  for (const t of speakingRows) {
    // Una intervención colectiva la ejerce la unidad académica, no una
    // persona: atribuirla a quien la pidió inflaría su registro individual.
    const isCollective = t.kind === "colectiva";
    const member = t.userId !== null ? memberById.get(t.userId) : undefined;
    const name = isCollective
      ? t.faculty ?? "Palabra colectiva"
      : member?.displayName ?? t.speakerName ?? "—";
    const group = isCollective ? t.faculty : member?.group ?? null;

    let arr = speakersBySession.get(t.sessionId);
    if (!arr) speakersBySession.set(t.sessionId, (arr = []));
    const existing = arr.find((s) => s.name === name);
    if (existing) {
      existing.seconds += t.elapsedSeconds;
      existing.turns += 1;
      existing.collective ||= isCollective;
    } else {
      arr.push({ name, group, seconds: t.elapsedSeconds, turns: 1, collective: isCollective });
    }
  }
  for (const arr of speakersBySession.values()) {
    arr.sort((a, b) => b.seconds - a.seconds || a.name.localeCompare(b.name, "es"));
  }

  // Registro propio. A diferencia del agregado público, aquí sí se cuentan las
  // intervenciones colectivas en las que participó la persona: es su historial,
  // no una atribución pública de mérito.
  const ownTurns = new Map<string, { seconds: number; turns: number }>();
  for (const t of speakingRows) {
    if (t.userId === null) continue;
    const key = `${t.sessionId}:${t.userId}`;
    const cur = ownTurns.get(key) ?? { seconds: 0, turns: 0 };
    cur.seconds += t.elapsedSeconds;
    cur.turns += 1;
    ownTurns.set(key, cur);
  }

  const justifiedBySession = new Map<number, Set<number>>();
  for (const j of justifiedRows) {
    let set = justifiedBySession.get(j.sessionId);
    if (!set) justifiedBySession.set(j.sessionId, (set = new Set<number>()));
    set.add(j.userId);
  }

  const attendanceBySession = new Map<number, Set<number>>();
  const checkedOutBySession = new Map<number, Set<number>>();
  const modalityBySession = new Map<number, Map<number, "online" | "presencial">>();
  for (const a of attendanceRows) {
    const target = a.checkedOutAt !== null ? checkedOutBySession : attendanceBySession;
    let set = target.get(a.sessionId);
    if (!set) target.set(a.sessionId, (set = new Set<number>()));
    set.add(a.userId);
    // Modality is kept for everyone who attended — including members who later
    // checked out: they WERE present, they just left early.
    let modMap = modalityBySession.get(a.sessionId);
    if (!modMap) modalityBySession.set(a.sessionId, (modMap = new Map()));
    modMap.set(a.userId, a.modality);
  }

  const votesByTopic = new Map<number, VoteRow[]>();
  for (const v of allVotes) {
    let arr = votesByTopic.get(v.voteTopicId);
    if (!arr) votesByTopic.set(v.voteTopicId, (arr = []));
    arr.push(v);
  }

  const candidatesByTopic = new Map<number, { id: number; name: string; position: number }[]>();
  const candidateNameById = new Map<number, string>();
  for (const c of candidates) {
    let arr = candidatesByTopic.get(c.voteTopicId);
    if (!arr) candidatesByTopic.set(c.voteTopicId, (arr = []));
    arr.push({ id: c.id, name: c.name, position: c.position });
    candidateNameById.set(c.id, c.name);
  }
  for (const arr of candidatesByTopic.values()) {
    arr.sort((a, b) => a.position - b.position || a.id - b.id);
  }

  const estamentosByTopic = new Map<number, Set<string>>();
  for (const e of estamentos) {
    let set = estamentosByTopic.get(e.voteTopicId);
    if (!set) estamentosByTopic.set(e.voteTopicId, (set = new Set<string>()));
    set.add(e.estamentoName);
  }

  return {
    sessions,
    topics,
    members,
    allVotes,
    attendanceBySession,
    checkedOutBySession,
    modalityBySession,
    votesByTopic,
    candidatesByTopic,
    estamentosByTopic,
    candidateNameById,
    weightsBySession,
    justifiedBySession,
    agendaBySession,
    speakersBySession,
    ownTurns,
  };
}

// Members that belong to a session's roster: active accounts that existed when
// the session was created (or that actually participated in it). Members added
// later never retro-affect past sessions' rosters, quorums, or absentee lists.
function sessionRoster(data: LoadedData, s: typeof plenariasTable.$inferSelect): MemberRow[] {
  const attendeeIds = data.attendanceBySession.get(s.id) ?? new Set<number>();
  const checkedOutIds = data.checkedOutBySession.get(s.id) ?? new Set<number>();
  const participantIds = new Set([...attendeeIds, ...checkedOutIds]);
  // Weights are frozen per session (snapshot at creation): overlay them so
  // later weight edits never retro-affect this session's totals/results.
  return applySessionWeights(
    scopeMembersToSession(data.members.filter((m) => m.active), s.createdAt, participantIds),
    data.weightsBySession.get(s.id),
  );
}

function eligibleMembersFor(data: LoadedData, roster: MemberRow[], topicId: number): MemberRow[] {
  const set = data.estamentosByTopic.get(topicId);
  if (!set || set.size === 0) return roster;
  return roster.filter((m) => m.group !== null && set.has(m.group));
}

// Shared topic result payload (both mocion and candidato shapes).
function buildTopicResult(
  data: LoadedData,
  roster: MemberRow[],
  t: TopicRow,
  attendeeIds: Set<number>,
  checkedOutIds: Set<number>,
) {
  const votes = t.electorateSnapshot?.votes ?? data.votesByTopic.get(t.id) ?? [];
  // Resolve each member's effective weight from the column the votación tallies with.
  const useAlt = t.weightSource === "alt";
  const members = eligibleMembersFor(data, roster, t.id).map((m) => ({
    ...m,
    votingWeight: useAlt ? m.votingWeightAlt : m.votingWeight,
  }));

  if (t.type === "candidato") {
    const candidates = data.candidatesByTopic.get(t.id) ?? [];
    const ballotUserIds = new Set(votes.map((v) => v.userId));
    const r = computeCandidateResult(
      votes,
      candidates,
      members,
      attendeeIds,
      checkedOutIds,
      ballotUserIds,
      t.weighted,
      t.electorateSnapshot,
      useAlt,
    );
    return {
      type: t.type,
      candidateMode: t.candidateMode,
      weighted: t.weighted,
      candidates: r.candidates,
      approved: null as boolean | null,
      voteCount: r.voteCount,
    };
  }

  const r = computeTopicResult(t.status, votes, members, attendeeIds, checkedOutIds, t.weighted, t.electorateSnapshot, useAlt);
  return {
    type: t.type,
    candidateMode: t.candidateMode,
    weighted: t.weighted,
    weights: r.weights,
    percentages: r.percentages,
    approved: r.approved,
    voteCount: r.voteCount,
  };
}

// Per-member nominal ballot list for a topic (transparency detail): every
// eligible member with their attendance status and vote label. In admin views
// retired members keep their status distinct ("checkedOut"); the PUBLIC view
// collapses them into "present" — attending and leaving early is an
// admin-only distinction. Previously emitted votes are shown and counted.
function buildTopicBallots(
  data: LoadedData,
  roster: MemberRow[],
  t: TopicRow,
  attendeeIds: Set<number>,
  checkedOutIds: Set<number>,
  opts: { collapseRetired?: boolean } = {},
) {
  const votes = t.electorateSnapshot?.votes ?? data.votesByTopic.get(t.id) ?? [];
  const votesByUser = new Map<number, typeof votes>();
  for (const v of votes) {
    let arr = votesByUser.get(v.userId);
    if (!arr) votesByUser.set(v.userId, (arr = []));
    arr.push(v);
  }

  const labelFor = (rows: typeof votes): string => {
    if (rows.length === 1 && rows[0].option) return rows[0].option;
    const counts = new Map<string, number>();
    for (const r of rows) {
      const label =
        r.candidateId === null ? "Abstención" : data.candidateNameById.get(r.candidateId) ?? "—";
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return [...counts.entries()].map(([name, n]) => (n > 1 ? `${name} ×${n}` : name)).join(", ");
  };

  if (t.electorateSnapshot) {
    attendeeIds = new Set(t.electorateSnapshot.attendeeIds);
    checkedOutIds = new Set(t.electorateSnapshot.checkedOutIds);
  }
  return (t.electorateSnapshot?.members ?? eligibleMembersFor(data, roster, t.id))
    .map((m) => {
      const status = attendeeIds.has(m.id)
        ? ("present" as const)
        : checkedOutIds.has(m.id)
          ? opts.collapseRetired
            ? ("present" as const)
            : ("checkedOut" as const)
          : ("absent" as const);
      const rows = votesByUser.get(m.id);
      return {
        name: m.displayName,
        group: m.group,
        status,
        voteLabel: rows ? labelFor(rows) : null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

function topicsBySessionMap(topics: TopicRow[]): Map<number, TopicRow[]> {
  const m = new Map<number, TopicRow[]>();
  for (const t of topics) {
    let arr = m.get(t.sessionId);
    if (!arr) m.set(t.sessionId, (arr = []));
    arr.push(t);
  }
  return m;
}

// Member personal history: every session with attendance status + per-topic own vote + aggregate results
router.get("/history/me", requireAuth, async (req, res): Promise<void> => {
  const userId = req.session.userId!;
  const data = await loadHistoryData();

  // My vote summary per topic (option, candidate names, or null)
  const myVoteByTopic = new Map<number, string>();
  const myVotesByTopic = new Map<number, VoteRow[]>();
  for (const v of data.allVotes) {
    if (v.userId !== userId) continue;
    let arr = myVotesByTopic.get(v.voteTopicId);
    if (!arr) myVotesByTopic.set(v.voteTopicId, (arr = []));
    arr.push(v);
  }
  for (const [topicId, rows] of myVotesByTopic) {
    if (rows.length === 1 && rows[0].option) {
      myVoteByTopic.set(topicId, rows[0].option);
    } else {
      const counts = new Map<string, number>();
      for (const r of rows) {
        const label = r.candidateId === null ? "Abstención" : data.candidateNameById.get(r.candidateId) ?? "—";
        counts.set(label, (counts.get(label) ?? 0) + 1);
      }
      myVoteByTopic.set(
        topicId,
        [...counts.entries()].map(([name, n]) => (n > 1 ? `${name} ×${n}` : name)).join(", "),
      );
    }
  }

  const topicsBySession = topicsBySessionMap(data.topics);

  const result = data.sessions.map((s) => {
    const attendeeIds = data.attendanceBySession.get(s.id) ?? new Set<number>();
    const checkedOutIds = data.checkedOutBySession.get(s.id) ?? new Set<number>();
    const sessionTopics = topicsBySession.get(s.id) ?? [];

    return {
      sessionId: s.id,
      title: s.title,
      location: s.location,
      scheduledAt: s.scheduledAt,
      status: s.status,
      createdAt: s.createdAt,
      meetingLink: s.meetingLink,
      actaObjectPath: s.actaObjectPath,
      actaFileName: s.actaFileName,
      // A member who checked out early still ATTENDED the session — retiring
      // early is not the same as being absent.
      attended: attendeeIds.has(userId) || checkedOutIds.has(userId),
      // Admin-marked "Inasistencia Justificada" — display label only; still a
      // normal absence for quorum and voting eligibility.
      justified: (data.justifiedBySession.get(s.id) ?? new Set()).has(userId),
      topics: sessionTopics.map((t) => ({
        topicId: t.id,
        title: t.title,
        detail: t.detail,
        status: t.status,
        myVote: myVoteByTopic.get(t.id) ?? null,
        ...buildTopicResult(data, sessionRoster(data, s), t, attendeeIds, checkedOutIds),
      })),
      // Quiénes intervinieron en la sesión, y el registro propio.
      speakers: data.speakersBySession.get(s.id) ?? [],
      mySeconds: data.ownTurns.get(`${s.id}:${userId}`)?.seconds ?? 0,
      myTurns: data.ownTurns.get(`${s.id}:${userId}`)?.turns ?? 0,
      officialMinutes:
        s.officialStartAt !== null && s.officialEndAt !== null
          ? Math.max(
              0,
              Math.round((s.officialEndAt.getTime() - s.officialStartAt.getTime()) / 60000),
            )
          : null,
    };
  });

  res.json(result);
});

// Admin history: all sessions with their votations + results + attendance summary
router.get("/history/sessions", requireAdmin, async (_req, res): Promise<void> => {
  const data = await loadHistoryData();

  const topicsBySession = topicsBySessionMap(data.topics);

  const result = data.sessions.map((s) => {
    const attendeeIds = data.attendanceBySession.get(s.id) ?? new Set<number>();
    const checkedOutIds = data.checkedOutBySession.get(s.id) ?? new Set<number>();
    const sessionTopics = topicsBySession.get(s.id) ?? [];
    // Roster is scoped per session: members created after the session never
    // affect its totals/quorum.
    const roster = sessionRoster(data, s);
    const totalMembers = roster.length;
    const totalWeight = roster.reduce((sum, m) => sum + parseFloat(m.votingWeight), 0);
    const weightById = new Map(roster.map((m) => [m.id, parseFloat(m.votingWeight)]));
    // Attendance summary counts everyone who attended, including members who
    // retired early (they were present; tallies handle their weight separately).
    const attendedIds = new Set([...attendeeIds, ...checkedOutIds]);
    let presentWeight = 0;
    for (const id of attendedIds) presentWeight += weightById.get(id) ?? 0;

    return {
      sessionId: s.id,
      title: s.title,
      location: s.location,
      scheduledAt: s.scheduledAt,
      status: s.status,
      createdAt: s.createdAt,
      meetingLink: s.meetingLink,
      actaObjectPath: s.actaObjectPath,
      actaFileName: s.actaFileName,
      presentCount: attendedIds.size,
      totalMembers,
      presentWeight,
      totalWeight,
      topics: sessionTopics.map((t) => ({
        topicId: t.id,
        title: t.title,
        detail: t.detail,
        status: t.status,
        ...buildTopicResult(data, roster, t, attendeeIds, checkedOutIds),
      })),
    };
  });

  res.json(result);
});

// Public (no auth): closed sessions with aggregate attendance + weighted results.
// Personal/per-member vote data is intentionally excluded.
router.get("/public/history", async (_req, res): Promise<void> => {
  const data = await loadHistoryData();

  const topicsBySession = topicsBySessionMap(data.topics);
  const now = Date.now();

  const result = data.sessions.map((s) => {
    const attendeeIds = data.attendanceBySession.get(s.id) ?? new Set<number>();
    const checkedOutIds = data.checkedOutBySession.get(s.id) ?? new Set<number>();
    const modalityMap = data.modalityBySession.get(s.id) ?? new Map();
    const sessionTopics = topicsBySession.get(s.id) ?? [];
    // Roster is scoped per session: members created after the session never
    // affect its totals, quorum, or absentee list.
    const roster = sessionRoster(data, s);
    const totalMembers = roster.length;
    const totalWeight = roster.reduce((sum, m) => sum + parseFloat(m.votingWeight), 0);
    const weightById = new Map(roster.map((m) => [m.id, parseFloat(m.votingWeight)]));
    const memberById = new Map(roster.map((m) => [m.id, m]));
    // Members who retired early still attended: publicly they are plain
    // attendees (the retired-early distinction is admin-only). Their recorded
    // votes remain counted; retirement only excludes later voting opportunities.
    const attendedIds = new Set([...attendeeIds, ...checkedOutIds]);
    let presentWeight = 0;
    for (const id of attendedIds) presentWeight += weightById.get(id) ?? 0;

    // Phase classification: open sessions are "activo"; closed sessions scheduled
    // for the future are "futuro"; everything else (held & closed, or drafts) is
    // "pasado". scheduledAt is the admin-set signal for upcoming plenaries.
    const scheduledMs = s.scheduledAt ? new Date(s.scheduledAt).getTime() : null;
    const phase: "pasado" | "activo" | "futuro" =
      s.status === "abierta"
        ? "activo"
        : scheduledMs !== null && scheduledMs > now
          ? "futuro"
          : "pasado";

    // Transparency roster: present members (with modality) + absentees. Only for
    // held/active sessions — future plenaries have no attendance yet. Names come
    // from active members; no usernames, weights, or other PII are exposed.
    const showRoster = phase !== "futuro";
    const attendees = showRoster
      ? Array.from(attendedIds)
          .map((id) => {
            const m = memberById.get(id);
            if (!m) return null;
            return {
              name: m.displayName,
              group: m.group,
              modality: (modalityMap.get(id) ?? "presencial") as "online" | "presencial",
            };
          })
          .filter(
            (
              x,
            ): x is {
              name: string;
              group: string | null;
              modality: "online" | "presencial";
            } => x !== null,
          )
          .sort((a, b) => a.name.localeCompare(b.name, "es"))
      : [];
    const justifiedIds = data.justifiedBySession.get(s.id) ?? new Set<number>();
    const absentees = showRoster
      ? roster
          .filter((m) => !attendedIds.has(m.id))
          .map((m) => ({
            name: m.displayName,
            group: m.group,
            // "Inasistencia Justificada" label — the member still counts as
            // absent everywhere (quorum, voting); only the display differs.
            justified: justifiedIds.has(m.id),
          }))
          .sort((a, b) => a.name.localeCompare(b.name, "es"))
      : [];

    return {
      sessionId: s.id,
      title: s.title,
      location: s.location,
      scheduledAt: s.scheduledAt,
      status: s.status,
      phase,
      createdAt: s.createdAt,
      meetingLink: s.meetingLink,
      // Public endpoint: never expose the internal object-storage key. Signal
      // acta availability via hasActa; the download goes through the public
      // acta endpoint, not this path.
      actaObjectPath: null,
      actaFileName: s.actaFileName,
      hasActa: !!s.actaObjectPath,
      presentCount: attendedIds.size,
      totalMembers,
      presentWeight,
      totalWeight,
      attendees,
      absentees,
      // The agenda is published for every phase: an upcoming plenary announces
      // what it will cover, and a held one documents what it did.
      agenda: data.agendaBySession.get(s.id) ?? [],
      // Duración real de la sesión, en minutos. Solo existe cuando la apertura
      // se declaró oficial y la sesión ya se cerró: una apertura de prueba no
      // suma horas, y una sesión en curso todavía no tiene duración.
      officialMinutes:
        s.officialStartAt !== null && s.officialEndAt !== null
          ? Math.max(
              0,
              Math.round((s.officialEndAt.getTime() - s.officialStartAt.getTime()) / 60000),
            )
          : null,
      // Registro de uso de la palabra. Solo en sesiones ya celebradas: una
      // futura no tiene intervenciones, y publicar la cola de una sesión en
      // curso expondría quién está por hablar antes de que hable.
      speakers: phase === "pasado" ? data.speakersBySession.get(s.id) ?? [] : [],
      // Only closed (held) sessions expose vote tallies — in-progress and future
      // plenaries do not publish live results. Each topic also carries the
      // per-member nominal ballot detail (transparency).
      topics:
        phase === "pasado"
          ? sessionTopics.map((t) => ({
              topicId: t.id,
              title: t.title,
              detail: t.detail,
              status: t.status,
              ...buildTopicResult(data, roster, t, attendeeIds, checkedOutIds),
              // Public view: no retired-early distinction — retirados appear
              // as plain attendees; their previously emitted votes remain counted.
              ballots: buildTopicBallots(data, roster, t, attendeeIds, checkedOutIds, {
                collapseRetired: true,
              }),
            }))
          : [],
    };
  });

  res.json(result);
});

// Public (no auth): download the acta (PDF) of a CLOSED session only. Guarded by
// looking up the session's stored acta path — no arbitrary object access.
router.get("/public/sessions/:id/acta", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const sessionId = parseInt(raw, 10);
  if (isNaN(sessionId)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const [session] = await db
    .select()
    .from(plenariasTable)
    .where(eq(plenariasTable.id, sessionId));
  if (!session || session.status !== "cerrada" || !session.actaObjectPath) {
    res.status(404).json({ error: "Acta no disponible" });
    return;
  }

  try {
    const objectFile = await objectStorageService.getObjectEntityFile(session.actaObjectPath);
    const response = await objectStorageService.downloadObject(objectFile);
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    if (response.body) {
      Readable.fromWeb(response.body as ReadableStream<Uint8Array>).pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Acta no encontrada" });
      return;
    }
    req.log.error({ err: error }, "Error serving public acta");
    res.status(500).json({ error: "Error al servir el acta" });
  }
});

// Public transparency: list of all active members (name, group, faculty only — no credentials)
router.get("/public/members", async (_req, res): Promise<void> => {
  const members = await db
    .select({
      name: usersTable.displayName,
      group: usersTable.group,
      faculty: usersTable.faculty,
    })
    .from(usersTable)
    .where(and(eq(usersTable.rol, "miembro"), eq(usersTable.active, true)))
    .orderBy(usersTable.displayName);
  res.json(members);
});

export default router;
