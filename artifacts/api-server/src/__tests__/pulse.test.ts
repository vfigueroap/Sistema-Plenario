import express from "express";
import request from "supertest";
import { afterEach, expect, it, vi } from "vitest";

const { scope } = vi.hoisted(() => ({ scope: vi.fn() }));
vi.mock("@workspace/db", () => ({ withInstitutionDb: scope }));

afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); scope.mockReset(); });

it("comparte ráfagas, conserva ETag y separa instituciones", async () => {
  scope.mockImplementation(async (id, work) => work({ execute: async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { rows: [{ live: id === "primera", s: id, a: "1", w: "1", t: "1", x: "1", g: "1" }] };
  } }));
  const { pulseHandler } = await import("../routes/pulse");
  const app = express();
  app.get("/a", pulseHandler("primera"));
  app.get("/b", pulseHandler("segunda"));
  const rows = await Promise.all(Array.from({ length: 120 }, () => request(app).get("/a")));
  expect(rows.every((row) => row.status === 200 && row.body.live === true && !row.headers["set-cookie"])).toBe(true);
  expect(scope).toHaveBeenCalledTimes(1);
  const unchanged = await request(app).get("/a").set("If-None-Match", rows[0].headers.etag);
  expect(unchanged.status).toBe(304);
  expect(scope).toHaveBeenCalledTimes(1);
  const other = await request(app).get("/b");
  expect(other.body.live).toBe(false);
  expect(other.body.v).not.toBe(rows[0].body.v);
  expect(scope).toHaveBeenCalledTimes(2);
  expect(other.headers["cache-control"]).toBe("public, max-age=0, s-maxage=5, must-revalidate");
});

it("no almacena errores del pulso y permite recuperarse", async () => {
  scope.mockRejectedValueOnce(new Error("BD")).mockResolvedValue({ v: "ok", c: {}, live: false });
  const { pulseHandler } = await import("../routes/pulse");
  const app = express();
  app.get("/pulse", pulseHandler("primera"));
  const failed = await request(app).get("/pulse");
  expect(failed.status).toBe(503);
  expect(failed.headers["cache-control"]).toBe("no-store");
  expect((await request(app).get("/pulse")).status).toBe(200);
});
