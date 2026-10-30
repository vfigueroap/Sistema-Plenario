import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, regularSpeakersTable } from "@workspace/db";
import { requireAdmin } from "../middlewares/auth";

const router: IRouter = Router();

const MAX_NAME_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 240;

const serialize = (row: typeof regularSpeakersTable.$inferSelect) => ({
  id: row.id,
  name: row.name,
  description: row.description,
  active: row.active,
});

const parseId = (value: string | string[]): number => parseInt(Array.isArray(value) ? value[0] : value, 10);

router.get("/regular-speakers", requireAdmin, async (_req, res): Promise<void> => {
  const rows = await db.select().from(regularSpeakersTable).orderBy(regularSpeakersTable.name);
  res.json(rows.map(serialize));
});

router.post("/regular-speakers", requireAdmin, async (req, res): Promise<void> => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const description = typeof req.body?.description === "string" ? req.body.description.trim() : "";
  if (!name || name.length > MAX_NAME_LENGTH || description.length > MAX_DESCRIPTION_LENGTH) {
    res.status(400).json({ error: "Nombre o descripción inválidos" });
    return;
  }
  try {
    const [created] = await db
      .insert(regularSpeakersTable)
      .values({ name, description: description || null })
      .returning();
    res.status(201).json(serialize(created));
  } catch (err) {
    if ((err as { code?: string })?.code === "23505") {
      res.status(409).json({ error: "Ya existe une interviniente con ese nombre" });
      return;
    }
    throw err;
  }
});

router.patch("/regular-speakers/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }
  const updates: Record<string, unknown> = {};
  if (req.body?.name !== undefined) {
    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    if (!name || name.length > MAX_NAME_LENGTH) {
      res.status(400).json({ error: "Nombre inválido" });
      return;
    }
    updates.name = name;
  }
  if (req.body?.description !== undefined) {
    const description = typeof req.body.description === "string" ? req.body.description.trim() : "";
    if (description.length > MAX_DESCRIPTION_LENGTH) {
      res.status(400).json({ error: "Descripción inválida" });
      return;
    }
    updates.description = description || null;
  }
  if (req.body?.active !== undefined) {
    if (typeof req.body.active !== "boolean") {
      res.status(400).json({ error: "Estado inválido" });
      return;
    }
    updates.active = req.body.active;
  }
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "Sin cambios" });
    return;
  }
  try {
    const [updated] = await db
      .update(regularSpeakersTable)
      .set(updates)
      .where(eq(regularSpeakersTable.id, id))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Interviniente no encontrade" });
      return;
    }
    res.json(serialize(updated));
  } catch (err) {
    if ((err as { code?: string })?.code === "23505") {
      res.status(409).json({ error: "Ya existe une interviniente con ese nombre" });
      return;
    }
    throw err;
  }
});

router.delete("/regular-speakers/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }
  const deleted = await db.delete(regularSpeakersTable).where(eq(regularSpeakersTable.id, id)).returning();
  if (deleted.length === 0) {
    res.status(404).json({ error: "Interviniente no encontrade" });
    return;
  }
  res.sendStatus(204);
});

export default router;
