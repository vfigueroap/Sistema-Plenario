import express, { type Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The votes router signals listeners via the realtime layer. Mock it so these
// tests exercise the casting rules without standing up Socket.io.
vi.mock("../lib/realtime", () => ({
  emitSessionEvent: vi.fn(),
  emitVotesChanged: vi.fn(),
  emitLobbyEvent: vi.fn(),
  SOCKET_PATH: "/api/socket.io",
}));

// Imported after the mock so the router binds to the stubbed realtime layer.
const { db, usersTable, plenariasTable, attendanceTable, topicsTable, votesTable } =
  await import("@workspace/db");
const { eq, and } = await import("drizzle-orm");
const votesRouter = (await import("../routes/votes")).default;

// A configurable fake session, standing in for what express-session would
// attach after login.
type FakeSession = { userId?: number; rol?: string };

function fakeSession(data: FakeSession = {}): FakeSession {
  return { ...data };
}

// Builds an app that injects a fixed session and mounts the votes router under
// /api, mirroring how the real session middleware + router are wired in prod.
function makeApp(session: FakeSession): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { session: FakeSession }).session = session;
    // Routes may log via pino-http's `req.log`; stub it since these tests mount
    // the router without the pino-http middleware.
    (req as unknown as { log: Record<string, () => void> }).log = {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    };
    next();
  });
  app.use("/api", votesRouter);
  return app;
}

const uniq = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

// memberWeighted casts the votes whose weight we assert is frozen.
let memberWeightedId: number;
// memberDup exercises duplicate / concurrent vote protection.
let memberDupId: number;
// memberNone never marked attendance.
let memberNoneId: number;
// memberRetired checked out of the session.
let memberRetiredId: number;

let openSessionId: number;
let openTopicId: number; // open topic used for the happy-path / weight assertions
let dupTopicId: number; // open topic dedicated to duplicate-vote assertions
let concTopicId: number; // open topic dedicated to concurrent-vote assertions
let closedTopicId: number; // closed topic in the open session

// The exact weight the weighted member holds when they cast their vote.
const FROZEN_WEIGHT = "2.5000";

beforeAll(async () => {
  const [memberWeighted] = await db
    .insert(usersTable)
    .values({
      username: `vc-weighted-${uniq}`,
      displayName: "Vote Casting Weighted",
      password: "x",
      rol: "miembro",
      votingWeight: FROZEN_WEIGHT,
    })
    .returning();
  memberWeightedId = memberWeighted.id;

  const [memberDup] = await db
    .insert(usersTable)
    .values({
      username: `vc-dup-${uniq}`,
      displayName: "Vote Casting Dup",
      password: "x",
      rol: "miembro",
      votingWeight: "1",
    })
    .returning();
  memberDupId = memberDup.id;

  const [memberNone] = await db
    .insert(usersTable)
    .values({
      username: `vc-none-${uniq}`,
      displayName: "Vote Casting None",
      password: "x",
      rol: "miembro",
      votingWeight: "1",
    })
    .returning();
  memberNoneId = memberNone.id;

  const [memberRetired] = await db
    .insert(usersTable)
    .values({
      username: `vc-retired-${uniq}`,
      displayName: "Vote Casting Retired",
      password: "x",
      rol: "miembro",
      votingWeight: "1",
    })
    .returning();
  memberRetiredId = memberRetired.id;

  const [openSession] = await db
    .insert(plenariasTable)
    .values({
      title: "Vote casting plenaria (vitest)",
      sessionCode: `VC-${uniq}`,
      status: "abierta",
    })
    .returning();
  openSessionId = openSession.id;

  // Active attendance for the weighted + dup members; retired (checked out) for
  // memberRetired. memberNone gets no attendance row at all.
  await db
    .insert(attendanceTable)
    .values({ sessionId: openSessionId, userId: memberWeightedId, modality: "presencial" });
  await db
    .insert(attendanceTable)
    .values({ sessionId: openSessionId, userId: memberDupId, modality: "presencial" });
  await db.insert(attendanceTable).values({
    sessionId: openSessionId,
    userId: memberRetiredId,
    modality: "presencial",
    checkedOutAt: new Date(),
  });

  const [openTopic] = await db
    .insert(topicsTable)
    .values({ sessionId: openSessionId, title: "VC open topic", status: "abierto" })
    .returning();
  openTopicId = openTopic.id;

  const [dupTopic] = await db
    .insert(topicsTable)
    .values({ sessionId: openSessionId, title: "VC dup topic", status: "abierto" })
    .returning();
  dupTopicId = dupTopic.id;

  const [concTopic] = await db
    .insert(topicsTable)
    .values({ sessionId: openSessionId, title: "VC concurrent topic", status: "abierto" })
    .returning();
  concTopicId = concTopic.id;

  const [closedTopic] = await db
    .insert(topicsTable)
    .values({ sessionId: openSessionId, title: "VC closed topic", status: "cerrado" })
    .returning();
  closedTopicId = closedTopic.id;
});

afterAll(async () => {
  // Deleting the session cascade-removes attendance, topics, and votes.
  await db.delete(plenariasTable).where(eq(plenariasTable.id, openSessionId));
  for (const id of [memberWeightedId, memberDupId, memberNoneId, memberRetiredId]) {
    await db.delete(usersTable).where(eq(usersTable.id, id));
  }
});

describe("vote casting — attendance is required", () => {
  it("rejects an unauthenticated vote with 401", async () => {
    const res = await request(makeApp(fakeSession()))
      .post(`/api/topics/${openTopicId}/vote`)
      .send({ option: "favor" });
    expect(res.status).toBe(401);
  });

  it("rejects a member with no attendance row with 400", async () => {
    const res = await request(makeApp(fakeSession({ userId: memberNoneId, rol: "miembro" })))
      .post(`/api/topics/${openTopicId}/vote`)
      .send({ option: "favor" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/asistencia/i);

    // No vote row should have been written.
    const rows = await db
      .select()
      .from(votesTable)
      .where(and(eq(votesTable.voteTopicId, openTopicId), eq(votesTable.userId, memberNoneId)));
    expect(rows).toHaveLength(0);
  });

  it("rejects a retired (checked-out) member with 400", async () => {
    const res = await request(makeApp(fakeSession({ userId: memberRetiredId, rol: "miembro" })))
      .post(`/api/topics/${openTopicId}/vote`)
      .send({ option: "favor" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/retirado/i);
  });
});

describe("vote casting — topic must be open", () => {
  it("rejects a vote on a closed topic with 400", async () => {
    const res = await request(makeApp(fakeSession({ userId: memberWeightedId, rol: "miembro" })))
      .post(`/api/topics/${closedTopicId}/vote`)
      .send({ option: "favor" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no está abierta/i);
  });

  it("returns 404 for a topic that does not exist", async () => {
    const res = await request(makeApp(fakeSession({ userId: memberWeightedId, rol: "miembro" })))
      .post(`/api/topics/987654321/vote`)
      .send({ option: "favor" });
    expect(res.status).toBe(404);
  });
});

describe("vote casting — input validation", () => {
  it("rejects an invalid option with 400", async () => {
    const res = await request(makeApp(fakeSession({ userId: memberWeightedId, rol: "miembro" })))
      .post(`/api/topics/${openTopicId}/vote`)
      .send({ option: "maybe" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/opción inválida/i);
  });
});

describe("vote casting — weight is frozen at vote time", () => {
  it("freezes weight_at_vote from the member's weight when the vote is cast", async () => {
    const res = await request(makeApp(fakeSession({ userId: memberWeightedId, rol: "miembro" })))
      .post(`/api/topics/${openTopicId}/vote`)
      .send({ option: "favor" });

    expect(res.status).toBe(200);
    expect(res.body.option).toBe("favor");
    expect(res.body.weightAtVote).toBe(2.5);

    const [row] = await db
      .select()
      .from(votesTable)
      .where(and(eq(votesTable.voteTopicId, openTopicId), eq(votesTable.userId, memberWeightedId)));
    expect(row.weightAtVote).toBe(FROZEN_WEIGHT);
  });

  it("keeps the stored weight_at_vote even after the member's weight changes", async () => {
    // Change the member's live weight after the vote was already cast.
    await db
      .update(usersTable)
      .set({ votingWeight: "9.9999" })
      .where(eq(usersTable.id, memberWeightedId));

    // The previously-recorded vote must keep the weight frozen at vote time.
    const [row] = await db
      .select()
      .from(votesTable)
      .where(and(eq(votesTable.voteTopicId, openTopicId), eq(votesTable.userId, memberWeightedId)));
    expect(row.weightAtVote).toBe(FROZEN_WEIGHT);

    // Restore so the test is order-independent / re-runnable.
    await db
      .update(usersTable)
      .set({ votingWeight: FROZEN_WEIGHT })
      .where(eq(usersTable.id, memberWeightedId));
  });
});

describe("vote casting — one vote per member per topic", () => {
  it("rejects a duplicate vote with 409 and does not double-count", async () => {
    const app = makeApp(fakeSession({ userId: memberDupId, rol: "miembro" }));

    const first = await request(app).post(`/api/topics/${dupTopicId}/vote`).send({ option: "favor" });
    expect(first.status).toBe(200);

    // A second vote (even with a different option) must be rejected.
    const second = await request(app)
      .post(`/api/topics/${dupTopicId}/vote`)
      .send({ option: "contra" });
    expect(second.status).toBe(409);
    expect(second.body.error).toMatch(/ya emitiste/i);

    // Exactly one row, holding the original option.
    const rows = await db
      .select()
      .from(votesTable)
      .where(and(eq(votesTable.voteTopicId, dupTopicId), eq(votesTable.userId, memberDupId)));
    expect(rows).toHaveLength(1);
    expect(rows[0].option).toBe("favor");
  });

  it("only records one vote when two votes race concurrently", async () => {
    const app = makeApp(fakeSession({ userId: memberDupId, rol: "miembro" }));

    // Fire two votes for the same member+topic at once. The ON CONFLICT DO
    // NOTHING guard must let exactly one through.
    const [a, b] = await Promise.all([
      request(app).post(`/api/topics/${concTopicId}/vote`).send({ option: "favor" }),
      request(app).post(`/api/topics/${concTopicId}/vote`).send({ option: "contra" }),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);

    const rows = await db
      .select()
      .from(votesTable)
      .where(and(eq(votesTable.voteTopicId, concTopicId), eq(votesTable.userId, memberDupId)));
    expect(rows).toHaveLength(1);
  });
});
