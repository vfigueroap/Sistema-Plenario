import request from "supertest";
import { afterAll, describe, expect, it, vi } from "vitest";

// Exercise the real app wiring without importing routes or opening PostgreSQL.
const { institutionScope } = vi.hoisted(() => ({
  institutionScope: vi.fn((_institutionId: string, work: (tx: object) => Promise<unknown>) => work({})),
}));
vi.mock("@workspace/db", () => ({
  pool: {},
  db: {},
  usersTable: {},
  withInstitutionDb: institutionScope,
}));
vi.mock("connect-pg-simple", async () => {
  const { default: session } = await import("express-session");
  return { default: () => session.MemoryStore };
});
vi.mock("../routes", async () => {
  const { Router } = await import("express");
  const router = Router();
  router.get("/healthz", (_req, res) => res.json({ status: "ok" }));
  router.all("/origin-probe", (req, res) => {
    req.session.userId = 1;
    res.json({ reached: true });
  });
  router.get("/origin-error", (_req, res) => {
    res.status(401).json({ error: "No autenticado" });
  });
  return { default: router };
});

vi.stubEnv("NODE_ENV", "production");
vi.stubEnv("SESSION_SECRET", "origin-test-only-secret");
vi.stubEnv("ALLOWED_ORIGINS", "https://frontend.example");
vi.stubEnv("APP_URL", "https://plenario.example/app");
const app = (await import("../app")).default;
afterAll(() => vi.unstubAllEnvs());

describe("HTTP origin boundary (no DB)", () => {
  it("serves liveness without opening an institution transaction", async () => {
    const callsBefore = institutionScope.mock.calls.length;
    await request(app).get("/api/healthz").expect(200, { status: "ok" });
    expect(institutionScope).toHaveBeenCalledTimes(callsBefore);
  });
  it.each(["post", "put", "patch", "delete"] as const)("rejects untrusted %s before the route", async (method) => {
    const res = await request(app)[method]("/api/origin-probe")
      .set("Origin", "https://evil.example").send({});
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "Origen no autorizado" });
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it.each(["application/x-www-form-urlencoded", "multipart/form-data; boundary=test", "text/plain"])("blocks simple forms: %s", async (type) => {
    const res = await request(app).post("/api/origin-probe")
      .set("Origin", "https://evil.example").set("Content-Type", type).send("action=change");
    expect(res.status).toBe(403);
  });

  it("does not authorize forged Host or proxy headers", async () => {
    const res = await request(app).post("/api/origin-probe")
      .set("Host", "evil.example").set("X-Forwarded-Host", "evil.example")
      .set("X-Forwarded-Proto", "https").set("Sec-Fetch-Site", "same-origin")
      .set("Origin", "https://evil.example");
    expect(res.status).toBe(403);
  });

  it("rejects before parsing a malformed body", async () => {
    const res = await request(app).post("/api/origin-probe")
      .set("Origin", "https://evil.example")
      .set("Content-Type", "application/json").send("{broken");
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "Origen no autorizado" });
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("rejects localhost in the production middleware", async () => {
    const res = await request(app).post("/api/origin-probe").set("Origin", "http://localhost:5173");
    expect(res.status).toBe(403);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it.each(["https://frontend.example", "https://plenario.example"])("allows configured origin %s and credentials", async (origin) => {
    const res = await request(app).post("/api/origin-probe")
      .set("Origin", origin).set("X-Forwarded-Proto", "https");
    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe(origin);
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
    expect(res.headers.vary).toContain("Origin");
    expect(res.headers["set-cookie"][0]).toMatch(/; SameSite=Lax/);
    expect(res.headers["set-cookie"][0]).toMatch(/; Secure/);
    expect(res.headers["set-cookie"][0]).toMatch(/; HttpOnly/);
  });

  it("checks Referer only when Origin is absent", async () => {
    const allowed = await request(app).post("/api/origin-probe").set("Referer", "https://plenario.example/session/1?x=2");
    expect(allowed.status).toBe(200);
    for (const origin of ["null", "https://evil.example", "https://plenario.example/path"]) {
      const denied = await request(app).post("/api/origin-probe")
        .set("Origin", origin).set("Referer", "https://plenario.example/");
      expect(denied.status).toBe(403);
    }
  });

  it("fails closed on missing or untrusted mutation source", async () => {
    expect((await request(app).post("/api/origin-probe")).status).toBe(403);
    expect((await request(app).post("/api/origin-probe").set("Referer", "https://evil.example/form")).status).toBe(403);
  });

  it("does not reflect untrusted read origins or change API error bodies", async () => {
    const res = await request(app).get("/api/origin-error").set("Origin", "https://evil.example");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "No autenticado" });
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    expect(res.headers["access-control-allow-credentials"]).toBeUndefined();
    expect((await request(app).get("/api/origin-probe")).status).toBe(200);
    const trusted = await request(app).get("/api/origin-error").set("Origin", "https://frontend.example");
    expect(trusted.status).toBe(401);
    expect(trusted.body).toEqual({ error: "No autenticado" });
    expect(trusted.headers["access-control-allow-origin"]).toBe("https://frontend.example");
  });

  it("grants preflight only to configured origins", async () => {
    for (const origin of ["https://frontend.example", "https://evil.example"]) {
      const res = await request(app).options("/api/origin-probe")
        .set("Origin", origin).set("Access-Control-Request-Method", "POST");
      expect(res.headers["access-control-allow-origin"]).toBe(origin.includes("frontend") ? origin : undefined);
    }
  });
});

describe("reusable origin predicate", () => {
  async function policy(env: Record<string, string> = {}) {
    const { createAllowedOrigin } = await import("../lib/allowed-origin");
    return createAllowedOrigin({ NODE_ENV: "production", ...env });
  }

  it("normalizes explicit origins, ports and a public application URL", async () => {
    const allowed = await policy({ ALLOWED_ORIGINS: " https://FRONTEND.example:443/, https://preview.example:8443 ", APP_URL: "https://app.example/base?x=1" });
    for (const origin of ["https://frontend.example", "https://preview.example:8443", "https://app.example"]) expect(allowed(origin)).toBe(true);
    for (const origin of ["http://frontend.example", "https://preview.example", "https://frontend.example.evil.test"]) expect(allowed(origin)).toBe(false);
  });

  it.each([undefined, "", "null", "https://app.example/path", "https://user@app.example", "https://app.example?x=1", "https://app.example#x", "https://app.example https://evil.example", "https://app.example\\evil", "ftp://app.example"])("rejects malformed request origins: %s", async (origin) => {
    expect((await policy({ ALLOWED_ORIGINS: "https://app.example" }))(origin)).toBe(false);
  });

  it.each(["*", "https://*.vercel.app", "null", "https://user:pass@app.example", "https://app.example/path", "https:app.example"])("fails closed on invalid allowlist configuration: %s", async (origin) => {
    await expect(policy({ ALLOWED_ORIGINS: origin })).rejects.toThrow("ALLOWED_ORIGINS");
  });

  it("allows Replit and Vercel only through explicitly configured origins", async () => {
    const allowed = await policy({ APP_URL: "https://project.replit.app", ALLOWED_ORIGINS: "https://specific-preview.vercel.app" });
    expect(allowed("https://project.replit.app")).toBe(true);
    expect(allowed("https://specific-preview.vercel.app")).toBe(true);
    expect(allowed("https://other.replit.app")).toBe(false);
    expect(allowed("https://other.vercel.app")).toBe(false);
  });

  it.each(["javascript:alert(1)", "https://*.replit.app", "https://user@app.example", "https://app.example\\evil", "not a URL"])("rejects invalid APP_URL: %s", async (url) => {
    await expect(policy({ APP_URL: url })).rejects.toThrow("APP_URL");
  });

  it("denies public origins when production configuration is absent", async () => {
    expect((await policy())("https://plenario.example")).toBe(false);
  });

  it("allows loopback only outside production", async () => {
    const dev = await policy({ NODE_ENV: "development" });
    const prod = await policy();
    for (const origin of ["http://localhost:5173", "http://127.0.0.1:3000", "http://[::1]:5000"]) {
      expect(dev(origin)).toBe(true);
      expect(prod(origin)).toBe(false);
    }
    expect(dev("http://localhost.evil.example:5173")).toBe(false);
    expect(dev("http://192.168.1.1:5173")).toBe(false);
    expect((await policy({ ALLOWED_ORIGINS: "http://localhost:5173" }))("http://localhost:5173")).toBe(false);
  });
});
