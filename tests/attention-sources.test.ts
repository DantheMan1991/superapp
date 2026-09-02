import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  collectAttention,
  sortAttention,
} from "../src/lib/attention-sources/resolve";
import type {
  AttentionCtx,
  AttentionItem,
  AttentionSource,
} from "../src/lib/attention-sources/types";
import type { Tx } from "../src/db";

/**
 * The resolve layer. Pure — sources are injected, so no database and always
 * runs.
 *
 * The behaviour under test is the one thing that makes this different from
 * `mail-extensions/resolve.ts`: a source that fails must be REPORTED, never
 * folded into an empty list. Every case below is a way somebody could stop
 * being told about work they owe.
 */

const CTX: AttentionCtx = {
  tenantId: "t1",
  userId: "user_1",
  role: "owner",
  today: "2026-08-06",
};

// The resolve layer never touches the tx — it hands it straight to sources.
const TX = {} as Tx;

function source(
  slug: string,
  collect: AttentionSource["collect"],
): AttentionSource {
  return { slug, moduleSlug: slug, label: slug.toUpperCase(), collect };
}

function item(key: string, over: Partial<AttentionItem> = {}): AttentionItem {
  return {
    key,
    title: key,
    urgency: "today",
    dueOn: "2026-08-06",
    href: `/x/${key}`,
    ...over,
  };
}

describe("collectAttention", () => {
  it("merges items from every source", async () => {
    const result = await collectAttention(TX, CTX, [
      source("a", async () => [item("a1")]),
      source("b", async () => [item("b1"), item("b2")]),
    ]);
    expect(result.items.map((i) => i.key).sort()).toEqual(["a1", "b1", "b2"]);
    expect(result.complete).toBe(true);
    expect(result.failed).toEqual([]);
  });

  it("REPORTS a throwing source instead of returning an empty list", async () => {
    // The whole point. Folding this to [] would tell somebody they owe nothing
    // when Accounting has seven overdue invoices for them.
    const result = await collectAttention(TX, CTX, [
      source("crm", async () => [item("t1")]),
      source("accounting", async () => {
        throw new Error("connection reset");
      }),
    ]);
    expect(result.items.map((i) => i.key)).toEqual(["t1"]);
    expect(result.complete).toBe(false);
    expect(result.failed).toEqual([
      { slug: "accounting", label: "ACCOUNTING", reason: "error" },
    ]);
  });

  it("one broken source does not stop the others answering", async () => {
    const result = await collectAttention(TX, CTX, [
      source("a", async () => {
        throw new Error("boom");
      }),
      source("b", async () => [item("b1")]),
      source("c", async () => [item("c1")]),
    ]);
    expect(result.items.map((i) => i.key).sort()).toEqual(["b1", "c1"]);
    expect(result.failed).toHaveLength(1);
  });

  it("distinguishes 'nothing owed' from 'could not ask'", async () => {
    // Both produce zero items; only one may be reported as an all-clear.
    const quiet = await collectAttention(TX, CTX, [
      source("a", async () => []),
    ]);
    expect(quiet.items).toEqual([]);
    expect(quiet.complete).toBe(true);

    const broken = await collectAttention(TX, CTX, [
      source("a", async () => {
        throw new Error("nope");
      }),
    ]);
    expect(broken.items).toEqual([]);
    expect(broken.complete).toBe(false);
  });

  it("no sources at all is a complete, empty answer", async () => {
    // A tenant with neither module enabled genuinely owes nothing here. That
    // is not a failure and must not be alarming.
    const result = await collectAttention(TX, CTX, []);
    expect(result.items).toEqual([]);
    expect(result.complete).toBe(true);
  });

  it("a source rejecting after another resolves still reports", async () => {
    const result = await collectAttention(TX, CTX, [
      source("fast", async () => [item("f1")]),
      source("slow", async () => {
        await new Promise((r) => setTimeout(r, 20));
        throw new Error("late failure");
      }),
    ]);
    expect(result.items.map((i) => i.key)).toEqual(["f1"]);
    expect(result.failed[0]?.slug).toBe("slow");
  });
});

describe("sortAttention", () => {
  it("overdue first, then today, then soon", async () => {
    const sorted = sortAttention([
      item("s", { urgency: "soon", dueOn: "2026-08-09" }),
      item("o", { urgency: "overdue", dueOn: "2026-08-01" }),
      item("t", { urgency: "today", dueOn: "2026-08-06" }),
    ]);
    expect(sorted.map((i) => i.key)).toEqual(["o", "t", "s"]);
  });

  it("within one urgency, earliest date first", () => {
    const sorted = sortAttention([
      item("b", { urgency: "overdue", dueOn: "2026-08-04" }),
      item("a", { urgency: "overdue", dueOn: "2026-08-01" }),
    ]);
    expect(sorted.map((i) => i.key)).toEqual(["a", "b"]);
  });

  it("undated sorts after dated within the same urgency", () => {
    const sorted = sortAttention([
      item("undated", { urgency: "soon", dueOn: null }),
      item("dated", { urgency: "soon", dueOn: "2026-09-01" }),
    ]);
    expect(sorted.map((i) => i.key)).toEqual(["dated", "undated"]);
  });

  it("is STABLE: same input in any order gives the same output", () => {
    // The design rejects adaptive ranking outright — an order that changes for
    // reasons the reader cannot predict destroys the trust the channel runs on.
    // Two runs over unchanged data must be byte-identical, which is what the
    // key tiebreak buys.
    const items = [
      item("z", { urgency: "today", dueOn: "2026-08-06" }),
      item("a", { urgency: "today", dueOn: "2026-08-06" }),
      item("m", { urgency: "today", dueOn: "2026-08-06" }),
    ];
    const forward = sortAttention(items).map((i) => i.key);
    const reversed = sortAttention([...items].reverse()).map((i) => i.key);
    expect(forward).toEqual(["a", "m", "z"]);
    expect(reversed).toEqual(forward);
  });

  it("does not mutate its input", () => {
    const items = [
      item("b", { urgency: "soon" }),
      item("a", { urgency: "overdue" }),
    ];
    sortAttention(items);
    expect(items.map((i) => i.key)).toEqual(["b", "a"]);
  });
});

// ------------------------------------------------------------------ DB-backed

/**
 * The queries, against real Postgres.
 *
 * The unit tests above inject fake sources, so they prove the resolve layer's
 * behaviour and nothing about whether the two real sources' SQL is valid. A
 * drizzle query that compiles can still be rejected by the server — wrong
 * column, bad enum cast, a `lte` against a date that is actually text. This
 * block runs them for real.
 *
 * Rows are only needed to prove the POSITIVE case. A query returning zero rows
 * has still executed, which is what validates the SQL, so the accounting source
 * is exercised without the considerable fixture weight of a party → customer →
 * invoice chain.
 */
const RUN_DB = !!process.env.DATABASE_URL;
const dd = RUN_DB ? describe : describe.skip;

dd("the real sources, against Postgres", () => {
  const STAMP = `attn-test-${process.pid}`;
  let tenantId: string;

  beforeAll(async () => {
    const { withSystem, schema } = await import("../src/db");
    tenantId = await withSystem(async (tx) => {
      const [t] = await tx
        .insert(schema.tenants)
        .values({ clerkOrgId: STAMP, name: "Attention Test", slug: STAMP })
        .returning();
      return t.id;
    });
  });

  afterAll(async () => {
    const { withSystem, schema } = await import("../src/db");
    const { eq } = await import("drizzle-orm");
    await withSystem((tx) =>
      tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId)),
    );
  });

  /*
   * THE THREE CRM-SOURCE TESTS THAT WERE HERE ARE GONE, not skipped.
   *
   * `crmAttentionSource` was deleted in work.md slice 5b when follow-ups became
   * work items. Everything they asserted — an overdue item reaching its
   * assignee, one person's work not reaching another, unassigned work rolling
   * up to an owner and not to staff — is covered against the source that
   * replaced it, in tests/work-attention.test.ts.
   */


  it("accounting source's SQL executes, and it stays silent for non-owners", async () => {
    const { withTenant } = await import("../src/db");
    const { accountingAttentionSource } = await import(
      "../src/modules/accounting/attention/source"
    );

    // Owner: both queries actually run against Postgres. Zero rows is a pass —
    // an invalid query would reject here rather than return empty.
    const owner = await withTenant(
      tenantId,
      (tx) =>
        collectAttention(
          tx,
          { tenantId, userId: "user_1", role: "owner", today: "2026-08-06" },
          [accountingAttentionSource],
        ),
      { role: "owner", userId: "user_1" },
    );
    expect(owner.complete).toBe(true);
    expect(owner.failed).toEqual([]);

    const staff = await withTenant(
      tenantId,
      (tx) =>
        collectAttention(
          tx,
          { tenantId, userId: "user_1", role: "staff", today: "2026-08-06" },
          [accountingAttentionSource],
        ),
      { role: "staff", userId: "user_1" },
    );
    expect(staff.items).toEqual([]);
    expect(staff.complete).toBe(true);
  });

  it("A FAILING TEMPLATE reaches the owner as an overdue item; a paused or clean one does not", async () => {
    /**
     * The sweep's note (`last_error`) used to be visible only on the recurring
     * list — a page nobody opens unless they already suspect something. This
     * is the same fact on the surface an owner actually reads at 7am.
     *
     * Three rows, one item. The paused one carries a note too (pausing does
     * not clear it, by design) but is not asked to run, so nothing is owed on
     * it — drop the `is_active` filter from the query and this goes red. The
     * clean one proves the note is the trigger, not the table.
     */
    const { withTenant, schema } = await import("../src/db");
    const { accountingAttentionSource } = await import(
      "../src/modules/accounting/attention/source"
    );
    const { failureSentence } = await import(
      "../src/modules/accounting/core/errors"
    );

    const seed = (values: Record<string, unknown>) =>
      withTenant(tenantId, async (tx) => {
        const [row] = await tx
          .insert(schema.recurringEntries)
          .values({
            tenantId,
            kind: "journal",
            template: { kind: "journal", lines: [] },
            dayOfMonth: 4,
            createdByClerkUserId: "user_1",
            ...values,
          } as never)
          .returning();
        return row;
      });

    const failing = await seed({
      name: "Monthly depreciation",
      nextRunDate: "2026-08-04",
      lastError: "ACCOUNT_INACTIVE",
      lastErrorAt: new Date("2026-08-04T11:00:00Z"),
    });
    await seed({
      name: "Paused, and failing",
      nextRunDate: "2026-08-04",
      lastError: "ACCOUNT_INACTIVE",
      lastErrorAt: new Date("2026-08-04T11:00:00Z"),
      isActive: false,
    });
    await seed({ name: "Clean", nextRunDate: "2026-09-04" });

    const ctx = { tenantId, userId: "user_1", today: "2026-08-06" } as const;
    const owner = await withTenant(
      tenantId,
      (tx) =>
        collectAttention(tx, { ...ctx, role: "owner" }, [accountingAttentionSource]),
      { role: "owner", userId: "user_1" },
    );
    expect(owner.complete).toBe(true);
    const recurring = owner.items.filter((i) => i.key.startsWith("recurring:"));
    expect(recurring).toEqual([
      {
        key: `recurring:${failing.id}`,
        title: 'Recurring journal "Monthly depreciation" could not run',
        // The same sentence the list page shows for the code — the two
        // surfaces cannot disagree about why.
        detail: failureSentence("ACCOUNT_INACTIVE"),
        urgency: "overdue",
        // The sweep does not move the date on a failure, so this is the
        // period that was due and was not written.
        dueOn: "2026-08-04",
        href: `/dashboard/m/accounting/recurring#${failing.id}`,
      },
    ]);
    // A real sentence, not the fallback for a code nobody mapped.
    expect(recurring[0].detail).not.toMatch(/could not name/);

    // Owners only, like the two obligations beside it: no assignee column.
    const staff = await withTenant(
      tenantId,
      (tx) =>
        collectAttention(tx, { ...ctx, role: "staff" }, [accountingAttentionSource]),
      { role: "staff", userId: "user_1" },
    );
    expect(staff.items).toEqual([]);
  });
});
