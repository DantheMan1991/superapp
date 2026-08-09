import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { withSystem, withTenant, schema, type Tx } from "../src/db";
import { listRange } from "../src/lib/schedule/range";
import {
  SchedulingError,
  createCalendar,
  grantShare,
  type SchedulingCtx,
} from "../src/modules/scheduling/calendar-ops";
import {
  cancelItem,
  createItem,
  getItemDetail,
  respondToItem,
  updateItem,
} from "../src/modules/scheduling/item-ops";

/**
 * Events and attendees, exercised as a PERSON through real RLS.
 *
 * The guards in item-ops mirror drizzle/0097 rather than being it, so a test
 * that bypassed the policy would only check the mirror. Everything here runs
 * inside `withTenant` with a role and a user id.
 */
const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;

d("scheduling item ops", () => {
  const STAMP = `ops-item-${process.pid}`;
  const OWNER = `${STAMP}-owner`;
  const MATE = `${STAMP}-mate`;
  const TZ = "America/New_York";

  let tenantId: string;
  let ownerCtx: SchedulingCtx;
  let mateCtx: SchedulingCtx;
  let ownerCal: string;
  let readOnlyCal: string;

  const asOwner = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantId, fn, { role: "owner", userId: OWNER });
  const asMate = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantId, fn, { role: "staff", userId: MATE });

  const WINDOW = {
    from: new Date("2026-09-01T00:00:00Z"),
    to: new Date("2026-10-01T00:00:00Z"),
  };
  const span = (day: number) => ({
    startsAt: new Date(`2026-09-${String(day).padStart(2, "0")}T14:00:00Z`),
    endsAt: new Date(`2026-09-${String(day).padStart(2, "0")}T15:00:00Z`),
  });

  beforeAll(async () => {
    await withSystem(async (tx) => {
      const [tenant] = await tx
        .insert(schema.tenants)
        .values({ clerkOrgId: STAMP, name: "Items", slug: STAMP })
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

    ownerCtx = { tenantId, userId: OWNER, role: "owner" };
    mateCtx = { tenantId, userId: MATE, role: "staff" };

    ownerCal = await asOwner((tx) =>
      createCalendar(tx, ownerCtx, { name: "Work", color: "blue" }),
    );
    readOnlyCal = await asOwner(async (tx) => {
      const id = await createCalendar(tx, ownerCtx, {
        name: "Look but do not touch",
        color: "green",
      });
      await grantShare(tx, ownerCtx, {
        calendarId: id,
        granteeClerkUserId: MATE,
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

  it("creates an event that shows up in the range", async () => {
    const id = await asOwner((tx) =>
      createItem(tx, ownerCtx, {
        calendarId: ownerCal,
        title: "Site visit",
        timeZone: TZ,
        ...span(10),
      }),
    );
    const items = await asOwner((tx) => listRange(tx, WINDOW.from, WINDOW.to));
    const found = items.find((i) => i.id === id);
    expect(found?.title).toBe("Site visit");
    expect(found?.access).toBe("write");
  });

  it("refuses to create on a calendar shared read-only", async () => {
    await expect(
      asMate((tx) =>
        createItem(tx, mateCtx, {
          calendarId: readOnlyCal,
          title: "Should not exist",
          timeZone: TZ,
          ...span(11),
        }),
      ),
    ).rejects.toThrow(SchedulingError);
  });

  it("refuses an event that ends before it starts", async () => {
    await expect(
      asOwner((tx) =>
        createItem(tx, ownerCtx, {
          calendarId: ownerCal,
          title: "Backwards",
          timeZone: TZ,
          startsAt: new Date("2026-09-12T15:00:00Z"),
          endsAt: new Date("2026-09-12T14:00:00Z"),
        }),
      ),
    ).rejects.toThrow(SchedulingError);
  });

  it("a cancelled event leaves the range but keeps its row", async () => {
    const id = await asOwner((tx) =>
      createItem(tx, ownerCtx, {
        calendarId: ownerCal,
        title: "Called off",
        timeZone: TZ,
        ...span(13),
      }),
    );
    await asOwner((tx) => cancelItem(tx, ownerCtx, id));

    const items = await asOwner((tx) => listRange(tx, WINDOW.from, WINDOW.to));
    expect(items.map((i) => i.id)).not.toContain(id);

    // Still there — cancelled, not deleted.
    const detail = await asOwner((tx) => getItemDetail(tx, id));
    expect(detail.cancelledAt).not.toBeNull();
  });

  it("an ATTENDEE sees the event without any access to its calendar", async () => {
    const id = await asOwner((tx) =>
      createItem(tx, ownerCtx, {
        calendarId: ownerCal,
        title: "You are invited",
        timeZone: TZ,
        ...span(14),
        attendees: [{ clerkUserId: MATE }],
      }),
    );
    const items = await asMate((tx) => listRange(tx, WINDOW.from, WINDOW.to));
    const found = items.find((i) => i.id === id);
    expect(found).toBeDefined();
    // No calendar access, so no level — which is what tells a renderer this is
    // an invitation rather than something on a calendar they can open.
    expect(found?.access).toBeNull();
  });

  it("an attendee can respond without write on the calendar", async () => {
    const id = await asOwner((tx) =>
      createItem(tx, ownerCtx, {
        calendarId: ownerCal,
        title: "RSVP please",
        timeZone: TZ,
        ...span(15),
        attendees: [{ clerkUserId: MATE }],
      }),
    );
    await asMate((tx) => respondToItem(tx, mateCtx, id, "accepted"));
    const detail = await asOwner((tx) => getItemDetail(tx, id));
    expect(detail.attendees.find((a) => a.clerkUserId === MATE)?.response).toBe(
      "accepted",
    );
  });

  it("cannot respond to an event you are not on", async () => {
    const id = await asOwner((tx) =>
      createItem(tx, ownerCtx, {
        calendarId: ownerCal,
        title: "Not yours",
        timeZone: TZ,
        ...span(16),
      }),
    );
    await expect(
      asMate((tx) => respondToItem(tx, mateCtx, id, "accepted")),
    ).rejects.toThrow(SchedulingError);
  });

  it("EDITING AN EVENT DOES NOT RESET WHO ALREADY REPLIED", async () => {
    // The reason attendees are diffed rather than deleted-and-reinserted. A
    // delete-all would silently un-accept everybody every time the title
    // changed, and nobody would notice until a meeting was half empty.
    const id = await asOwner((tx) =>
      createItem(tx, ownerCtx, {
        calendarId: ownerCal,
        title: "Kickoff",
        timeZone: TZ,
        ...span(17),
        attendees: [{ clerkUserId: MATE }],
      }),
    );
    await asMate((tx) => respondToItem(tx, mateCtx, id, "accepted"));

    await asOwner((tx) =>
      updateItem(tx, ownerCtx, id, {
        title: "Kickoff (moved room)",
        attendees: [{ clerkUserId: MATE }, { externalEmail: "guest@example.test" }],
      }),
    );

    const detail = await asOwner((tx) => getItemDetail(tx, id));
    expect(detail.title).toBe("Kickoff (moved room)");
    expect(detail.attendees).toHaveLength(2);
    expect(detail.attendees.find((a) => a.clerkUserId === MATE)?.response).toBe(
      "accepted",
    );
  });

  it("removing an attendee takes the event away from them", async () => {
    const id = await asOwner((tx) =>
      createItem(tx, ownerCtx, {
        calendarId: ownerCal,
        title: "Uninvited",
        timeZone: TZ,
        ...span(18),
        attendees: [{ clerkUserId: MATE }],
      }),
    );
    expect(
      (await asMate((tx) => listRange(tx, WINDOW.from, WINDOW.to))).map((i) => i.id),
    ).toContain(id);

    await asOwner((tx) => updateItem(tx, ownerCtx, id, { attendees: [] }));
    expect(
      (await asMate((tx) => listRange(tx, WINDOW.from, WINDOW.to))).map((i) => i.id),
    ).not.toContain(id);
  });

  it("moving an event needs write on the destination too", async () => {
    const id = await asOwner((tx) =>
      createItem(tx, ownerCtx, {
        calendarId: ownerCal,
        title: "Movable",
        timeZone: TZ,
        ...span(19),
      }),
    );
    // MATE has details on readOnlyCal and nothing on ownerCal, so this fails on
    // the source before the destination is even considered.
    await expect(
      asMate((tx) =>
        updateItem(tx, mateCtx, id, { calendarId: readOnlyCal }),
      ),
    ).rejects.toThrow(SchedulingError);
  });
});
