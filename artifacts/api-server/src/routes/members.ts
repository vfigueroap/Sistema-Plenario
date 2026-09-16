import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { eq, sql, and, isNull } from "drizzle-orm";
import { db, usersTable, attendanceTable, plenariasTable } from "@workspace/db";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { disconnectUser, evictUserFromSession, emitSessionEvent, emitUserEvent } from "../lib/realtime";

const router: IRouter = Router();

router.get("/members", requireAuth, async (req, res): Promise<void> => {
  const isAdmin = req.session.rol === "admin";
  const members = await db.select().from(usersTable).orderBy(usersTable.displayName);
  res.json(
    members.map((m) => ({
      id: m.id,
      username: m.username,
      displayName: m.displayName,
      group: m.group,
      faculty: m.faculty,
      email: isAdmin ? m.email : null,
      password: null,
      votingWeight: parseFloat(m.votingWeight),
      votingWeightAlt: parseFloat(m.votingWeightAlt),
      active: m.active,
      rol: m.rol,
    })),
  );
});

router.post("/members", requireAdmin, async (req, res): Promise<void> => {
  const { username, displayName, password, group, faculty, votingWeight, votingWeightAlt, rol } =
    req.body ?? {};

  if (typeof username !== "string" || username.trim() === "") {
    res.status(400).json({ error: "El nombre de usuario es obligatorio" });
    return;
  }
  if (typeof displayName !== "string" || displayName.trim() === "") {
    res.status(400).json({ error: "El nombre es obligatorio" });
    return;
  }
  if (typeof password !== "string" || password === "") {
    res.status(400).json({ error: "La contraseña es obligatoria" });
    return;
  }
  if (rol !== undefined && rol !== "admin" && rol !== "miembro") {
    res.status(400).json({ error: "Rol inválido" });
    return;
  }

  const normalizedUsername = username.trim();

  const [existing] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(sql`lower(${usersTable.username}) = lower(${normalizedUsername})`);
  if (existing) {
    res.status(409).json({ error: "El nombre de usuario ya existe" });
    return;
  }

  const parseWeight = (value: unknown, label: string): string | { error: string } => {
    if (value === undefined || value === null) return "0";
    const parsed = Number(value);
    if (isNaN(parsed) || parsed < 0) return { error: `${label} inválida` };
    return String(parsed);
  };

  const weight = parseWeight(votingWeight, "Ponderación");
  if (typeof weight !== "string") {
    res.status(400).json(weight);
    return;
  }
  const weightAlt = parseWeight(votingWeightAlt, "Ponderación alternativa");
  if (typeof weightAlt !== "string") {
    res.status(400).json(weightAlt);
    return;
  }

  const hashed = await bcrypt.hash(password, 10);

  let created;
  try {
    [created] = await db
      .insert(usersTable)
      .values({
        username: normalizedUsername,
        displayName: displayName.trim(),
        password: hashed,
        group: typeof group === "string" && group.trim() !== "" ? group.trim() : null,
        faculty: typeof faculty === "string" && faculty.trim() !== "" ? faculty.trim() : null,
        votingWeight: weight,
        votingWeightAlt: weightAlt,
        rol: rol === "admin" ? "admin" : "miembro",
      })
      .returning();
  } catch (err) {
    if ((err as { code?: string })?.code === "23505") {
      res.status(409).json({ error: "El nombre de usuario ya existe" });
      return;
    }
    throw err;
  }

  res.status(201).json({
    id: created.id,
    username: created.username,
    displayName: created.displayName,
    group: created.group,
    faculty: created.faculty,
    email: created.email,
    password: null,
    votingWeight: parseFloat(created.votingWeight),
    votingWeightAlt: parseFloat(created.votingWeightAlt),
    active: created.active,
    rol: created.rol,
  });
});

router.patch("/members/me/email", requireAuth, async (req, res): Promise<void> => {
  const { email } = req.body;
  if (typeof email !== "string" || !email.includes("@")) {
    res.status(400).json({ error: "Correo electrónico inválido" });
    return;
  }

  const [updated] = await db
    .update(usersTable)
    .set({ email: email.trim().toLowerCase() })
    .where(eq(usersTable.id, req.session.userId!))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Usuario no encontrado" });
    return;
  }

  res.json({
    id: updated.id,
    username: updated.username,
    displayName: updated.displayName,
    group: updated.group,
    faculty: updated.faculty,
    email: updated.email,
    rol: updated.rol,
    votingWeight: parseFloat(updated.votingWeight),
  });
});

router.patch("/members/me/password", requireAuth, async (req, res): Promise<void> => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: "Se requieren contraseña actual y nueva" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.session.userId!));
  if (!user) {
    res.status(404).json({ error: "Usuario no encontrado" });
    return;
  }

  const valid = await bcrypt.compare(currentPassword, user.password);
  if (!valid) {
    res.status(400).json({ error: "Contraseña actual incorrecta" });
    return;
  }

  const hashed = await bcrypt.hash(newPassword, 10);
  await db
    .update(usersTable)
    .set({ password: hashed })
    .where(eq(usersTable.id, user.id));
  res.json({ ok: true });
});

router.get("/members/me/attendance", requireAuth, async (req, res): Promise<void> => {
  const rows = await getAttendanceHistory(req.session.userId!);
  res.json(rows);
});

router.get("/members/:id/attendance", requireAdmin, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }
  const rows = await getAttendanceHistory(id);
  res.json(rows);
});

router.patch("/members/:id", requireAdmin, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const [target] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!target) {
    res.status(404).json({ error: "Miembro no encontrado" });
    return;
  }

  const { displayName, username, group, faculty, votingWeight, votingWeightAlt, active } = req.body;
  const updates: Record<string, unknown> = {};

  if (displayName !== undefined) {
    if (typeof displayName !== "string" || displayName.trim() === "") {
      res.status(400).json({ error: "El nombre es obligatorio" });
      return;
    }
    updates.displayName = displayName.trim();
  }

  if (username !== undefined) {
    if (typeof username !== "string" || username.trim() === "") {
      res.status(400).json({ error: "El nombre de usuario es obligatorio" });
      return;
    }
    const normalizedUsername = username.trim();
    const [existing] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(sql`lower(${usersTable.username}) = lower(${normalizedUsername})`);
    if (existing && existing.id !== id) {
      res.status(409).json({ error: "El nombre de usuario ya existe" });
      return;
    }
    updates.username = normalizedUsername;
  }

  if (group !== undefined) {
    updates.group = typeof group === "string" && group.trim() !== "" ? group.trim() : null;
  }
  if (faculty !== undefined) {
    updates.faculty = typeof faculty === "string" && faculty.trim() !== "" ? faculty.trim() : null;
  }

  if (votingWeight !== undefined) {
    const parsed = Number(votingWeight);
    if (isNaN(parsed) || parsed < 0) {
      res.status(400).json({ error: "Ponderación inválida" });
      return;
    }
    updates.votingWeight = String(parsed);
  }
  if (votingWeightAlt !== undefined) {
    const parsed = Number(votingWeightAlt);
    if (isNaN(parsed) || parsed < 0) {
      res.status(400).json({ error: "Ponderación alternativa inválida" });
      return;
    }
    updates.votingWeightAlt = String(parsed);
  }

  const deactivating = active === false && target.active;
  if (active !== undefined) {
    if (typeof active !== "boolean") {
      res.status(400).json({ error: "Estado activo inválido" });
      return;
    }
    if (target.rol === "admin" && active === false) {
      res.status(400).json({ error: "No se puede inhabilitar una cuenta de administración" });
      return;
    }
    updates.active = active;
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "Nada que actualizar" });
    return;
  }

  let updated;
  try {
    [updated] = await db
      .update(usersTable)
      .set(updates)
      .where(eq(usersTable.id, id))
      .returning();
  } catch (err) {
    if ((err as { code?: string })?.code === "23505") {
      res.status(409).json({ error: "El nombre de usuario ya existe" });
      return;
    }
    throw err;
  }

  // On deactivation, check the member out of any open sessions they're actively
  // attending so their weight leaves every present/total tally immediately, and
  // evict their live sockets from those session rooms.
  if (deactivating) {
    const activeAttendance = await db
      .select({ sessionId: attendanceTable.sessionId })
      .from(attendanceTable)
      .where(and(eq(attendanceTable.userId, id), isNull(attendanceTable.checkedOutAt)));
    if (activeAttendance.length > 0) {
      await db
        .update(attendanceTable)
        .set({ checkedOutAt: new Date() })
        .where(and(eq(attendanceTable.userId, id), isNull(attendanceTable.checkedOutAt)));
      for (const row of activeAttendance) {
        await evictUserFromSession(row.sessionId, id);
        emitSessionEvent(row.sessionId, "attendance:changed");
      }
    }
    // Signal the member directly so the AuthGuard flips to the "cuenta
    // inhabilitada" screen instantly — the account is still connected (only a
    // delete disconnects), and they may not be in any session room.
    emitUserEvent(id, "access:changed");
    req.log.info({ userId: id }, "member deactivated by admin");
  } else if (active === true && target.active === false) {
    // Re-enabling the account: signal the member directly so the AuthGuard
    // leaves the "cuenta inhabilitada" screen instantly, without waiting for the
    // next /auth/me refetch.
    emitUserEvent(id, "access:changed");
    req.log.info({ userId: id }, "member reactivated by admin");
  }

  res.json({
    id: updated.id,
    username: updated.username,
    displayName: updated.displayName,
    group: updated.group,
    faculty: updated.faculty,
    email: updated.email,
    password: null,
    votingWeight: parseFloat(updated.votingWeight),
    votingWeightAlt: parseFloat(updated.votingWeightAlt),
    active: updated.active,
    rol: updated.rol,
  });
});

router.delete("/members/:id", requireAdmin, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  if (req.session.userId === id) {
    res.status(400).json({ error: "No puedes eliminar tu propia cuenta" });
    return;
  }

  const [target] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!target) {
    res.status(404).json({ error: "Miembro no encontrado" });
    return;
  }
  if (target.rol === "admin") {
    res.status(400).json({ error: "No se puede eliminar una cuenta administradora" });
    return;
  }

  await db.delete(usersTable).where(eq(usersTable.id, id));

  // Deprovision immediately: revoke any active login sessions for this user
  // (connect-pg-simple stores them in the `session` table with the userId inside
  // the `sess` JSON) and disconnect their live sockets, so a deleted account
  // cannot keep using an already-issued cookie or socket connection.
  await db.execute(
    sql`DELETE FROM session WHERE sess->>'userId' ~ '^[0-9]+$' AND (sess->>'userId')::int = ${id}`,
  );
  await disconnectUser(id);

  req.log.info({ deletedUserId: id }, "member deleted by admin");
  res.status(204).end();
});

router.patch("/members/:id/password", requireAdmin, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const { newPassword } = req.body;
  if (!newPassword) {
    res.status(400).json({ error: "Se requiere la nueva contraseña" });
    return;
  }

  const hashed = await bcrypt.hash(newPassword, 10);
  const [updated] = await db
    .update(usersTable)
    .set({ password: hashed })
    .where(eq(usersTable.id, id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Miembro no encontrado" });
    return;
  }

  res.json({ ok: true });
});

async function getAttendanceHistory(userId: number) {
  const rows = await db
    .select({
      sessionId: plenariasTable.id,
      sessionTitle: plenariasTable.title,
      location: plenariasTable.location,
      scheduledAt: plenariasTable.scheduledAt,
      status: plenariasTable.status,
      timestamp: attendanceTable.timestamp,
    })
    .from(attendanceTable)
    .innerJoin(plenariasTable, eq(attendanceTable.sessionId, plenariasTable.id))
    .where(eq(attendanceTable.userId, userId))
    .orderBy(sql`${attendanceTable.timestamp} DESC`);

  return rows.map((r) => ({
    sessionId: r.sessionId,
    sessionTitle: r.sessionTitle,
    location: r.location,
    scheduledAt: r.scheduledAt,
    status: r.status,
    timestamp: r.timestamp,
  }));
}

export default router;
