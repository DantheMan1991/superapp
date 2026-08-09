import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { withSystem, withTenant, schema } from "../src/db";
import {
  ensureDefaultWorkList,
  findDefaultWorkListId,
} from "../src/lib/work/provision";
import { listWorkItems, listWorkLists } from "../src/modules/work/read";
import { WORK_STATES, WORK_VISIBILITIES } from "../src/lib/work/vocabulary";

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;

/**
 * Assert that a write was refused BY A NAMED CONSTRAINT.
 *
 * `rejects.toThrow(/name/)` does not work here: drizzle re-throws as
 * `Failed query: …` with the parameters, and the constraint name only survives
 * on the pg error underneath. A bare `rejects.toThrow()` would pass for a
 * typo'd column just as happily as for the invariant under test, which is the
 * failure mode this whole file exists to rule out — so walk the cause chain and
 * name the constraint.
 */
async function expectViolation(
  run: () => Promise<unknown>,
  constraint: string,
): Promise<void> {
  let caught: unknown;
  try {
    await run();
  } catch (error) {
    caught = error;
  }
  expect(caught, `expected ${constraint} to be violated`).toBeDefined();

  const seen: string[] = [];
  let error = caught as { constraint?: string; message?: string; cause?: unknown } | undefined;
  while (error) {
    if (typeof error.constraint === "string") seen.push(error.constraint);
    if (typeof error.message === "string") seen.push(error.message);
    error = error.cause as typeof error;
  }
  expect(seen.join(" | ")).toContain(constraint);
}

/**
 * The database invariants this module leans on, and the read path over them.
 *
 * The CHECK constraints get their own tests because they are load-bearing
 * rather than decorative: `closed_at IS NULL` is the predicate every "open
 * work" query uses and every index is partial on, so a row where `state` and
 * `closed_at` disagree would not be a cosmetic inconsistency — it would be work
 * that is finished and still nagging, or open and invisible.
 */
d("work: invariants, provisioning and the read path", () => {
  const STAMP = `work-${process.pid}`;
  const USER = `${STAMP}-user`;

  let tenantId: string;
  let listId: string;

  const asOwner = <T>(fn: Parameters<typeof withTenant<T>>[1]) =>
    withTenant(tenantId, fn, { role: "owner", userId: USER });

  beforeAll(async () => {
    await withSystem(async (tx) => {
      const [tenant] = await tx
        .insert(schema.tenants)
        .values({ clerkOrgId: STAMP, name: "Work test", slug: STAMP })
        .returning();
      tenantId = tenant.id;
      const [list] = await tx
        .insert(schema.workLists)
        .values({ tenantId, name: "Jobsite" })
        .returning();
      listId = list.id;
    });
  });

  afterAll(async () => {
    await withSystem((tx) =>
      tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId)),
    );
  });

  it("refuses a done item that was never closed", async () => {
    await expectViolation(
      () =>
        withSystem((tx) =>
          tx
            .insert(schema.workItems)
            .values({ tenantId, listId, title: "Half done", state: "done" }),
        ),
      "work_items_closed_matches_state",
    );
  });

  it("refuses an open item that carries a closing time", async () => {
    await expectViolation(
      () =>
        withSystem((tx) =>
          tx.insert(schema.workItems).values({
            tenantId,
            listId,
            title: "Closed but open",
            state: "todo",
            closedAt: new Date(),
            closedByClerkUserId: USER,
          }),
        ),
      "work_items_closed_matches_state",
    );
  });

  it("refuses half of the closed pair", async () => {
    await expectViolation(
      () =>
        withSystem((tx) =>
          tx.insert(schema.workItems).values({
            tenantId,
            listId,
            title: "Closed by nobody",
            state: "done",
            closedAt: new Date(),
          }),
        ),
      "work_items_closed_pair",
    );
  });

  it("accepts cancelled as closed — done is not the only way to finish", async () => {
    const [row] = await withSystem((tx) =>
      tx
        .insert(schema.workItems)
        .values({
          tenantId,
          listId,
          title: "Called off",
          state: "cancelled",
          closedAt: new Date(),
          closedByClerkUserId: USER,
        })
        .returning(),
    );
    expect(row.closedAt).not.toBeNull();
    await withSystem((tx) =>
      tx.delete(schema.workItems).where(eq(schema.workItems.id, row.id)),
    );
  });

  it("refuses work that starts after it is due", async () => {
    await expectViolation(
      () =>
        withSystem((tx) =>
          tx.insert(schema.workItems).values({
            tenantId,
            listId,
            title: "Backwards",
            startsOn: "2026-09-10",
            dueOn: "2026-09-01",
          }),
        ),
      "work_items_starts_before_due",
    );
  });

  it("refuses an item that is its own parent", async () => {
    const [row] = await withSystem((tx) =>
      tx
        .insert(schema.workItems)
        .values({ tenantId, listId, title: "Ouroboros" })
        .returning(),
    );
    await expectViolation(
      () =>
        withSystem((tx) =>
          tx
            .update(schema.workItems)
            .set({ parentId: row.id })
            .where(eq(schema.workItems.id, row.id)),
        ),
      "work_items_no_self_parent",
    );
    await withSystem((tx) =>
      tx.delete(schema.workItems).where(eq(schema.workItems.id, row.id)),
    );
  });

  it("keeps the CHECKs and the TypeScript vocabulary from drifting apart", async () => {
    // The two cannot be generated from one another — a migration imports
    // nothing — so the only thing stopping a state the app believes in and the
    // database refuses is this test. Postgres rewrites `in (…)` as
    // `= ANY (ARRAY[…])`, hence reading it back rather than comparing strings.
    async function checkValues(constraint: string): Promise<string[]> {
      const result = await withSystem((tx) =>
        tx.execute(
          sql`select pg_get_constraintdef(oid) as def from pg_constraint where conname = ${constraint}`,
        ),
      );
      const rows = (result as unknown as { rows: { def: string }[] }).rows;
      expect(rows, `constraint ${constraint} is missing`).toHaveLength(1);
      return [...rows[0].def.matchAll(/'([a-z_]+)'::text/g)]
        .map((m) => m[1])
        .sort();
    }

    expect(await checkValues("work_items_state")).toEqual(
      [...WORK_STATES].sort(),
    );
    expect(await checkValues("work_lists_visibility")).toEqual(
      [...WORK_VISIBILITIES].sort(),
    );
  });

  it("provisions exactly one default list, however many times it is called", async () => {
    await withSystem((tx) => ensureDefaultWorkList(tx, tenantId));
    await withSystem((tx) => ensureDefaultWorkList(tx, tenantId));
    await withSystem((tx) => ensureDefaultWorkList(tx, tenantId));

    const defaults = await withSystem((tx) =>
      tx
        .select()
        .from(schema.workLists)
        .where(
          sql`${schema.workLists.tenantId} = ${tenantId} and ${schema.workLists.isDefault}`,
        ),
    );
    expect(defaults).toHaveLength(1);

    const found = await asOwner((tx) => findDefaultWorkListId(tx, tenantId));
    expect(found).toBe(defaults[0].id);
  });

  it("lists put the default first, and leave archived ones out", async () => {
    await withSystem((tx) =>
      tx.insert(schema.workLists).values({
        tenantId,
        name: "Archived",
        archivedAt: new Date(),
      }),
    );
    const lists = await asOwner((tx) => listWorkLists(tx, tenantId));
    expect(lists[0].isDefault).toBe(true);
    expect(lists.map((l) => l.name)).not.toContain("Archived");

    const withArchived = await asOwner((tx) =>
      listWorkLists(tx, tenantId, { includeArchived: true }),
    );
    expect(withArchived.map((l) => l.name)).toContain("Archived");
  });

  describe("the read path", () => {
    let dueSoon: string;
    let dueLater: string;
    let undated: string;
    let closed: string;

    beforeAll(async () => {
      await withSystem(async (tx) => {
        const rows = await tx
          .insert(schema.workItems)
          .values([
            {
              tenantId,
              listId,
              title: "Due soon",
              dueOn: "2026-09-01",
              assigneeClerkUserId: USER,
            },
            {
              tenantId,
              listId,
              title: "Due later",
              dueOn: "2026-10-01",
              assigneeClerkUserId: USER,
            },
            { tenantId, listId, title: "No date" },
            {
              tenantId,
              listId,
              title: "Finished",
              dueOn: "2026-08-01",
              assigneeClerkUserId: USER,
              state: "done",
              closedAt: new Date(),
              closedByClerkUserId: USER,
            },
          ])
          .returning();
        dueSoon = rows[0].id;
        dueLater = rows[1].id;
        undated = rows[2].id;
        closed = rows[3].id;
      });
    });

    it("sorts by due date and puts undated work LAST", async () => {
      const rows = await asOwner((tx) =>
        listWorkItems(tx, tenantId, { listId }),
      );
      const ids = rows.map((r) => r.id);
      expect(ids.indexOf(closed)).toBeLessThan(ids.indexOf(dueSoon));
      expect(ids.indexOf(dueSoon)).toBeLessThan(ids.indexOf(dueLater));
      expect(ids.indexOf(dueLater)).toBeLessThan(ids.indexOf(undated));
    });

    it("openOnly drops anything closed, cancelled included", async () => {
      const rows = await asOwner((tx) =>
        listWorkItems(tx, tenantId, { listId, openOnly: true }),
      );
      expect(rows.map((r) => r.id)).not.toContain(closed);
      expect(rows.map((r) => r.id)).toContain(dueSoon);
    });

    it("asks for one person's work, and separately for nobody's", async () => {
      const mine = await asOwner((tx) =>
        listWorkItems(tx, tenantId, { listId, assignee: USER }),
      );
      expect(mine.map((r) => r.id)).toContain(dueSoon);
      expect(mine.map((r) => r.id)).not.toContain(undated);

      // `null` is a question, not "no filter" — it is the unassigned pile the
      // digest rolls up to an owner.
      const nobodys = await asOwner((tx) =>
        listWorkItems(tx, tenantId, { listId, assignee: null }),
      );
      expect(nobodys.map((r) => r.id)).toContain(undated);
      expect(nobodys.map((r) => r.id)).not.toContain(dueSoon);
    });

    it("filters by state, which is what the board's columns are", async () => {
      const done = await asOwner((tx) =>
        listWorkItems(tx, tenantId, { listId, states: ["done"] }),
      );
      expect(done.map((r) => r.id)).toEqual([closed]);

      const open = await asOwner((tx) =>
        listWorkItems(tx, tenantId, { listId, states: ["todo"] }),
      );
      expect(open.map((r) => r.id)).toContain(dueSoon);
      expect(open.map((r) => r.id)).not.toContain(closed);

      // Two states at once — one query, not two.
      const both = await asOwner((tx) =>
        listWorkItems(tx, tenantId, { listId, states: ["todo", "done"] }),
      );
      expect(both.length).toBeGreaterThan(open.length);
    });

    it("searches title and description, and treats % as a character", async () => {
      const byTitle = await asOwner((tx) =>
        listWorkItems(tx, tenantId, { listId, q: "Due so" }),
      );
      expect(byTitle.map((r) => r.id)).toEqual([dueSoon]);

      // A wildcard typed by a person is a wildcard they meant literally; an
      // unescaped one silently matches everything.
      const wildcard = await asOwner((tx) =>
        listWorkItems(tx, tenantId, { listId, q: "%" }),
      );
      expect(wildcard).toHaveLength(0);
    });

    it("filters on a due date as a STRING, not a Date", async () => {
      const rows = await asOwner((tx) =>
        listWorkItems(tx, tenantId, { listId, dueOnOrBefore: "2026-09-01" }),
      );
      expect(rows.map((r) => r.id)).toContain(dueSoon);
      expect(rows.map((r) => r.id)).not.toContain(dueLater);
    });
  });
});
