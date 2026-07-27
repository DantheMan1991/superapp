/**
 * Keeps the test suite away from the production database.
 *
 * Sixteen test files create tenants, write rows and delete them again, and
 * several of them do it under `withSystem` — the god view, where RLS is not
 * watching. That is correct for a certification suite and catastrophic against
 * live data, which is why `tenant-isolation.test.ts` has always carried the
 * warning "dev/staging DB, never prod".
 *
 * A warning in a comment is not a control. This is:
 *
 *   TEST_DATABASE_URL set    → it REPLACES DATABASE_URL for the whole run.
 *                              Tests physically cannot reach anything else.
 *   TEST_DATABASE_URL unset  → DATABASE_URL is REMOVED, so every DB-backed
 *                              suite skips itself through the `RUN` flag it
 *                              already has, and says loudly why.
 *
 * Skipping rather than failing is deliberate: the suites already degrade that
 * way when no database is configured, and the isolation test already shouts
 * about being skipped. Turning that into a hard failure would break running
 * the pure tests on a machine with no database at all.
 *
 * Create the separate database as a Neon branch — they are instant, cost
 * almost nothing, and a branch starts as a copy of production's schema, which
 * is exactly what a migration-sensitive suite wants.
 */

// Loaded HERE, not left to the test files. Each suite does its own
// `import "dotenv/config"`, which runs after this setup file — so without this
// line the guard inspects an empty environment, finds no DATABASE_URL, decides
// there is nothing to protect, and the suite then loads production's URL
// itself. Silent, and exactly the failure this file exists to prevent.
import "dotenv/config";

const testUrl = process.env.TEST_DATABASE_URL;
const liveUrl = process.env.DATABASE_URL;

function hostOf(url: string | undefined): string {
  if (!url) return "(none)";
  try {
    return new URL(url).host;
  } catch {
    return "(unparseable)";
  }
}

if (testUrl) {
  // The laziest possible mistake, and the one most likely to happen: copying
  // the production URL into the new variable and moving on.
  if (liveUrl && testUrl === liveUrl) {
    throw new Error(
      "TEST_DATABASE_URL is identical to DATABASE_URL.\n" +
        "  These tests create and delete tenants under withSystem, where RLS is\n" +
        "  not watching. Point TEST_DATABASE_URL at a separate database — a Neon\n" +
        "  branch takes about a minute to create.",
    );
  }
  process.env.DATABASE_URL = testUrl;
  // The owner URL drives migrations; leaving production's in place would let a
  // test run migrate the wrong database.
  if (process.env.TEST_DATABASE_URL_OWNER) {
    process.env.DATABASE_URL_OWNER = process.env.TEST_DATABASE_URL_OWNER;
  } else {
    delete process.env.DATABASE_URL_OWNER;
  }
} else if (liveUrl) {
  delete process.env.DATABASE_URL;
  delete process.env.DATABASE_URL_OWNER;
  // Written straight to stderr rather than through console.warn, which vitest
  // intercepts and then discards for a file whose tests all skip. A silent
  // skip is the exact failure this guard exists to make impossible: the
  // isolation suite is the one that must pass before a deploy, and "0 failed"
  // must never be mistaken for "it ran".
  process.stderr.write(
    `\n⚠  DATABASE TESTS SKIPPED — no TEST_DATABASE_URL set.\n` +
      `   DATABASE_URL points at ${hostOf(liveUrl)}, and these suites create and\n` +
      `   delete tenants under withSystem, where RLS is not watching. They will\n` +
      `   not be aimed at that.\n\n` +
      `   This includes tenant-isolation — the certification that must pass\n` +
      `   before any deploy. It did not run.\n\n` +
      `   To run them: set TEST_DATABASE_URL to a separate database (a Neon\n` +
      `   branch takes about a minute) and TEST_DATABASE_URL_OWNER to its owner\n` +
      `   connection string.\n\n`,
  );
}
