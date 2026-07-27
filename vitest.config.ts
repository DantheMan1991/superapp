import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // The "server-only" guard package throws outside a React server
      // context; tests exercise server code directly, so stub it out.
      "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts"),
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    // Runs before anything imports src/db. Points DB-backed suites at a
    // separate database, or removes DATABASE_URL so they skip — these tests
    // create and delete tenants under withSystem, where RLS is not watching.
    setupFiles: ["tests/setup/database-guard.ts"],
    // DB-backed tests share one Neon database; keep files sequential.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
