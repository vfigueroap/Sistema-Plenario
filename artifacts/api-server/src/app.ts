import express, { type Express, type RequestHandler } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { db, sessionPool, usersTable, withInstitutionDb } from "@workspace/db";
import { eq } from "drizzle-orm";
import router, { publicHistoryRouter } from "./routes";
import { logger } from "./lib/logger";
import { createAllowedOrigin, httpUrlOrigin } from "./lib/allowed-origin";
import { pulseHandler } from "./routes/pulse";
import { clearSharedCache } from "./lib/shared-cache";
import { committedResponse } from "./lib/committed-response";

const app: Express = express();

const isProduction = process.env.NODE_ENV === "production";

// Vercel and the local development proxy each add one trusted proxy hop.
app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  next();
});

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

const isAllowedOrigin = createAllowedOrigin(process.env);
app.use(cors({
  credentials: true,
  origin: (origin, callback) => callback(null, isAllowedOrigin(origin)),
}));
app.use((req, res, next) => {
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    // CORS alone cannot stop simple HTML forms from mutating state. Validate
    // before body parsing and session access; never rescue an invalid Origin
    // with a trusted Referer. Missing source metadata also fails closed.
    const origin = req.get("Origin") ?? httpUrlOrigin(req.get("Referer"));
    if (!isAllowedOrigin(origin)) {
      res.status(403).json({ error: "Origen no autorizado" });
      return;
    }
  }
  next();
});
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const testInstitutionId = "00000000-0000-4000-8000-000000000001";
const institutionId = process.env.INSTITUTION_ID ?? (isProduction ? "" : testInstitutionId);
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(institutionId)) {
  logger.error("INSTITUTION_ID must be a valid UUID");
  process.exit(1);
}

app.get("/api/public/pulse", pulseHandler(institutionId));
app.use("/api/public", publicHistoryRouter);

const PgSession = connectPgSimple(session);

const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret && isProduction) {
  logger.error("SESSION_SECRET is required in production");
  process.exit(1);
}

// Exported so the Socket.io server can reuse the exact same session
// middleware to authenticate websocket connections via the session cookie.
export const sessionMiddleware: RequestHandler = session({
  store: new PgSession({
    pool: sessionPool,
    tableName: "session",
    createTableIfMissing: !isProduction,
    disableTouch: true,
  }),
  secret: sessionSecret ?? "dev-secret-not-for-production",
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: isProduction,
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    sameSite: "lax",
  },
});

app.use(sessionMiddleware);

const isAllowedBeforePasswordChange = (method: string, path: string): boolean =>
  path.startsWith("/api/public/") ||
  path === "/api/auth/me" ||
  path === "/api/auth/logout" ||
  (method === "PATCH" && path === "/api/members/me/password");

type CurrentUser = { rol: typeof usersTable.rol._.data; active: boolean; mustChangePassword: boolean };
const CURRENT_USER_TTL_MS = 2000;
const isMemberActionPath = (path: string): boolean =>
  /^\/api\/(topics\/\d+\/vote|sessions\/\d+\/(attendance|speaking-turns))$/.test(path);
const currentUserCache = new Map<number, { at: number; value: CurrentUser }>();

async function loadCurrentUser(userId: number, allowCache: boolean): Promise<CurrentUser | undefined> {
  const hit = currentUserCache.get(userId);
  if (allowCache && hit && !hit.value.mustChangePassword && Date.now() - hit.at < CURRENT_USER_TTL_MS) return hit.value;
  const [row] = await db.select({
    rol: usersTable.rol,
    active: usersTable.active,
    mustChangePassword: usersTable.mustChangePassword,
  }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!row) {
    currentUserCache.delete(userId);
    return undefined;
  }
  if (currentUserCache.size > 2000) currentUserCache.clear();
  currentUserCache.set(userId, { at: Date.now(), value: row });
  return row;
}

app.use((req, res, next) => {
  if (req.path === "/api/healthz" || req.path === "/api/auth/login") return next();
  if (req.session.userId && req.session.institutionId !== institutionId) {
    req.session.destroy(() => {});
    res.status(401).json({ error: "La sesión pertenece a otra institución" });
    return;
  }
  const response = committedResponse(res);
  void withInstitutionDb(institutionId, async () => {
    if (res.destroyed) throw new Error("Request aborted");
    if (req.session.userId) {
      const currentUser = await loadCurrentUser(req.session.userId, req.method === "GET" || isMemberActionPath(req.path));
      if (!currentUser) {
        req.session.destroy(() => {});
        res.status(401).json({ error: "Usuario no encontrado" });
        return;
      }
      if (currentUser.mustChangePassword && !isAllowedBeforePasswordChange(req.method, req.path)) {
        res.status(403).json({
          error: "Debes cambiar tu contraseña inicial antes de continuar",
          code: "password_change_required",
        });
        return;
      }
      req.session.rol = currentUser.rol;
      req.session.active = currentUser.active;
    }
    if (res.destroyed) throw new Error("Request aborted");
    next();
    await response.ready;
  }).then(() => {
    if (req.method !== "GET") clearSharedCache();
    if (req.method !== "GET" && req.path.startsWith("/api/members")) currentUserCache.clear();
    response.send();
  }).catch((error) => {
    req.log.error({ error }, "Institution request failed");
    if (req.method !== "GET") clearSharedCache();
    response.fail();
  });
});

app.use("/api", router);

export default app;
