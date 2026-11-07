import http from "node:http";
import { once } from "node:events";
import { describe, expect, it } from "vitest";
import { pool } from "@workspace/db";
import app from "../app";

async function until(condition: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!condition() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(condition()).toBe(true);
}

describe("desconexiones mientras se espera la base", () => {
  it("libera todas las conexiones si el navegador abandona solicitudes en cola", async () => {
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Puerto local no disponible");
    const clients = await Promise.all(
      Array.from({ length: pool.options.max }, () => pool.connect()),
    );
    const pending: http.ClientRequest[] = [];
    let released = false;
    try {
      for (let i = 0; i < 5; i++) {
        const req = http.get(`http://127.0.0.1:${address.port}/api/sessions`);
        req.on("error", () => {});
        pending.push(req);
      }
      await until(() => pool.waitingCount === 5);
      pending.forEach((req) => req.destroy());
      await new Promise((resolve) => setTimeout(resolve, 50));
      clients.forEach((client) => client.release());
      released = true;
      await until(
        () => pool.waitingCount === 0 && pool.idleCount === pool.totalCount,
      );
    } finally {
      if (!released) clients.forEach((client) => client.release());
      pending.forEach((req) => req.destroy());
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
