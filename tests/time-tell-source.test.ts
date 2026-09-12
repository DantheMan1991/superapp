import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withSystem, withTenant, schema, type Tx } from "../src/db";
import { timeTellSource } from "../src/modules/time/tell/source";
import type { TellAction, TellCtx } from "../src/lib/tell-sources/types";

/**
 * "Clock me in" — the time module's tell source (voice slice 1, ADR 0039).
 *
 * **THE TEST THAT MADE THIS FILE DB-BACKED is the one about `ctx.now`.** A
 * sentence spoken in a barn with no signal is queued and arrives hours later
 * (ADR 0048), and a punch stamped at PROCESSING time rather than speaking time
 * is not a rounding error, it is wages. Nothing pure can catch that: the
 * write really does happen and really does carry a plausible timestamp. So it
 * is asserted against the row.
 *
 * The other property worth a test is the absence of a field: there is no
 * "who", so a sentence can only ever move the speaker's own clock.
 */

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;

d("clock me in", () => {
  const STAMP = `tell-time-${process.pid}-${Date.now()}`;
  const SIGNED_IN = `${STAMP}-user`;
  const STRANGER = `${STAMP}-stranger`;

  let tenantId = "";
  let workerId = "";
  let mateWorkerId = "";

  /** Ten in the morning, New York — a fixed instant, never a clock. */
  const SPOKEN = new Date("2026-09-12T14:00:00.000Z");

  const ctxFor = (userId: string, now = SPOKEN): TellCtx => ({
    tenantId,
    userId,
    role: "staff",
    now,
    timezone: "America/New_York",
    today: "2026-09-12",
  });

  const asStaff = <T,>(fn: (tx: Tx) => Promise<T>, userId = SIGNED_IN) =>
    withTenant(tenantId, fn, { role: "staff", userId });

  const actionsFor = (userId: string, now = SPOKEN) =>
    asStaff((tx) => timeTellSource.actions(tx, ctxFor(userId, now)), userId);

  const run = (
    action: TellAction,
    values: Record<string, string | number | null>,
    userId = SIGNED_IN,
    now = SPOKEN,
  ) => asStaff((tx) => action.record(tx, ctxFor(userId, now), values), userId);

  const openPunches = () =>
    withSystem((tx) =>
      tx
        .select()
        .from(schema.timePunches)
        .where(eq(schema.timePunches.tenantId, tenantId)),
    );

  beforeAll(async () => {
    await withSystem(async (tx) => {
      const [tenant] = await tx
        .insert(schema.tenants)
        .values({
          clerkOrgId: `org_${STAMP}`,
          name: `Tell Time ${STAMP}`,
          slug: STAMP,
          timezone: "America/New_York",
        })
        .returning();
      tenantId = tenant.id;

      const people = await tx
        .insert(schema.parties)
        .values([
          { tenantId, kind: "person" as const, displayName: "The Speaker" },
          { tenantId, kind: "person" as const, displayName: "Their Mate" },
        ])
        .returning({ id: schema.parties.id });

      const workers = await tx
        .insert(schema.timeWorkers)
        .values([
          { tenantId, partyId: people[0].id, clerkUserId: SIGNED_IN },
          // Deliberately NOT linked to a sign-in: somebody the business keeps
          // hours for who has no account, which is the common case.
          { tenantId, partyId: people[1].id },
        ])
        .returning({ id: schema.timeWorkers.id });
      workerId = workers[0].id;
      mateWorkerId = workers[1].id;
    });
  });

  afterAll(async () => {
    await withSystem((tx) =>
      tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId)),
    );
  });

  it("offers nothing to somebody the business keeps no hours for", async () => {
    // The module is on for the workspace; it is simply not on for them, and
    // an action they cannot perform is worse in the catalogue than absent.
    expect(await actionsFor(STRANGER)).toEqual([]);
  });

  it("offers both clocks to a worker who can sign in", async () => {
    const actions = await actionsFor(SIGNED_IN);
    expect(actions.map((a) => a.slug)).toEqual([
      "time.clock_in",
      "time.clock_out",
    ]);
  });

  it("has no field for WHOSE clock it is, in either action", async () => {
    // The security property, asserted as the absence it is. A sentence
    // carries no credential of anybody else's, so clocking somebody else in
    // belongs to the keypad's PIN and must have nothing here to land on.
    const actions = await actionsFor(SIGNED_IN);
    for (const action of actions) {
      const keys = action.fields.map((f) => f.key);
      expect(keys).not.toContain("worker");
      expect(keys).not.toContain("who");
      expect(keys).toEqual(["note"]);
    }
  });

  /** THE ONE THIS FILE EXISTS FOR. */
  it("stamps the punch when the sentence was SPOKEN, not when it was processed", async () => {
    const [clockIn] = await actionsFor(SIGNED_IN);
    const result = await run(clockIn, { note: "fencing the top field" });
    expect(result.summary).toBe("Clocked in at 10:00 AM");

    const punches = await openPunches();
    expect(punches).toHaveLength(1);
    // Not "roughly now" — exactly the instant the context carried. A queued
    // sentence arriving hours later must still land on its own moment.
    expect(punches[0].startedAt.toISOString()).toBe(SPOKEN.toISOString());
    expect(punches[0].workerId).toBe(workerId);
    expect(punches[0].note).toBe("fencing the top field");
  });

  it("refuses a second clock-in in the module's own words", async () => {
    const [clockIn] = await actionsFor(SIGNED_IN);
    await expect(run(clockIn, { note: "" })).rejects.toThrow(
      "a clock is already running",
    );
  });

  it("stops the clock, and says both numbers when rounding moved one", async () => {
    const actions = await actionsFor(SIGNED_IN);
    const clockOut = actions.find((a) => a.slug === "time.clock_out")!;
    // Ninety-three minutes after the start.
    const stoppedAt = new Date(SPOKEN.getTime() + 93 * 60 * 1_000);
    const result = await run(clockOut, { note: "" }, SIGNED_IN, stoppedAt);
    expect(result.summary).toContain("Clocked out");
    expect(result.summary).toContain("1h 33m");

    const punches = await openPunches();
    expect(punches[0].endedAt?.toISOString()).toBe(stoppedAt.toISOString());
  });

  it("refuses to stop a clock that was never started", async () => {
    const actions = await actionsFor(SIGNED_IN);
    const clockOut = actions.find((a) => a.slug === "time.clock_out")!;
    await expect(
      run(clockOut, { note: "" }, SIGNED_IN, new Date(SPOKEN.getTime() + 1)),
    ).rejects.toThrow("your clock is not running");
  });

  it("never touches the colleague who has no sign-in", async () => {
    const theirs = await withSystem((tx) =>
      tx
        .select()
        .from(schema.timePunches)
        .where(eq(schema.timePunches.workerId, mateWorkerId)),
    );
    expect(theirs).toHaveLength(0);
  });
});
