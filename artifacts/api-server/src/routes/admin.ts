import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import {
  db,
  usersTable,
  plenariasTable,
  attendanceTable,
  topicsTable,
  topicCandidatesTable,
  votesTable,
  justifiedAbsencesTable,
  type ElectorateMember,
} from "@workspace/db";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { computeTopicResult, computeCandidateResult } from "../lib/results";
import { scopeMembersToSession } from "../lib/roster";
import { getSessionWeightMap, applySessionWeights } from "../lib/sessionWeights";

const router: IRouter = Router();

router.post("/admin/clear-all", requireAdmin, async (req, res): Promise<void> => {
  if (req.body?.confirmation !== "ELIMINAR TODO") {
    res.status(400).json({ error: "Escribe ELIMINAR TODO para confirmar" });
    return;
  }
  // Delete in order due to foreign key constraints
  await db.delete(votesTable);
  await db.delete(attendanceTable);
  await db.delete(topicsTable);
  await db.delete(plenariasTable);

  res.json({ ok: true, message: "Todo eliminado. Los miembros y sus pesos se conservan." });
});

router.get("/admin/stats", requireAuth, async (_req, res): Promise<void> => {
  const [memberCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(usersTable)
    .where(eq(usersTable.rol, "miembro"));

  const [sessionCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(plenariasTable);

  const [openSessionCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(plenariasTable)
    .where(eq(plenariasTable.status, "abierta"));

  const [topicCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(topicsTable);

  res.json({
    totalMembers: Number(memberCount?.count ?? 0),
    totalSessions: Number(sessionCount?.count ?? 0),
    openSessions: Number(openSessionCount?.count ?? 0),
    totalTopics: Number(topicCount?.count ?? 0),
  });
});

// Export attendance data as JSON (frontend uses SheetJS to generate Excel)
router.get("/sessions/:id/export/attendance", requireAdmin, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const sessionId = parseInt(raw, 10);
  if (isNaN(sessionId)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const [session] = await db.select().from(plenariasTable).where(eq(plenariasTable.id, sessionId));
  if (!session) {
    res.status(404).json({ error: "Sesión no encontrada" });
    return;
  }

  const rawMembers = await db.select().from(usersTable).where(eq(usersTable.rol, "miembro"));
  const attendanceRecords = await db
    .select({
      userId: attendanceTable.userId,
      timestamp: attendanceTable.timestamp,
      modality: attendanceTable.modality,
      checkedOutAt: attendanceTable.checkedOutAt,
    })
    .from(attendanceTable)
    .where(eq(attendanceTable.sessionId, sessionId));

  // Members created after this session never appear in its export (unless they
  // actually participated) — new accounts don't retro-affect past sessions.
  // Weights come from the session's frozen snapshot.
  const allMembers = applySessionWeights(
    scopeMembersToSession(
      rawMembers,
      session.createdAt,
      new Set(attendanceRecords.map((a) => a.userId)),
    ),
    await getSessionWeightMap(sessionId),
  );

  const attendanceById = new Map(attendanceRecords.map((a) => [a.userId, a]));

  // Absences flagged "Inasistencia Justificada" (label only — still absent).
  const justifiedRows = await db
    .select({ userId: justifiedAbsencesTable.userId })
    .from(justifiedAbsencesTable)
    .where(eq(justifiedAbsencesTable.sessionId, sessionId));
  const justifiedIds = new Set(justifiedRows.map((j) => j.userId));

  const headers = [
    "Nombre",
    "Grupo",
    "Facultad/CE",
    "Peso Voto",
    "Asistencia",
    "Modalidad",
    "Hora Registro",
    "Hora Retiro",
  ];
  const rows = allMembers.map((m) => {
    const rec = attendanceById.get(m.id);
    let estado = justifiedIds.has(m.id) ? "Inasistencia Justificada" : "Ausente";
    if (rec) estado = rec.checkedOutAt !== null ? "Retirado" : "Presente";
    return [
      m.displayName,
      m.group ?? "",
      m.faculty ?? "",
      parseFloat(m.votingWeight).toFixed(4),
      estado,
      rec ? (rec.modality === "online" ? "Online" : "Presencial") : "",
      rec?.timestamp ? new Date(rec.timestamp).toLocaleString("es-CL") : "",
      rec?.checkedOutAt ? new Date(rec.checkedOutAt).toLocaleString("es-CL") : "",
    ];
  });

  res.json({ headers, rows });
});

// Export vote results for all topics
router.get("/sessions/:id/export/results", requireAdmin, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const sessionId = parseInt(raw, 10);
  if (isNaN(sessionId)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const [session] = await db.select().from(plenariasTable).where(eq(plenariasTable.id, sessionId));
  if (!session) {
    res.status(404).json({ error: "Sesión no encontrada" });
    return;
  }

  const topics = await db
    .select()
    .from(topicsTable)
    .where(eq(topicsTable.sessionId, sessionId));

  const rawMembers = await db.select().from(usersTable).where(eq(usersTable.rol, "miembro"));
  const attendanceRows = await db
    .select()
    .from(attendanceTable)
    .where(eq(attendanceTable.sessionId, sessionId));

  // Session-scoped roster: members created after this session don't alter its
  // denominators ("Ausente (peso)"/"Total (peso)"). Weights frozen per session.
  const allMembers = applySessionWeights(
    scopeMembersToSession(
      rawMembers,
      session.createdAt,
      new Set(attendanceRows.map((a) => a.userId)),
    ),
    await getSessionWeightMap(sessionId),
  );

  const attendeeIds = new Set(
    attendanceRows.filter((a) => a.checkedOutAt === null).map((a) => a.userId),
  );
  const checkedOutIds = new Set(
    attendanceRows.filter((a) => a.checkedOutAt !== null).map((a) => a.userId),
  );

  const headers = ["Tema", "Favor (peso)", "Contra (peso)", "Abstención (peso)", "Sin Voto (peso)", "Ausente (peso)", "Total (peso)", "% Favor", "% Contra", "Resultado"];
  const rows: string[][] = [];

  for (const topic of topics) {
    const topicVotes = topic.electorateSnapshot?.votes ?? await db
      .select()
      .from(votesTable)
      .where(eq(votesTable.voteTopicId, topic.id));

    // Candidato (multiple): one row per candidate with their weighted tally.
    if (topic.type === "candidato") {
      const candidates = await db
        .select()
        .from(topicCandidatesTable)
        .where(eq(topicCandidatesTable.voteTopicId, topic.id))
        .orderBy(sql`${topicCandidatesTable.position} ASC, ${topicCandidatesTable.id} ASC`);
      const ballotUserIds = new Set(topicVotes.map((v) => v.userId));
      const r = computeCandidateResult(
        topicVotes,
        candidates,
        allMembers,
        attendeeIds,
        checkedOutIds,
        ballotUserIds,
        topic.weighted,
        topic.electorateSnapshot,
        topic.weightSource === "alt",
      );
      for (const c of r.candidates) {
        rows.push([
          `${topic.title} — ${c.name}`,
          c.weight.toFixed(4),
          "",
          "",
          "",
          "",
          "",
          c.percentage.toFixed(2) + "%",
          "",
          topic.status === "cerrado" ? "CERRADO" : "EN CURSO",
        ]);
      }
      rows.push([
        `${topic.title} — Abstención`,
        r.abstenciónWeight.toFixed(4),
        "",
        "",
        r.sinVotoWeight.toFixed(4),
        r.ausenteWeight.toFixed(4),
        "",
        "",
        "",
        topic.status === "cerrado" ? "CERRADO" : "EN CURSO",
      ]);
      continue;
    }

    const { weights, percentages } = computeTopicResult(
      topic.status,
      topicVotes,
      allMembers,
      attendeeIds,
      checkedOutIds,
      topic.weighted,
      topic.electorateSnapshot,
      topic.weightSource === "alt",
    );
    const resultado =
      weights.favor > weights.contra
        ? "APROBADO"
        : weights.contra > weights.favor
          ? "RECHAZADO"
          : "EMPATE";

    rows.push([
      topic.title,
      weights.favor.toFixed(4),
      weights.contra.toFixed(4),
      weights.abstención.toFixed(4),
      weights.sinVoto.toFixed(4),
      weights.ausente.toFixed(4),
      weights.total.toFixed(4),
      percentages.favor.toFixed(2) + "%",
      percentages.contra.toFixed(2) + "%",
      topic.status === "cerrado" ? resultado : "EN CURSO",
    ]);
  }

  res.json({ headers, rows });
});

// Export vote matrix (who voted what on each topic)
router.get("/sessions/:id/export/matrix", requireAdmin, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const sessionId = parseInt(raw, 10);
  if (isNaN(sessionId)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const [session] = await db.select().from(plenariasTable).where(eq(plenariasTable.id, sessionId));
  if (!session) {
    res.status(404).json({ error: "Sesión no encontrada" });
    return;
  }

  const topics = await db
    .select()
    .from(topicsTable)
    .where(eq(topicsTable.sessionId, sessionId));

  const rawMembers = await db.select().from(usersTable).where(eq(usersTable.rol, "miembro"));
  const attendanceRows = await db
    .select()
    .from(attendanceTable)
    .where(eq(attendanceTable.sessionId, sessionId));

  // Session-scoped roster: members created after this session don't appear in
  // its vote matrix (unless they actually participated). Weights frozen per session.
  const allMembers = applySessionWeights(
    scopeMembersToSession(
      rawMembers,
      session.createdAt,
      new Set(attendanceRows.map((a) => a.userId)),
    ),
    await getSessionWeightMap(sessionId),
  );

  const attendeeIds = new Set(
    attendanceRows.filter((a) => a.checkedOutAt === null).map((a) => a.userId),
  );
  const checkedOutIds = new Set(
    attendanceRows.filter((a) => a.checkedOutAt !== null).map((a) => a.userId),
  );

  // Build vote map: topicId -> userId -> label.
  // Moción/single: the option. Candidato: candidate name(s) the member voted for
  // (with ×N for cumulative), or "Abstención" when they abstained.
  const voteMap: Map<number, Map<number, string>> = new Map();
  for (const topic of topics) {
    const topicVotes = topic.electorateSnapshot?.votes ?? await db
      .select()
      .from(votesTable)
      .where(eq(votesTable.voteTopicId, topic.id));

    const byUser = new Map<number, string>();
    if (topic.type === "candidato") {
      const candidates = await db
        .select()
        .from(topicCandidatesTable)
        .where(eq(topicCandidatesTable.voteTopicId, topic.id));
      const nameById = new Map(candidates.map((c) => [c.id, c.name]));
      const perUser = new Map<number, Map<string, number>>();
      for (const v of topicVotes) {
        let counts = perUser.get(v.userId);
        if (!counts) perUser.set(v.userId, (counts = new Map<string, number>()));
        const label = v.candidateId === null ? "Abstención" : nameById.get(v.candidateId) ?? "—";
        counts.set(label, (counts.get(label) ?? 0) + 1);
      }
      for (const [userId, counts] of perUser) {
        byUser.set(
          userId,
          [...counts.entries()].map(([name, n]) => (n > 1 ? `${name} ×${n}` : name)).join(", "),
        );
      }
    } else {
      for (const v of topicVotes) {
        if (v.option !== null) byUser.set(v.userId, v.option);
      }
    }
    voteMap.set(topic.id, byUser);
  }

  const topicTitles = topics.map((t) => t.title);
  const headers = ["Nombre", "Grupo", "Facultad/CE", "Peso Voto", "Asistencia", ...topicTitles];

  const matrixMembers = new Map<number, ElectorateMember>(allMembers.map((m) => [m.id, m]));
  for (const topic of topics) {
    for (const member of topic.electorateSnapshot?.members ?? []) matrixMembers.set(member.id, member);
  }
  const rows = [...matrixMembers.values()].map((m) => {
    const attended = attendeeIds.has(m.id);
    const retired = checkedOutIds.has(m.id);
    const estado = attended ? "Presente" : retired ? "Retirado" : "Ausente";
    const voteCols = topics.map((t) => {
      const recordedVote = voteMap.get(t.id)?.get(m.id);
      if (recordedVote !== undefined) return recordedVote;
      if (t.electorateSnapshot) {
        if (!t.electorateSnapshot.members.some((member) => member.id === m.id)) return "No habilitado";
        if (t.electorateSnapshot.checkedOutIds.includes(m.id)) return "Retirado";
        return t.electorateSnapshot.attendeeIds.includes(m.id) ? "Sin voto" : "Ausente";
      }
      if (retired) return "Retirado";
      if (!attended) return "Ausente";
      return voteMap.get(t.id)?.get(m.id) ?? "Sin voto";
    });
    return [
      m.displayName,
      m.group ?? "",
      m.faculty ?? "",
      parseFloat(m.votingWeight).toFixed(4),
      estado,
      ...voteCols,
    ];
  });

  res.json({ headers, rows });
});

export default router;
