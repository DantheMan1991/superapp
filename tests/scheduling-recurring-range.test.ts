import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { withSystem, withTenant, schema, type Tx } from "../src/db";
import { listRange } from "../src/lib/schedule/range";
import { minutesIntoDay } from "../src/lib/timezone";
import {
  createCalendar,
  grantShare,
  type SchedulingCtx,
} from "../src/modules/scheduling/calendar-ops";
import {
  createItem,
  overrideOccurrence,
} from "../src/modules/scheduling/item-ops";

/**
 * Repeating events, end to end through real RLS.
 *
 * The unit tests in `scheduling-recurrence.test.ts` prove the expander. These
 * prove the READ PATH: that a series stored as one row comes back as many, that
 * overrides apply, and — the one most easily missed — that expansion happens on
 * BOTH sources, so a `titles`-level colleague sees a recurring meeting too.
 */
const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;

d("recurring events through listRange", () => {
  const STAMP = `rec-range-${process.pid}`;
  const OWNER = `${STAMP}-owner`;
  const MATE = `${STAMP}-mate`;
  const TZ = "America/New_York";

  let tenantId: string;
  let ownerCal: string;
  let sharedCal: string;

  const ownerCtx = (): SchedulingCtx => ({ tenantId, userId: OWNER, role: "owner" });
  const asOwner = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantId, fn, { role: "owner", userId: OWNER });
  const asMate = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantId, fn, { role: "staff", userId: MATE });

  /** 9am New York on a date, as an instant. EDT in September. */
  const nineAm = (date: string) => new Date(`${date}T13:00:00Z`);
  const window = (from: string, to: string) => ({
    from: new Date(`${from}T00:00:00Z`),
    to: new Date(`${to}T00:00:00Z`),
  });

  beforeAll(async () => {
    await withSystem(async (tx) => {
      const [tenant] = await tx
        .insert(schema.tenants)
        .values({ clerkOrgId: STAMP, name: "Rec", slug: STAMP, timezone: TZ })
        .returning();
      tenantId = tenant.id;
      const profiles = await tx
        .insert(schema.profiles)
        .values([
          { clerkUserId: OWNER, email: `${OWNER}@example.test` },
          { clerkUserId: MATE, email: `${MATE}@example.test` },
        ])
        .returning();
      await tx.insert(schema.memberships).values([
        { tenantId, profileId: profiles[0].id, role: "owner" },
        { tenantId, profileId: profiles[1].id, role: "staff" },
      ]);
    });

    ownerCal = await asOwner((tx) =>
      createCalendar(tx, ownerCtx(), { name: "Work", color: "blue" }),
    );
    sharedCal = await asOwner(async (tx) => {
      const id = await createCalendar(tx, ownerCtx(), {
        name: "Shared",
        color: "green",
      });
      await grantShare(tx, ownerCtx(), {
        calendarId: id,
        granteeClerkUserId: MATE,
        access: "titles",
      });
      return id;
    });
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
      await tx
        .delete(schema.profiles)
        .where(sql`${schema.profiles.clerkUserId} like ${`${STAMP}%`}`);
    });
  });

  it("ONE ROW becomes many occurrences", async () => {
    const id = await asOwner((tx) =>
      createItem(tx, ownerCtx(), {
        calendarId: ownerCal,
        title: "Standup",
        timeZone: TZ,
        startsAt: nineAm("2026-09-07"),
        endsAt: new Date("2026-09-07T13:15:00Z"),
        recurrenceRule: "FREQ=WEEKLY;BYDAY=MO",
      }),
    );

    const w = window("2026-09-01", "2026-10-01");
    const items = await asOwner((tx) => listRange(tx, w.from, w.to));
    const mine = items.filter((i) => i.id === id);
    // Mondays in September 2026: 7, 14, 21, 28.
    expect(mine.map((i) => i.occurrenceDate)).toEqual([
      "2026-09-07",
      "2026-09-14",
      "2026-09-21",
      "2026-09-28",
    ]);
    expect(mine.every((i) => i.repeats)).toBe(true);
    // Every occurrence keeps the wall clock.
    for (const occurrence of mine) {
      expect(minutesIntoDay(occurrence.startsAt, TZ)).toBe(9 * 60);
    }
  });

  it("a series that STARTED before the window still appears in it", async () => {
    // The filter has to keep a recurring row whose first occurrence is long
    // past, or the expander never sees it.
    const id = await asOwner((tx) =>
      createItem(tx, ownerCtx(), {
        calendarId: ownerCal,
        title: "Old series",
        timeZone: TZ,
        startsAt: nineAm("2026-01-05"),
        endsAt: new Date("2026-01-05T14:00:00Z"),
        recurrenceRule: "FREQ=WEEKLY;BYDAY=MO",
      }),
    );
    const w = window("2026-09-01", "2026-09-15");
    const items = await asOwner((tx) => listRange(tx, w.from, w.to));
    expect(items.filter((i) => i.id === id).length).toBeGreaterThan(0);
  });

  it("CANCELLING ONE OCCURRENCE leaves the rest of the series alone", async () => {
    const id = await asOwner((tx) =>
      createItem(tx, ownerCtx(), {
        calendarId: ownerCal,
        title: "Weekly review",
        timeZone: TZ,
        startsAt: nineAm("2026-09-01"),
        endsAt: new Date("2026-09-01T14:00:00Z"),
        recurrenceRule: "FREQ=DAILY",
      }),
    );
    const w = window("2026-09-01", "2026-09-06");

    const before = await asOwner((tx) => listRange(tx, w.from, w.to));
    expect(before.filter((i) => i.id === id)).toHaveLength(5);

    await asOwner((tx) =>
      overrideOccurrence(tx, ownerCtx(), {
        itemId: id,
        occurrenceDate: "2026-09-03",
        cancelled: true,
      }),
    );

    const after = await asOwner((tx) => listRange(tx, w.from, w.to));
    const dates = after.filter((i) => i.id === id).map((i) => i.occurrenceDate);
    expect(dates).toEqual([
      "2026-09-01",
      "2026-09-02",
      "2026-09-04",
      "2026-09-05",
    ]);
  });

  it("MOVING one occurrence changes only that one", async () => {
    const id = await asOwner((tx) =>
      createItem(tx, ownerCtx(), {
        calendarId: ownerCal,
        title: "Movable series",
        timeZone: TZ,
        startsAt: nineAm("2026-09-01"),
        endsAt: new Date("2026-09-01T14:00:00Z"),
        recurrenceRule: "FREQ=DAILY;COUNT=3",
      }),
    );
    await asOwner((tx) =>
      overrideOccurrence(tx, ownerCtx(), {
        itemId: id,
        occurrenceDate: "2026-09-02",
        cancelled: false,
        startsAt: new Date("2026-09-02T18:00:00Z"), // 2pm local
        endsAt: new Date("2026-09-02T19:00:00Z"),
      }),
    );

    const w = window("2026-09-01", "2026-09-05");
    const items = (await asOwner((tx) => listRange(tx, w.from, w.to))).filter(
      (i) => i.id === id,
    );
    expect(items).toHaveLength(3);
    const moved = items.find((i) => i.occurrenceDate === "2026-09-02");
    expect(minutesIntoDay(moved!.startsAt, TZ)).toBe(14 * 60);
    // The others are untouched.
    const untouched = items.find((i) => i.occurrenceDate === "2026-09-01");
    expect(minutesIntoDay(untouched!.startsAt, TZ)).toBe(9 * 60);
  });

  it("EXPANSION HAPPENS ON THE REDACTED PATH TOO", async () => {
    // A `titles`-level colleague reads through app_schedule_range, not through
    // RLS — so if only the RLS path expanded, a recurring meeting would show
    // once on their calendar and never again. This is the test that catches it.
    const id = await asOwner((tx) =>
      createItem(tx, ownerCtx(), {
        calendarId: sharedCal,
        title: "Shared standup",
        timeZone: TZ,
        startsAt: nineAm("2026-09-07"),
        endsAt: new Date("2026-09-07T13:15:00Z"),
        recurrenceRule: "FREQ=WEEKLY;BYDAY=MO",
      }),
    );

    const w = window("2026-09-01", "2026-10-01");
    const seen = (await asMate((tx) => listRange(tx, w.from, w.to))).filter(
      (i) => i.id === id,
    );
    expect(seen.map((i) => i.occurrenceDate)).toEqual([
      "2026-09-07",
      "2026-09-14",
      "2026-09-21",
      "2026-09-28",
    ]);
    // At `titles` they get the title and no body.
    expect(seen[0].title).toBe("Shared standup");
    expect(seen[0].description).toBeNull();
    expect(seen[0].access).toBe("titles");
  });

  it("refuses a repeat pattern the expander cannot honour", async () => {
    await expect(
      asOwner((tx) =>
        createItem(tx, ownerCtx(), {
          calendarId: ownerCal,
          title: "Third Tuesday",
          timeZone: TZ,
          startsAt: nineAm("2026-09-15"),
          endsAt: new Date("2026-09-15T14:00:00Z"),
          recurrenceRule: "FREQ=MONTHLY;BYDAY=3TU",
        }),
      ),
    ).rejects.toThrow();
  });

  it("a one-off event still has a null occurrenceDate", async () => {
    const id = await asOwner((tx) =>
      createItem(tx, ownerCtx(), {
        calendarId: ownerCal,
        title: "Just once",
        timeZone: TZ,
        startsAt: nineAm("2026-09-09"),
        endsAt: new Date("2026-09-09T14:00:00Z"),
      }),
    );
    const w = window("2026-09-01", "2026-10-01");
    const items = (await asOwner((tx) => listRange(tx, w.from, w.to))).filter(
      (i) => i.id === id,
    );
    expect(items).toHaveLength(1);
    expect(items[0].occurrenceDate).toBeNull();
    expect(items[0].repeats).toBe(false);
  });
});
