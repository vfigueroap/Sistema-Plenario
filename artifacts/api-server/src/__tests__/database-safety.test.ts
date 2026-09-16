import { describe, expect, it, vi } from "vitest";

describe("database test isolation", () => {
  it.each(["development", "production"])("refuses the application DB when Vitest inherits NODE_ENV=%s", async (nodeEnv) => {
    vi.stubEnv("NODE_ENV", nodeEnv);
    vi.stubEnv("VITEST", "true");
    vi.stubEnv("DATABASE_URL", "postgresql://user:secret@localhost/plenario");
    vi.stubEnv("TEST_DATABASE_URL", "");
    vi.resetModules();
    try {
      await expect(import("@workspace/db").then(async ({ pool }) => {
        await pool.end();
      })).rejects.toThrow("TEST_DATABASE_URL");
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  }, 30000);

  it("refuses the application DATABASE_URL when no test database is configured", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("DATABASE_URL", "postgresql://user:secret@localhost/plenario");
    vi.stubEnv("TEST_DATABASE_URL", "");
    vi.resetModules();
    try {
      await expect(import("@workspace/db").then(async ({ pool }) => {
        await pool.end();
      })).rejects.toThrow("TEST_DATABASE_URL");
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  }, 30000);

  it.each([
    "not-a-url",
    "postgresql://user:secret@db.example.com/plenario_test",
    "postgresql://user:secret@localhost/plenario",
    "https://localhost/plenario_test",
    "postgresql://user:secret@localhost/plenario_test?host=db.example.com",
  ])("rejects unsafe test database case %#", async (url) => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("TEST_DATABASE_URL", url);
    vi.resetModules();
    try {
      await expect(import("@workspace/db").then(async ({ pool }) => {
        await pool.end();
      })).rejects.toThrow("TEST_DATABASE_URL");
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  }, 30000);

  it("uses only the dedicated local test database without connecting", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("DATABASE_URL", "postgresql://user:secret@db.example.com/plenario");
    vi.stubEnv("TEST_DATABASE_URL", "postgresql://user:secret@127.0.0.1/plenario_test");
    vi.resetModules();
    try {
      const { pool } = await import("@workspace/db");
      expect(pool.options.connectionString).toBe(process.env.TEST_DATABASE_URL);
      expect(pool.totalCount).toBe(0);
      await pool.end();
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  }, 30000);
});
