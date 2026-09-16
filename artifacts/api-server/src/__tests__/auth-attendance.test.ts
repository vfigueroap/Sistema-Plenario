import express, { type Express } from "express";
import request from "supertest";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The attendance router signals listeners via the realtime layer. Mock it so
// these tests exercise the access-control rules without standing up Socket.io.
vi.mock("../lib/realtime", () => ({
  emitSessionEvent: vi.fn(),
  emitVotesChanged: vi.fn(),
  emitLobbyEvent: vi.fn(),
  emitUserEvent: vi.fn(),
  evictUserFromSession: vi.fn(async () => {}),
  SOCKET_PATH: "/api/socket.io",
}));

// Imported after the mock so the routers bind to the stubbed realtime layer.
const { db, usersTable, plenariasTable, attendanceTable, topicsTable } =
  await import("@workspace/db");
const { eq, and } = await import("drizzle-orm");
const authRouter = (await import("../routes/auth")).default;
const attendanceRouter = (await import("../routes/attendance")).default;
const votesRouter = (await import("../routes/votes")).default;
const { requireAuth, requireAdmin } = await import("../middlewares/auth");

// A configurable fake session, standing in for what express-session would
// attach after login. `save`/`destroy` are stubbed so the login/logout routes
// (which call them) resolve synchronously.
type FakeSession = {
  userId?: number;
  rol?: string;
  institutionId?: string;
  active?: boolean;
  regenerate: (cb: (err?: unknown) => void) => void;
  save: (cb: (err?: unknown) => void) => void;
  destroy: (cb: (err?: unknown) => void) => void;
};

function fakeSession(data: { userId?: number; rol?: string } = {}): FakeSession {
  return {
    ...data,
    regenerate: (cb) => cb(),
    save: (cb) => cb(),
    destroy: (cb) => cb(),
  };
}

// Builds an app that injects a fixed session and mounts the given router under
// /api, mirroring how the real session middleware + router are wired in prod.
function makeApp(router: express.Router, session: FakeSession): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { session: FakeSession }).session = session;
    // Routes log via pino-http's `req.log`; stub it since these tests mount the
    // router without the pino-http middleware.
    (req as unknown as { log: Record<string, () => void> }).log = {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    };
    next();
  });
  app.use("/api", router);
  return app;
}

const PASSWORD = "test-1234";
const uniq = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

let adminId: number;
let memberActiveId: number; // has active attendance in the open session
let memberRetiredId: number; // checked out of the open session
let memberNoneId: number; // never marked attendance
let memberCheckoutId: number; // active attendance, dedicated to the self check-out test
let openSessionId: number;
let closedSessionId: number;
let openTopicId: number; // open topic in the open session
let closedTopicId: number; // closed topic in the open session
let openTopicInClosedSessionId: number;
const OPEN_CODE = `OPEN-${uniq}`;

beforeAll(async () => {
  const hash = await bcrypt.hash(PASSWORD, 10);

  const [admin] = await db
    .insert(usersTable)
    .values({
      username: `admin-${uniq}`,
      displayName: "Admin Test",
      password: hash,
      rol: "admin",
      votingWeight: "0",
    })
    .returning();
  adminId = admin.id;

  const [memberActive] = await db
    .insert(usersTable)
    .values({
      username: `member-active-${uniq}`,
      displayName: "Member Active",
      password: hash,
      rol: "miembro",
      votingWeight: "1.5",
    })
    .returning();
  memberActiveId = memberActive.id;

  const [memberRetired] = await db
    .insert(usersTable)
    .values({
      username: `member-retired-${uniq}`,
      displayName: "Member Retired",
      password: hash,
      rol: "miembro",
      votingWeight: "1",
    })
    .returning();
  memberRetiredId = memberRetired.id;

  const [memberNone] = await db
    .insert(usersTable)
    .values({
      username: `member-none-${uniq}`,
      displayName: "Member None",
      password: hash,
      rol: "miembro",
      votingWeight: "1",
    })
    .returning();
  memberNoneId = memberNone.id;

  const [memberCheckout] = await db
    .insert(usersTable)
    .values({
      username: `member-checkout-${uniq}`,
      displayName: "Member Checkout",
      password: hash,
      rol: "miembro",
      votingWeight: "1",
    })
    .returning();
  memberCheckoutId = memberCheckout.id;

  const [openSession] = await db
    .insert(plenariasTable)
    .values({ title: "Open plenaria (vitest)", sessionCode: OPEN_CODE, status: "abierta" })
    .returning();
  openSessionId = openSession.id;

  const [closedSession] = await db
    .insert(plenariasTable)
    .values({
      title: "Closed plenaria (vitest)",
      sessionCode: `CLOSED-${uniq}`,
      status: "cerrada",
    })
    .returning();
  closedSessionId = closedSession.id;

  // Active attendance for memberActive; retired (checked out) for memberRetired.
  await db
    .insert(attendanceTable)
    .values({ sessionId: openSessionId, userId: memberActiveId, modality: "presencial" });
  // Active attendance for the dedicated self check-out member.
  await db
    .insert(attendanceTable)
    .values({ sessionId: openSessionId, userId: memberCheckoutId, modality: "presencial" });
  await db.insert(attendanceTable).values({
    sessionId: openSessionId,
    userId: memberRetiredId,
    modality: "presencial",
    checkedOutAt: new Date(),
  });

  const [openTopic] = await db
    .insert(topicsTable)
    .values({ sessionId: openSessionId, title: "Open topic (vitest)", status: "abierto" })
    .returning();
  openTopicId = openTopic.id;

  const [closedTopic] = await db
    .insert(topicsTable)
    .values({ sessionId: openSessionId, title: "Closed topic (vitest)", status: "cerrado" })
    .returning();
  closedTopicId = closedTopic.id;
  const [inconsistentTopic] = await db.insert(topicsTable).values({
    sessionId: closedSessionId, title: "Open topic in closed session (vitest)", status: "abierto",
  }).returning();
  openTopicInClosedSessionId = inconsistentTopic.id;
  await db.insert(attendanceTable).values({
    sessionId: closedSessionId, userId: memberActiveId, modality: "presencial",
  });
});

afterAll(async () => {
  // Deleting the sessions cascade-removes attendance, topics, and votes.
  await db.delete(plenariasTable).where(eq(plenariasTable.id, openSessionId));
  await db.delete(plenariasTable).where(eq(plenariasTable.id, closedSessionId));
  for (const id of [adminId, memberActiveId, memberRetiredId, memberNoneId, memberCheckoutId]) {
    await db.delete(usersTable).where(eq(usersTable.id, id));
  }
});

describe("login", () => {
  const app = () => makeApp(authRouter, fakeSession());

  it("succeeds with valid credentials and returns the user", async () => {
    const res = await request(app())
      .post("/api/auth/login")
      .send({ username: `member-active-${uniq}`, password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(memberActiveId);
    expect(res.body.rol).toBe("miembro");
    expect(res.body.password).toBeUndefined();
  });

  it("rejects a wrong password with 401", async () => {
    const res = await request(app())
      .post("/api/auth/login")
      .send({ username: `member-active-${uniq}`, password: "wrong-password" });

    expect(res.status).toBe(401);
  });

  it("rejects an unknown username with 401", async () => {
    const res = await request(app())
      .post("/api/auth/login")
      .send({ username: `does-not-exist-${uniq}`, password: PASSWORD });

    expect(res.status).toBe(401);
  });

  it("rejects missing credentials with 400", async () => {
    const res = await request(app()).post("/api/auth/login").send({ username: "x" });
    expect(res.status).toBe(400);
  });
});

describe("requireAuth / requireAdmin middleware", () => {
  function guardApp(session: FakeSession): Express {
    const app = express();
    app.use((req, _res, next) => {
      (req as unknown as { session: FakeSession }).session = session;
      next();
    });
    app.get("/api/protected", requireAuth, (_req, res) => {
      res.json({ ok: true });
    });
    app.get("/api/admin-only", requireAdmin, (_req, res) => {
      res.json({ ok: true });
    });
    return app;
  }

  it("requireAuth blocks an unauthenticated request with 401", async () => {
    const res = await request(guardApp(fakeSession())).get("/api/protected");
    expect(res.status).toBe(401);
  });

  it("requireAuth allows an authenticated request", async () => {
    const res = await request(guardApp(fakeSession({ userId: memberActiveId, rol: "miembro" }))).get(
      "/api/protected",
    );
    expect(res.status).toBe(200);
  });

  it("requireAdmin blocks an unauthenticated request with 401", async () => {
    const res = await request(guardApp(fakeSession())).get("/api/admin-only");
    expect(res.status).toBe(401);
  });

  it("requireAdmin blocks a non-admin member with 403", async () => {
    const res = await request(
      guardApp(fakeSession({ userId: memberActiveId, rol: "miembro" })),
    ).get("/api/admin-only");
    expect(res.status).toBe(403);
  });

  it("requireAdmin allows an admin", async () => {
    const res = await request(guardApp(fakeSession({ userId: adminId, rol: "admin" }))).get(
      "/api/admin-only",
    );
    expect(res.status).toBe(200);
  });
});

describe("attendance gating", () => {
  it("rejects an unauthenticated read of attendance with 401", async () => {
    const res = await request(makeApp(attendanceRouter, fakeSession())).get(
      `/api/sessions/${openSessionId}/attendance`,
    );
    expect(res.status).toBe(401);
  });

  it("marks attendance on an open session with the correct code", async () => {
    const app = makeApp(attendanceRouter, fakeSession({ userId: memberNoneId, rol: "miembro" }));
    const res = await request(app)
      .post(`/api/sessions/${openSessionId}/attendance`)
      .send({ sessionCode: OPEN_CODE, modality: "presencial" });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Clean up the row created by this test so re-runs stay idempotent.
    await db.delete(attendanceTable).where(eq(attendanceTable.userId, memberNoneId));
  });

  it("refuses attendance on a closed session with 400", async () => {
    const app = makeApp(attendanceRouter, fakeSession({ userId: memberNoneId, rol: "miembro" }));
    const res = await request(app)
      .post(`/api/sessions/${closedSessionId}/attendance`)
      .send({ sessionCode: `CLOSED-${uniq}`, modality: "presencial" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no está abierta/i);
  });

  it("refuses attendance with an incorrect session code", async () => {
    const app = makeApp(attendanceRouter, fakeSession({ userId: memberNoneId, rol: "miembro" }));
    const res = await request(app)
      .post(`/api/sessions/${openSessionId}/attendance`)
      .send({ sessionCode: "WRONG-CODE", modality: "presencial" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/incorrecto/i);
  });

  it("blocks a non-admin from the admin attendance edit with 403", async () => {
    const app = makeApp(attendanceRouter, fakeSession({ userId: memberActiveId, rol: "miembro" }));
    const res = await request(app)
      .patch(`/api/sessions/${openSessionId}/attendance/${memberNoneId}`)
      .send({ present: true });

    expect(res.status).toBe(403);
  });
});

describe("voting requires active attendance", () => {
  it("rejects an open topic when its parent session is closed", async () => {
    const app = makeApp(votesRouter, fakeSession({ userId: memberActiveId, rol: "miembro" }));
    const res = await request(app)
      .post(`/api/topics/${openTopicInClosedSessionId}/vote`)
      .send({ option: "favor" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/sesión no está abierta/i);
  });

  it("allows a member with active attendance to vote on an open topic", async () => {
    const app = makeApp(votesRouter, fakeSession({ userId: memberActiveId, rol: "miembro" }));
    const res = await request(app)
      .post(`/api/topics/${openTopicId}/vote`)
      .send({ option: "favor" });

    expect(res.status).toBe(200);
    expect(res.body.option).toBe("favor");
  });

  it("rejects a member with no attendance with 400", async () => {
    const app = makeApp(votesRouter, fakeSession({ userId: memberNoneId, rol: "miembro" }));
    const res = await request(app)
      .post(`/api/topics/${openTopicId}/vote`)
      .send({ option: "favor" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/asistencia/i);
  });

  it("rejects a retired (checked-out) member with 400", async () => {
    const app = makeApp(votesRouter, fakeSession({ userId: memberRetiredId, rol: "miembro" }));
    const res = await request(app)
      .post(`/api/topics/${openTopicId}/vote`)
      .send({ option: "favor" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/retirado/i);
  });

  it("rejects voting on a closed topic with 400", async () => {
    const app = makeApp(votesRouter, fakeSession({ userId: memberActiveId, rol: "miembro" }));
    const res = await request(app)
      .post(`/api/topics/${closedTopicId}/vote`)
      .send({ option: "favor" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no está abierta/i);
  });

  it("rejects an unauthenticated vote with 401", async () => {
    const res = await request(makeApp(votesRouter, fakeSession()))
      .post(`/api/topics/${openTopicId}/vote`)
      .send({ option: "favor" });

    expect(res.status).toBe(401);
  });
});

describe("self check-out (retire) rules", () => {
  it("rejects an unauthenticated check-out with 401", async () => {
    const res = await request(makeApp(attendanceRouter, fakeSession())).post(
      `/api/sessions/${openSessionId}/attendance/checkout`,
    );
    expect(res.status).toBe(401);
  });

  it("refuses check-out on a closed session with 400", async () => {
    const app = makeApp(attendanceRouter, fakeSession({ userId: memberActiveId, rol: "miembro" }));
    const res = await request(app).post(`/api/sessions/${closedSessionId}/attendance/checkout`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no está abierta/i);
  });

  it("refuses check-out when the member has no active attendance with 400", async () => {
    const app = makeApp(attendanceRouter, fakeSession({ userId: memberNoneId, rol: "miembro" }));
    const res = await request(app).post(`/api/sessions/${openSessionId}/attendance/checkout`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/asistencia activa/i);
  });

  it("refuses a second check-out for an already-retired member with 400", async () => {
    const app = makeApp(attendanceRouter, fakeSession({ userId: memberRetiredId, rol: "miembro" }));
    const res = await request(app).post(`/api/sessions/${openSessionId}/attendance/checkout`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/asistencia activa/i);
  });

  it("succeeds for a member with active attendance on an open session", async () => {
    const app = makeApp(
      attendanceRouter,
      fakeSession({ userId: memberCheckoutId, rol: "miembro" }),
    );
    const res = await request(app).post(`/api/sessions/${openSessionId}/attendance/checkout`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // The row is now marked retired (checkedOutAt set), not deleted.
    const [row] = await db
      .select()
      .from(attendanceTable)
      .where(
        and(
          eq(attendanceTable.sessionId, openSessionId),
          eq(attendanceTable.userId, memberCheckoutId),
        ),
      );
    expect(row).toBeDefined();
    expect(row.checkedOutAt).not.toBeNull();
  });
});

describe("admin manual attendance edit (PATCH)", () => {
  it("marks a member present, creating an active attendance row", async () => {
    const app = makeApp(attendanceRouter, fakeSession({ userId: adminId, rol: "admin" }));
    const res = await request(app)
      .patch(`/api/sessions/${openSessionId}/attendance/${memberNoneId}`)
      .send({ present: true, modality: "presencial" });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const [row] = await db
      .select()
      .from(attendanceTable)
      .where(
        and(
          eq(attendanceTable.sessionId, openSessionId),
          eq(attendanceTable.userId, memberNoneId),
        ),
      );
    expect(row).toBeDefined();
    expect(row.checkedOutAt).toBeNull();

    // Clean up so memberNoneId stays attendance-free for re-runs.
    await db.delete(attendanceTable).where(eq(attendanceTable.userId, memberNoneId));
  });

  it("clears a prior retire when marking a retired member present again", async () => {
    const app = makeApp(attendanceRouter, fakeSession({ userId: adminId, rol: "admin" }));
    const res = await request(app)
      .patch(`/api/sessions/${openSessionId}/attendance/${memberRetiredId}`)
      .send({ present: true, modality: "presencial" });

    expect(res.status).toBe(200);

    const [row] = await db
      .select()
      .from(attendanceTable)
      .where(
        and(
          eq(attendanceTable.sessionId, openSessionId),
          eq(attendanceTable.userId, memberRetiredId),
        ),
      );
    expect(row).toBeDefined();
    expect(row.checkedOutAt).toBeNull();
  });

  it("marks a member absent, removing their attendance row", async () => {
    const app = makeApp(attendanceRouter, fakeSession({ userId: adminId, rol: "admin" }));
    const res = await request(app)
      .patch(`/api/sessions/${openSessionId}/attendance/${memberActiveId}`)
      .send({ present: false });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const rows = await db
      .select()
      .from(attendanceTable)
      .where(
        and(
          eq(attendanceTable.sessionId, openSessionId),
          eq(attendanceTable.userId, memberActiveId),
        ),
      );
    expect(rows).toHaveLength(0);
  });

  it("rejects a PATCH without a boolean 'present' field with 400", async () => {
    const app = makeApp(attendanceRouter, fakeSession({ userId: adminId, rol: "admin" }));
    const res = await request(app)
      .patch(`/api/sessions/${openSessionId}/attendance/${memberNoneId}`)
      .send({ modality: "presencial" });

    expect(res.status).toBe(400);
  });
});
