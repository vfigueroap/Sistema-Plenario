import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts"],
    // Realtime + DB integration tests must not run concurrently against the
    // shared module-level Socket.io singleton and the dev database.
    fileParallelism: false,
  },
});
