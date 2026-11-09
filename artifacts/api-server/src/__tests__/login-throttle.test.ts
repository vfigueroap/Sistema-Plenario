import express, { type Express } from "express";
import request from "supertest";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const { db, usersTable } = await import("@workspace/db");
const { eq } = await import("drizzle-orm");

const authRouter = (await import("../routes/auth")).default;

// A fake express-session whose save/destroy resolve synchronously, standing in
// for what express-session attaches in production.
type FakeSession = {
  userId?: number;
  rol?: string;
  institutionId?: string;
  regenerate: (cb: (err?: unknown) => void) => void;
  save: (cb: (err?: unknown) => void) => void;
  destroy: (cb: (err?: unknown) => void) => void;
};

function fakeSession(): FakeSession {
  return {
    regenerate: (cb) => cb(),
    save: (cb) => cb(),
    destroy: (cb) => cb(),
  };
}

// Mounts the auth router under /api with a stubbed session + req.log, mirroring
// how the real server wires the session middleware + pino-http + router.
function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { session: FakeSession }).session = fakeSession();
    (req as unknown as { log: Record<string, () => void> }).log = {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    };
    next();
  });
  app.use("/api", authRouter);
  return app;
}

const PASSWORD = "right-1234";
const WRONG = "wrong-9999";
const uniq = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const USERNAME = `login-${uniq}`;

let userId: number;

beforeAll(async () => {
  const hash = await bcrypt.hash(PASSWORD, 10);
  const [user] = await db
    .insert(usersTable)
    .values({
      username: USERNAME,
      displayName: "Login Test",
      password: hash,
      rol: "miembro",
      votingWeight: "1",
    })
    .returning();
  userId = user.id;
});

afterAll(async () => {
  await db.delete(usersTable).where(eq(usersTable.id, userId));
});

describe("POST /auth/login without lockout", () => {
  it("never blocks after repeated failed attempts", async () => {
    const app = makeApp();
    for (let i = 0; i < 12; i++) {
      const res = await request(app)
        .post("/api/auth/login")
        .send({ username: USERNAME, password: WRONG });
      expect(res.status).toBe(401);
    }
  });

  it("accepts the correct password after many failed attempts", async () => {
    const app = makeApp();
    for (let i = 0; i < 12; i++) {
      await request(app)
        .post("/api/auth/login")
        .send({ username: USERNAME, password: WRONG });
    }
    const ok = await request(app)
      .post("/api/auth/login")
      .send({ username: USERNAME, password: PASSWORD });
    expect(ok.status).toBe(200);
    expect(ok.body.username).toBe(USERNAME);
  });
});
