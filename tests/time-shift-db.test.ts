import "dotenv/config";
import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { withSystem } from "../src/db";

/**
 * The database's clock agrees with the tests' clock.
 *
 * Many db tests compare a row Postgres stamped with its own `now()` against
 * JS time: rate caps, import windows, `last_7_days`, support-session expiry.
 * They pass only while the two clocks agree, which they always have, until
 * the Date bombs workflow moved one of them. Moving only the JS clock
 * (tests/setup/time-shift.ts) failed 12 such tests in #705's sweep for no
 * reason at all, so the workflow moves Postgres's clock by the same offset,
 * and this file is its canary: a run where the two disagree is a broken run.
 *
 * Run by hand with FAKE_NOW against a database whose clock did not move (the
 * Neon dev branch, say), this fails, and that is the useful answer: the db
 * results of that run are leads to read, not verdicts.
 */

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;

d("the database's clock", () => {
  it("agrees with the tests' clock, to within half a minute", async () => {
    const res = await withSystem((tx) =>
      tx.execute(sql`select (extract(epoch from now()) * 1000)::float8 as ms`),
    );
    const database = Number((res.rows[0] as { ms: number | string }).ms);
    const tests = Date.now();
    const apart = Math.abs(database - tests);
    expect(
      apart,
      `The database reads ${new Date(database).toISOString()} and the tests read ` +
        `${new Date(tests).toISOString()}. Under FAKE_NOW that means only the tests' ` +
        `clock moved: Postgres needs the same offset through libfaketime ` +
        `(docker/postgres-faketime), or every db result in this run is a lead, ` +
        `not a verdict. See docs/runbooks/date-bombs.md.`,
    ).toBeLessThan(30_000);
  });
});
