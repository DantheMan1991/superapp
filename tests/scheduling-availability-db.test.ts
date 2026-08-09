import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { withSystem, withTenant, schema, type Tx } from "../src/db";
import { busyForPeople } from "../src/lib/schedule/availability";
import {
  createCalendar,
  grantShare,
  type SchedulingCtx,
} from "../src/modules/scheduling/calendar-ops";
import { createItem } from "../src/modules/scheduling/item-ops";

/**
 * Availability through real RLS.
 *
 * The unit tests prove the interval maths. These prove the two things only the
 * database can: that a `busy`-level share is ENOUGH to see somebody's times,
 * and that an unshared calendar reports UNKNOWN rather than free.
 */
const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;

d("availability through RLS", () => {
  const STAMP = `avail-${process.pid}`;
  const ASKER = `${STAMP}-asker`;
  const OPEN = `${STAMP}-open`; // shares at busy
  const CLOSED = `${STAMP}-closed`; // shares nothing
  const TZ = "America/New_York";

  let tenantId: string;

  const ctxFor = (userId: string): SchedulingCtx => ({
    tenantId,
    userId,
    role: "staff",
  });
  const as = <T>(userId: string, fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantId, fn, { role: "staff", userId });

  const window = {
    from: new Date("2026-09-10T00:00:00Z"),
    to: new Date("2026-09-12T00:00:00Z"),
  };

  beforeAll(async () => {
    await withSystem(async (tx) => {
      const [tenant] = await tx
        .insert(schema.tenants)
        .values({ clerkOrgId: STAMP, name: "Avail", slug: STAMP, timezone: TZ })
        .returning();
      tenantId = tenant.id;
      const profiles = await tx
        .insert(schema.profiles)
        .values(
          [ASKER, OPEN, CLOSED].map((u) => ({
            clerkUserId: u,
            email: `${u}@example.test`,
          })),
        )
        .returning();
      await tx.insert(schema.memberships).values(
        profiles.map((p) => ({ tenantId, profileId: p.id, role: "staff" as const })),
      );
    });

    // OPEN shares at `busy` — the lowest level, which must be enough.
    await as(OPEN, async (tx) => {
      const id = await createCalendar(tx, ctxFor(OPEN), {
        name: "Open",
        color: "blue",
      });
      await grantShare(tx, ctxFor(OPEN), {
        calendarId: id,
        granteeClerkUserId: ASKER,
        access: "busy",
      });
      await createItem(tx, ctxFor(OPEN), {
        calendarId: id,
        title: "Secret client meeting",
        timeZone: TZ,
        startsAt: new Date("2026-09-10T14:00:00Z"),
        endsAt: new Date("2026-09-10T15:00:00Z"),
      });
      // A `free` item must NOT count as busy.
      await createItem(tx, ctxFor(OPEN), {
        calendarId: id,
        title: "Reminder: order materials",
        timeZone: TZ,
        showAs: "free",
        startsAt: new Date("2026-09-10T18:00:00Z"),
        endsAt: new Date("2026-09-10T19:00:00Z"),
      });
    });

    // CLOSED shares nothing at all.
    await as(CLOSED, async (tx) => {
      const id = await createCalendar(tx, ctxFor(CLOSED), {
        name: "Closed",
        color: "rose",
      });
      await createItem(tx, ctxFor(CLOSED), {
        calendarId: id,
        title: "Private",
        timeZone: TZ,
        startsAt: new Date("2026-09-10T14:00:00Z"),
        endsAt: new Date("2026-09-10T15:00:00Z"),
      });
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

  it("a `busy`-level share is ENOUGH to see somebody's times", async () => {
    const people = await as(ASKER, (tx) =>
      busyForPeople(tx, { clerkUserIds: [OPEN], from: window.from, to: window.to }),
    );
    expect(people[0].visible).toBe(true);
    expect(people[0].busy).toHaveLength(1);
    expect(people[0].busy[0].startsAt.toISOString()).toBe(
      "2026-09-10T14:00:00.000Z",
    );
  });

  it("and it reveals NO titles — that is the point of the level", async () => {
    // busyForPeople returns intervals only. There is nowhere for a title to
    // leak, which is the property the whole four-level design exists for.
    const people = await as(ASKER, (tx) =>
      busyForPeople(tx, { clerkUserIds: [OPEN], from: window.from, to: window.to }),
    );
    expect(Object.keys(people[0].busy[0]).sort()).toEqual(["endsAt", "startsAt"]);
  });

  it("a `free` item does not make somebody busy", async () => {
    const people = await as(ASKER, (tx) =>
      busyForPeople(tx, { clerkUserIds: [OPEN], from: window.from, to: window.to }),
    );
    // The 18:00 reminder is show_as=free and must be absent.
    expect(
      people[0].busy.some(
        (b) => b.startsAt.toISOString() === "2026-09-10T18:00:00.000Z",
      ),
    ).toBe(false);
  });

  it("AN UNSHARED CALENDAR IS UNKNOWN, NOT FREE", async () => {
    // The worst lie this feature could tell. CLOSED genuinely has a meeting at
    // the same time; the asker must not be told the slot is open.
    const people = await as(ASKER, (tx) =>
      busyForPeople(tx, { clerkUserIds: [CLOSED], from: window.from, to: window.to }),
    );
    expect(people[0].visible).toBe(false);
    expect(people[0].busy).toEqual([]);
  });

  it("your own calendar is always visible to you", async () => {
    const people = await as(OPEN, (tx) =>
      busyForPeople(tx, { clerkUserIds: [OPEN], from: window.from, to: window.to }),
    );
    expect(people[0].visible).toBe(true);
    expect(people[0].busy).toHaveLength(1);
  });

  it("asking about nobody is not an error", async () => {
    const people = await as(ASKER, (tx) =>
      busyForPeople(tx, { clerkUserIds: [], from: window.from, to: window.to }),
    );
    expect(people).toEqual([]);
  });
});
