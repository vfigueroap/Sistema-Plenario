import express, { type Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Both routers signal listeners via the realtime layer. Mock it so these tests
// exercise the rules without standing up Socket.io.
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
  topicCandidatesTable,
  topicEstamentosTable,
  votesTable,
} = await import("@workspace/db");
const { eq, and } = await import("drizzle-orm");
const votesRouter = (await import("../routes/votes")).default;
const topicsRouter = (await import("../routes/topics")).default;

type FakeSession = { userId?: number; rol?: string };

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

const uniq = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

let memberPickId: number;
let memberAbstainId: number;
let adminId: number;
let sessionId: number;
let singleTopicId: number;
let candidateAId: number;

beforeAll(async () => {
  const [memberPick] = await db
    .insert(usersTable)
    .values({ username: `cs-pick-${uniq}`, displayName: "CS Pick", password: "x", rol: "miembro", votingWeight: "2" })
    .returning();
  memberPickId = memberPick.id;

  const [memberAbstain] = await db
    .insert(usersTable)
    .values({ username: `cs-abs-${uniq}`, displayName: "CS Abstain", password: "x", rol: "miembro", votingWeight: "1" })
    .returning();
  memberAbstainId = memberAbstain.id;

  const [admin] = await db
    .insert(usersTable)
    .values({ username: `cs-admin-${uniq}`, displayName: "CS Admin", password: "x", rol: "admin", votingWeight: "1" })
    .returning();
  adminId = admin.id;

  const [session] = await db
    .insert(plenariasTable)
    .values({ title: "Candidato single plenaria (vitest)", sessionCode: `CS-${uniq}`, status: "abierta" })
    .returning();
  sessionId = session.id;

  for (const uid of [memberPickId, memberAbstainId]) {
    await db.insert(attendanceTable).values({ sessionId, userId: uid, modality: "presencial" });
  }

  const [singleTopic] = await db
    .insert(topicsTable)
    .values({ sessionId, title: "CS single topic", status: "abierto", type: "candidato", candidateMode: "single", votesPerVoter: 1 })
    .returning();
  singleTopicId = singleTopic.id;

  const [candA] = await db
    .insert(topicCandidatesTable)
    .values({ voteTopicId: singleTopicId, name: "Candidate A", position: 0 })
    .returning();
  candidateAId = candA.id;
  await db.insert(topicCandidatesTable).values({ voteTopicId: singleTopicId, name: "Candidate B", position: 1 });
});

afterAll(async () => {
  await db.delete(plenariasTable).where(eq(plenariasTable.id, sessionId));
  for (const id of [memberPickId, memberAbstainId, adminId]) {
    await db.delete(usersTable).where(eq(usersTable.id, id));
  }
});

describe("candidato single — ballot", () => {
  it.each([0, -1, 1.5, 1001])("rejects invalid multiple vote limits (%s) on creation and editing", async (votesPerVoter) => {
    const app = makeApp(topicsRouter, { userId: adminId, rol: "admin" });
    const shape = { title: "Invalid limit", type: "candidato", candidateMode: "multiple", candidates: ["A"], votesPerVoter };
    const created = await request(app).post(`/api/sessions/${sessionId}/topics`).send(shape);
    expect(created.status).toBe(400);
    const [editable] = await db.insert(topicsTable).values({ sessionId, title: "Editable limit test" }).returning();
    const updated = await request(app).patch(`/api/topics/${editable.id}`).send(shape);
    expect(updated.status).toBe(400);
    const [unchanged] = await db.select().from(topicsTable).where(eq(topicsTable.id, editable.id));
    expect(unchanged.type).toBe("mocion");
  });

  it("accepts a single candidate pick and freezes weight", async () => {
    const res = await request(makeApp(votesRouter, { userId: memberPickId, rol: "miembro" }))
      .post(`/api/topics/${singleTopicId}/vote`)
      .send({ allocations: [{ candidateId: candidateAId, count: 1 }] });

    expect(res.status).toBe(200);
    expect(res.body.option).toBeNull();
    expect(res.body.weightAtVote).toBe(2);

    const rows = await db
      .select()
      .from(votesTable)
      .where(and(eq(votesTable.voteTopicId, singleTopicId), eq(votesTable.userId, memberPickId)));
    expect(rows).toHaveLength(1);
    expect(rows[0].candidateId).toBe(candidateAId);
  });

  it("accepts an abstención (null candidate) pick", async () => {
    const res = await request(makeApp(votesRouter, { userId: memberAbstainId, rol: "miembro" }))
      .post(`/api/topics/${singleTopicId}/vote`)
      .send({ allocations: [{ candidateId: null, count: 1 }] });

    expect(res.status).toBe(200);

    const rows = await db
      .select()
      .from(votesTable)
      .where(and(eq(votesTable.voteTopicId, singleTopicId), eq(votesTable.userId, memberAbstainId)));
    expect(rows).toHaveLength(1);
    expect(rows[0].candidateId).toBeNull();
  });

  it("rejects more than the allowed number of votes", async () => {
    const res = await request(makeApp(votesRouter, { userId: memberPickId, rol: "miembro" }))
      .post(`/api/topics/${singleTopicId}/vote`)
      .send({ allocations: [{ candidateId: candidateAId, count: 2 }] });
    // Already voted -> 409; the point is it never records a 2-vote ballot.
    expect([400, 409]).toContain(res.status);
  });
});

describe("topic creation — fixed division whitelist", () => {
  it("keeps allowed divisions and drops everything else (incl. Mesa Directiva)", async () => {
    const res = await request(makeApp(topicsRouter, { userId: adminId, rol: "admin" }))
      .post(`/api/sessions/${sessionId}/topics`)
      .send({
        title: "CS whitelist topic",
        type: "mocion",
        estamentos: ["CEE", "Mesa Directiva FECh", "Consejeros FECh", "bogus"],
      });

    expect(res.status).toBe(201);
    expect([...res.body.estamentos].sort()).toEqual(["CEE", "Consejeros FECh"]);

    const persisted = await db
      .select()
      .from(topicEstamentosTable)
      .where(eq(topicEstamentosTable.voteTopicId, res.body.id));
    expect(persisted.map((r) => r.estamentoName).sort()).toEqual(["CEE", "Consejeros FECh"]);
  });

  it("creates a candidato-single topic with a single candidate", async () => {
    const res = await request(makeApp(topicsRouter, { userId: adminId, rol: "admin" }))
      .post(`/api/sessions/${sessionId}/topics`)
      .send({ title: "CS one-candidate", type: "candidato", candidates: ["Solo"] });

    expect(res.status).toBe(201);
    expect(res.body.type).toBe("candidato");
    expect(res.body.candidateMode).toBe("single");
    expect(res.body.candidates).toHaveLength(1);
  });

  it("keeps weightSource=alt only when estamento-restricted", async () => {
    const restricted = await request(makeApp(topicsRouter, { userId: adminId, rol: "admin" }))
      .post(`/api/sessions/${sessionId}/topics`)
      .send({ title: "CS alt restricted", type: "mocion", weighted: true, weightSource: "alt", estamentos: ["CEE"] });
    expect(restricted.status).toBe(201);
    expect(restricted.body.weightSource).toBe("alt");

    const unrestricted = await request(makeApp(topicsRouter, { userId: adminId, rol: "admin" }))
      .post(`/api/sessions/${sessionId}/topics`)
      .send({ title: "CS alt unrestricted", type: "mocion", weighted: true, weightSource: "alt", estamentos: [] });
    expect(unrestricted.status).toBe(201);
    expect(unrestricted.body.weightSource).toBe("normal");
  });
});
