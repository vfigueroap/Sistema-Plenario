import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, agendaPointsTable, plenariasTable } from "@workspace/db";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { emitSessionEvent } from "../lib/realtime";

const router: IRouter = Router();

function serialize(p: typeof agendaPointsTable.$inferSelect) {
  return {
    id: p.id,
    sessionId: p.sessionId,
    title: p.title,
    position: p.position,
    estimatedMinutes: p.estimatedMinutes,
    createdAt: p.createdAt,
  };
}

router.get("/sessions/:id/agenda", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const sessionId = parseInt(raw, 10);
  if (isNaN(sessionId)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const points = await db
    .select()
    .from(agendaPointsTable)
    .where(eq(agendaPointsTable.sessionId, sessionId))
    .orderBy(sql`${agendaPointsTable.position} ASC, ${agendaPointsTable.id} ASC`);

  res.json(points.map(serialize));
});

router.post("/sessions/:id/agenda", requireAdmin, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const sessionId = parseInt(raw, 10);
  if (isNaN(sessionId)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const { title, estimatedMinutes } = req.body;
  if (!title || typeof title !== "string") {
    res.status(400).json({ error: "Título requerido" });
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

  const [maxRow] = await db
    .select({ max: sql<number>`coalesce(max(${agendaPointsTable.position}), -1)` })
    .from(agendaPointsTable)
    .where(eq(agendaPointsTable.sessionId, sessionId));
  const nextPosition = Number(maxRow?.max ?? -1) + 1;

  const [point] = await db
    .insert(agendaPointsTable)
    .values({
      sessionId,
      title,
      position: nextPosition,
      estimatedMinutes:
        estimatedMinutes === undefined || estimatedMinutes === null
          ? null
          : Number(estimatedMinutes),
    })
    .returning();

  emitSessionEvent(sessionId, "session:changed");

  res.status(201).json(serialize(point));
});

router.post("/sessions/:id/agenda/reorder", requireAdmin, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const sessionId = parseInt(raw, 10);
  if (isNaN(sessionId)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const { orderedIds } = req.body;
  if (!Array.isArray(orderedIds)) {
    res.status(400).json({ error: "orderedIds requerido" });
    return;
  }

  await db.transaction(async (tx) => {
    for (let i = 0; i < orderedIds.length; i++) {
      const pointId = Number(orderedIds[i]);
      if (isNaN(pointId)) continue;
      await tx
        .update(agendaPointsTable)
        .set({ position: i })
        .where(
          sql`${agendaPointsTable.id} = ${pointId} AND ${agendaPointsTable.sessionId} = ${sessionId}`,
        );
    }
  });

  emitSessionEvent(sessionId, "session:changed");

  res.json({ ok: true });
});

router.patch("/agenda/:pointId", requireAdmin, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.pointId) ? req.params.pointId[0] : req.params.pointId;
  const pointId = parseInt(raw, 10);
  if (isNaN(pointId)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const { title, estimatedMinutes, position } = req.body;
  const updates: Record<string, unknown> = {};
  if (title !== undefined) updates.title = title;
  if (estimatedMinutes !== undefined)
    updates.estimatedMinutes = estimatedMinutes === null ? null : Number(estimatedMinutes);
  if (position !== undefined) updates.position = Number(position);

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "Sin cambios" });
    return;
  }

  const [updated] = await db
    .update(agendaPointsTable)
    .set(updates)
    .where(eq(agendaPointsTable.id, pointId))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Punto no encontrado" });
    return;
  }

  emitSessionEvent(updated.sessionId, "session:changed");

  res.json(serialize(updated));
});

router.delete("/agenda/:pointId", requireAdmin, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.pointId) ? req.params.pointId[0] : req.params.pointId;
  const pointId = parseInt(raw, 10);
  if (isNaN(pointId)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const [deleted] = await db
    .delete(agendaPointsTable)
    .where(eq(agendaPointsTable.id, pointId))
    .returning({ sessionId: agendaPointsTable.sessionId });

  if (deleted) emitSessionEvent(deleted.sessionId, "session:changed");

  res.sendStatus(204);
});

export default router;
