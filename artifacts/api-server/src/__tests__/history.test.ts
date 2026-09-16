import express, { type Express } from "express";
import request from "supertest";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The history router itself does not emit realtime events, but other routers it
// pulls in transitively might. Mock the realtime layer so these tests exercise
// the read endpoints without standing up Socket.io.
vi.mock("../lib/realtime", () => ({
  emitSessionEvent: vi.fn(),
  emitVotesChanged: vi.fn(),
  emitLobbyEvent: vi.fn(),
  emitUserEvent: vi.fn(),
  evictUserFromSession: vi.fn(async () => {}),
  SOCKET_PATH: "/api/socket.io",
}));

// Imported after the mock so the router binds to the stubbed realtime layer.
const {
  db,
  usersTable,
  plenariasTable,
  attendanceTable,
  topicsTable,
  votesTable,
} = await import("@workspace/db");
const { eq } = await import("drizzle-orm");
const historyRouter = (await import("../routes/history")).default;

type FakeSession = {
  userId?: number;
  rol?: string;
  save: (cb: (err?: unknown) => void) => void;
  destroy: (cb: (err?: unknown) => void) => void;
};

function fakeSession(data: { userId?: number; rol?: string } = {}): FakeSession {
  return {
    ...data,
    save: (cb) => cb(),
    destroy: (cb) => cb(),
  };
}

function makeApp(router: express.Router, session: FakeSession): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { session: FakeSession }).session = session;
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
let mFavorId: number; // attended + voted favor (frozen weight 5, current 2)
let mContraId: number; // attended + voted contra (weight 3)
let mAbstainId: number; // attended + voted abstención (weight 1)
let mNoVoteId: number; // attended, never voted (weight 4)
let mAbsentId: number; // never attended, never voted (weight 6)
let mRetiredId: number; // attended, voted favor, then checked out (weight 8)
let sessionId: number;
let topicId: number;

beforeAll(async () => {
  const hash = await bcrypt.hash(PASSWORD, 10);

  const [admin] = await db
    .insert(usersTable)
    .values({
      username: `hist-admin-${uniq}`,
      displayName: "Hist Admin",
      password: hash,
      rol: "admin",
      votingWeight: "0",
    })
    .returning();
  adminId = admin.id;

  const mk = async (suffix: string, weight: string) => {
    const [u] = await db
      .insert(usersTable)
      .values({
        username: `hist-${suffix}-${uniq}`,
        displayName: `Hist ${suffix}`,
        password: hash,
        rol: "miembro",
        votingWeight: weight,
      })
      .returning();
    return u.id;
  };

  mFavorId = await mk("favor", "2");
  mContraId = await mk("contra", "3");
  mAbstainId = await mk("abstain", "1");
  mNoVoteId = await mk("novote", "4");
  mAbsentId = await mk("absent", "6");
  mRetiredId = await mk("retired", "8");

  // A closed session so the topic's approved flag is computed (favor > contra).
  const [session] = await db
    .insert(plenariasTable)
    .values({
      title: "History plenaria (vitest)",
      sessionCode: `HIST-${uniq}`,
      status: "cerrada",
    })
    .returning();
  sessionId = session.id;

  // Active attendance for the four present members (mAbsent never attends).
  for (const userId of [mFavorId, mContraId, mAbstainId, mNoVoteId]) {
    await db
      .insert(attendanceTable)
      .values({ sessionId, userId, modality: "presencial" });
  }
  // mRetired attended (online) but checked out before the session ended: they
  // count as PRESENT in rosters/summaries and their previously cast vote remains.
  await db.insert(attendanceTable).values({
    sessionId,
    userId: mRetiredId,
    modality: "online",
    checkedOutAt: new Date(),
  });

  // A closed topic so its finalized result + approved flag are exercised.
  const [topic] = await db
    .insert(topicsTable)
    .values({ sessionId, title: "History topic (vitest)", status: "cerrado" })
    .returning();
  topicId = topic.id;

  // mFavor voted while their weight was frozen at 5 (current weight is 2), so
  // the tally must use 5, not their current 2 — exercising weight_at_vote.
  await db.insert(votesTable).values([
    { voteTopicId: topicId, userId: mFavorId, option: "favor", weightAtVote: "5" },
    { voteTopicId: topicId, userId: mContraId, option: "contra", weightAtVote: "3" },
    { voteTopicId: topicId, userId: mAbstainId, option: "abstención", weightAtVote: "1" },
    // Cast before checking out — visible in ballots and retained in the tally.
    { voteTopicId: topicId, userId: mRetiredId, option: "favor", weightAtVote: "8" },
  ]);
});

afterAll(async () => {
  // Deleting the session cascade-removes attendance, topics, and votes.
  await db.delete(plenariasTable).where(eq(plenariasTable.id, sessionId));
  for (const id of [adminId, mFavorId, mContraId, mAbstainId, mNoVoteId, mAbsentId, mRetiredId]) {
    await db.delete(usersTable).where(eq(usersTable.id, id));
  }
});

// Pull this test's session out of the (global) list the endpoints return.
type SessionResult = {
  sessionId: number;
  topics: {
    topicId: number;
    status: string;
    myVote?: string | null;
    weights: { favor: number; contra: number; abstención: number; total: number };
    approved: boolean | null;
    voteCount: number;
  }[];
};

function findSession(body: SessionResult[]): SessionResult {
  const s = body.find((x) => x.sessionId === sessionId);
  expect(s, "test session should appear in history").toBeDefined();
  return s!;
}

describe("GET /history/sessions (admin)", () => {
  it("rejects an unauthenticated request with 401", async () => {
    const res = await request(makeApp(historyRouter, fakeSession())).get(
      "/api/history/sessions",
    );
    expect(res.status).toBe(401);
  });

  it("rejects a non-admin member with 403", async () => {
    const res = await request(
      makeApp(historyRouter, fakeSession({ userId: mFavorId, rol: "miembro" })),
    ).get("/api/history/sessions");
    expect(res.status).toBe(403);
  });

  it("returns weighted results + attendance summary for each session", async () => {
    const res = await request(
      makeApp(historyRouter, fakeSession({ userId: adminId, rol: "admin" })),
    ).get("/api/history/sessions");

    expect(res.status).toBe(200);
    const s = findSession(res.body) as SessionResult & {
      presentCount: number;
      presentWeight: number;
      totalMembers: number;
      totalWeight: number;
    };

    // Four members stayed + one retired early (still counts as present); mAbsent did not attend.
    expect(s.presentCount).toBe(5);
    // presentWeight uses current weights: 2 + 3 + 1 + 4 + 8 (retired) = 18.
    expect(s.presentWeight).toBe(18);
    // Global roster totals include the seeded members, so just sanity-check.
    expect(s.totalMembers).toBeGreaterThanOrEqual(5);
    expect(s.totalWeight).toBeGreaterThan(0);

    const topic = s.topics.find((t) => t.topicId === topicId);
    expect(topic).toBeDefined();
    // Frozen favor weights: 5 (not current 2) + 8 from the retired voter.
    expect(topic!.weights.favor).toBe(13);
    expect(topic!.weights.contra).toBe(3);
    expect(topic!.weights.abstención).toBe(1);
    expect(topic!.voteCount).toBe(4);
    // Closed topic, favor (13) > contra (3) -> approved.
    expect(topic!.approved).toBe(true);
  });
});

describe("GET /history/me (member)", () => {
  it("rejects an unauthenticated request with 401", async () => {
    const res = await request(makeApp(historyRouter, fakeSession())).get(
      "/api/history/me",
    );
    expect(res.status).toBe(401);
  });

  it("shows an attendee their own vote on a topic", async () => {
    const res = await request(
      makeApp(historyRouter, fakeSession({ userId: mFavorId, rol: "miembro" })),
    ).get("/api/history/me");

    expect(res.status).toBe(200);
    const s = findSession(res.body) as SessionResult & { attended: boolean };
    expect(s.attended).toBe(true);
    const topic = s.topics.find((t) => t.topicId === topicId);
    expect(topic!.myVote).toBe("favor");
  });

  it("shows an attendee who did not vote a null myVote (No votó)", async () => {
    const res = await request(
      makeApp(historyRouter, fakeSession({ userId: mNoVoteId, rol: "miembro" })),
    ).get("/api/history/me");

    expect(res.status).toBe(200);
    const s = findSession(res.body) as SessionResult & { attended: boolean };
    expect(s.attended).toBe(true);
    const topic = s.topics.find((t) => t.topicId === topicId);
    expect(topic!.myVote).toBeNull();
  });

  it("counts a member who retired early as attended (not Ausente)", async () => {
    const res = await request(
      makeApp(historyRouter, fakeSession({ userId: mRetiredId, rol: "miembro" })),
    ).get("/api/history/me");

    expect(res.status).toBe(200);
    const s = findSession(res.body) as SessionResult & { attended: boolean };
    expect(s.attended).toBe(true);
  });

  it("marks an absent member as not attended with a null myVote (Ausente)", async () => {
    const res = await request(
      makeApp(historyRouter, fakeSession({ userId: mAbsentId, rol: "miembro" })),
    ).get("/api/history/me");

    expect(res.status).toBe(200);
    const s = findSession(res.body) as SessionResult & { attended: boolean };
    expect(s.attended).toBe(false);
    const topic = s.topics.find((t) => t.topicId === topicId);
    expect(topic!.myVote).toBeNull();
  });

  it("reports the same aggregate weighted results everyone sees", async () => {
    const res = await request(
      makeApp(historyRouter, fakeSession({ userId: mAbsentId, rol: "miembro" })),
    ).get("/api/history/me");

    const s = findSession(res.body);
    const topic = s.topics.find((t) => t.topicId === topicId);
    // Frozen-weight tally is identical to what the admin endpoint reports.
    expect(topic!.weights.favor).toBe(13);
    expect(topic!.weights.contra).toBe(3);
    expect(topic!.weights.abstención).toBe(1);
    expect(topic!.voteCount).toBe(4);
    expect(topic!.approved).toBe(true);
  });
});

describe("GET /public/history (unauthenticated)", () => {
  type PublicSession = Omit<SessionResult, "topics"> & {
    phase: string;
    presentCount: number;
    presentWeight: number;
    attendees: { name: string; group: string | null; modality: string }[];
    totalMembers: number;
    totalWeight: number;
    absentees: { name: string; group: string | null }[];
    topics: (SessionResult["topics"][number] & {
      ballots: { name: string; group: string | null; status: string; voteLabel: string | null }[];
    })[];
  };

  it("lists a retired member as a plain attendee (no retired-early flag), never as an absentee", async () => {
    const res = await request(makeApp(historyRouter, fakeSession())).get("/api/public/history");
    expect(res.status).toBe(200);

    const s = findSession(res.body) as PublicSession;
    expect(s.phase).toBe("pasado");
    // 4 stayed + 1 retired early = 5 present; weights 2+3+1+4+8 = 18.
    expect(s.presentCount).toBe(5);
    expect(s.presentWeight).toBe(18);

    const retired = s.attendees.find((a) => a.name === "Hist retired");
    expect(retired).toBeDefined();
    expect(retired!.modality).toBe("online");
    // The retired-early distinction is admin-only: no such field publicly.
    expect(retired).not.toHaveProperty("retiredEarly");
    // The retired member must NOT appear among absentees; the truly absent one must.
    expect(s.absentees.some((a) => a.name === "Hist retired")).toBe(false);
    expect(s.absentees.some((a) => a.name === "Hist absent")).toBe(true);
  });

  it("excludes members created after the session from roster, totals, and ballots", async () => {
    // A brand-new member must never retro-affect a session that predates them.
    const hash = await bcrypt.hash(PASSWORD, 10);
    const [late] = await db
      .insert(usersTable)
      .values({
        username: `hist-late-${uniq}`,
        displayName: "Hist late",
        password: hash,
        rol: "miembro",
        votingWeight: "50",
      })
      .returning();

    try {
      const before = await request(makeApp(historyRouter, fakeSession())).get(
        "/api/public/history",
      );
      const s = findSession(before.body) as PublicSession;
      // Not an absentee, not in totals, not in any ballot list.
      expect(s.absentees.some((a) => a.name === "Hist late")).toBe(false);
      expect(s.attendees.some((a) => a.name === "Hist late")).toBe(false);
      const topic = s.topics.find((t) => t.topicId === topicId)!;
      expect(topic.ballots.some((b) => b.name === "Hist late")).toBe(false);
      // Tally denominators unchanged (their weight 50 would be visible in ausente).
      expect(topic.weights.favor).toBe(13);
      expect(topic.weights.contra).toBe(3);
    } finally {
      await db.delete(usersTable).where(eq(usersTable.id, late.id));
    }
  });

  it("exposes per-member ballots for past topics and retains the retired member's vote", async () => {
    const res = await request(makeApp(historyRouter, fakeSession())).get("/api/public/history");
    const s = findSession(res.body) as PublicSession;
    const topic = s.topics.find((t) => t.topicId === topicId)!;

    // Retirement does not revoke the previously emitted favor vote (frozen 8).
    expect(topic.weights.favor).toBe(13);
    expect(topic.weights.contra).toBe(3);

    const ballots = topic.ballots;
    expect(ballots.length).toBeGreaterThanOrEqual(5);
    const byName = (n: string) => ballots.find((b) => b.name === n)!;
    expect(byName("Hist favor")).toMatchObject({ status: "present", voteLabel: "favor" });
    expect(byName("Hist novote")).toMatchObject({ status: "present", voteLabel: null });
    // Publicly the retired member appears as present (distinction is admin-only);
    // "checkedOut" must never leak into the public payload.
    expect(byName("Hist retired")).toMatchObject({ status: "present", voteLabel: "favor" });
    for (const t of s.topics) {
      expect(t.ballots.every((b) => b.status !== "checkedOut")).toBe(true);
    }
    expect(byName("Hist absent")).toMatchObject({ status: "absent", voteLabel: null });
    // No usernames or weights in the public ballot detail.
    expect(Object.keys(byName("Hist favor"))).toEqual(
      expect.not.arrayContaining(["username", "weight"]),
    );
  });
});
