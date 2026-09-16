import { Router, type IRouter } from "express";
import { db, unidadesAcademicasTable } from "@workspace/db";
import { asc, eq } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";

const router: IRouter = Router();

// List academic units (catalog used for palabra colectiva and member faculties).
router.get("/unidades-academicas", requireAuth, async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(unidadesAcademicasTable)
    .orderBy(asc(unidadesAcademicasTable.name));
  res.json(rows);
});

router.post("/unidades-academicas", requireAdmin, async (req, res): Promise<void> => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name) {
    res.status(400).json({ error: "El nombre es obligatorio" });
    return;
  }
  try {
    const [row] = await db
      .insert(unidadesAcademicasTable)
      .values({ name })
      .returning();
    res.status(201).json(row);
  } catch (err) {
    if ((err as { code?: string })?.code === "23505") {
      res.status(409).json({ error: "Esa Unidad Académica ya existe" });
      return;
    }
    throw err;
  }
});

router.delete("/unidades-academicas/:id", requireAdmin, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }
  const [row] = await db
    .delete(unidadesAcademicasTable)
    .where(eq(unidadesAcademicasTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Unidad Académica no encontrada" });
    return;
  }
  res.status(204).end();
});

export default router;
