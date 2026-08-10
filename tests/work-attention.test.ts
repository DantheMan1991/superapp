import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withSystem, withTenant, schema, type Tx } from "../src/db";
import { workAttentionSource } from "../src/modules/work/attention/source";
import { ensureDefaultWorkList } from "../src/lib/work/provision";

/**
 * What Work contributes to the morning digest.
 *
 * Run as a PERSON through real RLS, because the whole claim of this feature is
 * "each person sees their own work" — and notifications.md records that the
 * digest once shipped into a product where nothing set an assignee, so every
 * staff member's digest was empty by construction and no test could have caught
 * it. These are the tests that could have.
 */
const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;

d("work attention source", () => {
  const STAMP = `att-work-${process.pid}`;
  const OWNER = `${STAMP}-owner`;
  const MATE = `${STAMP}-mate`;
  const TODAY = "2026-09-15";

  let tenantId: string;
  let listId: string;

  const asOwner = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantId, fn, { role: "owner", userId: OWNER });
  const asMate = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantId, fn, { role: "staff", userId: MATE });

  /** Collect for one person on one local day, the way the digest does. */
  function collectFor(who: "owner" | "mate", today = TODAY) {
    const run = who === "owner" ? asOwner : asMate;
    const ctx =
      who === "owner"
        ? { tenantId, userId: OWNER, role: "owner" as const }
        : { tenantId, userId: MATE, role: "staff" as const };
    return run((tx) => workAttentionSource.collect(tx, { ...ctx, today }));
  }

  /** A work item, straight into the table — this certifies the SOURCE. */
  async function seed(values: {
    title: string;
    dueOn?: string | null;
    startsOn?: string | null;
    assignee?: string | null;
    state?: string;
    closed?: boolean;
  }): Promise<string> {
    return withSystem(async (tx) => {
      const [row] = await tx
        .insert(schema.workItems)
        .values({
          tenantId,
          listId,
          title: values.title,
          dueOn: values.dueOn ?? null,
          startsOn: values.startsOn ?? null,
          assigneeClerkUserId: values.assignee ?? null,
          state: values.state ?? "todo",
          closedAt: values.closed ? new Date() : null,
          closedByClerkUserId: values.closed ? OWNER : null,
        })
        .returning();
      return row.id;
    });
  }

  beforeAll(async () => {
    await withSystem(async (tx) => {
      const [tenant] = await tx
        .insert(schema.tenants)
        .values({
          clerkOrgId: STAMP,
          name: "Work attention",
          slug: STAMP,
          timezone: "America/New_York",
        })
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
      await ensureDefaultWorkList(tx, tenantId);
      const [list] = await tx
        .select({ id: schema.workLists.id })
        .from(schema.workLists)
        .where(eq(schema.workLists.tenantId, tenantId));
      listId = list.id;
    });
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
      await tx
        .delete(schema.profiles)
        .where(eq(schema.profiles.clerkUserId, OWNER));
      await tx
        .delete(schema.profiles)
        .where(eq(schema.profiles.clerkUserId, MATE));
    });
  });

  it("tells each person about their own work and nobody else's", async () => {
    const mine = await seed({ title: "Mate's job", dueOn: TODAY, assignee: MATE });
    await seed({ title: "Owner's job", dueOn: TODAY, assignee: OWNER });

    const mateItems = await collectFor("mate");
    expect(mateItems.map((i) => i.key)).toEqual([`work_item:${mine}`]);
    expect(mateItems[0].title).toBe("Mate's job");
    expect(mateItems[0].urgency).toBe("today");
    expect(mateItems[0].unassigned).toBe(false);
  });

  it("deep-links to the item itself, which slice 3's sheet made addressable", async () => {
    const id = await seed({ title: "Linkable", dueOn: TODAY, assignee: MATE });
    const items = await collectFor("mate");
    const item = items.find((i) => i.key === `work_item:${id}`);
    expect(item?.href).toBe(`/dashboard/m/work?item=${id}`);
  });

  it("rolls unassigned work up to an owner, flagged as nobody's", async () => {
    const id = await seed({ title: "Nobody has this", dueOn: TODAY });

    const ownerItems = await collectFor("owner");
    const rolled = ownerItems.find((i) => i.key === `work_item:${id}`);
    expect(rolled?.unassigned).toBe(true);

    // Staff are NOT given work nobody asked them to pick up.
    const mateItems = await collectFor("mate");
    expect(mateItems.map((i) => i.key)).not.toContain(`work_item:${id}`);
  });

  it("says nothing about work that is finished with", async () => {
    const done = await seed({
      title: "Already done",
      dueOn: TODAY,
      assignee: MATE,
      state: "done",
      closed: true,
    });
    const cancelled = await seed({
      title: "Called off",
      dueOn: TODAY,
      assignee: MATE,
      state: "cancelled",
      closed: true,
    });
    const keys = (await collectFor("mate")).map((i) => i.key);
    expect(keys).not.toContain(`work_item:${done}`);
    expect(keys).not.toContain(`work_item:${cancelled}`);
  });

  it("holds back work that has not started", async () => {
    const deferred = await seed({
      title: "Not until Monday",
      dueOn: "2026-09-18",
      startsOn: "2026-09-17",
      assignee: MATE,
    });
    expect((await collectFor("mate")).map((i) => i.key)).not.toContain(
      `work_item:${deferred}`,
    );
    // …and produces it once the start date arrives.
    expect((await collectFor("mate", "2026-09-17")).map((i) => i.key)).toContain(
      `work_item:${deferred}`,
    );
  });

  it("does not chase work nobody put a date on", async () => {
    const undated = await seed({ title: "Someday", assignee: MATE });
    expect((await collectFor("mate")).map((i) => i.key)).not.toContain(
      `work_item:${undated}`,
    );
  });

  it("stops at the seven-day horizon the page also uses", async () => {
    const inside = await seed({
      title: "Next week",
      dueOn: "2026-09-22",
      assignee: MATE,
    });
    const outside = await seed({
      title: "Later",
      dueOn: "2026-09-23",
      assignee: MATE,
    });
    const keys = (await collectFor("mate")).map((i) => i.key);
    expect(keys).toContain(`work_item:${inside}`);
    expect(keys).not.toContain(`work_item:${outside}`);
  });

  it("still reports BLOCKED work, and says that it is blocked", async () => {
    // The decision: excluding it would let anybody silence a late item by
    // setting a state, and a digest that can be switched off per row is one
    // nobody can trust.
    const id = await seed({
      title: "Waiting on parts",
      dueOn: "2026-09-10",
      assignee: MATE,
      state: "blocked",
    });
    const item = (await collectFor("mate")).find(
      (i) => i.key === `work_item:${id}`,
    );
    expect(item).toBeDefined();
    expect(item?.urgency).toBe("overdue");
    expect(item?.detail).toContain("Blocked");
    expect(item?.detail).toContain("5 days overdue");
  });

  it("says nothing at all on a quiet day", async () => {
    // "Nothing needs you" and "we could not ask Work" must never render the
    // same way — this is the half that has to be empty rather than throwing.
    const items = await collectFor("mate", "2020-01-01");
    expect(items).toEqual([]);
  });
});
