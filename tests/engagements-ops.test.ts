import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { withSystem, withTenant, schema, type Tx } from "../src/db";
import {
  createEngagement,
  deleteTimeEntry,
  EngagementError,
  ENGAGEMENT_DIMENSION,
  getEngagementDetail,
  listClientCandidates,
  listEngagements,
  logTime,
  setEngagementStatus,
  updateEngagement,
  updateTimeEntry,
  type EngagementCtx,
} from "../src/packs/professional-services/ops";
import { seedParty } from "./isolation/_shared";

/**
 * The ops behind the professional-services pack (back-office slice 7b).
 *
 * `tests/isolation/professional-services.test.ts` builds its fixtures under
 * `withSystem`, because that suite certifies what the DATABASE enforces and
 * routing setup through this file would let a bug here make those tests agree
 * with it. So the pack's central claim — that an engagement is a COST OBJECT
 * from the moment it exists — is covered here and nowhere else.
 *
 * Tested at the op rather than through the action: an action's other half is
 * `requireTenant()` and a Clerk session, and the rules are what is worth
 * certifying.
 */

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;

d("engagement ops", () => {
  const STAMP = `engops-${process.pid}`;
  const OWNER = `${STAMP}-owner`;
  const STAFF = `${STAMP}-staff`;

  let tenantId = "";
  let clientId = "";

  const asOwner = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantId, fn, { role: "owner", userId: OWNER });
  const asStaff = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantId, fn, { role: "staff", userId: STAFF });

  const ownerCtx = (): EngagementCtx => ({ tenantId, userId: OWNER, role: "owner" });
  const staffCtx = (): EngagementCtx => ({ tenantId, userId: STAFF, role: "staff" });

  const terms = () => ({
    partyId: clientId,
    name: "Monthly bookkeeping",
    kind: "retainer",
    startsOn: "2026-07-01",
    retainerMinutesMonthly: 600,
    feeCents: 250_000,
    rateCents: 12_000,
  });

  beforeAll(async () => {
    await withSystem(async (tx) => {
      const [tenant] = await tx
        .insert(schema.tenants)
        .values({ clerkOrgId: `${STAMP}-org`, name: "Engagement Ops", slug: `${STAMP}-slug` })
        .returning({ id: schema.tenants.id });
      tenantId = tenant.id;
      clientId = await seedParty(tx, tenantId, "Hollis & Co");
    });
  });

  afterAll(async () => {
    await withSystem((tx) => tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId)));
  });

  // ---- the claim the whole pack rests on ---------------------------------

  it("agreeing an engagement makes it a cost object in the same transaction", async () => {
    const engagement = await asOwner((tx) => createEngagement(tx, ownerCtx(), terms()));

    const members = await asOwner((tx) =>
      tx
        .select()
        .from(schema.dimensionMembers)
        .where(
          and(
            eq(schema.dimensionMembers.tenantId, tenantId),
            eq(schema.dimensionMembers.packEntityId, engagement.id),
          ),
        ),
    );
    expect(members).toHaveLength(1);
    expect(members[0].dimensionType).toBe(ENGAGEMENT_DIMENSION);
    // Named for a report, which reads a list of members with no idea what an
    // engagement is: the client, then the engagement.
    expect(members[0].displayName).toBe("Hollis & Co · Monthly bookkeeping");
    expect(members[0].isActive).toBe(true);
  });

  it("the retainer agreed becomes the first month's allotment", async () => {
    const engagement = await asOwner((tx) =>
      createEngagement(tx, ownerCtx(), { ...terms(), name: "Allotment check" }),
    );
    const rows = await asOwner((tx) =>
      tx.query.psEngagementAllotments.findMany({
        where: eq(schema.psEngagementAllotments.engagementId, engagement.id),
      }),
    );
    expect(rows).toHaveLength(1);
    // The month it STARTS in, not the month it was typed in.
    expect(rows[0].effectiveMonth).toBe("2026-07");
    expect(rows[0].includedMinutes).toBe(600);
  });

  it("an engagement with no retainer writes no allotment", async () => {
    const engagement = await asOwner((tx) =>
      createEngagement(tx, ownerCtx(), {
        partyId: clientId,
        name: "Ad hoc advice",
        kind: "hourly",
        startsOn: "2026-08-01",
        rateCents: 20_000,
      }),
    );
    const rows = await asOwner((tx) =>
      tx.query.psEngagementAllotments.findMany({
        where: eq(schema.psEngagementAllotments.engagementId, engagement.id),
      }),
    );
    expect(rows).toHaveLength(0);
  });

  it("mints the client through the party door when it is somebody new", async () => {
    const engagement = await asOwner((tx) =>
      createEngagement(tx, ownerCtx(), {
        clientName: "Brightwell Dental",
        name: "Website care",
        kind: "retainer",
        startsOn: "2026-08-01",
      }),
    );
    const party = await asOwner((tx) =>
      tx.query.parties.findFirst({ where: eq(schema.parties.id, engagement.partyId) }),
    );
    expect(party?.displayName).toBe("Brightwell Dental");
    expect(party?.kind).toBe("organization");
    // And it is the same identity the rest of the product uses, so the picker
    // offers it next time.
    const candidates = await asOwner((tx) => listClientCandidates(tx, tenantId));
    expect(candidates.map((c) => c.name)).toContain("Brightwell Dental");
  });

  // ---- who may do what ---------------------------------------------------

  it("staff cannot agree an engagement — it is a decision", async () => {
    await expect(asStaff((tx) => createEngagement(tx, staffCtx(), terms()))).rejects.toThrow(
      EngagementError,
    );
  });

  it("staff CAN log time — it is a chore", async () => {
    const engagement = await asOwner((tx) =>
      createEngagement(tx, ownerCtx(), { ...terms(), name: "Chore check" }),
    );
    const entry = await asStaff((tx) =>
      logTime(tx, staffCtx(), {
        engagementId: engagement.id,
        minutes: 90,
        workDate: "2026-09-03",
        note: "Bank reconciliation",
      }),
    );
    expect(entry.minutes).toBe(90);
    expect(entry.actorClerkUserId).toBe(STAFF);
  });

  it("refuses a duration nobody worked", async () => {
    const engagement = await asOwner((tx) =>
      createEngagement(tx, ownerCtx(), { ...terms(), name: "Minutes check" }),
    );
    for (const minutes of [0, -30, 1441, 1.5]) {
      await expect(
        asStaff((tx) =>
          logTime(tx, staffCtx(), { engagementId: engagement.id, minutes, workDate: "2026-09-03" }),
        ),
      ).rejects.toThrow(EngagementError);
    }
  });

  // ---- the month ---------------------------------------------------------

  it("the month is measured from what was logged, against the allotment in force", async () => {
    const engagement = await asOwner((tx) =>
      createEngagement(tx, ownerCtx(), { ...terms(), name: "Meter check" }),
    );
    await asStaff(async (tx) => {
      await logTime(tx, staffCtx(), {
        engagementId: engagement.id,
        minutes: 400,
        workDate: "2026-09-02",
      });
      await logTime(tx, staffCtx(), {
        engagementId: engagement.id,
        minutes: 290,
        workDate: "2026-09-20",
      });
      // Another month entirely — it must not reach September's figure.
      await logTime(tx, staffCtx(), {
        engagementId: engagement.id,
        minutes: 120,
        workDate: "2026-08-11",
      });
    });

    const detail = await asOwner((tx) =>
      getEngagementDetail(tx, tenantId, engagement.id, "2026-09"),
    );
    expect(detail!.thisMonth.usedMinutes).toBe(690);
    expect(detail!.thisMonth.includedMinutes).toBe(600);
    expect(detail!.thisMonth.overageMinutes).toBe(90);
    expect(detail!.thisMonth.overageCents).toBe(18_000);
    expect(detail!.clientName).toBe("Hollis & Co");
    expect(detail!.entries).toHaveLength(3);
    // August is its own month, over its own allotment.
    const august = detail!.months.find((m) => m.month === "2026-08")!;
    expect(august.usedMinutes).toBe(120);
    expect(august.isOver).toBe(false);
  });

  it("the list carries each engagement's month without a query per row", async () => {
    const rows = await asOwner((tx) => listEngagements(tx, tenantId, { month: "2026-09" }));
    const meterCheck = rows.find((r) => r.engagement.name === "Meter check");
    expect(meterCheck!.month.usedMinutes).toBe(690);
    expect(meterCheck!.clientName).toBe("Hollis & Co");
    // Live work first, then by client, then by name.
    expect(rows.every((r) => r.engagement.status !== "ended")).toBe(true);
  });

  it("raising the retainer leaves earlier months at what was agreed then", async () => {
    const engagement = await asOwner((tx) =>
      createEngagement(tx, ownerCtx(), { ...terms(), name: "History check" }),
    );
    await asStaff((tx) =>
      logTime(tx, staffCtx(), {
        engagementId: engagement.id,
        minutes: 700,
        workDate: "2026-07-15",
      }),
    );
    await asOwner((tx) =>
      updateEngagement(tx, ownerCtx(), {
        engagementId: engagement.id,
        expectedVersion: engagement.version,
        patch: { retainerMinutesMonthly: 1200 },
        allotmentMonth: "2026-09",
      }),
    );

    const detail = await asOwner((tx) =>
      getEngagementDetail(tx, tenantId, engagement.id, "2026-09"),
    );
    const july = detail!.months.find((m) => m.month === "2026-07")!;
    expect(july.includedMinutes).toBe(600);
    expect(july.isOver).toBe(true);
    expect(detail!.thisMonth.includedMinutes).toBe(1200);
  });

  it("refuses a stale version rather than overwriting", async () => {
    const engagement = await asOwner((tx) =>
      createEngagement(tx, ownerCtx(), { ...terms(), name: "Version check" }),
    );
    await asOwner((tx) =>
      updateEngagement(tx, ownerCtx(), {
        engagementId: engagement.id,
        expectedVersion: engagement.version,
        patch: { name: "Version check, renamed" },
        allotmentMonth: "2026-09",
      }),
    );
    await expect(
      asOwner((tx) =>
        updateEngagement(tx, ownerCtx(), {
          engagementId: engagement.id,
          expectedVersion: engagement.version,
          patch: { name: "Too late" },
          allotmentMonth: "2026-09",
        }),
      ),
    ).rejects.toThrow(EngagementError);
  });

  it("renaming an engagement renames its cost object", async () => {
    const engagement = await asOwner((tx) =>
      createEngagement(tx, ownerCtx(), { ...terms(), name: "Before" }),
    );
    await asOwner((tx) =>
      updateEngagement(tx, ownerCtx(), {
        engagementId: engagement.id,
        expectedVersion: engagement.version,
        patch: { name: "After" },
        allotmentMonth: "2026-09",
      }),
    );
    const member = await asOwner((tx) =>
      tx.query.dimensionMembers.findFirst({
        where: eq(schema.dimensionMembers.packEntityId, engagement.id),
      }),
    );
    expect(member!.displayName).toBe("Hollis & Co · After");
  });

  // ---- moving it along ---------------------------------------------------

  it("ending archives the cost object, and reopening brings it back", async () => {
    const engagement = await asOwner((tx) =>
      createEngagement(tx, ownerCtx(), { ...terms(), name: "Lifecycle check" }),
    );
    const memberId = async () =>
      (
        await asOwner((tx) =>
          tx.query.dimensionMembers.findFirst({
            where: eq(schema.dimensionMembers.packEntityId, engagement.id),
          }),
        )
      )!;

    await asOwner((tx) =>
      setEngagementStatus(tx, ownerCtx(), {
        engagementId: engagement.id,
        status: "ended",
        today: "2026-09-30",
      }),
    );
    expect((await memberId()).isActive).toBe(false);
    // Nothing new should be tagged to a finished engagement; what already was
    // keeps reporting.
    const ended = await asOwner((tx) =>
      tx.query.psEngagements.findFirst({ where: eq(schema.psEngagements.id, engagement.id) }),
    );
    expect(ended!.endsOn).toBe("2026-09-30");

    await asOwner((tx) =>
      setEngagementStatus(tx, ownerCtx(), {
        engagementId: engagement.id,
        status: "active",
        today: "2026-10-05",
      }),
    );
    expect((await memberId()).isActive).toBe(true);
    const reopened = await asOwner((tx) =>
      tx.query.psEngagements.findFirst({ where: eq(schema.psEngagements.id, engagement.id) }),
    );
    // Live again means it has not ended.
    expect(reopened!.endsOn).toBeNull();
  });

  it("an ended engagement takes no more time until it is reopened", async () => {
    const engagement = await asOwner((tx) =>
      createEngagement(tx, ownerCtx(), { ...terms(), name: "Closed book" }),
    );
    await asOwner((tx) =>
      setEngagementStatus(tx, ownerCtx(), {
        engagementId: engagement.id,
        status: "ended",
        today: "2026-09-30",
      }),
    );
    await expect(
      asStaff((tx) =>
        logTime(tx, staffCtx(), {
          engagementId: engagement.id,
          minutes: 60,
          workDate: "2026-10-01",
        }),
      ),
    ).rejects.toThrow(EngagementError);
  });

  it("refuses a move the engagement cannot make", async () => {
    const engagement = await asOwner((tx) =>
      createEngagement(tx, ownerCtx(), { ...terms(), name: "Transition check" }),
    );
    // active → proposed is not a thing.
    await expect(
      asOwner((tx) =>
        setEngagementStatus(tx, ownerCtx(), {
          engagementId: engagement.id,
          status: "proposed",
          today: "2026-09-30",
        }),
      ),
    ).rejects.toThrow(EngagementError);
  });

  it("refuses an engagement that ends before it starts", async () => {
    await expect(
      asOwner((tx) =>
        createEngagement(tx, ownerCtx(), {
          ...terms(),
          name: "Backwards",
          startsOn: "2026-09-01",
          endsOn: "2026-08-01",
        }),
      ),
    ).rejects.toThrow(EngagementError);
  });

  // ---- fixing a slip -----------------------------------------------------

  it("an entry can be corrected and removed by whoever is standing there", async () => {
    const engagement = await asOwner((tx) =>
      createEngagement(tx, ownerCtx(), { ...terms(), name: "Slip check" }),
    );
    const entry = await asStaff((tx) =>
      logTime(tx, staffCtx(), {
        engagementId: engagement.id,
        minutes: 600,
        workDate: "2026-09-04",
        note: "typo",
      }),
    );
    const fixed = await asStaff((tx) =>
      updateTimeEntry(tx, staffCtx(), {
        entryId: entry.id,
        expectedVersion: entry.version,
        minutes: 60,
        workDate: "2026-09-04",
        note: "One hour",
      }),
    );
    expect(fixed.minutes).toBe(60);
    await asStaff((tx) => deleteTimeEntry(tx, staffCtx(), { entryId: entry.id }));
    const gone = await asOwner((tx) =>
      tx.query.psTimeEntries.findFirst({ where: eq(schema.psTimeEntries.id, entry.id) }),
    );
    expect(gone).toBeUndefined();
  });

  // ---- the identity underneath -------------------------------------------

  it("a client with an engagement cannot be deleted out from under it", async () => {
    // The FK carries NO cascade on purpose: the CRM's merge deletes the losing
    // identity last so a reference it did not re-point fails HERE and rolls the
    // merge back, rather than taking a client's engagements with it.
    const party = await withSystem((tx) => seedParty(tx, tenantId, "Doomed Ltd"));
    await asOwner((tx) =>
      createEngagement(tx, ownerCtx(), {
        partyId: party,
        name: "Anchor",
        kind: "project",
        startsOn: "2026-09-01",
      }),
    );
    await expect(
      withSystem((tx) =>
        tx
          .delete(schema.parties)
          .where(and(eq(schema.parties.tenantId, tenantId), eq(schema.parties.id, party))),
      ),
    ).rejects.toThrow();
  });
});
