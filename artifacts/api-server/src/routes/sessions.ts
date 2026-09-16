import { Router, type IRouter } from "express";
import { and, eq, sql } from "drizzle-orm";
import { db, plenariasTable, attendanceTable, topicsTable } from "@workspace/db";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { emitSessionEvent, emitLobbyEvent } from "../lib/realtime";
import { snapshotSessionWeights } from "../lib/sessionWeights";
import { randomBytes } from "crypto";
import { captureElectorate } from "../lib/electorate";

const router: IRouter = Router();

function generateSessionCode(): string {
  return randomBytes(3).toString("hex").toUpperCase();
}

router.get("/sessions", requireAuth, async (_req, res): Promise<void> => {
  const sessions = await db
    .select()
    .from(plenariasTable)
    .orderBy(sql`${plenariasTable.createdAt} DESC`);

  res.json(
    sessions.map((s) => ({
      id: s.id,
      title: s.title,
      location: s.location,
      scheduledAt: s.scheduledAt,
      status: s.status,
      sessionCode: s.sessionCode,
      meetingLink: s.meetingLink,
      actaObjectPath: s.actaObjectPath,
      actaFileName: s.actaFileName,
      speakingRoundOpen: s.speakingRoundOpen,
      speakingRoundAgendaPointId: s.speakingRoundAgendaPointId,
      officialStartAt: s.officialStartAt,
      officialEndAt: s.officialEndAt,
      createdAt: s.createdAt,
    })),
  );
});

router.post("/sessions", requireAdmin, async (req, res): Promise<void> => {
  const { title, location, scheduledAt, meetingLink } = req.body;
  if (!title) {
    res.status(400).json({ error: "Título requerido" });
    return;
  }

  const sessionCode = generateSessionCode();
  const [session] = await db
    .insert(plenariasTable)
    .values({
      title,
      location: location ?? null,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
      meetingLink:
        typeof meetingLink === "string" && meetingLink.trim()
          ? meetingLink.trim()
          : null,
      sessionCode,
      status: "cerrada",
    })
    .returning();

  // Freeze every member's voting weights for this session: later weight edits
  // must never retro-affect a session that already exists.
  await snapshotSessionWeights(session.id);

  emitSessionEvent(session.id, "session:changed");
  emitLobbyEvent("sessions:changed");

  res.status(201).json({
    id: session.id,
    title: session.title,
    location: session.location,
    scheduledAt: session.scheduledAt,
    status: session.status,
    sessionCode: session.sessionCode,
    meetingLink: session.meetingLink,
    actaObjectPath: session.actaObjectPath,
    actaFileName: session.actaFileName,
    speakingRoundOpen: session.speakingRoundOpen,
    speakingRoundAgendaPointId: session.speakingRoundAgendaPointId,
    officialStartAt: session.officialStartAt,
    officialEndAt: session.officialEndAt,
    createdAt: session.createdAt,
  });
});

router.get("/sessions/:id", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const [session] = await db
    .select()
    .from(plenariasTable)
    .where(eq(plenariasTable.id, id));

  if (!session) {
    res.status(404).json({ error: "Sesión no encontrada" });
    return;
  }

  const [attendanceCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(attendanceTable)
    .where(eq(attendanceTable.sessionId, id));

  const [topicsCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(topicsTable)
    .where(eq(topicsTable.sessionId, id));

  res.json({
    id: session.id,
    title: session.title,
    location: session.location,
    scheduledAt: session.scheduledAt,
    status: session.status,
    sessionCode: session.sessionCode,
    meetingLink: session.meetingLink,
    actaObjectPath: session.actaObjectPath,
    actaFileName: session.actaFileName,
    speakingRoundOpen: session.speakingRoundOpen,
    speakingRoundAgendaPointId: session.speakingRoundAgendaPointId,
    officialStartAt: session.officialStartAt,
    officialEndAt: session.officialEndAt,
    createdAt: session.createdAt,
    attendanceCount: Number(attendanceCount?.count ?? 0),
    topicsCount: Number(topicsCount?.count ?? 0),
  });
});

router.patch("/sessions/:id", requireAdmin, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const {
    title, status, location, scheduledAt, meetingLink, actaObjectPath, actaFileName, official,
  } = req.body;
  const updates: Record<string, unknown> = {};
  if (title !== undefined) updates.title = title;
  if (status !== undefined) updates.status = status;

  // Horario oficial. Solo una apertura declarada oficial abre el reloj; las
  // aperturas de prueba o preparación no suman horas al registro del pleno.
  if (status !== undefined) {
    const [current] = await db.select().from(plenariasTable).where(eq(plenariasTable.id, id));
    if (current) {
      if (status === "abierta" && official === true) {
        // Reapertura de una sesión oficial: se reanuda, no se reinicia.
        if (current.officialStartAt === null) updates.officialStartAt = new Date();
        updates.officialEndAt = null;
      }
      if (status === "cerrada" && current.officialStartAt !== null) {
        updates.officialEndAt = new Date();
      }
    }
  }

  if (location !== undefined) updates.location = location;
  if (scheduledAt !== undefined)
    updates.scheduledAt = scheduledAt ? new Date(scheduledAt) : null;
  if (meetingLink !== undefined)
    updates.meetingLink =
      typeof meetingLink === "string" && meetingLink.trim() ? meetingLink.trim() : null;
  if (actaObjectPath !== undefined) updates.actaObjectPath = actaObjectPath ?? null;
  if (actaFileName !== undefined) updates.actaFileName = actaFileName ?? null;

  const updated = await db.transaction(async (tx) => {
    const [current] = await tx.select().from(plenariasTable)
      .where(eq(plenariasTable.id, id)).for("update");
    if (!current) return null;
    if (status === "cerrada") {
      const openTopics = await tx.select().from(topicsTable)
        .where(and(eq(topicsTable.sessionId, id), eq(topicsTable.status, "abierto")))
        .orderBy(topicsTable.id).for("update");
      for (const topic of openTopics) {
        await tx.update(topicsTable).set({
          status: "cerrado",
          electorateSnapshot: await captureElectorate(tx, topic.id),
        }).where(eq(topicsTable.id, topic.id));
      }
    }
    if (Object.keys(updates).length === 0) return current;
    const [row] = await tx.update(plenariasTable).set(updates)
      .where(eq(plenariasTable.id, id)).returning();
    return row;
  });

  if (!updated) {
    res.status(404).json({ error: "Sesión no encontrada" });
    return;
  }

  emitSessionEvent(updated.id, "session:changed");
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
    officialStartAt: updated.officialStartAt,
    officialEndAt: updated.officialEndAt,
    createdAt: updated.createdAt,
  });
});

router.delete("/sessions/:id", requireAdmin, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const deletion = await db.transaction(async (tx) => {
    const [session] = await tx.select({ id: plenariasTable.id, officialStartAt: plenariasTable.officialStartAt })
      .from(plenariasTable).where(eq(plenariasTable.id, id)).for("update");
    if (!session) return "missing" as const;
    const [attendance] = await tx.select({ count: sql<number>`count(*)` })
      .from(attendanceTable).where(eq(attendanceTable.sessionId, id));
    const [topics] = await tx.select({ count: sql<number>`count(*)` })
      .from(topicsTable).where(eq(topicsTable.sessionId, id));
    if (session.officialStartAt !== null || Number(attendance.count) > 0 || Number(topics.count) > 0) {
      return "history" as const;
    }
    await tx.delete(plenariasTable).where(eq(plenariasTable.id, id));
    return "deleted" as const;
  });
  if (deletion === "missing") {
    res.status(404).json({ error: "Sesión no encontrada" });
    return;
  }
  if (deletion === "history") {
    res.status(409).json({ error: "No se puede eliminar una sesión iniciada o con historial" });
    return;
  }
  emitSessionEvent(id, "session:changed");
  emitLobbyEvent("sessions:changed");
  res.sendStatus(204);
});

export default router;
