import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

const { scope } = vi.hoisted(() => ({
  scope: vi.fn(async (_id: string, work: () => Promise<unknown>) => work()),
}));
vi.mock("@workspace/db", () => ({ withInstitutionDb: scope }));
import { publicRead } from "../lib/public-read";

afterEach(() => {
  vi.unstubAllEnvs();
  scope.mockClear();
});

describe("lecturas públicas compartidas", () => {
  it("agrupa visitantes simultáneos en una transacción y conserva ETag", async () => {
    const app = express();
    const load = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 20));
      return [{ public: true }];
    });
    app.get("/history", publicRead(load, "public, s-maxage=60", 1000));
    const results = await Promise.all(
      Array.from({ length: 30 }, () => request(app).get("/history")),
    );
    expect(load).toHaveBeenCalledOnce();
    expect(scope).toHaveBeenCalledOnce();
    expect(
      results.every(
        (r) => r.status === 200 && r.headers["set-cookie"] === undefined,
      ),
    ).toBe(true);
    const unchanged = await request(app)
      .get("/history")
      .set("If-None-Match", results[0].headers.etag);
    expect(unchanged.status).toBe(304);
    expect(scope).toHaveBeenCalledOnce();
  });

  it("no comparte contenido entre instituciones", async () => {
    const app = express();
    app.get(
      "/history",
      publicRead(
        async () => ({ institution: process.env.INSTITUTION_ID }),
        "public",
        1000,
      ),
    );
    vi.stubEnv("INSTITUTION_ID", "00000000-0000-4000-8000-000000000001");
    const first = await request(app).get("/history");
    vi.stubEnv("INSTITUTION_ID", "00000000-0000-4000-8000-000000000002");
    const second = await request(app).get("/history");
    expect(first.body.institution).not.toBe(second.body.institution);
    expect(scope).toHaveBeenCalledTimes(2);
  });

  it("no almacena fallos y vuelve a intentar", async () => {
    const app = express();
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error("DB"))
      .mockResolvedValue({ ok: true });
    app.get("/history", publicRead(load, "public", 1000));
    const failed = await request(app).get("/history");
    expect(failed.status).toBe(503);
    expect(failed.headers["cache-control"]).toBe("no-store");
    expect((await request(app).get("/history")).body).toEqual({ ok: true });
  });
});
