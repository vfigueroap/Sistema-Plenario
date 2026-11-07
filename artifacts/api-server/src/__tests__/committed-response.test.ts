import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { committedResponse } from "../lib/committed-response";

describe("confirmación después del commit", () => {
  it("espera el commit antes de entregar éxito", async () => {
    const app = express();
    let commit!: () => void;
    let ready!: () => void;
    const prepared = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const committed = new Promise<void>((resolve) => {
      commit = resolve;
    });
    app.get("/write", (_req, res) => {
      const response = committedResponse(res);
      void response.ready.then(async () => {
        ready();
        await committed;
        response.send();
      });
      res.json({ ok: true });
    });
    let completed = false;
    const result = request(app)
      .get("/write")
      .then((r) => {
        completed = true;
        return r;
      });
    await prepared;
    expect(completed).toBe(false);
    commit();
    expect((await result).body).toEqual({ ok: true });
  });

  it("no entrega éxito cuando falla el commit", async () => {
    const app = express();
    app.get("/write", (_req, res) => {
      const response = committedResponse(res);
      void response.ready.then(() => response.fail());
      res.status(201).json({ ok: true });
    });
    const result = await request(app).get("/write");
    expect(result.status).toBe(500);
    expect(result.body.ok).toBeUndefined();
    expect(result.headers["cache-control"]).toBe("no-store");
  });

  it("revierte ante una respuesta de error del servidor", async () => {
    const app = express();
    let rolledBack = false;
    app.get("/write", (_req, res) => {
      const response = committedResponse(res);
      void response.ready.catch(() => {
        rolledBack = true;
        response.fail();
      });
      res.status(500).json({ error: "fallo" });
    });
    const result = await request(app).get("/write");
    expect(result.status).toBe(500);
    expect(rolledBack).toBe(true);
  });
});
