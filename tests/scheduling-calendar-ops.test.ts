import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { withSystem, withTenant, schema, type Tx } from "../src/db";
import {
  SchedulingError,
  createCalendar,
  grantShare,
  listCalendars,
  listShares,
  revokeShare,
  setCalendarArchived,
  updateCalendar,
  type SchedulingCtx,
} from "../src/modules/scheduling/calendar-ops";

/**
 * The calendar ops layer, exercised through real RLS.
 *
 * These run as a PERSON rather than under `withSystem`, which is the point:
 * every guard in calendar-ops has a policy behind it, and a test that bypassed
 * the policy would only be checking the guard's own arithmetic. Where a guard
 * and a policy disagree, this is what catches it.
 */
const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;

d("scheduling calendar ops", () => {
  const STAMP = `ops-sched-${process.pid}`;
  const OWNER = `${STAMP}-owner`;
  const MATE = `${STAMP}-mate`;

  let tenantId: string;
  let ownerCtx: SchedulingCtx;
  let mateCtx: SchedulingCtx;
  let primaryId: string;

  const asOwner = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantId, fn, { role: "owner", userId: OWNER });
  const asMate = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantId, fn, { role: "staff", userId: MATE });

  beforeAll(async () => {
    await withSystem(async (tx) => {
      const [tenant] = await tx
        .insert(schema.tenants)
        .values({ clerkOrgId: STAMP, name: "Ops", slug: STAMP })
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

      const [primary] = await tx
        .insert(schema.scheduleCalendars)
        .values({
          tenantId,
          ownerClerkUserId: OWNER,
          name: "Calendar",
          kind: "personal",
          isPrimary: true,
        })
        .returning();
      primaryId = primary.id;
    });

    ownerCtx = { tenantId, userId: OWNER, role: "owner" };
    mateCtx = { tenantId, userId: MATE, role: "staff" };
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
      await tx
        .delete(schema.profiles)
        .where(sql`${schema.profiles.clerkUserId} like ${`${STAMP}%`}`);
    });
  });

  it("a new calendar is mine, and invisible to a colleague", async () => {
    const id = await asOwner((tx) =>
      createCalendar(tx, ownerCtx, { name: "Site visits", color: "blue" }),
    );

    const mine = await asOwner((tx) => listCalendars(tx, ownerCtx));
    const row = mine.find((c) => c.id === id);
    expect(row?.group).toBe("mine");
    expect(row?.access).toBe("write");

    const theirs = await asMate((tx) => listCalendars(tx, mateCtx));
    expect(theirs.map((c) => c.id)).not.toContain(id);
  });

  it("the main calendar cannot be archived", async () => {
    await expect(
      asOwner((tx) =>
        setCalendarArchived(tx, ownerCtx, {
          calendarId: primaryId,
          archived: true,
        }),
      ),
    ).rejects.toThrow(SchedulingError);
  });

  it("archiving hides a calendar from the default list, and restores", async () => {
    const id = await asOwner((tx) =>
      createCalendar(tx, ownerCtx, { name: "Old", color: "slate" }),
    );

    await asOwner((tx) =>
      setCalendarArchived(tx, ownerCtx, { calendarId: id, archived: true }),
    );
    const visible = await asOwner((tx) => listCalendars(tx, ownerCtx));
    expect(visible.map((c) => c.id)).not.toContain(id);

    const withArchived = await asOwner((tx) =>
      listCalendars(tx, ownerCtx, { includeArchived: true }),
    );
    expect(withArchived.map((c) => c.id)).toContain(id);

    await asOwner((tx) =>
      setCalendarArchived(tx, ownerCtx, { calendarId: id, archived: false }),
    );
    const back = await asOwner((tx) => listCalendars(tx, ownerCtx));
    expect(back.map((c) => c.id)).toContain(id);
  });

  it("a grant makes it visible, and re-granting UPDATES rather than duplicates", async () => {
    const id = await asOwner((tx) =>
      createCalendar(tx, ownerCtx, { name: "Shared", color: "green" }),
    );

    await asOwner((tx) =>
      grantShare(tx, ownerCtx, {
        calendarId: id,
        granteeClerkUserId: MATE,
        access: "busy",
      }),
    );
    let seen = await asMate((tx) => listCalendars(tx, mateCtx));
    expect(seen.find((c) => c.id === id)?.group).toBe("shared");
    expect(seen.find((c) => c.id === id)?.access).toBe("busy");

    await asOwner((tx) =>
      grantShare(tx, ownerCtx, {
        calendarId: id,
        granteeClerkUserId: MATE,
        access: "details",
      }),
    );
    const shares = await asOwner((tx) => listShares(tx, id));
    // One row, upgraded — not two rows to reconcile.
    expect(shares.filter((s) => s.granteeClerkUserId === MATE)).toHaveLength(1);

    seen = await asMate((tx) => listCalendars(tx, mateCtx));
    expect(seen.find((c) => c.id === id)?.access).toBe("details");
  });

  it("a grantee cannot re-grant, however much access they have", async () => {
    const id = await asOwner((tx) =>
      createCalendar(tx, ownerCtx, { name: "Not yours", color: "rose" }),
    );
    await asOwner((tx) =>
      grantShare(tx, ownerCtx, {
        calendarId: id,
        granteeClerkUserId: MATE,
        access: "write",
      }),
    );

    await expect(
      asMate((tx) =>
        grantShare(tx, mateCtx, {
          calendarId: id,
          granteeClerkUserId: OWNER,
          access: "write",
        }),
      ),
    ).rejects.toThrow(SchedulingError);
  });

  it("granting yourself your own calendar is refused rather than written", async () => {
    const id = await asOwner((tx) =>
      createCalendar(tx, ownerCtx, { name: "Mine", color: "amber" }),
    );
    await expect(
      asOwner((tx) =>
        grantShare(tx, ownerCtx, {
          calendarId: id,
          granteeClerkUserId: OWNER,
          access: "write",
        }),
      ),
    ).rejects.toThrow(SchedulingError);
  });

  it("revoking takes the calendar away again", async () => {
    const id = await asOwner((tx) =>
      createCalendar(tx, ownerCtx, { name: "Temporary", color: "violet" }),
    );
    await asOwner((tx) =>
      grantShare(tx, ownerCtx, {
        calendarId: id,
        granteeClerkUserId: MATE,
        access: "details",
      }),
    );
    const [share] = await asOwner((tx) => listShares(tx, id));

    await asOwner((tx) =>
      revokeShare(tx, ownerCtx, { calendarId: id, shareId: share.id }),
    );
    const seen = await asMate((tx) => listCalendars(tx, mateCtx));
    expect(seen.map((c) => c.id)).not.toContain(id);
  });

  it("a colleague cannot rename a calendar shared with them read-only", async () => {
    const id = await asOwner((tx) =>
      createCalendar(tx, ownerCtx, { name: "Original", color: "blue" }),
    );
    await asOwner((tx) =>
      grantShare(tx, ownerCtx, {
        calendarId: id,
        granteeClerkUserId: MATE,
        access: "details",
      }),
    );

    await expect(
      asMate((tx) =>
        updateCalendar(tx, mateCtx, { calendarId: id, name: "Renamed" }),
      ),
    ).rejects.toThrow(SchedulingError);

    const still = await asOwner((tx) => listCalendars(tx, ownerCtx));
    expect(still.find((c) => c.id === id)?.name).toBe("Original");
  });

  it("an invisible calendar reports NOT_FOUND rather than FORBIDDEN", async () => {
    // The two must be indistinguishable, or the error confirms the calendar
    // exists to somebody probing for it.
    const id = await asOwner((tx) =>
      createCalendar(tx, ownerCtx, { name: "Secret", color: "slate" }),
    );
    await expect(
      asMate((tx) =>
        updateCalendar(tx, mateCtx, { calendarId: id, name: "Nope" }),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
