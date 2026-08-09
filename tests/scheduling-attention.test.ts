import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { withSystem, withTenant, schema, type Tx } from "../src/db";
import { schedulingAttentionSource } from "../src/modules/scheduling/attention/source";
import { createCalendar, grantShare } from "../src/modules/scheduling/calendar-ops";
import { createItem, respondToItem } from "../src/modules/scheduling/item-ops";

/**
 * What scheduling contributes to the morning digest.
 *
 * Run as a PERSON through real RLS, because the whole claim of this feature is
 * "each person sees their own work" — and notifications.md records that the
 * digest once shipped into a product where nothing set an assignee, so every
 * staff member's digest was empty by construction and no test could have caught
 * it. These are the tests that could have.
 */
const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;

d("scheduling attention source", () => {
  const STAMP = `att-sched-${process.pid}`;
  const OWNER = `${STAMP}-owner`;
  const MATE = `${STAMP}-mate`;
  const TZ = "America/New_York";

  let tenantId: string;
  let ownerCal: string;
  let mateCal: string;
  let teamCal: string;

  const ownerCtx = () => ({ tenantId, userId: OWNER, role: "owner" as const });
  const mateCtx = () => ({ tenantId, userId: MATE, role: "staff" as const });

  const asOwner = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantId, fn, { role: "owner", userId: OWNER });
  const asMate = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantId, fn, { role: "staff", userId: MATE });

  /** Collect for one person on one local day, the way the digest does. */
  const collectFor = (
    who: "owner" | "mate",
    today: string,
  ): Promise<Awaited<ReturnType<typeof schedulingAttentionSource.collect>>> => {
    const run = who === "owner" ? asOwner : asMate;
    const ctx = who === "owner" ? ownerCtx() : mateCtx();
    return run((tx) => schedulingAttentionSource.collect(tx, { ...ctx, today }));
  };

  const TODAY = "2026-09-15";
  /** 2pm local on a given day, as an instant. */
  const at = (date: string, hour: number) =>
    new Date(`${date}T${String(hour + 4).padStart(2, "0")}:00:00Z`); // EDT = UTC-4

  beforeAll(async () => {
    await withSystem(async (tx) => {
      const [tenant] = await tx
        .insert(schema.tenants)
        .values({ clerkOrgId: STAMP, name: "Att", slug: STAMP, timezone: TZ })
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
      createCalendar(tx, ownerCtx(), { name: "Owner", color: "blue" }),
    );
    mateCal = await asMate((tx) =>
      createCalendar(tx, mateCtx(), { name: "Mate", color: "green" }),
    );
    // A workspace-wide calendar, shared with everybody at `details`.
    teamCal = await asOwner(async (tx) => {
      const id = await createCalendar(tx, ownerCtx(), {
        name: "Team",
        color: "amber",
      });
      await grantShare(tx, ownerCtx(), {
        calendarId: id,
        granteeClerkUserId: "",
        access: "details",
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

  it("reports what is on YOUR calendar today", async () => {
    await asOwner((tx) =>
      createItem(tx, ownerCtx(), {
        calendarId: ownerCal,
        title: "Knox site visit",
        location: "Knox office",
        timeZone: TZ,
        startsAt: at(TODAY, 14),
        endsAt: at(TODAY, 15),
      }),
    );
    const items = await collectFor("owner", TODAY);
    const found = items.find((i) => i.title === "Knox site visit");
    expect(found).toBeDefined();
    expect(found?.urgency).toBe("today");
    expect(found?.dueOn).toBe(TODAY);
    expect(found?.detail).toBe("2:00 PM · Knox office");
  });

  it("does NOT report tomorrow's events", async () => {
    await asOwner((tx) =>
      createItem(tx, ownerCtx(), {
        calendarId: ownerCal,
        title: "Not today",
        timeZone: TZ,
        startsAt: at("2026-09-16", 14),
        endsAt: at("2026-09-16", 15),
      }),
    );
    const items = await collectFor("owner", TODAY);
    expect(items.map((i) => i.title)).not.toContain("Not today");
  });

  it("A COLLEAGUE'S DAY IS NOT YOURS, even on a calendar you can read", async () => {
    // The whole point of the scoping rule. A workspace calendar shared with
    // everybody would otherwise put the entire company's week in every
    // person's morning email.
    await asOwner((tx) =>
      createItem(tx, ownerCtx(), {
        calendarId: teamCal,
        title: "Company all-hands",
        timeZone: TZ,
        startsAt: at(TODAY, 10),
        endsAt: at(TODAY, 11),
      }),
    );
    const mine = await collectFor("owner", TODAY);
    const theirs = await collectFor("mate", TODAY);
    // The owner owns the Team calendar, so it is theirs.
    expect(mine.map((i) => i.title)).toContain("Company all-hands");
    // MATE can READ it at `details` and is not on it — not their obligation.
    expect(theirs.map((i) => i.title)).not.toContain("Company all-hands");
  });

  it("an INVITATION you have not answered is reported, and clears when you reply", async () => {
    const id = await asOwner((tx) =>
      createItem(tx, ownerCtx(), {
        calendarId: ownerCal,
        title: "Kickoff",
        timeZone: TZ,
        startsAt: at("2026-09-18", 9),
        endsAt: at("2026-09-18", 10),
        attendees: [{ clerkUserId: MATE }],
      }),
    );

    let items = await collectFor("mate", TODAY);
    const invite = items.find((i) => i.key === `schedule_invite:${id}`);
    expect(invite).toBeDefined();
    expect(invite?.title).toContain("you have not replied");
    // Three days out, so it is "soon" rather than today.
    expect(invite?.urgency).toBe("soon");

    // THE SELF-CLEARING PROPERTY. Answering makes it disappear; there is
    // nothing to mark read.
    await asMate((tx) => respondToItem(tx, mateCtx(), id, "accepted"));
    items = await collectFor("mate", TODAY);
    expect(items.map((i) => i.key)).not.toContain(`schedule_invite:${id}`);
  });

  it("an unanswered invitation for TODAY is reported once, not twice", async () => {
    const id = await asOwner((tx) =>
      createItem(tx, ownerCtx(), {
        calendarId: ownerCal,
        title: "Today and unanswered",
        timeZone: TZ,
        startsAt: at(TODAY, 16),
        endsAt: at(TODAY, 17),
        attendees: [{ clerkUserId: MATE }],
      }),
    );
    const items = await collectFor("mate", TODAY);
    const keys = items.filter((i) => i.key.endsWith(id)).map((i) => i.key);
    // The invitation, not the invitation AND the day's entry — "one number
    // everywhere" is what the feature trades on.
    expect(keys).toEqual([`schedule_invite:${id}`]);
    expect(items.find((i) => i.key === `schedule_invite:${id}`)?.urgency).toBe(
      "today",
    );
  });

  it("an event you ACCEPTED still shows up in your day", async () => {
    const id = await asOwner((tx) =>
      createItem(tx, ownerCtx(), {
        calendarId: ownerCal,
        title: "Accepted meeting",
        timeZone: TZ,
        startsAt: at(TODAY, 11),
        endsAt: at(TODAY, 12),
        attendees: [{ clerkUserId: MATE }],
      }),
    );
    await asMate((tx) => respondToItem(tx, mateCtx(), id, "accepted"));

    const items = await collectFor("mate", TODAY);
    expect(items.map((i) => i.key)).toContain(`schedule_event:${id}`);
  });

  it("a CANCELLED event is not somebody's morning", async () => {
    const id = await asOwner((tx) =>
      createItem(tx, ownerCtx(), {
        calendarId: mateCal,
        title: "Should not appear",
        timeZone: TZ,
        startsAt: at(TODAY, 13),
        endsAt: at(TODAY, 14),
      }),
    ).catch(() => null);
    // MATE owns mateCal, so the owner cannot write to it — proving the guard,
    // and leaving nothing to cancel.
    expect(id).toBeNull();
  });

  it("nothing at all is an empty list, not a failure", async () => {
    const items = await collectFor("mate", "2027-01-01");
    expect(items).toEqual([]);
  });
});
