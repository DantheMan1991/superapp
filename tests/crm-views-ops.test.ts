import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withTenant, withSystem, schema } from "../src/db";
import { createParty } from "../src/lib/parties";
import { listRecords } from "../src/modules/crm/party-ops";
import {
  createView,
  deleteView,
  listViews,
  pinView,
  pinnedViewId,
  resolveView,
  updateView,
} from "../src/modules/crm/view-ops";
import { DEFAULT_SORT, type FilterCondition } from "../src/modules/crm/core/views";

/**
 * The filter compiler and the view store, against a database.
 *
 * `core/views.ts` decides what a filter MEANS and is tested without one. This
 * file is for the half that cannot be: predicates that either run or do not,
 * a count that has to agree with the page it labels, and the RLS that decides
 * whose views are whose.
 *
 * The compiler tests below are written as "does this filter return the right
 * records" rather than "does it produce the right SQL", because the SQL is not
 * the promise — the rows are.
 */

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;
const STAMP = `crmviews-${process.pid}`;

d("crm saved views (database)", () => {
  let tenantId: string;
  const owner = { role: "owner" as const, userId: "owner-user" };
  const mate = { role: "staff" as const, userId: "other-user" };

  beforeAll(async () => {
    tenantId = await withSystem(async (tx) => {
      const [row] = await tx
        .insert(schema.tenants)
        .values([{ clerkOrgId: STAMP, name: "Views Test", slug: STAMP }])
        .returning();
      return row.id;
    });

    await withTenant(
      tenantId,
      async (tx) => {
        const acme = await createParty(tx, tenantId, {
          kind: "organization",
          displayName: "Acme Holdings",
        });
        const bob = await createParty(tx, tenantId, {
          kind: "person",
          displayName: "Bob Smith",
        });
        await createParty(tx, tenantId, {
          kind: "organization",
          displayName: "Zenith Ltd",
        });
        await tx.insert(schema.crmPartyDetails).values([
          {
            tenantId,
            partyId: acme.id,
            lifecycleStage: "customer",
            ownerClerkUserId: "owner-user",
          },
          { tenantId, partyId: bob.id, lifecycleStage: "lead" },
        ]);
      },
      owner,
    );
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
    });
  });

  async function run(conditions: FilterCondition[]): Promise<string[]> {
    const page = await withTenant(
      tenantId,
      (tx) => listRecords(tx, tenantId, { conditions }),
      owner,
    );
    return page.rows.map((r) => r.party.displayName).sort();
  }

  describe("the compiler", () => {
    it("filters on a party column", async () => {
      expect(
        await run([{ field: "kind", operator: "equals", value: "person" }]),
      ).toEqual(["Bob Smith"]);
    });

    it("filters on a details column, which excludes unworked records", async () => {
      // Inherent to the LEFT JOIN rather than a bug: "Zenith Ltd" has no
      // details row, so it has no stage to compare.
      expect(
        await run([{ field: "stage", operator: "equals", value: "customer" }]),
      ).toEqual(["Acme Holdings"]);
    });

    it("KEEPS THE UNKNOWNS on a negative operator", async () => {
      // `<>` is NULL for a NULL column, so a plain `ne` would silently drop
      // every record CRM has never been asked about — which reads as data loss
      // rather than as a filter.
      expect(
        await run([{ field: "stage", operator: "not_equals", value: "customer" }]),
      ).toEqual(["Bob Smith", "Zenith Ltd"]);
    });

    it("matches case-insensitively and escapes LIKE's own wildcards", async () => {
      expect(
        await run([{ field: "name", operator: "contains", value: "acme" }]),
      ).toEqual(["Acme Holdings"]);
      // `%` is a literal here, not "match anything" — if it were interpolated
      // this would return every record.
      expect(
        await run([{ field: "name", operator: "contains", value: "%" }]),
      ).toEqual([]);
    });

    it("starts_with anchors at the beginning", async () => {
      expect(
        await run([{ field: "name", operator: "starts_with", value: "A" }]),
      ).toEqual(["Acme Holdings"]);
      expect(
        await run([{ field: "name", operator: "starts_with", value: "cme" }]),
      ).toEqual([]);
    });

    it("resolves a relative date", async () => {
      expect(
        await run([
          { field: "created", operator: "greater_or_equal", value: "last_7_days" },
        ]),
      ).toEqual(["Acme Holdings", "Bob Smith", "Zenith Ltd"]);
      expect(
        await run([
          { field: "created", operator: "less_than", value: "last_7_days" },
        ]),
      ).toEqual([]);
    });

    it("ANDs several conditions", async () => {
      expect(
        await run([
          { field: "kind", operator: "equals", value: "organization" },
          { field: "name", operator: "contains", value: "acme" },
        ]),
      ).toEqual(["Acme Holdings"]);
    });

    it("DROPS a condition naming a field that does not exist", async () => {
      // Widening, never narrowing — and safe only because RLS, not this filter,
      // decides which rows the caller may see.
      expect(
        await run([
          { field: "definitely_not_a_column", operator: "equals", value: "x" } as FilterCondition,
        ]),
      ).toEqual(["Acme Holdings", "Bob Smith", "Zenith Ltd"]);
    });
  });

  describe("paging", () => {
    it("counts every match, not just the page", async () => {
      const page = await withTenant(
        tenantId,
        (tx) => listRecords(tx, tenantId, { pageSize: 2, page: 1 }),
        owner,
      );
      expect(page.rows).toHaveLength(2);
      expect(page.total).toBe(3);
    });

    it("the count agrees with a filtered page", async () => {
      // The count query carries the same predicate and the same details join;
      // one that did not would label the page with a number it contradicts.
      const page = await withTenant(
        tenantId,
        (tx) =>
          listRecords(tx, tenantId, {
            conditions: [{ field: "stage", operator: "equals", value: "customer" }],
          }),
        owner,
      );
      expect(page.total).toBe(1);
      expect(page.rows).toHaveLength(1);
    });

    it("page 2 continues rather than repeating", async () => {
      const [first, second] = await Promise.all([
        withTenant(tenantId, (tx) => listRecords(tx, tenantId, { pageSize: 2, page: 1 }), owner),
        withTenant(tenantId, (tx) => listRecords(tx, tenantId, { pageSize: 2, page: 2 }), owner),
      ]);
      expect(second.rows).toHaveLength(1);
      const names = new Set(first.rows.map((r) => r.party.displayName));
      expect(names.has(second.rows[0].party.displayName)).toBe(false);
    });
  });

  describe("stored views", () => {
    it("lists the built-ins even with nothing saved", async () => {
      const views = await withTenant(
        tenantId,
        (tx) => listViews(tx, tenantId, owner.userId),
        owner,
      );
      expect(views.filter((v) => v.isBuiltIn).map((v) => v.id)).toContain(
        "builtin:all",
      );
    });

    it("A PRIVATE VIEW IS INVISIBLE TO A COLLEAGUE; a shared one is not", async () => {
      await withTenant(
        tenantId,
        async (tx) => {
          await createView(tx, tenantId, owner.userId, {
            name: "My private view",
            conditions: [{ field: "kind", operator: "equals", value: "person" }],
            sort: DEFAULT_SORT,
            isShared: false,
          });
          await createView(tx, tenantId, owner.userId, {
            name: "Team view",
            conditions: [],
            sort: DEFAULT_SORT,
            isShared: true,
          });
        },
        owner,
      );

      const theirs = await withTenant(
        tenantId,
        (tx) => listViews(tx, tenantId, mate.userId),
        mate,
      );
      const names = theirs.filter((v) => !v.isBuiltIn).map((v) => v.name);
      expect(names).toEqual(["Team view"]);
    });

    it("a colleague cannot edit a view they can see", async () => {
      const shared = await withTenant(
        tenantId,
        (tx) => listViews(tx, tenantId, mate.userId),
        mate,
      );
      const teamView = shared.find((v) => v.name === "Team view")!;
      await expect(
        withTenant(
          tenantId,
          (tx) => updateView(tx, tenantId, teamView.id, { name: "Hijacked" }),
          mate,
        ),
      ).rejects.toThrow();
    });

    it("BUT A TENANT OWNER MAY DELETE ONE, so a leaver's views are not permanent", async () => {
      const views = await withTenant(
        tenantId,
        (tx) => listViews(tx, tenantId, owner.userId),
        owner,
      );
      const teamView = views.find((v) => v.name === "Team view")!;
      // Deleted by somebody who is a tenant owner but NOT the view's author.
      await withTenant(
        tenantId,
        (tx) => deleteView(tx, tenantId, teamView.id),
        { role: "owner", userId: "a-different-owner" },
      );
      const after = await withTenant(
        tenantId,
        (tx) => listViews(tx, tenantId, owner.userId),
        owner,
      );
      expect(after.map((v) => v.name)).not.toContain("Team view");
    });

    it("refuses a second view with the same name for one person", async () => {
      await expect(
        withTenant(
          tenantId,
          (tx) =>
            createView(tx, tenantId, owner.userId, {
              name: "My private view",
              conditions: [],
              sort: DEFAULT_SORT,
              isShared: false,
            }),
          owner,
        ),
      ).rejects.toThrow();
    });
  });

  describe("pins", () => {
    it("remembers a person's view and falls back when it stops resolving", async () => {
      await withTenant(
        tenantId,
        (tx) => pinView(tx, tenantId, owner.userId, "builtin:companies"),
        owner,
      );
      expect(
        await withTenant(tenantId, (tx) => pinnedViewId(tx, tenantId, owner.userId), owner),
      ).toBe("builtin:companies");

      // A pin naming something that no longer resolves — a deleted view, a
      // retired built-in — must not produce a broken page.
      await withTenant(
        tenantId,
        (tx) => pinView(tx, tenantId, owner.userId, "builtin:retired-long-ago"),
        owner,
      );
      const resolved = await withTenant(
        tenantId,
        (tx) => resolveView(tx, tenantId, owner.userId, "builtin:retired-long-ago"),
        owner,
      );
      expect(resolved.id).toBe("builtin:all");
    });

    it("one person's pin does not move anybody else's", async () => {
      expect(
        await withTenant(tenantId, (tx) => pinnedViewId(tx, tenantId, mate.userId), mate),
      ).toBeNull();
    });
  });
});
