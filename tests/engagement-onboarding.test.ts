import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withSystem, withTenant, schema, type Tx } from "../src/db";
import {
  ENGAGEMENT_ENTITY,
  previewOnboarding,
  startOnboarding,
} from "../src/packs/professional-services/onboarding-ops";
import {
  createEngagement,
  EngagementError,
  setEngagementStatus,
  type EngagementCtx,
} from "../src/packs/professional-services/ops";
import { setWorkComplete } from "../src/lib/work/entity-work";
import { seedParty } from "./isolation/_shared";

/**
 * Onboarding as a Work list (back-office slice 7c).
 *
 * The claim: the steps a profile names become ORDINARY work items linked to
 * the engagement, raised additively with no table of this pack's own — so the
 * button is idempotent, a step added to the profile later arrives on the next
 * press, and every item behaves like any other piece of work.
 *
 * The tenant is given `industry: "agency"` so `packContext` reads the real
 * profile's list rather than a fixture: what is certified here is the shipped
 * configuration, not a shape invented for the test.
 */

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;

d("engagement onboarding", () => {
  const STAMP = `engonb-${process.pid}`;
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

  const agree = (name: string, kind = "retainer", startsOn = "2026-09-01") =>
    asOwner((tx) =>
      createEngagement(tx, ownerCtx(), {
        partyId: clientId,
        name,
        kind,
        startsOn,
        retainerMinutesMonthly: 600,
      }),
    );

  beforeAll(async () => {
    await withSystem(async (tx) => {
      const [tenant] = await tx
        .insert(schema.tenants)
        .values({
          clerkOrgId: `${STAMP}-org`,
          name: "Onboarding Ops",
          slug: `${STAMP}-slug`,
          // The real agency profile is what supplies the list.
          industry: "agency",
        })
        .returning({ id: schema.tenants.id });
      tenantId = tenant.id;
      clientId = await seedParty(tx, tenantId, "Hollis & Co");
    });
  });

  afterAll(async () => {
    await withSystem((tx) => tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId)));
  });

  it("offers the profile's steps before anything is raised", async () => {
    const engagement = await agree("Preview check");
    const preview = await asOwner((tx) =>
      previewOnboarding(tx, tenantId, "agency", engagement),
    );
    expect(preview.noListConfigured).toBe(false);
    expect(preview.work).toHaveLength(0);
    expect(preview.missing.map((s) => s.title)).toContain("Signed agreement on file");
    expect(preview.missing.length).toBeGreaterThan(1);
  });

  it("raises them as ordinary work items linked to the engagement", async () => {
    const engagement = await agree("Raise check");
    const { raised } = await asOwner((tx) =>
      startOnboarding(tx, ownerCtx(), { engagementId: engagement.id, today: "2026-09-10" }),
    );
    expect(raised.length).toBeGreaterThan(1);

    const [items, links] = await asOwner((tx) =>
      Promise.all([
        tx.select().from(schema.workItems).where(eq(schema.workItems.tenantId, tenantId)),
        tx
          .select()
          .from(schema.workItemLinks)
          .where(eq(schema.workItemLinks.entityId, engagement.id)),
      ]),
    );
    // The items live in Work's own table — no checklist table of this pack's.
    expect(items.length).toBeGreaterThanOrEqual(raised.length);
    expect(links).toHaveLength(raised.length);
    for (const link of links) {
      expect(link.extensionSlug).toBe("professional-services");
      expect(link.entityType).toBe(ENGAGEMENT_ENTITY);
    }
  });

  it("dates a step from the later of the start and today, so a late start is not born overdue", async () => {
    // Starts in the past; raised today. "Kickoff call booked" is dueInDays 3.
    const late = await agree("Late start", "retainer", "2026-01-01");
    await asOwner((tx) =>
      startOnboarding(tx, ownerCtx(), { engagementId: late.id, today: "2026-09-10" }),
    );
    const kickoff = await asOwner((tx) =>
      tx.query.workItems.findFirst({
        where: eq(schema.workItems.title, "Kickoff call booked"),
        columns: { dueOn: true },
      }),
    );
    expect(kickoff?.dueOn).toBe("2026-09-13");

    // Starts in the future; the list schedules from the start instead.
    const future = await agree("Future start", "project", "2026-12-01");
    await asOwner((tx) =>
      startOnboarding(tx, ownerCtx(), { engagementId: future.id, today: "2026-09-10" }),
    );
    const futureLinks = await asOwner((tx) =>
      tx
        .select({ itemId: schema.workItemLinks.itemId })
        .from(schema.workItemLinks)
        .where(eq(schema.workItemLinks.entityId, future.id)),
    );
    const futureItems = await asOwner((tx) =>
      tx.select().from(schema.workItems).where(eq(schema.workItems.tenantId, tenantId)),
    );
    const ids = new Set(futureLinks.map((l) => l.itemId));
    const futureKickoff = futureItems.find(
      (i) => ids.has(i.id) && i.title === "Kickoff call booked",
    );
    expect(futureKickoff?.dueOn).toBe("2026-12-04");
  });

  it("is idempotent — a second press raises nothing", async () => {
    const engagement = await agree("Twice check");
    const first = await asOwner((tx) =>
      startOnboarding(tx, ownerCtx(), { engagementId: engagement.id, today: "2026-09-10" }),
    );
    expect(first.raised.length).toBeGreaterThan(0);
    const second = await asOwner((tx) =>
      startOnboarding(tx, ownerCtx(), { engagementId: engagement.id, today: "2026-09-10" }),
    );
    expect(second.raised).toHaveLength(0);
  });

  it("a step already TICKED OFF is not raised again", async () => {
    // Matching on title rather than on open items is what makes this true: a
    // finished step must not come back the next time somebody presses it.
    const engagement = await agree("Done check");
    await asOwner((tx) =>
      startOnboarding(tx, ownerCtx(), { engagementId: engagement.id, today: "2026-09-10" }),
    );
    const links = await asOwner((tx) =>
      tx
        .select({ itemId: schema.workItemLinks.itemId })
        .from(schema.workItemLinks)
        .where(eq(schema.workItemLinks.entityId, engagement.id)),
    );
    await asOwner((tx) =>
      setWorkComplete(tx, { tenantId, userId: OWNER }, links[0].itemId, true),
    );
    const again = await asOwner((tx) =>
      startOnboarding(tx, ownerCtx(), { engagementId: engagement.id, today: "2026-09-10" }),
    );
    expect(again.raised).toHaveLength(0);
  });

  it("only offers a list that applies to the engagement's kind", async () => {
    // The agency profile's list is for `retainer` and `project`, not `hourly`.
    const adHoc = await agree("Ad hoc advice", "hourly");
    const preview = await asOwner((tx) => previewOnboarding(tx, tenantId, "agency", adHoc));
    expect(preview.missing).toHaveLength(0);
    // The list exists, it simply does not apply — the panel says so rather
    // than pretending the business has no onboarding at all.
    expect(preview.noListConfigured).toBe(false);
  });

  it("offers nothing when the tenant has no profile", async () => {
    const engagement = await agree("No profile");
    const preview = await asOwner((tx) => previewOnboarding(tx, tenantId, "general", engagement));
    expect(preview.noListConfigured).toBe(true);
    expect(preview.missing).toHaveLength(0);
  });

  it("staff cannot raise it — it puts work on other people's lists", async () => {
    const engagement = await agree("Role check");
    await expect(
      asStaff((tx) =>
        startOnboarding(tx, staffCtx(), { engagementId: engagement.id, today: "2026-09-10" }),
      ),
    ).rejects.toThrow(EngagementError);
  });

  it("an ended engagement raises nothing", async () => {
    const engagement = await agree("Ended check");
    await asOwner((tx) =>
      setEngagementStatus(tx, ownerCtx(), {
        engagementId: engagement.id,
        status: "ended",
        today: "2026-09-10",
      }),
    );
    await expect(
      asOwner((tx) =>
        startOnboarding(tx, ownerCtx(), { engagementId: engagement.id, today: "2026-09-10" }),
      ),
    ).rejects.toThrow(EngagementError);
  });
});
