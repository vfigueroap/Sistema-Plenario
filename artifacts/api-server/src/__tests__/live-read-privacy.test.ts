import { beforeAll, afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { eq, inArray } from "drizzle-orm";
import { db, usersTable, plenariasTable, attendanceTable, topicsTable, votesTable, sessionWeightsTable } from "@workspace/db";
import app from "../app";

let users: (typeof usersTable.$inferSelect)[];
let sessionId: number;
let topicId: number;
const agents = [request.agent(app), request.agent(app), request.agent(app)];

beforeAll(async () => {
  const password = await bcrypt.hash("clave-ficticia", 4);
  users = await db.insert(usersTable).values([0, 1, 2].map((i) => ({
    username: `lectura-${crypto.randomUUID()}`,
    displayName: `Persona ficticia ${i}`,
    password,
    votingWeight: "99",
    rol: i === 2 ? "admin" as const : "miembro" as const,
  }))).returning();
  sessionId = (await db.insert(plenariasTable).values({ title: "Lectura privada", sessionCode: crypto.randomUUID(), status: "abierta" }).returning())[0].id;
  topicId = (await db.insert(topicsTable).values({ sessionId, title: "Moción ficticia", status: "abierto" }).returning())[0].id;
  await db.insert(attendanceTable).values(users.slice(0, 2).map((u) => ({ sessionId, userId: u.id })));
  await db.insert(sessionWeightsTable).values(users.slice(0, 2).map((u, i) => ({ sessionId, userId: u.id, weight: String(i + 1) })));
  await db.insert(votesTable).values(users.slice(0, 2).map((u, i) => ({ voteTopicId: topicId, userId: u.id, option: i ? "contra" : "favor", weightAtVote: String(i + 1) })));
  await Promise.all(agents.map((agent, i) => agent.post("/api/auth/login").set("Origin", "http://localhost:3000").send({ username: users[i].username, password: "clave-ficticia" }).expect(200)));
});

afterAll(async () => {
  await db.delete(plenariasTable).where(eq(plenariasTable.id, sessionId));
  await db.delete(usersTable).where(inArray(usersTable.id, users.map((u) => u.id)));
});

describe("datos personales sobre lecturas compartidas", () => {
  it("conserva el usuario y el voto propios en solicitudes simultáneas", async () => {
    const [a, b, resultA, resultB] = await Promise.all([
      agents[0].get("/api/auth/me"),
      agents[1].get("/api/auth/me"),
      agents[0].get(`/api/topics/${topicId}/results`),
      agents[1].get(`/api/topics/${topicId}/results`),
    ]);
    for (const result of [a, b, resultA, resultB]) {
      expect(result.status).toBe(200);
      expect(result.headers["cache-control"]).toBe("private, no-store");
    }
    expect(a.body.id).toBe(users[0].id);
    expect(b.body.id).toBe(users[1].id);
    expect(a.body.password).toBeUndefined();
    expect(resultA.body.myVote).toBe("favor");
    expect(resultB.body.myVote).toBe("contra");
  });

  it("restringe los identificadores de ingreso al administrador y conserva ponderaciones congeladas", async () => {
    const [member, admin] = await Promise.all([
      agents[0].get(`/api/topics/${topicId}/ballots`),
      agents[2].get(`/api/topics/${topicId}/ballots`),
    ]);
    expect(member.status).toBe(200);
    expect(admin.status).toBe(200);
    const row = (response: typeof member, id: number) => response.body.members.find((u: { userId: number }) => u.userId === id);
    expect(row(member, users[0].id).username).toBeNull();
    expect(row(admin, users[0].id).username).toBe(users[0].username);
    expect(row(member, users[0].id).weight).toBe(1);
    expect(row(member, users[1].id).weight).toBe(2);
  });
});
