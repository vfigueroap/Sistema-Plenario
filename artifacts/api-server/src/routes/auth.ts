import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable, withInstitutionDb } from "@workspace/db";
import { logger } from "../lib/logger";
import { checkPassword, PasswordQueueFullError } from "../lib/password-check";
import type { RequestUser } from "../lib/request-user";

declare module "express-session" {
  interface SessionData {
    userId: number;
    rol: string;
    institutionId: string;
    active: boolean;
  }
}

const router: IRouter = Router();

router.post("/auth/login", async (req, res): Promise<void> => {
  const { username, password } = req.body ?? {};
  if (typeof username !== "string" || typeof password !== "string" || !username || !password || username.length > 200 || password.length > 1024) {
    res.status(400).json({ error: "Usuario y contraseña requeridos" });
    return;
  }

  const institutionId = process.env.INSTITUTION_ID ?? "00000000-0000-4000-8000-000000000001";

  const [user] = await withInstitutionDb(institutionId, (tx) => tx
    .select()
    .from(usersTable)
    .where(eq(usersTable.username, username)));

  if (!user) {
    res.status(401).json({ error: "Credenciales inválidas" });
    return;
  }

  let valid: boolean;
  try {
    valid = await checkPassword(password, user.password);
  } catch (error) {
    if (!(error instanceof PasswordQueueFullError)) throw error;
    res.status(503).setHeader("Retry-After", "3");
    res.json({ error: "Hay muchos ingresos en curso. Intenta nuevamente en unos segundos." });
    return;
  }
  if (!valid) {
    res.status(401).json({ error: "Credenciales inválidas" });
    return;
  }

  const [current] = await withInstitutionDb(institutionId, (tx) => tx.select().from(usersTable).where(eq(usersTable.id, user.id)));
  if (!current || current.password !== user.password) {
    res.status(401).json({ error: "Credenciales inválidas" });
    return;
  }
  Object.assign(user, current);

  req.session.regenerate((regenerateErr) => {
    if (regenerateErr) {
      req.log.error({ regenerateErr }, "Error regenerando sesión");
      res.status(500).json({ error: "Error interno" });
      return;
    }
    req.session.userId = user.id;
    req.session.rol = user.rol;
    req.session.institutionId = institutionId;
    req.session.active = user.active;
    req.session.save((saveErr) => {
    if (saveErr) {
      req.log.error({ saveErr }, "Error guardando sesión");
      res.status(500).json({ error: "Error interno" });
      return;
    }

    req.log.info({ userId: user.id, rol: user.rol }, "Login exitoso");

    res.json({
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      group: user.group,
      faculty: user.faculty,
      email: user.email,
      rol: user.rol,
      votingWeight: parseFloat(user.votingWeight),
      active: user.active,
      mustChangePassword: user.mustChangePassword,
    });
    });
  });
});

router.post("/auth/logout", (req, res): void => {
  req.session.destroy((err) => {
    if (err) {
      logger.error({ err }, "Error al cerrar sesión");
    }
    res.json({ ok: true });
  });
});

router.get("/auth/me", async (req, res): Promise<void> => {
  if (!req.session.userId) {
    res.status(401).json({ error: "No autenticado" });
    return;
  }

  const user = (res.locals.currentUser as RequestUser | undefined) ?? (await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, req.session.userId)))[0];

  if (!user) {
    req.session.destroy(() => {});
    res.status(401).json({ error: "Usuario no encontrado" });
    return;
  }

  res.json({
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    group: user.group,
    faculty: user.faculty,
    email: user.email,
    rol: user.rol,
    votingWeight: parseFloat(user.votingWeight),
    active: user.active,
    mustChangePassword: user.mustChangePassword,
  });
});

export default router;
