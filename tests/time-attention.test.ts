import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withSystem, withTenant, schema, type Tx } from "../src/db";
import type { AttentionCtx } from "../src/lib/attention-sources/types";
import { timeAttentionSource } from "../src/modules/time/attention/source";

/**
 * What Time puts in front of a person — slice 8.
 *
 * DB-backed because the whole source is queries, and a drizzle query that
 * compiles can still be rejected by Postgres. But the reason these assertions
 * exist is not SQL validity: it is **who gets told**. Every item here is a
 * message to a specific person about work they can actually do, and the ways to
 * get that wrong are silent — telling an owner about a clock the worker can see
 * for themselves is noise, and telling nobody about the barn worker's clock is
 * the failure the `unassigned` roll-up exists to prevent.
 *
 * `today` is fixed at 2026-09-10, a Thursday. With a Sunday week start that
 * makes the current week 2026-09-06 to 2026-09-12 and the previous weekly pay
 * period 2026-08-30 to 2026-09-05.
 */

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;

d("the Time attention source", () => {
  const STAMP = `time-attn-${process.pid}`;
  const OWNER = `${STAMP}-owner`;
  const SIGNED_IN = `${STAMP}-worker`;

  let tenantId = "";
  let withLogin = ""; // a worker who can see their own items
  let noLogin = ""; // the barn worker; their items roll up to the owner
  let gone = ""; // somebody who has left

  const asOwner = (): AttentionCtx => ({
    tenantId,
    userId: OWNER,
    role: "owner",
    today: "2026-09-10",
  });
  const asWorker = (): AttentionCtx => ({
    tenantId,
    userId: SIGNED_IN,
    role: "staff",
    today: "2026-09-10",
  });

  const collect = (ctx: AttentionCtx) =>
    withTenant(
      tenantId,
      (tx: Tx) => timeAttentionSource.collect(tx, ctx),
      { role: ctx.role, userId: ctx.userId },
    );

  const hoursAgo = (h: number) => new Date(Date.now() - h * 60 * 60 * 1000);

  beforeAll(async () => {
    await withSystem(async (tx) => {
      const [tenant] = await tx
        .insert(schema.tenants)
        .values({ clerkOrgId: STAMP, name: "Attention Farm", slug: STAMP })
        .returning();
      tenantId = tenant.id;

      const people = await tx
        .insert(schema.parties)
        .values([
          { tenantId, kind: "person" as const, displayName: "Signed In Sam" },
          { tenantId, kind: "person" as const, displayName: "Barn Bess" },
          { tenantId, kind: "person" as const, displayName: "Gone Gary" },
        ])
        .returning({ id: schema.parties.id });

      const workers = await tx
        .insert(schema.timeWorkers)
        .values([
          { tenantId, partyId: people[0].id, clerkUserId: SIGNED_IN },
          { tenantId, partyId: people[1].id },
          { tenantId, partyId: people[2].id, isActive: false },
        ])
        .returning({ id: schema.timeWorkers.id });
      withLogin = workers[0].id;
      noLogin = workers[1].id;
      gone = workers[2].id;

      await tx.insert(schema.timeSettings).values({
        tenantId,
        weekStartsOn: 0,
        payFrequency: "weekly",
        overtimeRuleset: "federal",
      });
    });
  });

  afterAll(async () => {
    if (!tenantId) return;
    await withSystem((tx) =>
      tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId)),
    );
  });

  it("says nothing at all when nothing is owed", async () => {
    // The important half of the contract: a quiet day and a broken source must
    // not look the same, so this must be an empty answer and not a throw.
    expect(await collect(asOwner())).toEqual([]);
    expect(await collect(asWorker())).toEqual([]);
  });

  // ── a clock left running ──────────────────────────────────────────────────

  it("ignores a clock that is simply having a long day", async () => {
    await withSystem((tx) =>
      tx.insert(schema.timePunches).values({
        tenantId,
        workerId: withLogin,
        startedAt: hoursAgo(9),
        startedByClerkUserId: SIGNED_IN,
      }),
    );
    // Nine hours is a clock doing its job. An item here would fire on every
    // full day anybody works, which is how a warning gets muted.
    expect(await collect(asWorker())).toEqual([]);
    expect(await collect(asOwner())).toEqual([]);
  });

  it("tells the WORKER about their own clock once it has crossed a night", async () => {
    await withSystem((tx) =>
      tx
        .update(schema.timePunches)
        .set({ startedAt: hoursAgo(17) })
        .where(eq(schema.timePunches.workerId, withLogin)),
    );
    const mine = await collect(asWorker());
    expect(mine).toHaveLength(1);
    expect(mine[0].title).toMatch(/^Your clock has been running/);
    expect(mine[0].urgency).toBe("overdue");
    expect(mine[0].unassigned).toBeUndefined();
  });

  it("does NOT also tell the owner, because somebody can already see it", async () => {
    // One fact, one message. Reporting it twice is how a digest stops being read.
    expect(await collect(asOwner())).toEqual([]);
  });

  it("ROLLS UP the barn worker's clock to the owner, who is the only one who can see it", async () => {
    await withSystem((tx) =>
      tx.insert(schema.timePunches).values({
        tenantId,
        workerId: noLogin,
        startedAt: hoursAgo(20),
        startedByClerkUserId: OWNER,
        deviceLabel: "Barn door",
      }),
    );
    const theirs = await collect(asOwner());
    expect(theirs).toHaveLength(1);
    expect(theirs[0].title).toContain("Barn Bess");
    // The flag the renderer groups on: "nobody owes this yet", not "you do".
    expect(theirs[0].unassigned).toBe(true);
    expect(theirs[0].detail).toContain("Barn door");
  });

  it("clears both the moment the clocks are stopped", async () => {
    await withSystem((tx) =>
      tx
        .update(schema.timePunches)
        .set({ endedAt: new Date() })
        .where(eq(schema.timePunches.tenantId, tenantId)),
    );
    expect(await collect(asOwner())).toEqual([]);
    expect(await collect(asWorker())).toEqual([]);
  });

  // ── overtime, before it happens ───────────────────────────────────────────

  /**
   * Hours across the week starting Sunday 2026-09-06. Zeros are SKIPPED, not
   * inserted: `time_entries_minutes_positive` refuses a zero-minute row, which
   * is the schema being right — a day nobody worked has no entry, it does not
   * have an entry of nothing.
   */
  const logWeek = (workerId: string, minutes: number[]) => {
    const rows = minutes
      .map((m, i) => ({
        tenantId,
        workerId,
        minutes: m,
        workDate: `2026-09-${String(6 + i).padStart(2, "0")}`,
        payType: "worked" as const,
        enteredByClerkUserId: OWNER,
      }))
      .filter((r) => r.minutes > 0);
    if (rows.length === 0) return Promise.resolve();
    return withSystem((tx) => tx.insert(schema.timeEntries).values(rows));
  };

  it("stays quiet with a full day of room left", async () => {
    await logWeek(withLogin, [480, 480, 480, 480]); // 32h
    expect(await collect(asOwner())).toEqual([]);
  });

  it("speaks up once somebody is half a day from overtime", async () => {
    await logWeek(withLogin, [0, 0, 0, 0, 240]); // +4h = 36h
    const items = await collect(asOwner());
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Signed In Sam is 4h from overtime");
    // A decision for today, and dated to the end of the week it is about.
    expect(items[0].urgency).toBe("today");
    expect(items[0].dueOn).toBe("2026-09-12");
  });

  it("tells the OWNER and not the worker, even though the worker has a login", async () => {
    // Sending somebody home an hour early is the decision of whoever pays for
    // the hour. Telling both would report one fact twice.
    expect(await collect(asWorker())).toEqual([]);
  });

  it("STOPS once the week is already over, because nothing can be done now", async () => {
    await logWeek(withLogin, [0, 0, 0, 0, 0, 300]); // 41h
    expect(await collect(asOwner())).toEqual([]);
  });

  it("never warns under a ruleset with no weekly threshold", async () => {
    await withSystem((tx) =>
      tx
        .update(schema.timeSettings)
        .set({ overtimeRuleset: "none" })
        .where(eq(schema.timeSettings.tenantId, tenantId)),
    );
    // Back to 36h, which warned a moment ago under the federal rules.
    await withSystem((tx) =>
      tx.delete(schema.timeEntries).where(eq(schema.timeEntries.tenantId, tenantId)),
    );
    await logWeek(withLogin, [480, 480, 480, 480, 240]);
    expect(await collect(asOwner())).toEqual([]);
    await withSystem((tx) =>
      tx
        .update(schema.timeSettings)
        .set({ overtimeRuleset: "federal" })
        .where(eq(schema.timeSettings.tenantId, tenantId)),
    );
  });

  // ── hours nobody sent ─────────────────────────────────────────────────────

  it("asks the worker for a FINISHED period's hours, and not the current one", async () => {
    await withSystem((tx) =>
      tx.delete(schema.timeEntries).where(eq(schema.timeEntries.tenantId, tenantId)),
    );
    await withSystem((tx) =>
      tx.insert(schema.timeEntries).values({
        tenantId,
        workerId: withLogin,
        minutes: 480,
        workDate: "2026-09-02", // inside 2026-08-30 – 2026-09-05
        payType: "worked" as const,
        enteredByClerkUserId: SIGNED_IN,
      }),
    );
    const mine = await collect(asWorker());
    expect(mine).toHaveLength(1);
    expect(mine[0].title).toBe("Your hours have not been sent for approval");
    expect(mine[0].dueOn).toBe("2026-09-05");
    // A one-tap that is the pay screen's own button.
    expect(mine[0].action?.kind).toBe("time.sheet.submit");
    expect(mine[0].action?.args).toEqual({
      workerId: withLogin,
      on: "2026-08-30",
    });
  });

  it("rolls the barn worker's unsent hours up to the owner", async () => {
    await withSystem((tx) =>
      tx.insert(schema.timeEntries).values({
        tenantId,
        workerId: noLogin,
        minutes: 300,
        workDate: "2026-09-03",
        payType: "worked" as const,
        enteredByClerkUserId: OWNER,
      }),
    );
    const theirs = await collect(asOwner());
    expect(theirs).toHaveLength(1);
    expect(theirs[0].title).toContain("Barn Bess");
    expect(theirs[0].unassigned).toBe(true);
  });

  it("does NOT nag about somebody who has left", async () => {
    // They are not going to press submit. Their hours still need approving,
    // and that is a different item on a different person's list.
    await withSystem((tx) =>
      tx.insert(schema.timeEntries).values({
        tenantId,
        workerId: gone,
        minutes: 240,
        workDate: "2026-09-04",
        payType: "worked" as const,
        enteredByClerkUserId: OWNER,
      }),
    );
    const theirs = await collect(asOwner());
    expect(theirs.every((i) => !i.title.includes("Gone Gary"))).toBe(true);
  });

  it("clears the moment the hours are sent", async () => {
    await withSystem((tx) =>
      tx.insert(schema.timeSheets).values({
        tenantId,
        workerId: withLogin,
        periodStartsOn: "2026-08-30",
        periodEndsOn: "2026-09-05",
        submittedByClerkUserId: SIGNED_IN,
      }),
    );
    expect(await collect(asWorker())).toEqual([]);
  });

  it("and then asks the OWNER to approve them", async () => {
    const theirs = await collect(asOwner());
    const waiting = theirs.filter((i) => i.key.startsWith("time_sheet:"));
    expect(waiting).toHaveLength(1);
    expect(waiting[0].title).toBe("Signed In Sam's hours are waiting for you");
    expect(waiting[0].action?.kind).toBe("time.sheet.approve");
  });

  it("tells an accountant nothing, because they can do none of it", async () => {
    const expert = await withTenant(
      tenantId,
      (tx: Tx) =>
        timeAttentionSource.collect(tx, {
          tenantId,
          userId: `${STAMP}-expert`,
          role: "expert",
          today: "2026-09-10",
        }),
      { role: "expert", userId: `${STAMP}-expert` },
    );
    expect(expert).toEqual([]);
  });
});
