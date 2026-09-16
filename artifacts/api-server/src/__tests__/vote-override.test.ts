import express, { type Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The votes router signals listeners via the realtime layer. Mock it so these
// tests exercise the override rules without standing up Socket.io.
vi.mock("../lib/realtime", () => ({
  emitSessionEvent: vi.fn(),
  emitVotesChanged: vi.fn(),
  emitLobbyEvent: vi.fn(),
  SOCKET_PATH: "/api/socket.io",
}));

const {
  db,
  usersTable,
  plenariasTable,
  attendanceTable,
  topicsTable,
  topicEstamentosTable,
  topicCandidatesTable,
  votesTable,
  voteBallotsTable,
} = await import("@workspace/db");
const { eq, and } = await import("drizzle-orm");
const votesRouter = (await import("../routes/votes")).default;

type FakeSession = { userId?: number; rol?: string };

function fakeSession(data: FakeSession = {}): FakeSession {
  return { ...data };
}

function makeApp(session: FakeSession): Express {
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
  app.use("/api", votesRouter);
  return app;
}

const uniq = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const FROZEN_WEIGHT = "3.0000";

let adminId: number;
let memberId: number; // eligible (group CEE), active
let inactiveId: number; // active=false
let outsiderId: number; // wrong group for the restricted topic
let sessionId: number;
let mocionTopicId: number; // open mocion, unrestricted
let restrictedTopicId: number; // mocion restricted to CEE
let candSingleTopicId: number; // candidato single
let candMultiTopicId: number; // candidato multiple (votesPerVoter=2)
let candAId: number;
let candBId: number;
let candCId: number;
let singleCandAId: number;

beforeAll(async () => {
  const [admin] = await db
    .insert(usersTable)
    .values({ username: `ov-admin-${uniq}`, displayName: "Override Admin", password: "x", rol: "admin" })
    .returning();
  adminId = admin.id;

  const [member] = await db
    .insert(usersTable)
    .values({
      username: `ov-member-${uniq}`,
      displayName: "Override Member",
      password: "x",
      rol: "miembro",
      group: "CEE",
      votingWeight: FROZEN_WEIGHT,
    })
    .returning();
  memberId = member.id;

  const [inactive] = await db
    .insert(usersTable)
    .values({
      username: `ov-inactive-${uniq}`,
      displayName: "Override Inactive",
      password: "x",
      rol: "miembro",
      group: "CEE",
      votingWeight: "1",
      active: false,
    })
    .returning();
  inactiveId = inactive.id;

  const [outsider] = await db
    .insert(usersTable)
    .values({
      username: `ov-outsider-${uniq}`,
      displayName: "Override Outsider",
      password: "x",
      rol: "miembro",
      group: "COSEFECH",
      votingWeight: "1",
    })
    .returning();
  outsiderId = outsider.id;

  const [session] = await db
    .insert(plenariasTable)
    .values({ title: "Override plenaria (vitest)", sessionCode: `OV-${uniq}`, status: "abierta" })
    .returning();
  sessionId = session.id;

  // Member has active attendance; outsider too (so eligibility, not attendance, gates them).
  await db.insert(attendanceTable).values({ sessionId, userId: memberId, modality: "presencial" });
  await db.insert(attendanceTable).values({ sessionId, userId: outsiderId, modality: "presencial" });

  const [mocion] = await db
    .insert(topicsTable)
    .values({ sessionId, title: "OV mocion", status: "abierto", type: "mocion" })
    .returning();
  mocionTopicId = mocion.id;

  const [restricted] = await db
    .insert(topicsTable)
    .values({ sessionId, title: "OV restricted", status: "abierto", type: "mocion" })
    .returning();
  restrictedTopicId = restricted.id;
  await db.insert(topicEstamentosTable).values({ voteTopicId: restrictedTopicId, estamentoName: "CEE" });

  const [candSingle] = await db
    .insert(topicsTable)
    .values({
      sessionId,
      title: "OV candidato single",
      status: "abierto",
      type: "candidato",
      candidateMode: "single",
      votesPerVoter: 1,
    })
    .returning();
  candSingleTopicId = candSingle.id;

  const [candMulti] = await db
    .insert(topicsTable)
    .values({
      sessionId,
      title: "OV candidato multiple",
      status: "abierto",
      type: "candidato",
      candidateMode: "multiple",
      votesPerVoter: 2,
    })
    .returning();
  candMultiTopicId = candMulti.id;

  // Candidates belong to both candidato topics (each topic gets its own rows).
  for (const topicId of [candSingleTopicId, candMultiTopicId]) {
    const rows = await db
      .insert(topicCandidatesTable)
      .values([
        { voteTopicId: topicId, name: "Cand A", position: 0 },
        { voteTopicId: topicId, name: "Cand B", position: 1 },
        { voteTopicId: topicId, name: "Cand C", position: 2 },
      ])
      .returning();
    if (topicId === candMultiTopicId) {
      candAId = rows[0].id;
      candBId = rows[1].id;
      candCId = rows[2].id;
    } else {
      singleCandAId = rows[0].id;
    }
  }
});

afterAll(async () => {
  await db.delete(plenariasTable).where(eq(plenariasTable.id, sessionId));
  for (const id of [adminId, memberId, inactiveId, outsiderId]) {
    await db.delete(usersTable).where(eq(usersTable.id, id));
  }
});

const admin = () => makeApp(fakeSession({ userId: adminId, rol: "admin" }));

describe("admin vote override — access control", () => {
  it("rejects a non-admin with 403", async () => {
    const res = await request(makeApp(fakeSession({ userId: memberId, rol: "miembro" })))
      .put(`/api/topics/${mocionTopicId}/ballots/${memberId}`)
      .send({ option: "favor" });
    expect(res.status).toBe(403);
  });
});

describe("admin vote override — validation", () => {
  it("rejects a missing option property with 400 (does not clear silently)", async () => {
    const res = await request(admin()).put(`/api/topics/${mocionTopicId}/ballots/${memberId}`).send({});
    expect(res.status).toBe(400);
  });

  it("rejects an invalid option with 400", async () => {
    const res = await request(admin())
      .put(`/api/topics/${mocionTopicId}/ballots/${memberId}`)
      .send({ option: "maybe" });
    expect(res.status).toBe(400);
  });

  it("rejects a candidato topic when allocations property is missing (does not clear silently)", async () => {
    const res = await request(admin())
      .put(`/api/topics/${candSingleTopicId}/ballots/${memberId}`)
      .send({ option: "favor" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/asignaciones/i);
  });

  it("returns 404 for an unknown topic", async () => {
    const res = await request(admin())
      .put(`/api/topics/987654321/ballots/${memberId}`)
      .send({ option: "favor" });
    expect(res.status).toBe(404);
  });

  it("returns 404 for an unknown member", async () => {
    const res = await request(admin())
      .put(`/api/topics/${mocionTopicId}/ballots/987654321`)
      .send({ option: "favor" });
    expect(res.status).toBe(404);
  });

  it("rejects an inactive member with 400", async () => {
    const res = await request(admin())
      .put(`/api/topics/${mocionTopicId}/ballots/${inactiveId}`)
      .send({ option: "favor" });
    expect(res.status).toBe(400);
  });

  it("rejects a member outside the topic's estamento with 400", async () => {
    const res = await request(admin())
      .put(`/api/topics/${restrictedTopicId}/ballots/${outsiderId}`)
      .send({ option: "favor" });
    expect(res.status).toBe(400);
  });
});

describe("admin vote override — set, replace, and clear", () => {
  it("sets a vote and freezes the member's current weight", async () => {
    const res = await request(admin())
      .put(`/api/topics/${mocionTopicId}/ballots/${memberId}`)
      .send({ option: "favor" });
    expect(res.status).toBe(200);
    expect(res.body.option).toBe("favor");
    expect(res.body.weightAtVote).toBe(3);

    const rows = await db
      .select()
      .from(votesTable)
      .where(and(eq(votesTable.voteTopicId, mocionTopicId), eq(votesTable.userId, memberId)));
    expect(rows).toHaveLength(1);
    expect(rows[0].option).toBe("favor");
    expect(rows[0].weightAtVote).toBe(FROZEN_WEIGHT);
  });

  it("replaces an existing vote without leaving duplicate rows", async () => {
    const res = await request(admin())
      .put(`/api/topics/${mocionTopicId}/ballots/${memberId}`)
      .send({ option: "contra" });
    expect(res.status).toBe(200);

    const rows = await db
      .select()
      .from(votesTable)
      .where(and(eq(votesTable.voteTopicId, mocionTopicId), eq(votesTable.userId, memberId)));
    expect(rows).toHaveLength(1);
    expect(rows[0].option).toBe("contra");

    const ballots = await db
      .select()
      .from(voteBallotsTable)
      .where(and(eq(voteBallotsTable.voteTopicId, mocionTopicId), eq(voteBallotsTable.userId, memberId)));
    expect(ballots).toHaveLength(1);
  });

  it("clears a vote when option is explicit null", async () => {
    const res = await request(admin())
      .put(`/api/topics/${mocionTopicId}/ballots/${memberId}`)
      .send({ option: null });
    expect(res.status).toBe(200);
    expect(res.body.option).toBeNull();

    const rows = await db
      .select()
      .from(votesTable)
      .where(and(eq(votesTable.voteTopicId, mocionTopicId), eq(votesTable.userId, memberId)));
    expect(rows).toHaveLength(0);
    const ballots = await db
      .select()
      .from(voteBallotsTable)
      .where(and(eq(voteBallotsTable.voteTopicId, mocionTopicId), eq(voteBallotsTable.userId, memberId)));
    expect(ballots).toHaveLength(0);
  });
});

describe("admin vote override — candidato single", () => {
  it("rejects a candidate id that belongs to a different topic", async () => {
    // candAId belongs to the multiple topic; the single topic has its own
    // candidates, so this candidate id is invalid here -> 400.
    const res = await request(admin())
      .put(`/api/topics/${candSingleTopicId}/ballots/${memberId}`)
      .send({ allocations: [{ candidateId: candAId, count: 1 }] });
    expect(res.status).toBe(400);
  });

  it("sets a single-candidate vote and freezes weight", async () => {
    const res = await request(admin())
      .put(`/api/topics/${candSingleTopicId}/ballots/${memberId}`)
      .send({ allocations: [{ candidateId: singleCandAId, count: 1 }] });
    expect(res.status).toBe(200);

    const rows = await db
      .select()
      .from(votesTable)
      .where(and(eq(votesTable.voteTopicId, candSingleTopicId), eq(votesTable.userId, memberId)));
    expect(rows).toHaveLength(1);
    expect(rows[0].candidateId).toBe(singleCandAId);
    expect(rows[0].weightAtVote).toBe(FROZEN_WEIGHT);
  });

  it("sets abstención (candidateId null) as an explicit vote", async () => {
    const res = await request(admin())
      .put(`/api/topics/${candSingleTopicId}/ballots/${memberId}`)
      .send({ allocations: [{ candidateId: null, count: 1 }] });
    expect(res.status).toBe(200);

    const rows = await db
      .select()
      .from(votesTable)
      .where(and(eq(votesTable.voteTopicId, candSingleTopicId), eq(votesTable.userId, memberId)));
    expect(rows).toHaveLength(1);
    expect(rows[0].candidateId).toBeNull();
    expect(rows[0].weightAtVote).toBe(FROZEN_WEIGHT);
  });

  it("clears a candidato vote when allocations is explicit null", async () => {
    const res = await request(admin())
      .put(`/api/topics/${candSingleTopicId}/ballots/${memberId}`)
      .send({ allocations: null });
    expect(res.status).toBe(200);

    const rows = await db
      .select()
      .from(votesTable)
      .where(and(eq(votesTable.voteTopicId, candSingleTopicId), eq(votesTable.userId, memberId)));
    expect(rows).toHaveLength(0);
  });
});

describe("admin vote override — candidato multiple (approval, votesPerVoter=2)", () => {
  it("stores chosen candidates plus abstención remainder", async () => {
    const res = await request(admin())
      .put(`/api/topics/${candMultiTopicId}/ballots/${memberId}`)
      .send({ allocations: [{ candidateId: candAId, count: 1 }] });
    expect(res.status).toBe(200);

    const rows = await db
      .select()
      .from(votesTable)
      .where(and(eq(votesTable.voteTopicId, candMultiTopicId), eq(votesTable.userId, memberId)));
    // 1 chosen + 1 abstención remainder = votesPerVoter rows
    expect(rows).toHaveLength(2);
    const candIds = rows.map((r) => r.candidateId);
    expect(candIds).toContain(candAId);
    expect(candIds.filter((c) => c === null)).toHaveLength(1);
  });

  it("replaces with two chosen candidates (no abstención remainder)", async () => {
    const res = await request(admin())
      .put(`/api/topics/${candMultiTopicId}/ballots/${memberId}`)
      .send({
        allocations: [
          { candidateId: candBId, count: 1 },
          { candidateId: candCId, count: 1 },
        ],
      });
    expect(res.status).toBe(200);

    const rows = await db
      .select()
      .from(votesTable)
      .where(and(eq(votesTable.voteTopicId, candMultiTopicId), eq(votesTable.userId, memberId)));
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.candidateId).sort()).toEqual([candBId, candCId].sort());
    const ballots = await db
      .select()
      .from(voteBallotsTable)
      .where(and(eq(voteBallotsTable.voteTopicId, candMultiTopicId), eq(voteBallotsTable.userId, memberId)));
    expect(ballots).toHaveLength(1);
  });

  it("rejects choosing more than votesPerVoter distinct candidates", async () => {
    const res = await request(admin())
      .put(`/api/topics/${candMultiTopicId}/ballots/${memberId}`)
      .send({
        allocations: [
          { candidateId: candAId, count: 1 },
          { candidateId: candBId, count: 1 },
          { candidateId: candCId, count: 1 },
        ],
      });
    expect(res.status).toBe(400);
  });

  it("exposes per-member allocations in the ballots endpoint", async () => {
    // Set a known vote first, then read it back via GET ballots.
    await request(admin())
      .put(`/api/topics/${candMultiTopicId}/ballots/${memberId}`)
      .send({ allocations: [{ candidateId: candAId, count: 1 }] });

    const res = await request(admin()).get(`/api/topics/${candMultiTopicId}/ballots`);
    expect(res.status).toBe(200);
    const me = res.body.members.find((x: { userId: number }) => x.userId === memberId);
    expect(me).toBeDefined();
    expect(me.voted).toBe(true);
    const chosen = (me.allocations as { candidateId: number | null; count: number }[])
      .filter((a) => a.candidateId !== null)
      .map((a) => a.candidateId);
    expect(chosen).toContain(candAId);
  });
});
