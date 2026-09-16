import express, { type Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Spy on the realtime layer so we can assert the route signals listeners
// without standing up a Socket.io server. The route imports `emitSessionEvent`
// from "../lib/realtime"; this mock replaces that module for the route too.
const emitSessionEvent = vi.fn();
const emitLobbyEvent = vi.fn();
vi.mock("../lib/realtime", () => ({
  emitSessionEvent,
  emitLobbyEvent,
  SOCKET_PATH: "/api/socket.io",
}));

// Imported after the mock is registered so the router binds to the spy.
const { db, plenariasTable, speakingTurnsTable, agendaPointsTable } = await import("@workspace/db");
const speakingRouter = (await import("../routes/speaking")).default;
const { eq } = await import("drizzle-orm");

// Minimal app that injects an admin session, mirroring what the real
// session middleware would attach after login, then mounts the real router.
function makeApp(rol: "admin" | "miembro" = "admin", userId = 1): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as { session: { userId: number; rol: string } }).session = {
      userId,
      rol,
    };
    next();
  });
  app.use("/api", speakingRouter);
  return app;
}

let app: Express;
let sessionId: number;
let agendaPointId: number;
const createdTurnIds: number[] = [];

beforeAll(async () => {
  app = makeApp();
  const [session] = await db
    .insert(plenariasTable)
    .values({
      title: "Test plenaria (vitest)",
      sessionCode: `TEST-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      status: "abierta",
    })
    .returning();
  sessionId = session.id;

  const [point] = await db
    .insert(agendaPointsTable)
    .values({ sessionId, title: "Punto de prueba", position: 0 })
    .returning();
  agendaPointId = point.id;
});

afterAll(async () => {
  // speaking_turns cascade-delete with the plenaria, but clean up explicitly
  // for clarity and to leave the dev DB as we found it.
  for (const id of createdTurnIds) {
    await db.delete(speakingTurnsTable).where(eq(speakingTurnsTable.id, id));
  }
  await db.delete(plenariasTable).where(eq(plenariasTable.id, sessionId));
});

describe("speaking-turn mutations emit realtime events", () => {
  it("emits 'speaking:changed' for the session when a turn is created", async () => {
    emitSessionEvent.mockClear();

    const res = await request(app)
      .post(`/api/sessions/${sessionId}/speaking-turns`)
      .send({ category: "pleno", speakerName: "Orador de prueba" });

    expect(res.status).toBe(201);
    if (res.body?.id) createdTurnIds.push(res.body.id);

    expect(emitSessionEvent).toHaveBeenCalledWith(sessionId, "speaking:changed");
  });

  it("does not emit when the mutation is rejected", async () => {
    emitSessionEvent.mockClear();

    // Missing speaker info -> 400, so no event should fire.
    const res = await request(app)
      .post(`/api/sessions/${sessionId}/speaking-turns`)
      .send({ category: "pleno" });

    expect(res.status).toBe(400);
    expect(emitSessionEvent).not.toHaveBeenCalled();
  });
});

describe("speaking-round gate", () => {
  it("blocks a member self-request while the round is closed", async () => {
    // The session is created with speakingRoundOpen defaulting to false.
    emitSessionEvent.mockClear();
    const memberApp = makeApp("miembro", 2);

    const res = await request(memberApp)
      .post(`/api/sessions/${sessionId}/speaking-turns`)
      .send({ category: "pleno" });

    expect(res.status).toBe(400);
    expect(res.body?.error).toMatch(/ronda de palabras/i);
    expect(emitSessionEvent).not.toHaveBeenCalled();
  });

  it("admin toggle opens the round and emits realtime events", async () => {
    emitSessionEvent.mockClear();
    emitLobbyEvent.mockClear();

    const res = await request(app)
      .post(`/api/sessions/${sessionId}/speaking-round`)
      .send({ open: true, agendaPointId });

    expect(res.status).toBe(200);
    expect(res.body?.speakingRoundOpen).toBe(true);
    expect(res.body?.speakingRoundAgendaPointId).toBe(agendaPointId);
    expect(emitSessionEvent).toHaveBeenCalledWith(sessionId, "session:changed");
    expect(emitLobbyEvent).toHaveBeenCalledWith("sessions:changed");

    // Restore the closed state so other tests/dev DB stay as found.
    await db
      .update(plenariasTable)
      .set({ speakingRoundOpen: false })
      .where(eq(plenariasTable.id, sessionId));
  });
});
