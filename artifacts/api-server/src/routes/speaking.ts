import { Router, type IRouter } from "express";
import { eq, sql, inArray } from "drizzle-orm";
import {
  db,
  speakingTurnsTable,
  speakingTurnParticipantsTable,
  attendanceTable,
  usersTable,
  plenariasTable,
  agendaPointsTable,
} from "@workspace/db";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { emitSessionEvent, emitLobbyEvent } from "../lib/realtime";

const router: IRouter = Router();

const CONSEJEROS_GROUP = "Consejeros FECh";
const DEFAULT_SECONDS = 60;
// Palabra colectiva is capped at 3 minutes by default (admin may override).
const DEFAULT_COLLECTIVE_SECONDS = 180;

type TurnRow = typeof speakingTurnsTable.$inferSelect;

async function serializeTurns(turns: TurnRow[]) {
  if (turns.length === 0) return [];

  const turnIds = turns.map((t) => t.id);
  const participantRows = await db
    .select({
      turnId: speakingTurnParticipantsTable.turnId,
      userId: speakingTurnParticipantsTable.userId,
      displayName: usersTable.displayName,
      faculty: usersTable.faculty,
    })
    .from(speakingTurnParticipantsTable)
    .innerJoin(usersTable, eq(speakingTurnParticipantsTable.userId, usersTable.id))
    .where(inArray(speakingTurnParticipantsTable.turnId, turnIds));

  const byTurn = new Map<number, { userId: number; displayName: string; faculty: string | null }[]>();
  for (const p of participantRows) {
    const arr = byTurn.get(p.turnId) ?? [];
    arr.push({ userId: p.userId, displayName: p.displayName, faculty: p.faculty });
    byTurn.set(p.turnId, arr);
  }

  return turns.map((t) => {
    const participants = byTurn.get(t.id) ?? [];
    let label: string;
    if (t.kind === "colectiva") {
      label = `Palabra colectiva · ${t.faculty ?? ""}`.trim();
    } else if (t.category === "base") {
      label = "Estudiante de base";
    } else if (participants.length > 0) {
      label = participants[0].displayName;
    } else {
      label = t.speakerName ?? "Orador";
    }
    return {
      id: t.id,
      sessionId: t.sessionId,
      agendaPointId: t.agendaPointId,
      category: t.category,
      kind: t.kind,
      status: t.status,
      position: t.position,
      durationSeconds: t.durationSeconds,
      elapsedSeconds: t.elapsedSeconds,
      startedAt: t.startedAt ? t.startedAt.toISOString() : null,
      faculty: t.faculty,
      userId: t.userId,
      label,
      participants,
      createdAt: t.createdAt.toISOString(),
    };
  });
}

async function serializeOne(turnId: number) {
  const [turn] = await db.select().from(speakingTurnsTable).where(eq(speakingTurnsTable.id, turnId));
  if (!turn) return null;
  const [serialized] = await serializeTurns([turn]);
  return serialized;
}

async function agendaPointBelongsToSession(
  pointId: number,
  sessionId: number,
): Promise<boolean> {
  const [row] = await db
    .select({ id: agendaPointsTable.id })
    .from(agendaPointsTable)
    .where(
      sql`${agendaPointsTable.id} = ${pointId} AND ${agendaPointsTable.sessionId} = ${sessionId}`,
    );
  return !!row;
}

async function nextPosition(sessionId: number, agendaPointId: number | null): Promise<number> {
  const [maxRow] = await db
    .select({ max: sql<number>`coalesce(max(${speakingTurnsTable.position}), -1)` })
    .from(speakingTurnsTable)
    .where(
      sql`${speakingTurnsTable.sessionId} = ${sessionId}
        AND ${agendaPointId === null ? sql`${speakingTurnsTable.agendaPointId} IS NULL` : sql`${speakingTurnsTable.agendaPointId} = ${agendaPointId}`}`,
    );
  return Number(maxRow?.max ?? -1) + 1;
}

router.get("/sessions/:id/speaking-turns", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const sessionId = parseInt(raw, 10);
  if (isNaN(sessionId)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const turns = await db
    .select()
    .from(speakingTurnsTable)
    .where(eq(speakingTurnsTable.sessionId, sessionId))
    .orderBy(sql`${speakingTurnsTable.position} ASC, ${speakingTurnsTable.id} ASC`);

  res.json(await serializeTurns(turns));
});

router.post("/sessions/:id/speaking-turns", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const sessionId = parseInt(raw, 10);
  if (isNaN(sessionId)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const { category, agendaPointId, durationSeconds } = req.body;
  if (category !== "pleno" && category !== "base") {
    res.status(400).json({ error: "Categoría inválida (pleno o base)" });
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

  const isAdmin = req.session.rol === "admin";

  // Determine speaker: members can only request for themselves; admin may add anyone (by id or free name).
  let speakerUserId: number | null;
  let speakerName: string | null = null;
  if (isAdmin) {
    const bodyUserId = req.body.userId;
    const bodyName = req.body.speakerName;
    if (bodyUserId !== undefined && bodyUserId !== null) {
      speakerUserId = Number(bodyUserId);
    } else if (typeof bodyName === "string" && bodyName.trim()) {
      speakerUserId = null;
      speakerName = bodyName.trim();
    } else {
      res.status(400).json({ error: "Indica un miembro o un nombre de orador" });
      return;
    }
  } else {
    speakerUserId = req.session.userId!;
    // Members can only request the floor while the speaking round is open
    if (!session.speakingRoundOpen) {
      res.status(400).json({ error: "La ronda de palabras está cerrada" });
      return;
    }
    // Members must have active attendance to request the floor
    const [attendance] = await db
      .select()
      .from(attendanceTable)
      .where(
        sql`${attendanceTable.sessionId} = ${sessionId} AND ${attendanceTable.userId} = ${speakerUserId}`,
      );
    if (!attendance || attendance.checkedOutAt !== null) {
      res.status(400).json({ error: "Debes tener asistencia activa para pedir la palabra" });
      return;
    }
  }

  let pointId =
    agendaPointId === undefined || agendaPointId === null ? null : Number(agendaPointId);
  // The speaking round is scoped to a single agenda point; a member's request is
  // always filed under whatever point the admin opened the round for.
  if (!isAdmin) {
    pointId = session.speakingRoundAgendaPointId ?? null;
  }

  if (pointId !== null && !(await agendaPointBelongsToSession(pointId, sessionId))) {
    res.status(400).json({ error: "El punto de tabla no pertenece a esta sesión" });
    return;
  }

  // Prevent duplicate queued requests for the same speaker on the same point
  if (speakerUserId !== null) {
    const existing = await db
      .select()
      .from(speakingTurnsTable)
      .where(
        sql`${speakingTurnsTable.sessionId} = ${sessionId}
          AND ${speakingTurnsTable.userId} = ${speakerUserId}
          AND ${speakingTurnsTable.status} <> 'finalizada'
          AND ${speakingTurnsTable.kind} = 'individual'
          AND ${pointId === null ? sql`${speakingTurnsTable.agendaPointId} IS NULL` : sql`${speakingTurnsTable.agendaPointId} = ${pointId}`}`,
      );
    if (existing.length > 0) {
      res.status(409).json({ error: "Ya tienes una palabra en cola para este punto" });
      return;
    }
  }

  // Duration is base 60s and adjustable only by admin; member requests are always DEFAULT_SECONDS.
  let duration = DEFAULT_SECONDS;
  if (isAdmin && durationSeconds !== undefined && durationSeconds !== null) {
    const parsed = Number(durationSeconds);
    if (!Number.isFinite(parsed)) {
      res.status(400).json({ error: "Duración inválida" });
      return;
    }
    duration = Math.max(1, Math.floor(parsed));
  }

  const position = await nextPosition(sessionId, pointId);

  const [turn] = await db
    .insert(speakingTurnsTable)
    .values({
      sessionId,
      agendaPointId: pointId,
      category,
      kind: "individual",
      userId: speakerUserId,
      speakerName,
      durationSeconds: duration,
      position,
    })
    .returning();

  if (speakerUserId !== null) {
    await db
      .insert(speakingTurnParticipantsTable)
      .values({ turnId: turn.id, userId: speakerUserId })
      .onConflictDoNothing();
  }

  emitSessionEvent(sessionId, "speaking:changed");
  res.status(201).json(await serializeOne(turn.id));
});

router.post(
  "/sessions/:id/speaking-round",
  requireAdmin,
  async (req, res): Promise<void> => {
    const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const sessionId = parseInt(raw, 10);
    if (isNaN(sessionId)) {
      res.status(400).json({ error: "ID inválido" });
      return;
    }

    const { open, agendaPointId } = req.body;
    if (typeof open !== "boolean") {
      res.status(400).json({ error: "El campo 'open' debe ser booleano" });
      return;
    }

    // Opening a round is scoped to a single agenda point: the admin must pick the
    // "punto de tabla" the round belongs to, so member requests land only there.
    let pointId: number | null = null;
    if (open) {
      if (agendaPointId === undefined || agendaPointId === null) {
        res.status(400).json({ error: "Debes indicar un punto de tabla para abrir la ronda" });
        return;
      }
      pointId = Number(agendaPointId);
      if (!Number.isFinite(pointId) || !(await agendaPointBelongsToSession(pointId, sessionId))) {
        res.status(400).json({ error: "El punto de tabla no pertenece a esta sesión" });
        return;
      }
    }

    const [updated] = await db
      .update(plenariasTable)
      .set({ speakingRoundOpen: open, speakingRoundAgendaPointId: open ? pointId : null })
      .where(eq(plenariasTable.id, sessionId))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Sesión no encontrada" });
      return;
    }

    emitSessionEvent(sessionId, "session:changed");
    emitSessionEvent(sessionId, "speaking:changed");
    emitLobbyEvent("sessions:changed");

    res.json({
      id: updated.id,
      title: updated.title,
      location: updated.location,
      scheduledAt: updated.scheduledAt,
      status: updated.status,
      sessionCode: updated.sessionCode,
      meetingLink: updated.meetingLink,
      actaObjectPath: updated.actaObjectPath,
      actaFileName: updated.actaFileName,
      speakingRoundOpen: updated.speakingRoundOpen,
      speakingRoundAgendaPointId: updated.speakingRoundAgendaPointId,
      createdAt: updated.createdAt,
    });
  },
);

router.post(
  "/sessions/:id/speaking-turns/collective",
  requireAdmin,
  async (req, res): Promise<void> => {
    const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const sessionId = parseInt(raw, 10);
    if (isNaN(sessionId)) {
      res.status(400).json({ error: "ID inválido" });
      return;
    }

    const { faculty, agendaPointId, userIds, secondsPerSpeaker, durationSeconds } = req.body;
    if (!faculty || typeof faculty !== "string") {
      res.status(400).json({ error: "Unidad Académica (faculty) requerida" });
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

    // The whole group of consejeros of the requested academic unit (present or not)
    const groupConsejeros = await db
      .select({
        userId: usersTable.id,
        displayName: usersTable.displayName,
        faculty: usersTable.faculty,
      })
      .from(usersTable)
      .where(
        sql`${usersTable.group} = ${CONSEJEROS_GROUP}
          AND ${usersTable.faculty} = ${faculty}`,
      );

    let selected = groupConsejeros;
    if (Array.isArray(userIds) && userIds.length > 0) {
      const wanted = new Set(userIds.map((u: unknown) => Number(u)));
      selected = groupConsejeros.filter((c) => wanted.has(c.userId));
    }

    if (selected.length === 0) {
      res.status(400).json({
        error: "No hay consejeros de esa Unidad Académica",
      });
      return;
    }

    const duration =
      durationSeconds !== undefined && durationSeconds !== null
        ? Math.max(1, Number(durationSeconds))
        : secondsPerSpeaker !== undefined && secondsPerSpeaker !== null
          ? Math.max(1, Number(secondsPerSpeaker)) * selected.length
          : DEFAULT_COLLECTIVE_SECONDS;

    const pointId =
      agendaPointId === undefined || agendaPointId === null ? null : Number(agendaPointId);

    if (pointId !== null && !(await agendaPointBelongsToSession(pointId, sessionId))) {
      res.status(400).json({ error: "El punto de tabla no pertenece a esta sesión" });
      return;
    }

    const position = await nextPosition(sessionId, pointId);

    const turnId = await db.transaction(async (tx) => {
      const [turn] = await tx
        .insert(speakingTurnsTable)
        .values({
          sessionId,
          agendaPointId: pointId,
          category: "pleno",
          kind: "colectiva",
          faculty,
          durationSeconds: duration,
          position,
        })
        .returning();

      await tx.insert(speakingTurnParticipantsTable).values(
        selected.map((c) => ({ turnId: turn.id, userId: c.userId })),
      );
      return turn.id;
    });

    emitSessionEvent(sessionId, "speaking:changed");
    res.status(201).json(await serializeOne(turnId));
  },
);

router.post("/sessions/:id/speaking-turns/reorder", requireAdmin, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const sessionId = parseInt(raw, 10);
  if (isNaN(sessionId)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const { orderedIds } = req.body;
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
    res.status(400).json({ error: "orderedIds requerido" });
    return;
  }

  const ids = orderedIds.map((x) => Number(x)).filter((n) => !isNaN(n));
  if (ids.length === 0) {
    res.status(400).json({ error: "orderedIds inválido" });
    return;
  }

  // All turns must belong to this session and share the same agenda point:
  // queues are scoped per agenda point, so reordering only affects one point's queue.
  const rows = await db
    .select({ id: speakingTurnsTable.id, agendaPointId: speakingTurnsTable.agendaPointId })
    .from(speakingTurnsTable)
    .where(
      sql`${speakingTurnsTable.sessionId} = ${sessionId} AND ${inArray(speakingTurnsTable.id, ids)}`,
    );
  if (rows.length !== ids.length) {
    res.status(400).json({ error: "Algunas palabras no pertenecen a esta sesión" });
    return;
  }
  const points = new Set(rows.map((r) => (r.agendaPointId === null ? "none" : r.agendaPointId)));
  if (points.size > 1) {
    res.status(400).json({ error: "Solo se puede reordenar dentro de un mismo punto de tabla" });
    return;
  }

  await db.transaction(async (tx) => {
    for (let i = 0; i < ids.length; i++) {
      await tx
        .update(speakingTurnsTable)
        .set({ position: i })
        .where(
          sql`${speakingTurnsTable.id} = ${ids[i]} AND ${speakingTurnsTable.sessionId} = ${sessionId}`,
        );
    }
  });

  emitSessionEvent(sessionId, "speaking:changed");
  res.json({ ok: true });
});

router.patch("/speaking-turns/:turnId", requireAdmin, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.turnId) ? req.params.turnId[0] : req.params.turnId;
  const turnId = parseInt(raw, 10);
  if (isNaN(turnId)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const [existing] = await db
    .select()
    .from(speakingTurnsTable)
    .where(eq(speakingTurnsTable.id, turnId));
  if (!existing) {
    res.status(404).json({ error: "Palabra no encontrada" });
    return;
  }

  const { durationSeconds, agendaPointId } = req.body;
  const updates: Record<string, unknown> = {};
  if (durationSeconds !== undefined) {
    const parsed = Number(durationSeconds);
    if (!Number.isFinite(parsed)) {
      res.status(400).json({ error: "Duración inválida" });
      return;
    }
    updates.durationSeconds = Math.max(1, Math.floor(parsed));
  }
  if (agendaPointId !== undefined) {
    const pointId = agendaPointId === null ? null : Number(agendaPointId);
    if (pointId !== null && !(await agendaPointBelongsToSession(pointId, existing.sessionId))) {
      res.status(400).json({ error: "El punto de tabla no pertenece a esta sesión" });
      return;
    }
    updates.agendaPointId = pointId;
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "Sin cambios" });
    return;
  }

  const [updated] = await db
    .update(speakingTurnsTable)
    .set(updates)
    .where(eq(speakingTurnsTable.id, turnId))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Palabra no encontrada" });
    return;
  }

  emitSessionEvent(updated.sessionId, "speaking:changed");
  res.json(await serializeOne(turnId));
});

router.post("/speaking-turns/:turnId/control", requireAdmin, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.turnId) ? req.params.turnId[0] : req.params.turnId;
  const turnId = parseInt(raw, 10);
  if (isNaN(turnId)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const { action } = req.body;
  const valid = ["grant", "start", "pause", "finish"];
  if (!valid.includes(action)) {
    res.status(400).json({ error: "Acción inválida" });
    return;
  }

  const [turn] = await db.select().from(speakingTurnsTable).where(eq(speakingTurnsTable.id, turnId));
  if (!turn) {
    res.status(404).json({ error: "Palabra no encontrada" });
    return;
  }

  const now = new Date();
  const accrued = (t: TurnRow): number =>
    t.startedAt ? Math.floor((now.getTime() - t.startedAt.getTime()) / 1000) : 0;

  await db.transaction(async (tx) => {
    // Only one active speaker per session: pause any other running/active turn back to queue.
    if (action === "grant" || action === "start") {
      const others = await tx
        .select()
        .from(speakingTurnsTable)
        .where(
          sql`${speakingTurnsTable.sessionId} = ${turn.sessionId}
            AND ${speakingTurnsTable.id} <> ${turn.id}
            AND ${speakingTurnsTable.status} = 'hablando'`,
        );
      for (const o of others) {
        await tx
          .update(speakingTurnsTable)
          .set({ status: "en_cola", elapsedSeconds: o.elapsedSeconds + accrued(o), startedAt: null })
          .where(eq(speakingTurnsTable.id, o.id));
      }
    }

    if (action === "grant") {
      await tx
        .update(speakingTurnsTable)
        .set({ status: "hablando", startedAt: null })
        .where(eq(speakingTurnsTable.id, turn.id));
    } else if (action === "start") {
      // begin/resume the timer
      await tx
        .update(speakingTurnsTable)
        .set({ status: "hablando", startedAt: turn.startedAt ?? now })
        .where(eq(speakingTurnsTable.id, turn.id));
    } else if (action === "pause") {
      await tx
        .update(speakingTurnsTable)
        .set({ elapsedSeconds: turn.elapsedSeconds + accrued(turn), startedAt: null })
        .where(eq(speakingTurnsTable.id, turn.id));
    } else if (action === "finish") {
      await tx
        .update(speakingTurnsTable)
        .set({
          status: "finalizada",
          elapsedSeconds: turn.elapsedSeconds + accrued(turn),
          startedAt: null,
        })
        .where(eq(speakingTurnsTable.id, turn.id));
    }
  });

  emitSessionEvent(turn.sessionId, "speaking:changed");
  res.json(await serializeOne(turnId));
});

router.delete("/speaking-turns/:turnId", requireAdmin, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.turnId) ? req.params.turnId[0] : req.params.turnId;
  const turnId = parseInt(raw, 10);
  if (isNaN(turnId)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const [deleted] = await db
    .delete(speakingTurnsTable)
    .where(eq(speakingTurnsTable.id, turnId))
    .returning({ sessionId: speakingTurnsTable.sessionId });
  if (deleted) emitSessionEvent(deleted.sessionId, "speaking:changed");
  res.sendStatus(204);
});

export default router;
