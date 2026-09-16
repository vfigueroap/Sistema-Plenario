import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { RequestHandler } from "express";
import type { Server as SocketIoServer } from "socket.io";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

// Handshake tests never join session rooms or access a database.
vi.mock("@workspace/db", () => ({
  db: { select: () => { throw new Error("Unexpected database access"); } },
  plenariasTable: {},
  attendanceTable: {},
  withInstitutionDb: (_institutionId: string, work: (tx: object) => Promise<unknown>) => work({}),
}));
const { initRealtime, SOCKET_PATH } = await import("../lib/realtime");

let server: HttpServer;
let io: SocketIoServer | undefined;
let url: string;
const clients: ClientSocket[] = [];
const readSession = vi.fn<RequestHandler>((req, _res, next) => {
  if (req.headers.cookie === "session=valid") {
    (req as unknown as { session: { userId: number; institutionId: string } }).session = {
      userId: 1,
      institutionId: process.env.INSTITUTION_ID ?? "00000000-0000-4000-8000-000000000001",
    };
  }
  next();
});

async function start(production = false) {
  vi.stubEnv("NODE_ENV", production ? "production" : "development");
  vi.stubEnv("ALLOWED_ORIGINS", "https://frontend.example");
  vi.stubEnv("APP_URL", "https://plenario.example/base");
  server = createServer();
  io = initRealtime(server, readSession);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

afterEach(async () => {
  for (const client of clients.splice(0)) client.disconnect();
  if (io) await new Promise<void>((resolve) => io!.close(() => resolve()));
  io = undefined;
  readSession.mockClear();
  vi.unstubAllEnvs();
});

function handshake(transport: "websocket" | "polling", headers: Record<string, string>) {
  return new Promise<Error | undefined>((resolve) => {
    const client = ioClient(url, {
      path: SOCKET_PATH,
      transports: [transport],
      reconnection: false,
      timeout: 1500,
      extraHeaders: headers,
    });
    clients.push(client);
    client.once("connect", () => resolve(undefined));
    client.once("connect_error", (error) => resolve(error));
  });
}

describe.each(["websocket", "polling"] as const)("%s origin handshake (no DB)", (transport) => {
  it.each([undefined, "null", "https://evil.example", "https://plenario.example/path"])("rejects origin %s even with a session cookie", async (origin) => {
    await start();
    const headers: Record<string, string> = { Cookie: "session=valid" };
    if (origin !== undefined) headers.Origin = origin;
    const error = await handshake(transport, headers);
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).not.toBe("timeout");
    expect(readSession).not.toHaveBeenCalled();
  });

  it("does not trust Host, proxy headers or Referer to authorize a handshake", async () => {
    await start(true);
    const error = await handshake(transport, {
      Cookie: "session=valid",
      Origin: "https://evil.example",
      Host: "evil.example",
      "X-Forwarded-Host": "evil.example",
      "X-Forwarded-Proto": "https",
      Referer: "https://plenario.example/",
    });
    expect(error).toBeInstanceOf(Error);
    expect(readSession).not.toHaveBeenCalled();
  });

  it.each(["https://frontend.example", "https://plenario.example"])("accepts configured production origin %s", async (origin) => {
    await start(true);
    expect(await handshake(transport, { Origin: origin, Cookie: "session=valid" })).toBeUndefined();
    expect(readSession).toHaveBeenCalledOnce();
  });

  it("accepts a Node client's explicit loopback Origin in development", async () => {
    await start();
    expect(await handshake(transport, { Origin: url, Cookie: "session=valid" })).toBeUndefined();
  });

  it("denies loopback Origin in production", async () => {
    await start(true);
    expect(await handshake(transport, { Origin: url, Cookie: "session=valid" })).toBeInstanceOf(Error);
    expect(readSession).not.toHaveBeenCalled();
  });

  it("still requires authentication for an allowed origin", async () => {
    await start();
    const error = await handshake(transport, { Origin: url });
    expect(error?.message).toBe("No autenticado");
  });
});

describe("Engine.IO HTTP CORS", () => {
  it.each(["https://frontend.example", "https://evil.example"])("uses the same explicit policy for %s", async (origin) => {
    await start(true);
    const res = await request(server).get(`${SOCKET_PATH}/?EIO=4&transport=polling`).set("Origin", origin);
    if (origin === "https://frontend.example") {
      expect(res.status).toBe(200);
      expect(res.headers["access-control-allow-origin"]).toBe(origin);
      expect(res.headers["access-control-allow-credentials"]).toBe("true");
    } else {
      expect(res.status).toBe(403);
      expect(res.headers["access-control-allow-origin"]).toBeUndefined();
      expect(res.headers["access-control-allow-credentials"]).toBeUndefined();
    }
  });
});
