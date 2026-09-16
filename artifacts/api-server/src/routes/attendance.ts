import { Router, type IRouter } from "express";
import { eq, sql, isNull, isNotNull, and } from "drizzle-orm";
import {
  db,
  plenariasTable,
  attendanceTable,
  usersTable,
  justifiedAbsencesTable,
} from "@workspace/db";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { scopeMembersToSession } from "../lib/roster";
import {
  getSessionWeightMap,
  applySessionWeights,
  ensureSessionWeightForUser,
} from "../lib/sessionWeights";
import { emitSessionEvent, evictUserFromSession, emitUserEvent } from "../lib/realtime";

const router: IRouter = Router();

router.get("/sessions/:id/attendance", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const sessionId = parseInt(raw, 10);
  if (isNaN(sessionId)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  // Get all active members (non-admin). Inactive accounts are excluded from the
  // absent list and from every weight total.
  const [rawMembers, [plenaria]] = await Promise.all([
    db
      .select()
      .from(usersTable)
      .where(and(eq(usersTable.rol, "miembro"), eq(usersTable.active, true))),
    db.select().from(plenariasTable).where(eq(plenariasTable.id, sessionId)),
  ]);

  if (!plenaria) {
    res.status(404).json({ error: "Sesión no encontrada" });
    return;
  }

  // Weights are frozen per session: use the snapshot, not current user weights.
  const weightMap = await getSessionWeightMap(sessionId);

  // Absences flagged "Inasistencia Justificada" (label only — still absent).
  const justifiedRows = await db
    .select({ userId: justifiedAbsencesTable.userId })
    .from(justifiedAbsencesTable)
    .where(eq(justifiedAbsencesTable.sessionId, sessionId));

  // Get attendance records
  const attendanceRecords = await db
    .select({
      userId: attendanceTable.userId,
      timestamp: attendanceTable.timestamp,
      modality: attendanceTable.modality,
      checkedOutAt: attendanceTable.checkedOutAt,
      displayName: usersTable.displayName,
      group: usersTable.group,
      faculty: usersTable.faculty,
      votingWeight: usersTable.votingWeight,
    })
    .from(attendanceTable)
    .innerJoin(usersTable, eq(attendanceTable.userId, usersTable.id))
    .where(eq(attendanceTable.sessionId, sessionId));

  const attendedIds = new Set(attendanceRecords.map((a) => a.userId));

  // Session-scoped roster: members created after this session don't show up as
  // absentees nor count toward its quorum/total weight (unless they attended).
  const allMembers = applySessionWeights(
    scopeMembersToSession(rawMembers, plenaria?.createdAt ?? new Date(0), attendedIds),
    weightMap,
  );

  const toRecord = (a: (typeof attendanceRecords)[number]) => ({
    userId: a.userId,
    displayName: a.displayName,
    group: a.group,
    faculty: a.faculty,
    votingWeight: parseFloat(weightMap.get(a.userId)?.weight ?? a.votingWeight),
    timestamp: a.timestamp,
    modality: a.modality,
    checkedOutAt: a.checkedOutAt,
  });

  // Active present = attended AND not checked out
  const present = attendanceRecords.filter((a) => a.checkedOutAt === null).map(toRecord);
  // Retired = attended AND checked out
  const checkedOut = attendanceRecords.filter((a) => a.checkedOutAt !== null).map(toRecord);

  // Absent = members who never marked attendance (retired members are listed in checkedOut)
  const absent = allMembers
    .filter((m) => !attendedIds.has(m.id))
    .map((m) => ({
      id: m.id,
      username: m.username,
      displayName: m.displayName,
      group: m.group,
      faculty: m.faculty,
      votingWeight: parseFloat(m.votingWeight),
      rol: m.rol,
    }));

  const totalWeight = allMembers.reduce((sum, m) => sum + parseFloat(m.votingWeight), 0);
  const presentWeight = present.reduce((sum, m) => sum + m.votingWeight, 0);

  // Only absentees can carry the justified label (a present member's stale
  // flag, if any, is ignored client-side).
  const justifiedIds = justifiedRows
    .map((j) => j.userId)
    .filter((id) => !attendedIds.has(id));

  res.json({ present, absent, checkedOut, totalWeight, presentWeight, justifiedIds });
});

router.post("/sessions/:id/attendance", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const sessionId = parseInt(raw, 10);
  if (isNaN(sessionId)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const { sessionCode, modality } = req.body;
  if (!sessionCode) {
    res.status(400).json({ error: "Código de sesión requerido" });
    return;
  }

  const validModalities = ["online", "presencial"];
  const chosenModality = validModalities.includes(modality) ? modality : "presencial";

  // Verify session exists and code matches
  const [session] = await db
    .select()
    .from(plenariasTable)
    .where(eq(plenariasTable.id, sessionId));

  if (!session) {
    res.status(404).json({ error: "Sesión no encontrada" });
    return;
  }

  if (session.status !== "abierta") {
    res.status(400).json({ error: "La sesión no está abierta" });
    return;
  }

  if (session.sessionCode.toUpperCase() !== sessionCode.toUpperCase().trim()) {
    res.status(400).json({ error: "Código de sesión incorrecto" });
    return;
  }

  const userId = req.session.userId!;

  const [user] = await db
    .select({ active: usersTable.active })
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  if (!user?.active) {
    res.status(403).json({ error: "Tu cuenta está inhabilitada" });
    return;
  }

  // Check for duplicate attendance using INSERT ... ON CONFLICT
  const result = await db.execute(sql`
    INSERT INTO attendance (session_id, user_id, modality)
    VALUES (${sessionId}, ${userId}, ${chosenModality})
    ON CONFLICT (session_id, user_id) DO NOTHING
    RETURNING id
  `);

  if (!result.rows || result.rows.length === 0) {
    res.status(409).json({ error: "Asistencia ya registrada" });
    return;
  }

  // Attending invalidates any prior "Inasistencia Justificada" label — without
  // this, deleting the attendance row later would silently resurrect it.
  await db
    .delete(justifiedAbsencesTable)
    .where(
      and(
        eq(justifiedAbsencesTable.sessionId, sessionId),
        eq(justifiedAbsencesTable.userId, userId),
      ),
    );

  // Members created after the session (joining an older open one) get their
  // weights frozen for it at first attendance.
  await ensureSessionWeightForUser(sessionId, userId);

  emitSessionEvent(sessionId, "attendance:changed");
  res.json({ ok: true, message: "Asistencia registrada correctamente" });
});

// Self check-out: a present member retires from the session
router.post("/sessions/:id/attendance/checkout", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const sessionId = parseInt(raw, 10);
  if (isNaN(sessionId)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const userId = req.session.userId!;

  // Only allow self check-out while the session is open — retiring after closure
  // would retroactively remove the member's vote weight from finalized results.
  const [session] = await db
    .select()
    .from(plenariasTable)
    .where(eq(plenariasTable.id, sessionId));

  if (!session) {
    res.status(404).json({ error: "Sesión no encontrada" });
    return;
  }

  if (session.status !== "abierta") {
    res.status(400).json({ error: "La sesión no está abierta" });
    return;
  }

  const [updated] = await db
    .update(attendanceTable)
    .set({ checkedOutAt: new Date() })
    .where(
      and(
        eq(attendanceTable.sessionId, sessionId),
        eq(attendanceTable.userId, userId),
        isNull(attendanceTable.checkedOutAt),
      ),
    )
    .returning({ id: attendanceTable.id });

  if (!updated) {
    res.status(400).json({ error: "No tienes asistencia activa en esta sesión" });
    return;
  }

  // No longer an active attendee — stop their live updates immediately.
  await evictUserFromSession(sessionId, userId);
  emitSessionEvent(sessionId, "attendance:changed");
  res.json({ ok: true, message: "Te has retirado de la sesión" });
});

// Quien se retiró puede volver a entrar por su cuenta. Es el inverso del
// endpoint anterior, y comparte su misma condición: solo mientras la sesión
// siga abierta. Reingresar a una sesión cerrada devolvería el peso de esa
// persona a resultados que ya se fijaron.
router.post("/sessions/:id/attendance/rejoin", requireAuth, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const sessionId = parseInt(raw, 10);
  if (isNaN(sessionId)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const userId = req.session.userId!;

  const [session] = await db
    .select()
    .from(plenariasTable)
    .where(eq(plenariasTable.id, sessionId));

  if (!session) {
    res.status(404).json({ error: "Sesión no encontrada" });
    return;
  }

  if (session.status !== "abierta") {
    res.status(400).json({ error: "La sesión no está abierta" });
    return;
  }

  const [updated] = await db
    .update(attendanceTable)
    .set({ checkedOutAt: null })
    .where(
      and(
        eq(attendanceTable.sessionId, sessionId),
        eq(attendanceTable.userId, userId),
        isNotNull(attendanceTable.checkedOutAt),
      ),
    )
    .returning({ id: attendanceTable.id });

  if (!updated) {
    res.status(400).json({ error: "No estás retirade de esta sesión" });
    return;
  }

  emitSessionEvent(sessionId, "attendance:changed");
  // Al retirarse quedó fuera de la sala de eventos, así que la difusión
  // anterior no le llega: hay que avisarle directamente para que vuelva a
  // entrar y se actualice al instante.
  emitUserEvent(userId, "access:changed");
  res.json({ ok: true, message: "Has reingresado a la sesión" });
});

// Admin retires a member from the session (check-out, keeps their cast votes).
// Distinct from PATCH present:false, which deletes the row entirely (absent).
router.post(
  "/sessions/:id/attendance/:userId/checkout",
  requireAdmin,
  async (req, res): Promise<void> => {
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const rawUser = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
    const sessionId = parseInt(rawId, 10);
    const userId = parseInt(rawUser, 10);
    if (isNaN(sessionId) || isNaN(userId)) {
      res.status(400).json({ error: "ID inválido" });
      return;
    }

    const [updated] = await db
      .update(attendanceTable)
      .set({ checkedOutAt: new Date() })
      .where(
        and(
          eq(attendanceTable.sessionId, sessionId),
          eq(attendanceTable.userId, userId),
          isNull(attendanceTable.checkedOutAt),
        ),
      )
      .returning({ id: attendanceTable.id });

    if (!updated) {
      res.status(400).json({ error: "El miembro no tiene asistencia activa en esta sesión" });
      return;
    }

    // No longer an active attendee — stop their live updates immediately.
    await evictUserFromSession(sessionId, userId);
    emitSessionEvent(sessionId, "attendance:changed");
    // The retired member is now out of the session room, so tell them directly
    // (per-user channel) to refresh — otherwise their ballot/results would sit
    // stale until the 30s fallback poll.
    emitUserEvent(userId, "access:changed");
    res.json({ ok: true, message: "Miembro retirado de la sesión" });
  },
);

// Admin re-admits a previously retired member (clears the check-out), keeping
// their modality. Inverse of the checkout endpoint above.
router.post(
  "/sessions/:id/attendance/:userId/reactivate",
  requireAdmin,
  async (req, res): Promise<void> => {
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const rawUser = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
    const sessionId = parseInt(rawId, 10);
    const userId = parseInt(rawUser, 10);
    if (isNaN(sessionId) || isNaN(userId)) {
      res.status(400).json({ error: "ID inválido" });
      return;
    }

    const [updated] = await db
      .update(attendanceTable)
      .set({ checkedOutAt: null })
      .where(
        and(
          eq(attendanceTable.sessionId, sessionId),
          eq(attendanceTable.userId, userId),
          isNotNull(attendanceTable.checkedOutAt),
        ),
      )
      .returning({ id: attendanceTable.id });

    if (!updated) {
      res.status(400).json({ error: "El miembro no está retirado de esta sesión" });
      return;
    }

    emitSessionEvent(sessionId, "attendance:changed");
    // The re-admitted member was evicted from the session room on checkout, so
    // the room broadcast above won't reach them — signal them directly so they
    // rejoin the room and refresh instantly.
    emitUserEvent(userId, "access:changed");
    res.json({ ok: true, message: "Miembro reingresado a la sesión" });
  },
);

// Admin manual edit of a member's attendance
router.patch("/sessions/:id/attendance/:userId", requireAdmin, async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const rawUser = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
  const sessionId = parseInt(rawId, 10);
  const userId = parseInt(rawUser, 10);
  if (isNaN(sessionId) || isNaN(userId)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const { present, modality, justified } = req.body;
  if (typeof present !== "boolean") {
    res.status(400).json({ error: "El campo 'present' es requerido" });
    return;
  }

  const validModalities = ["online", "presencial"];

  if (!present) {
    // Mark absent: remove attendance row entirely. `justified` only records the
    // "Inasistencia Justificada" LABEL — operationally identical to a normal
    // absence (no quorum, no voting eligibility).
    await db
      .delete(attendanceTable)
      .where(
        and(eq(attendanceTable.sessionId, sessionId), eq(attendanceTable.userId, userId)),
      );
    if (justified === true) {
      await db
        .insert(justifiedAbsencesTable)
        .values({ sessionId, userId })
        .onConflictDoNothing();
    } else {
      await db
        .delete(justifiedAbsencesTable)
        .where(
          and(
            eq(justifiedAbsencesTable.sessionId, sessionId),
            eq(justifiedAbsencesTable.userId, userId),
          ),
        );
    }
    // No longer an active attendee — stop their live updates immediately.
    await evictUserFromSession(sessionId, userId);
    emitSessionEvent(sessionId, "attendance:changed");
    // Out of the session room now — tell them directly to refresh.
    emitUserEvent(userId, "access:changed");
    res.json({ ok: true, message: "Marcado como ausente" });
    return;
  }

  // Mark present (and clear any retire). Upsert with conflict on (session_id, user_id).
  const chosenModality = validModalities.includes(modality) ? modality : "presencial";
  await db.execute(sql`
    INSERT INTO attendance (session_id, user_id, modality, checked_out_at)
    VALUES (${sessionId}, ${userId}, ${chosenModality}, NULL)
    ON CONFLICT (session_id, user_id)
    DO UPDATE SET modality = ${chosenModality}, checked_out_at = NULL
  `);

  // Present clears any prior "Inasistencia Justificada" label.
  await db
    .delete(justifiedAbsencesTable)
    .where(
      and(
        eq(justifiedAbsencesTable.sessionId, sessionId),
        eq(justifiedAbsencesTable.userId, userId),
      ),
    );

  // Freeze this member's weights for the session if not snapshotted yet
  // (e.g. admin marks a late-created member present in an older session).
  await ensureSessionWeightForUser(sessionId, userId);

  emitSessionEvent(sessionId, "attendance:changed");
  // Admin just marked this member present — they were likely absent (not in the
  // session room), so signal them directly to refresh + join the room instantly.
  emitUserEvent(userId, "access:changed");
  res.json({ ok: true, message: "Asistencia actualizada" });
});

export default router;
