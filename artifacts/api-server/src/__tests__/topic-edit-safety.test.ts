import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/realtime", () => ({ emitSessionEvent: vi.fn(), emitVotesChanged: vi.fn(), emitLobbyEvent: vi.fn() }));
const { db, usersTable, plenariasTable, attendanceTable, topicsTable, topicCandidatesTable, topicEstamentosTable, votesTable, voteBallotsTable } = await import("@workspace/db");
const { eq } = await import("drizzle-orm");
const topicsRouter = (await import("../routes/topics")).default;
const votesRouter = (await import("../routes/votes")).default;
const sessionsRouter = (await import("../routes/sessions")).default;
const adminRouter = (await import("../routes/admin")).default;
const app = express();
app.use(express.json());
let userId: number;
let sessionId: number;
let topicId: number;
let candidateId: number;
app.use((req, _res, next) => {
  req.session = { userId, rol: "admin" } as typeof req.session;
  next();
});
app.use("/api", topicsRouter);
app.use("/api", votesRouter);
app.use("/api", sessionsRouter);
app.use("/api", adminRouter);

const shape = { type: "candidato", candidateMode: "single", weighted: true, weightSource: "normal", votesPerVoter: 1, candidates: ["Candidate A"], estamentos: ["CEE"] };

beforeEach(async () => {
  const unique = crypto.randomUUID();
  const [user] = await db.insert(usersTable).values({ username: unique, displayName: "Test voter", password: "unused", rol: "miembro", group: "CEE" }).returning();
  userId = user.id;
  const [session] = await db.insert(plenariasTable).values({ title: "Edit protection test", sessionCode: unique, status: "abierta" }).returning();
  sessionId = session.id;
  const [topic] = await db.insert(topicsTable).values({ sessionId, title: "Original", type: "candidato", candidateMode: "single", status: "cerrado" }).returning();
  topicId = topic.id;
  const [candidate] = await db.insert(topicCandidatesTable).values({ voteTopicId: topicId, name: "Candidate A", position: 0 }).returning();
  candidateId = candidate.id;
  await db.insert(topicEstamentosTable).values({ voteTopicId: topicId, estamentoName: "CEE" });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await db.delete(plenariasTable).where(eq(plenariasTable.id, sessionId));
  await db.delete(usersTable).where(eq(usersTable.id, userId));
});

async function recordVote(legacy = false) {
  const ballot = legacy ? null : (await db.insert(voteBallotsTable).values({ voteTopicId: topicId, userId, weightAtVote: "1" }).returning())[0];
  await db.insert(votesTable).values({ voteTopicId: topicId, userId, ballotId: ballot?.id ?? null, candidateId, weightAtVote: "1" });
}

async function snapshot() {
  return {
    topics: await db.select().from(topicsTable).where(eq(topicsTable.id, topicId)),
    candidates: await db.select().from(topicCandidatesTable).where(eq(topicCandidatesTable.voteTopicId, topicId)),
    estamentos: await db.select().from(topicEstamentosTable).where(eq(topicEstamentosTable.voteTopicId, topicId)),
    votes: await db.select().from(votesTable).where(eq(votesTable.voteTopicId, topicId)),
    ballots: await db.select().from(voteBallotsTable).where(eq(voteBallotsTable.voteTopicId, topicId)),
  };
}

describe("topic edits preserve recorded ballots", () => {
  it("requires an explicit phrase before clearing institutional history", async () => {
    await request(app).post("/api/admin/clear-all").send({}).expect(400);
    expect((await db.select().from(plenariasTable).where(eq(plenariasTable.id, sessionId))).length).toBe(1);
  });
  it("rejects destructive deletion of closed topics and sessions with history", async () => {
    await request(app).delete(`/api/topics/${topicId}`).expect(409);
    await request(app).delete(`/api/sessions/${sessionId}`).expect(409);
    expect((await db.select().from(topicsTable).where(eq(topicsTable.id, topicId))).length).toBe(1);
    expect((await db.select().from(plenariasTable).where(eq(plenariasTable.id, sessionId))).length).toBe(1);
  });
  it("preserves recorded results when a member account is deleted", async () => {
    await recordVote();
    await request(app).patch(`/api/topics/${topicId}`).send({ status: "abierto" }).expect(200);
    await request(app).patch(`/api/topics/${topicId}`).send({ status: "cerrado" }).expect(200);
    const before = (await request(app).get(`/api/topics/${topicId}/results`).expect(200)).body;
    const detail = (await request(app).get(`/api/topics/${topicId}/ballots`).expect(200)).body;
    await db.delete(usersTable).where(eq(usersTable.id, userId));
    const after = (await request(app).get(`/api/topics/${topicId}/results`).expect(200)).body;
    expect(after.candidates).toEqual(before.candidates);
    expect(after.voteCount).toBe(before.voteCount);
    expect((await request(app).get(`/api/topics/${topicId}/ballots`).expect(200)).body).toEqual(detail);
  });
  it("closes and snapshots open topics atomically when closing their session", async () => {
    await request(app).patch(`/api/topics/${topicId}`).send({ status: "abierto" }).expect(200);
    await request(app).patch(`/api/sessions/${sessionId}`).send({ status: "cerrada" }).expect(200);
    const [topic] = await db.select().from(topicsTable).where(eq(topicsTable.id, topicId));
    expect(topic.status).toBe("cerrado");
    expect(topic.electorateSnapshot?.members.map((m) => m.id)).toContain(userId);
  });
  it("freezes the electorate on closure, including non-voters and nominal detail", async () => {
    await db.update(usersTable).set({ votingWeight: "7" }).where(eq(usersTable.id, userId));
    await db.insert(attendanceTable).values({ sessionId, userId, modality: "online" });
    await request(app).patch(`/api/topics/${topicId}`).send({ status: "abierto" }).expect(200);
    await request(app).patch(`/api/topics/${topicId}`).send({ status: "cerrado" }).expect(200);
    const before = (await request(app).get(`/api/topics/${topicId}/results`).expect(200)).body;
    const detail = (await request(app).get(`/api/topics/${topicId}/ballots`).expect(200)).body;
    const exported = (await request(app).get(`/api/sessions/${sessionId}/export/results`).expect(200)).body;
    expect(before.sinVotoWeight).toBe(7);
    await db.update(usersTable).set({ active: false, displayName: "Changed", group: "Other", votingWeight: "99" }).where(eq(usersTable.id, userId));
    await db.update(attendanceTable).set({ checkedOutAt: new Date() }).where(eq(attendanceTable.sessionId, sessionId));
    const after = (await request(app).get(`/api/topics/${topicId}/results`).expect(200)).body;
    expect(after.sinVotoWeight).toBe(before.sinVotoWeight);
    expect(after.eligibleCount).toBe(before.eligibleCount);
    expect((await request(app).get(`/api/topics/${topicId}/ballots`).expect(200)).body).toEqual(detail);
    expect((await request(app).get(`/api/sessions/${sessionId}/export/results`).expect(200)).body).toEqual(exported);
  });
  it("requires reopening a frozen topic before correcting a ballot", async () => {
    await request(app).patch(`/api/topics/${topicId}`).send({ status: "abierto" }).expect(200);
    await request(app).patch(`/api/topics/${topicId}`).send({ status: "cerrado" }).expect(200);
    const before = await snapshot();
    await request(app).put(`/api/topics/${topicId}/ballots/${userId}`)
      .send({ allocations: [{ candidateId, count: 1 }] }).expect(409);
    expect(await snapshot()).toEqual(before);
    await request(app).patch(`/api/topics/${topicId}`).send({ status: "abierto" }).expect(200);
    await request(app).put(`/api/topics/${topicId}/ballots/${userId}`)
      .send({ allocations: [{ candidateId, count: 1 }] }).expect(200);
  });
  it("protects a ballot marker even if legacy detail rows are missing", async () => {
    await db.insert(voteBallotsTable).values({ voteTopicId: topicId, userId, weightAtVote: "1" });
    const before = await snapshot();
    expect((await request(app).patch(`/api/topics/${topicId}`).send({ ...shape, weighted: false })).status).toBe(409);
    expect(await snapshot()).toEqual(before);
  });
  it("keeps candidate IDs and votes when saving the same shape", async () => {
    await recordVote();
    const before = await snapshot();
    const res = await request(app).patch(`/api/topics/${topicId}`).send(shape);
    expect(res.status).toBe(200);
    expect(await snapshot()).toEqual(before);
  });

  it.each([
    { ...shape, candidates: ["Replacement"] },
    { ...shape, weighted: false },
    { estamentos: [] },
  ])("rejects a ballot-changing edit without partial writes: %j", async (change) => {
    await recordVote();
    const before = await snapshot();
    const res = await request(app).patch(`/api/topics/${topicId}`).send({ ...change, title: "Must not persist" });
    expect(res.status).toBe(409);
    expect(await snapshot()).toEqual(before);
  });

  it("also protects legacy votes without a ballot marker", async () => {
    await recordVote(true);
    const before = await snapshot();
    expect((await request(app).patch(`/api/topics/${topicId}`).send({ ...shape, candidates: ["Replacement"] })).status).toBe(409);
    expect(await snapshot()).toEqual(before);
  });

  it("allows title/detail and close/reopen without changing votes", async () => {
    await recordVote();
    const before = await snapshot();
    expect((await request(app).patch(`/api/topics/${topicId}`).send({ title: "Clarified", detail: "Description", status: "abierto" })).status).toBe(200);
    const after = await snapshot();
    expect(after.votes).toEqual(before.votes);
    expect(after.candidates).toEqual(before.candidates);
    expect(after.topics[0]).toMatchObject({ title: "Clarified", detail: "Description", status: "abierto" });
  });

  it("still allows replacing candidates before any vote", async () => {
    const res = await request(app).patch(`/api/topics/${topicId}`).send({ ...shape, candidates: ["Replacement"] });
    expect(res.status).toBe(200);
    expect(res.body.candidates.map((c: { name: string }) => c.name)).toEqual(["Replacement"]);
  });
});

describe("vote admission rechecks concurrent changes", () => {
  it.each(["session", "topic", "retirement", "deactivation", "rules", "eligibility"])("rejects a vote when %s changes after preflight validation", async (change) => {
    await db.update(topicsTable).set({ status: "abierto" }).where(eq(topicsTable.id, topicId));
    await db.insert(attendanceTable).values({ sessionId, userId, modality: "presencial" });
    const transaction = db.transaction.bind(db);
    // Force a deterministic interleaving: commit the other action immediately
    // before vote persistence begins. All queries still use real PostgreSQL.
    vi.spyOn(db, "transaction").mockImplementationOnce(async (callback, config) => {
      if (change === "session") await db.update(plenariasTable).set({ status: "cerrada" }).where(eq(plenariasTable.id, sessionId));
      if (change === "topic") await db.update(topicsTable).set({ status: "cerrado" }).where(eq(topicsTable.id, topicId));
      if (change === "retirement") await db.update(attendanceTable).set({ checkedOutAt: new Date() }).where(eq(attendanceTable.sessionId, sessionId));
      if (change === "deactivation") await db.update(usersTable).set({ active: false }).where(eq(usersTable.id, userId));
      if (change === "rules") await db.update(topicsTable).set({ weighted: false }).where(eq(topicsTable.id, topicId));
      if (change === "eligibility") await db.update(topicEstamentosTable).set({ estamentoName: "COSEFECH" }).where(eq(topicEstamentosTable.voteTopicId, topicId));
      return transaction(callback, config);
    });
    const res = await request(app).post(`/api/topics/${topicId}/vote`).send({ allocations: [{ candidateId, count: 1 }] });
    expect([400, 403, 409]).toContain(res.status);
    const after = await snapshot();
    expect(after.votes).toHaveLength(0);
    expect(after.ballots).toHaveLength(0);
  });
});
