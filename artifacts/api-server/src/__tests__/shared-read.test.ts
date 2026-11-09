import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

const { scope } = vi.hoisted(() => ({ scope: vi.fn(async (_id: string, work: () => Promise<unknown>) => work()) }));
vi.mock("@workspace/db", () => ({ currentInstitutionId: () => undefined, withInstitutionDb: scope }));
import { sendShared, clearSharedCache } from "../lib/shared-cache";

afterEach(() => {
  clearSharedCache();
  vi.clearAllMocks();
});

describe("lecturas autenticadas compartidas", () => {
  it("abre una sola transacción para lectores concurrentes y envía después de confirmar", async () => {
    const app = express();
    let committed = false;
    scope.mockImplementation(async (_id, work) => {
      const value = await work();
      await new Promise((resolve) => setTimeout(resolve, 40));
      committed = true;
      return value;
    });
    const load = vi.fn(async () => ({ status: 200, body: { ready: true } }));
    app.get("/read", async (_req, res) => {
      res.locals.sharedReadInstitutionId = "00000000-0000-4000-8000-000000000001";
      await sendShared(res, "fixture", load);
    });
    const results = await Promise.all(Array.from({ length: 30 }, async () => {
      const result = await request(app).get("/read");
      expect(committed).toBe(true);
      return result;
    }));
    expect(results.every((r) => r.status === 200 && r.body.ready)).toBe(true);
    expect(scope).toHaveBeenCalledOnce();
    expect(load).toHaveBeenCalledOnce();
  });

  it("no publica un resultado cuando falla la confirmación", async () => {
    const app = express();
    scope.mockRejectedValueOnce(new Error("commit rechazado"));
    app.get("/read", async (_req, res) => {
      res.locals.sharedReadInstitutionId = "00000000-0000-4000-8000-000000000001";
      await sendShared(res, "fixture", async () => ({ status: 200, body: { private: true } }));
    });
    const result = await request(app).get("/read");
    expect(result.status).toBe(500);
    expect(result.body.private).toBeUndefined();
  });
});
