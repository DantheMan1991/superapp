import path from "node:path";
import { configDefaults, defineConfig } from "vitest/config";
import { DB_BACKED_TESTS } from "./tests/db-backed-files";

/**
 * TWO PROJECTS, BECAUSE ONE CONSTRAINT WAS BEING PAID BY EVERY FILE.
 *
 * `fileParallelism: false` used to be set globally, for a real reason: the
 * database-backed suites share one Neon branch, create and delete tenants, and
 * several of them assert what is NOT visible across a tenant boundary — an
 * assertion that another file writing at the same moment can break.
 *
 * But only 43 of 89 test files touch the database. The other 46 are pure
 * functions with no shared state at all, and they were queueing behind the slow
 * ones for a rule that never applied to them.
 *
 * So: `db` keeps the old behaviour exactly, `pure` runs in parallel. The list of
 * which is which is CHECKED rather than trusted — tests/db-backed-files.test.ts
 * recomputes it from file contents and fails if it has drifted, so a database
 * test added to a previously-pure file cannot silently start racing.
 */
const shared = {
  // Runs before anything imports src/db. Points DB-backed suites at a
  // separate database, or removes DATABASE_URL so they skip — these tests
  // create and delete tenants under withSystem, where RLS is not watching.
  setupFiles: ["tests/setup/database-guard.ts"],
  testTimeout: 30_000,
  hookTimeout: 30_000,
};

export default defineConfig({
  resolve: {
    alias: {
      // The "server-only" guard package throws outside a React server
      // context; tests exercise server code directly, so stub it out.
      "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts"),
      // A build-time loader whose exports are not callable outside Next's
      // compiler; the site's fonts module (and every screen that imports it)
      // gets callable stubs instead.
      "next/font/google": path.resolve(__dirname, "tests/stubs/next-font-google.ts"),
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "pure",
          include: ["tests/**/*.test.ts"],
          // configDefaults.exclude carries node_modules and friends; dropping it
          // would let vitest walk into dependencies looking for tests.
          exclude: [...configDefaults.exclude, ...DB_BACKED_TESTS],
          fileParallelism: true,
          ...shared,
        },
      },
      {
        extends: true,
        test: {
          name: "db",
          include: [...DB_BACKED_TESTS],
          // The original constraint, kept where it actually applies.
          fileParallelism: false,
          ...shared,
        },
      },
    ],
  },
});
