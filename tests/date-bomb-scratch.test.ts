import "dotenv/config";
import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { withSystem } from "../src/db";

/**
 * SCRATCH, NEVER MERGED: three date bombs, one of each kind, to prove the Date
 * bombs guard finds them. Each passes on today's clock.
 */

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;

d("date bomb scratch", () => {
  it("a price from today does not collide with one from 2026-11-06", () => {
    expect(new Date().toISOString().slice(0, 10)).not.toBe("2026-11-06");
  });

  it("the database's today is not 2026-11-13", async () => {
    const res = await withSystem((tx) =>
      tx.execute(sql`select to_char(now() at time zone 'UTC', 'YYYY-MM-DD') as day`),
    );
    expect((res.rows[0] as { day: string }).day).not.toBe("2026-11-13");
  });

  it("2026-11-20 is still in the future", () => {
    expect(Date.now()).toBeLessThan(Date.parse("2026-11-20T00:00:00Z"));
  });
});
