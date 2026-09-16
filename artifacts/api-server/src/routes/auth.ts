import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { rateLimitHit, rateLimitPeek } from "../lib/rate-limit";

// Throttle failed login attempts so a member's short password can't be
// brute-forced. Only failures count toward the limit (successful logins never
// increment), so normal usage is unaffected. The per-username limit is strict
// (targets brute force of one account); the per-IP limit is looser because many
// legitimate members may share one campus/NAT address.
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const LOGIN_MAX_FAILURES_PER_USERNAME = 5;
const LOGIN_MAX_FAILURES_PER_IP = 30;

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
  const { username, password } = req.body;
  if (!username || !password) {
    res.status(400).json({ error: "Usuario y contraseña requeridos" });
    return;
  }

  const ip = req.ip ?? "unknown";
  const ipKey = `login:ip:${ip}`;
  const institutionId = process.env.INSTITUTION_ID ?? "00000000-0000-4000-8000-000000000001";
  const userKey = `login:user:${institutionId}:${String(username).trim().toLowerCase()}`;

  // Gate up-front on prior failures so a successful login never increments the
  // counter. Block both the brute-forced account and the abusive source IP.
  const userBlock = rateLimitPeek(userKey, LOGIN_MAX_FAILURES_PER_USERNAME);
  const ipBlock = rateLimitPeek(ipKey, LOGIN_MAX_FAILURES_PER_IP);
  if (userBlock.limited || ipBlock.limited) {
    const retryAfter = Math.max(
      userBlock.retryAfterSeconds,
      ipBlock.retryAfterSeconds,
    );
    req.log.warn({ ip, username }, "Inicio de sesión limitado por intentos fallidos");
    res.setHeader("Retry-After", String(retryAfter));
    res
      .status(429)
      .json({ error: "Demasiados intentos fallidos. Intenta más tarde." });
    return;
  }

  // Records a failed attempt against both the username and the source IP.
  const recordFailure = (): void => {
    rateLimitHit(userKey, LOGIN_MAX_FAILURES_PER_USERNAME, LOGIN_WINDOW_MS);
    rateLimitHit(ipKey, LOGIN_MAX_FAILURES_PER_IP, LOGIN_WINDOW_MS);
  };

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.username, username));

  if (!user) {
    recordFailure();
    res.status(401).json({ error: "Credenciales inválidas" });
    return;
  }

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
    recordFailure();
    res.status(401).json({ error: "Credenciales inválidas" });
    return;
  }

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

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, req.session.userId));

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
  });
});

export default router;
