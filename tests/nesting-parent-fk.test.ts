import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { withSystem, schema } from "../src/db";

/**
 * The composite self-FK on `schedule_items` and `work_items`, exercised.
 *
 * WHAT THIS GUARDS. Both tables nest through `(tenant_id, parent_id)` and both
 * declare `ON DELETE SET NULL`. Postgres's *bare* SET NULL nulls EVERY
 * referencing column, `tenant_id` included, and `tenant_id` is NOT NULL — so
 * for a year the declared behaviour was impossible and deleting a parent that
 * still had a child raised *"null value in column tenant_id … violates
 * not-null constraint"* instead. `drizzle/0192` rewrites both constraints by
 * hand as PG 15's column-list form, `ON DELETE SET NULL (parent_id)`.
 *
 * IT HAS TO BE A TEST RATHER THAN A COMMENT because the fix lives in SQL that
 * Drizzle cannot express: `.onDelete()` takes an action, not a column list, so
 * the schema files still say plain `set null` and nothing in `tsc`, lint or
 * `db:generate` can tell the two apart. A regenerated migration, a
 * `drizzle-kit pull`, or somebody "tidying" the constraint would put the bug
 * back silently. This is the only thing that would notice.
 *
 * `withSystem` and raw deletes on purpose: no module deletes an item today
 * (scheduling cancels, work archives), so there is no app path to drive. The
 * subject here is the constraint, not a caller.
 */
const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;

d("nesting parent FK", () => {
  const STAMP = `parent-fk-${process.pid}`;
  let tenantId: string;

  beforeAll(async () => {
    await withSystem(async (tx) => {
      const [tenant] = await tx
        .insert(schema.tenants)
        .values({ clerkOrgId: STAMP, name: "Parent FK", slug: STAMP })
        .returning();
      tenantId = tenant.id;
    });
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
    });
  });

  it("names only parent_id, on both tables", async () => {
    const defs = await withSystem(async (tx) =>
      tx.execute(sql`
        select conrelid::regclass::text as tbl, pg_get_constraintdef(oid) as def
          from pg_constraint
         where conname in ('schedule_items_parent_fk', 'work_items_parent_fk')
         order by 1
      `),
    );
    const rows = defs.rows as { tbl: string; def: string }[];
    expect(rows.map((r) => r.tbl)).toEqual(["schedule_items", "work_items"]);
    for (const row of rows) {
      // The `(parent_id)` is the whole fix. Bare `SET NULL` would also match a
      // looser assertion, so match the column list itself.
      expect(row.def).toContain("ON DELETE SET NULL (parent_id)");
    }
  });

  it("unparents a schedule item instead of failing on tenant_id", async () => {
    const child = await withSystem(async (tx) => {
      const [calendar] = await tx
        .insert(schema.scheduleCalendars)
        .values({ tenantId, name: "Nesting", ownerClerkUserId: `${STAMP}-owner` })
        .returning();
      const starts = new Date("2026-09-01T14:00:00Z");
      const ends = new Date("2026-09-01T15:00:00Z");
      const [parent] = await tx
        .insert(schema.scheduleItems)
        .values({
          tenantId,
          calendarId: calendar.id,
          title: "Month-end close",
          startsAt: starts,
          endsAt: ends,
          timeZone: "UTC",
        })
        .returning();
      const [step] = await tx
        .insert(schema.scheduleItems)
        .values({
          tenantId,
          calendarId: calendar.id,
          title: "Reconcile the bank",
          startsAt: starts,
          endsAt: ends,
          timeZone: "UTC",
          parentId: parent.id,
        })
        .returning();

      await tx
        .delete(schema.scheduleItems)
        .where(eq(schema.scheduleItems.id, parent.id));

      const [after] = await tx
        .select()
        .from(schema.scheduleItems)
        .where(eq(schema.scheduleItems.id, step.id));
      return after;
    });

    expect(child).toBeDefined();
    expect(child.parentId).toBeNull();
    expect(child.tenantId).toBe(tenantId);
  });

  /**
   * The cross-list case, which is also why this is SET NULL and not CASCADE:
   * nothing makes a child sit on the same list as its parent, so CASCADE would
   * reach sideways and delete a live item out of a list nobody touched.
   */
  it("unparents a work item without touching the list it lives on", async () => {
    const child = await withSystem(async (tx) => {
      const [listA] = await tx
        .insert(schema.workLists)
        .values({ tenantId, name: "Jobs" })
        .returning();
      const [listB] = await tx
        .insert(schema.workLists)
        .values({ tenantId, name: "Snags" })
        .returning();
      const [parent] = await tx
        .insert(schema.workItems)
        .values({ tenantId, listId: listA.id, title: "Rewire the barn" })
        .returning();
      const [step] = await tx
        .insert(schema.workItems)
        .values({
          tenantId,
          listId: listB.id,
          title: "Chase the sparky",
          parentId: parent.id,
        })
        .returning();

      await tx.delete(schema.workItems).where(eq(schema.workItems.id, parent.id));

      const [after] = await tx
        .select()
        .from(schema.workItems)
        .where(eq(schema.workItems.id, step.id));
      return { after, listB: listB.id };
    });

    expect(child.after).toBeDefined();
    expect(child.after.parentId).toBeNull();
    expect(child.after.tenantId).toBe(tenantId);
    expect(child.after.listId).toBe(child.listB);
  });
});
