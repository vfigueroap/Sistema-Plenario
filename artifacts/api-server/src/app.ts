import express, { type Express, type RequestHandler } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { db, pool, usersTable, withInstitutionDb } from "@workspace/db";
import { eq } from "drizzle-orm";
import router from "./routes";
import { logger } from "./lib/logger";
import { createAllowedOrigin, httpUrlOrigin } from "./lib/allowed-origin";

const app: Express = express();

const isProduction = process.env.NODE_ENV === "production";

// Vercel and the local development proxy each add one trusted proxy hop.
app.set("trust proxy", 1);

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
    pool,
    tableName: "session",
    createTableIfMissing: !isProduction,
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

const testInstitutionId = "00000000-0000-4000-8000-000000000001";
const institutionId = process.env.INSTITUTION_ID ?? (isProduction ? "" : testInstitutionId);
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(institutionId)) {
  logger.error("INSTITUTION_ID must be a valid UUID");
  process.exit(1);
}

app.use((req, res, next) => {
  if (req.path === "/api/healthz") return next();
  if (req.session.userId && req.session.institutionId !== institutionId) {
    req.session.destroy(() => {});
    res.status(401).json({ error: "La sesión pertenece a otra institución" });
    return;
  }
  void withInstitutionDb(institutionId, async () => {
    if (req.session.userId) {
      const [currentUser] = await db.select({ rol: usersTable.rol, active: usersTable.active })
        .from(usersTable).where(eq(usersTable.id, req.session.userId)).limit(1);
      if (!currentUser) {
        req.session.destroy(() => {});
        res.status(401).json({ error: "Usuario no encontrado" });
        return;
      }
      req.session.rol = currentUser.rol;
      req.session.active = currentUser.active;
    }
    await new Promise<void>((resolve, reject) => {
      res.once("finish", () => res.statusCode >= 500 ? reject(new Error("Request failed")) : resolve());
      res.once("close", () => res.writableEnded ? resolve() : reject(new Error("Request aborted")));
      next();
    });
  }).catch((error) => {
    req.log.error({ error }, "Institution request failed");
    if (!res.headersSent) res.status(500).json({ error: "Error interno" });
  });
});

app.use("/api", router);

export default app;
