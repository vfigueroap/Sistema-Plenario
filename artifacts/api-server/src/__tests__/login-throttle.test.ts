import express, { type Express } from "express";
import request from "supertest";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const { db, usersTable } = await import("@workspace/db");
const { eq } = await import("drizzle-orm");
const { resetRateLimits } = await import("../lib/rate-limit");
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

beforeEach(() => {
  // Clear rate-limit counters so each test starts from a clean window.
  resetRateLimits();
});

describe("POST /auth/login throttling", () => {
  it("throttles repeated failed attempts for the same username with 429", async () => {
    const app = makeApp();
    const statuses: number[] = [];
    // The per-username limit is 5 failures within the window; the 6th attempt
    // is blocked before credentials are even checked.
    for (let i = 0; i < 6; i++) {
      const res = await request(app)
        .post("/api/auth/login")
        .send({ username: USERNAME, password: WRONG });
      statuses.push(res.status);
    }

    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses[5]).toBe(429);
  });

  it("sets a Retry-After header when throttled", async () => {
    const app = makeApp();
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post("/api/auth/login")
        .send({ username: USERNAME, password: WRONG });
    }
    const res = await request(app)
      .post("/api/auth/login")
      .send({ username: USERNAME, password: WRONG });

    expect(res.status).toBe(429);
    expect(Number(res.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("blocks even a correct password once the account is throttled", async () => {
    const app = makeApp();
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post("/api/auth/login")
        .send({ username: USERNAME, password: WRONG });
    }
    const res = await request(app)
      .post("/api/auth/login")
      .send({ username: USERNAME, password: PASSWORD });

    expect(res.status).toBe(429);
  });

  it("does not throttle successful logins or normal usage", async () => {
    const app = makeApp();
    // A few failures below the limit, then a correct login still succeeds.
    for (let i = 0; i < 4; i++) {
      const fail = await request(app)
        .post("/api/auth/login")
        .send({ username: USERNAME, password: WRONG });
      expect(fail.status).toBe(401);
    }

    const ok = await request(app)
      .post("/api/auth/login")
      .send({ username: USERNAME, password: PASSWORD });
    expect(ok.status).toBe(200);
    expect(ok.body.username).toBe(USERNAME);

    // Successful logins never increment the counter, so repeated success stays
    // unaffected by the throttle.
    for (let i = 0; i < 10; i++) {
      const again = await request(app)
        .post("/api/auth/login")
        .send({ username: USERNAME, password: PASSWORD });
      expect(again.status).toBe(200);
    }
  });
});
