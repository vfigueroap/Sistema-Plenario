import { Router, type IRouter } from "express";
import { eq, inArray, asc, sql } from "drizzle-orm";
import {
  db,
  topicsTable,
  topicCandidatesTable,
  topicEstamentosTable,
  plenariasTable,
  votesTable,
  voteBallotsTable,
} from "@workspace/db";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { emitSessionEvent } from "../lib/realtime";
import { MAX_VOTES_PER_VOTER } from "../lib/candidate-votes";
import { captureElectorate } from "../lib/electorate";

const router: IRouter = Router();

// Fixed voting divisions (users.group values). Mesa Directiva is intentionally
// excluded; any other value sent as an estamento is dropped.
const ALLOWED_ESTAMENTOS = ["CEE", "Consejeros FECh", "COSEFECH"] as const;

type TopicRow = typeof topicsTable.$inferSelect;

function serializeTopic(
  t: TopicRow,
  candidates: { id: number; name: string; position: number }[],
  estamentos: string[],
) {
  return {
    id: t.id,
    sessionId: t.sessionId,
    agendaPointId: t.agendaPointId,
    title: t.title,
    detail: t.detail,
    status: t.status,
    type: t.type,
    candidateMode: t.candidateMode,
    weighted: t.weighted,
    weightSource: t.weightSource,
    votesPerVoter: t.votesPerVoter,
    candidates: candidates
      .slice()
      .sort((a, b) => a.position - b.position || a.id - b.id)
      .map((c) => ({ id: c.id, name: c.name, position: c.position })),
    estamentos,
    createdAt: t.createdAt,
  };
}

// Normalize the type/mode/candidates/votesPerVoter combo coming from the client.
function parseVotingShape(body: Record<string, unknown>) {
  const type = body.type === "candidato" ? "candidato" : "mocion";
  let candidateMode: "single" | "multiple" | null = null;
  let candidates: string[] = [];
  let votesPerVoter = 1;
  const weighted = body.weighted === undefined ? true : Boolean(body.weighted);

  if (type === "candidato") {
    // Default is single (pick one candidate); multiple (cumulative) is opt-in.
    candidateMode = body.candidateMode === "multiple" ? "multiple" : "single";
    candidates = Array.isArray(body.candidates)
      ? (body.candidates as unknown[])
          .map((c) => (typeof c === "string" ? c.trim() : ""))
          .filter((c) => c.length > 0)
      : [];
    if (candidateMode === "multiple") {
      votesPerVoter = body.votesPerVoter === undefined ? 1 : Number(body.votesPerVoter);
    } else {
      votesPerVoter = 1;
    }
  }

  // Eligibility is restricted to a fixed set of divisions (Mesa Directiva excluded).
  const estamentos = Array.isArray(body.estamentos)
    ? [
        ...new Set(
          (body.estamentos as unknown[])
            .map((e) => (typeof e === "string" ? e.trim() : ""))
            .filter((e) => (ALLOWED_ESTAMENTOS as readonly string[]).includes(e)),
        ),
      ]
    : [];

  // Which weight column tallies this votación. Only meaningful when weighted AND
  // estamento-restricted; force "normal" otherwise so unrestricted votes can't
  // silently persist the alternative weight.
  const weightSource =
    weighted && estamentos.length > 0 && body.weightSource === "alt" ? "alt" : "normal";

  return { type, candidateMode, candidates, votesPerVoter, weighted, weightSource, estamentos };
}

async function loadTopicRelations(topicIds: number[]) {
  const candByTopic = new Map<number, { id: number; name: string; position: number }[]>();
  const estByTopic = new Map<number, string[]>();
  if (topicIds.length === 0) return { candByTopic, estByTopic };

  const [cands, ests] = await Promise.all([
    db.select().from(topicCandidatesTable).where(inArray(topicCandidatesTable.voteTopicId, topicIds)),
    db.select().from(topicEstamentosTable).where(inArray(topicEstamentosTable.voteTopicId, topicIds)),
  ]);
  for (const c of cands) {
    let arr = candByTopic.get(c.voteTopicId);
    if (!arr) candByTopic.set(c.voteTopicId, (arr = []));
    arr.push({ id: c.id, name: c.name, position: c.position });
  }
  for (const e of ests) {
    let arr = estByTopic.get(e.voteTopicId);
    if (!arr) estByTopic.set(e.voteTopicId, (arr = []));
    arr.push(e.estamentoName);
  }
  return { candByTopic, estByTopic };
}

router.get("/sessions/:id/topics", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const sessionId = parseInt(raw, 10);
  if (isNaN(sessionId)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const topics = await db
    .select()
    .from(topicsTable)
    .where(eq(topicsTable.sessionId, sessionId))
    .orderBy(asc(topicsTable.createdAt));

  const { candByTopic, estByTopic } = await loadTopicRelations(topics.map((t) => t.id));

  res.json(
    topics.map((t) => serializeTopic(t, candByTopic.get(t.id) ?? [], estByTopic.get(t.id) ?? [])),
  );
});

router.post("/sessions/:id/topics", requireAdmin, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const sessionId = parseInt(raw, 10);
  if (isNaN(sessionId)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const { title, agendaPointId } = req.body;
  if (!title) {
    res.status(400).json({ error: "Título requerido" });
    return;
  }
  const detail =
    typeof req.body?.detail === "string" ? req.body.detail.trim() || null : null;

  const shape = parseVotingShape(req.body ?? {});
  if (!Number.isSafeInteger(shape.votesPerVoter) || shape.votesPerVoter < 1 || shape.votesPerVoter > MAX_VOTES_PER_VOTER) {
    res.status(400).json({ error: `Los votos por votante deben ser un entero entre 1 y ${MAX_VOTES_PER_VOTER}` });
    return;
  }
  if (shape.type === "candidato" && shape.candidates.length === 0) {
    res.status(400).json({ error: "Agrega al menos une candidate" });
    return;
  }

  const [session] = await db
    .select()
    .from(plenariasTable)
    .where(eq(plenariasTable.id, sessionId));

  if (!session) {
    res.status(404).json({ error: "Sesión no encontrada" });
    return;
  }

  const created = await db.transaction(async (tx) => {
    const [topic] = await tx
      .insert(topicsTable)
      .values({
        sessionId,
        title,
        detail,
        status: "cerrado",
        type: shape.type,
        candidateMode: shape.candidateMode,
        weighted: shape.weighted,
        weightSource: shape.weightSource,
        votesPerVoter: shape.votesPerVoter,
        agendaPointId:
          agendaPointId === undefined || agendaPointId === null ? null : Number(agendaPointId),
      })
      .returning();

    if (shape.candidates.length > 0) {
      await tx.insert(topicCandidatesTable).values(
        shape.candidates.map((name, i) => ({ voteTopicId: topic.id, name, position: i })),
      );
    }
    if (shape.estamentos.length > 0) {
      await tx.insert(topicEstamentosTable).values(
        shape.estamentos.map((estamentoName) => ({ voteTopicId: topic.id, estamentoName })),
      );
    }
    return topic;
  });

  const { candByTopic, estByTopic } = await loadTopicRelations([created.id]);
  emitSessionEvent(sessionId, "session:changed");
  res
    .status(201)
    .json(serializeTopic(created, candByTopic.get(created.id) ?? [], estByTopic.get(created.id) ?? []));
});

router.patch("/topics/:topicId", requireAdmin, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.topicId) ? req.params.topicId[0] : req.params.topicId;
  const topicId = parseInt(raw, 10);
  if (isNaN(topicId)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const body = req.body ?? {};
  const { title, status, agendaPointId } = body;
  const updates: Record<string, unknown> = {};
  if (title !== undefined) updates.title = title;
  if (body.detail !== undefined)
    updates.detail = typeof body.detail === "string" ? body.detail.trim() || null : null;
  if (status !== undefined) updates.status = status;
  if (agendaPointId !== undefined)
    updates.agendaPointId = agendaPointId === null ? null : Number(agendaPointId);

  // Voting-shape edits only when the client explicitly sends `type`.
  const editShape = body.type !== undefined;
  const shape = editShape ? parseVotingShape(body) : null;
  if (shape) {
    if (!Number.isSafeInteger(shape.votesPerVoter) || shape.votesPerVoter < 1 || shape.votesPerVoter > MAX_VOTES_PER_VOTER) {
      res.status(400).json({ error: `Los votos por votante deben ser un entero entre 1 y ${MAX_VOTES_PER_VOTER}` });
      return;
    }
    updates.type = shape.type;
    updates.candidateMode = shape.candidateMode;
    updates.weighted = shape.weighted;
    updates.weightSource = shape.weightSource;
    updates.votesPerVoter = shape.votesPerVoter;
    if (shape.type === "candidato" && shape.candidates.length === 0) {
      res.status(400).json({ error: "Agrega al menos une candidate" });
      return;
    }
  }

  const updated = await db.transaction(async (tx) => {
    // Serialize edits and protect existing FK-linked ballots before any writes.
    const [current] = await tx.select().from(topicsTable)
      .where(eq(topicsTable.id, topicId)).for("update");
    if (!current) return null;

    if (status === "abierto") updates.electorateSnapshot = null;

    let candidatesChanged = false;
    let estamentosChanged = false;
    const ests = shape?.estamentos ?? (body.estamentos !== undefined
      ? parseVotingShape({ ...body, type: "mocion" }).estamentos : null);
    if (shape) {
      const candidates = await tx.select().from(topicCandidatesTable)
        .where(eq(topicCandidatesTable.voteTopicId, topicId))
        .orderBy(asc(topicCandidatesTable.position), asc(topicCandidatesTable.id));
      candidatesChanged = JSON.stringify(candidates.map((c) => c.name)) !== JSON.stringify(shape.candidates);
    }
    if (ests !== null) {
      const existing = await tx.select().from(topicEstamentosTable)
        .where(eq(topicEstamentosTable.voteTopicId, topicId));
      estamentosChanged = JSON.stringify(existing.map((e) => e.estamentoName).sort()) !== JSON.stringify([...ests].sort());
    }
    const rulesChanged = shape !== null &&
      (["type", "candidateMode", "weighted", "weightSource", "votesPerVoter"] as const)
        .some((key) => shape[key] !== current[key]);
    if (rulesChanged || candidatesChanged || estamentosChanged) {
      const ballots = await tx.select({ id: voteBallotsTable.id }).from(voteBallotsTable)
        .where(eq(voteBallotsTable.voteTopicId, topicId)).limit(1);
      const votes = await tx.select({ id: votesTable.id }).from(votesTable)
        .where(eq(votesTable.voteTopicId, topicId)).limit(1);
      if (ballots.length || votes.length) return false;
    }
    if (Object.keys(updates).length === 0 && !estamentosChanged) return current;
    const [row] = Object.keys(updates).length ? await tx
      .update(topicsTable)
      .set(updates)
      .where(eq(topicsTable.id, topicId))
      .returning() : [current];
    if (!row) return null;

    if (shape && candidatesChanged) {
      await tx.delete(topicCandidatesTable).where(eq(topicCandidatesTable.voteTopicId, topicId));
      if (shape.candidates.length > 0) {
        await tx.insert(topicCandidatesTable).values(
          shape.candidates.map((name, i) => ({ voteTopicId: topicId, name, position: i })),
        );
      }
    }
    if (ests !== null && estamentosChanged) {
      await tx.delete(topicEstamentosTable).where(eq(topicEstamentosTable.voteTopicId, topicId));
      if (ests.length > 0) {
        await tx.insert(topicEstamentosTable).values(
          ests.map((estamentoName) => ({ voteTopicId: topicId, estamentoName })),
        );
      }
    }
    if (status === "cerrado" && current.status === "abierto") {
      const [closed] = await tx.update(topicsTable)
        .set({ electorateSnapshot: await captureElectorate(tx, topicId) })
        .where(eq(topicsTable.id, topicId)).returning();
      return closed;
    }
    return row;
  });

  if (updated === false) {
    res.status(409).json({ error: "No se pueden cambiar candidaturas ni reglas de una votación con votos registrados" });
    return;
  }
  if (!updated) {
    res.status(404).json({ error: "Tema no encontrado" });
    return;
  }

  const { candByTopic, estByTopic } = await loadTopicRelations([topicId]);
  emitSessionEvent(updated.sessionId, "session:changed");
  res.json(serializeTopic(updated, candByTopic.get(topicId) ?? [], estByTopic.get(topicId) ?? []));
});

router.delete("/topics/:topicId", requireAdmin, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.topicId) ? req.params.topicId[0] : req.params.topicId;
  const topicId = parseInt(raw, 10);
  if (isNaN(topicId)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const deletion = await db.transaction(async (tx) => {
    const [topic] = await tx.select({
      sessionId: topicsTable.sessionId,
      status: topicsTable.status,
      electorateSnapshot: topicsTable.electorateSnapshot,
    }).from(topicsTable).where(eq(topicsTable.id, topicId)).for("update");
    if (!topic) return { kind: "missing" as const };
    const [ballots] = await tx.select({ count: sql<number>`count(*)` })
      .from(voteBallotsTable).where(eq(voteBallotsTable.voteTopicId, topicId));
    if (topic.status === "cerrado" || topic.electorateSnapshot || Number(ballots.count) > 0) {
      return { kind: "history" as const };
    }
    await tx.delete(topicsTable).where(eq(topicsTable.id, topicId));
    return { kind: "deleted" as const, sessionId: topic.sessionId };
  });
  if (deletion.kind === "missing") {
    res.status(404).json({ error: "Tema no encontrado" });
    return;
  }
  if (deletion.kind === "history") {
    res.status(409).json({ error: "No se puede eliminar una votación cerrada o con historial" });
    return;
  }
  const deleted = deletion;
  if (deleted) emitSessionEvent(deleted.sessionId, "session:changed");
  res.sendStatus(204);
});

export default router;
