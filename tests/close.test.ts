import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { withTenant, withSystem, schema } from "../src/db";
import {
  LedgerError,
  addCloseNote,
  closePeriodStart,
  completeClose,
  getClose,
  getCloseChecklist,
  listCloses,
  postEntry,
  reopenClose,
  setClosedThrough,
  signOffClose,
  type LedgerCtx,
} from "../src/modules/accounting/core";
import { provisionAccounting } from "../src/modules/accounting/templates/apply";
import { upsertMembership } from "../src/lib/tenant-sync";
import {
  lastCompleteMonthEndIso,
  monthEndIso,
} from "../src/modules/accounting/lib/dates";

/**
 * Session 7 certification: the month-end close subsystem + the expert-role
 * plumbing. Pure date helpers always run; everything else needs
 * DATABASE_URL (dev/staging DB, never prod).
 */

// ------------------------------------------------------------------ pure

describe("close date helpers (pure)", () => {
  it("monthEndIso", () => {
    expect(monthEndIso("2026-01-15")).toBe("2026-01-31");
    expect(monthEndIso("2026-02-01")).toBe("2026-02-28");
    expect(monthEndIso("2028-02-10")).toBe("2028-02-29"); // leap
    expect(monthEndIso("2026-12-31")).toBe("2026-12-31");
    expect(monthEndIso("2026-04-30")).toBe("2026-04-30");
  });

  it("lastCompleteMonthEndIso", () => {
    expect(lastCompleteMonthEndIso("2026-07-23")).toBe("2026-06-30");
    expect(lastCompleteMonthEndIso("2026-01-05")).toBe("2025-12-31");
    expect(lastCompleteMonthEndIso("2026-03-01")).toBe("2026-02-28");
  });

  it("closePeriodStart: day after previous close, else fiscal-year start", () => {
    expect(
      closePeriodStart(
        { periodEnd: "2026-06-30", previousClosedThrough: "2026-05-31" },
        1,
      ),
    ).toBe("2026-06-01");
    expect(
      closePeriodStart(
        { periodEnd: "2026-06-30", previousClosedThrough: null },
        1,
      ),
    ).toBe("2026-01-01");
    // FY starting July: a first close for June belongs to FY started last July.
    expect(
      closePeriodStart(
        { periodEnd: "2026-06-30", previousClosedThrough: null },
        7,
      ),
    ).toBe("2025-07-01");
  });
});

// ------------------------------------------------------------------ DB

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;

const STAMP = `close-test-${process.pid}`;
let tenantId: string;
let owner: LedgerCtx;
let staff: LedgerCtx;
let expert: LedgerCtx;
const acct: Record<string, string> = {};

async function accountId(code: string): Promise<string> {
  if (acct[code]) return acct[code];
  const row = await withTenant(tenantId, (tx) =>
    tx.query.accounts.findFirst({
      where: and(
        eq(schema.accounts.tenantId, tenantId),
        eq(schema.accounts.code, code),
      ),
    }),
  );
  if (!row) throw new Error(`fixture account ${code} missing`);
  acct[code] = row.id;
  return row.id;
}

d("month-end close subsystem", () => {
  beforeAll(async () => {
    tenantId = await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.tenants)
        .values([{ clerkOrgId: STAMP, name: "Close Test", slug: STAMP }])
        .returning();
      return rows[0].id;
    });
    await withTenant(tenantId, (tx) => provisionAccounting(tx, tenantId));
    owner = { tenantId, userId: `${STAMP}-owner`, role: "owner" };
    staff = { tenantId, userId: `${STAMP}-staff`, role: "staff" };
    expert = { tenantId, userId: `${STAMP}-expert`, role: "expert" };
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      // Profiles are global rows; memberships cascade with the tenant.
      await tx.execute(
        sql`delete from profiles where clerk_user_id like ${`${STAMP}%`}`,
      );
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
    });
  });

  it("checklist counts date-scoped sources and skips items after period end", async () => {
    const cash = await accountId("1000");
    const sales = await accountId("4000");
    await withTenant(tenantId, async (tx) => {
      // Draft inside the period…
      await postEntry(tx, owner, {
        entryDate: "2026-06-15",
        memo: "june draft",
        status: "draft",
        lines: [
          { accountId: cash, amountCents: 1000 },
          { accountId: sales, amountCents: -1000 },
        ],
      });
      // …and one after period end (must not count).
      await postEntry(tx, owner, {
        entryDate: "2026-07-10",
        memo: "july draft",
        status: "draft",
        lines: [
          { accountId: cash, amountCents: 2000 },
          { accountId: sales, amountCents: -2000 },
        ],
      });
    });
    const checklist = await withTenant(tenantId, (tx) =>
      getCloseChecklist(tx, tenantId, "2026-06-30"),
    );
    const drafts = checklist.items.find((i) => i.key === "draft_entries");
    expect(drafts?.count).toBe(1);
    expect(drafts?.ok).toBe(false);
    expect(checklist.blockerCount).toBeGreaterThan(0);
    const integrity = checklist.items.find((i) => i.key === "ledger_integrity");
    expect(integrity?.ok).toBe(true);
  });

  it("completeClose warns-not-blocks, snapshots the checklist, and locks the period", async () => {
    const { close, checklist } = await withTenant(tenantId, (tx) =>
      completeClose(tx, owner, { periodEnd: "2026-06-30" }),
    );
    expect(close.status).toBe("completed");
    expect(close.periodEnd).toBe("2026-06-30");
    expect(close.previousClosedThrough).toBeNull();
    expect(checklist.blockerCount).toBeGreaterThan(0); // the june draft warned
    expect((close.checklist as { blockerCount: number }).blockerCount).toBe(
      checklist.blockerCount,
    );

    // Period is now enforced by the same closedThrough machinery.
    const cash = await accountId("1000");
    const sales = await accountId("4000");
    await expect(
      withTenant(tenantId, (tx) =>
        postEntry(tx, owner, {
          entryDate: "2026-06-20",
          memo: "backdated",
          status: "posted",
          lines: [
            { accountId: cash, amountCents: 500 },
            { accountId: sales, amountCents: -500 },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: "PERIOD_CLOSED" });
  });

  it("staff and expert cannot complete a close", async () => {
    for (const ctx of [staff, expert]) {
      await expect(
        withTenant(tenantId, (tx) =>
          completeClose(tx, ctx, { periodEnd: "2026-07-31" }),
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });

  it("closes are monotonic (CLOSE_NOT_FORWARD)", async () => {
    await expect(
      withTenant(tenantId, (tx) =>
        completeClose(tx, owner, { periodEnd: "2026-06-30" }),
      ),
    ).rejects.toMatchObject({ code: "CLOSE_NOT_FORWARD" });
    await expect(
      withTenant(tenantId, (tx) =>
        completeClose(tx, owner, { periodEnd: "2026-05-31" }),
      ),
    ).rejects.toMatchObject({ code: "CLOSE_NOT_FORWARD" });
  });

  it("sign-off: staff forbidden, expert ok, double sign-off rejected", async () => {
    const closes = await withTenant(tenantId, (tx) => listCloses(tx, tenantId));
    const june = closes.find((c) => c.periodEnd === "2026-06-30")!;

    await expect(
      withTenant(tenantId, (tx) =>
        signOffClose(tx, staff, { closeId: june.id, expectedVersion: june.version }),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const signed = await withTenant(tenantId, (tx) =>
      signOffClose(tx, expert, { closeId: june.id, expectedVersion: june.version }),
    );
    expect(signed.signedOffByClerkUserId).toBe(expert.userId);
    expect(signed.signedOffAt).toBeTruthy();

    await expect(
      withTenant(tenantId, (tx) =>
        signOffClose(tx, owner, {
          closeId: june.id,
          expectedVersion: signed.version,
        }),
      ),
    ).rejects.toMatchObject({ code: "CLOSE_ALREADY_SIGNED" });
  });

  it("notes: owner and expert can add, staff cannot; authors resolve", async () => {
    const closes = await withTenant(tenantId, (tx) => listCloses(tx, tenantId));
    const june = closes.find((c) => c.periodEnd === "2026-06-30")!;

    await withTenant(tenantId, (tx) =>
      addCloseNote(tx, expert, { closeId: june.id, body: "AR aging looks clean." }),
    );
    await withTenant(tenantId, (tx) =>
      addCloseNote(tx, owner, { closeId: june.id, body: "Thanks — closing." }),
    );
    await expect(
      withTenant(tenantId, (tx) =>
        addCloseNote(tx, staff, { closeId: june.id, body: "nope" }),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const { notes } = await withTenant(tenantId, (tx) =>
      getClose(tx, tenantId, june.id),
    );
    expect(notes).toHaveLength(2);
    expect(notes[0].body).toContain("AR aging");
  });

  it("reopen restores the prior closed-through, latest-only, CAS-guarded", async () => {
    // Second close (July) on top of June.
    const { close: july } = await withTenant(tenantId, (tx) =>
      completeClose(tx, owner, { periodEnd: "2026-07-31" }),
    );
    expect(july.previousClosedThrough).toBe("2026-06-30");

    const closes = await withTenant(tenantId, (tx) => listCloses(tx, tenantId));
    const june = closes.find((c) => c.periodEnd === "2026-06-30")!;

    // June is no longer the latest.
    await expect(
      withTenant(tenantId, (tx) =>
        reopenClose(tx, owner, { closeId: june.id, expectedVersion: june.version }),
      ),
    ).rejects.toMatchObject({ code: "CLOSE_NOT_LATEST" });

    // Stale version on the latest.
    await expect(
      withTenant(tenantId, (tx) =>
        reopenClose(tx, owner, { closeId: july.id, expectedVersion: 999 }),
      ),
    ).rejects.toMatchObject({ code: "STALE_VERSION" });

    // Real reopen restores June's lock.
    await withTenant(tenantId, (tx) =>
      reopenClose(tx, owner, { closeId: july.id, expectedVersion: july.version }),
    );
    const settings = await withTenant(tenantId, (tx) =>
      tx.query.accountingSettings.findFirst({
        where: eq(schema.accountingSettings.tenantId, tenantId),
      }),
    );
    expect(settings?.closedThrough).toBe("2026-06-30");

    // Reopening the same close again: no longer completed.
    const reopened = await withTenant(tenantId, (tx) =>
      getClose(tx, tenantId, july.id),
    );
    await expect(
      withTenant(tenantId, (tx) =>
        reopenClose(tx, owner, {
          closeId: july.id,
          expectedVersion: reopened.close.version,
        }),
      ),
    ).rejects.toMatchObject({ code: "CLOSE_NOT_COMPLETED" });
  });

  it("legacy scalar close: reopen restores a closedThrough that predates period_closes", async () => {
    // Simulate a pre-session-7 lock set directly (no close row).
    await withTenant(tenantId, async (tx) => {
      await setClosedThrough(tx, owner, { date: "2026-08-15" });
    });
    const { close } = await withTenant(tenantId, (tx) =>
      completeClose(tx, owner, { periodEnd: "2026-08-31" }),
    );
    expect(close.previousClosedThrough).toBe("2026-08-15");
    await withTenant(tenantId, (tx) =>
      reopenClose(tx, owner, { closeId: close.id, expectedVersion: close.version }),
    );
    const settings = await withTenant(tenantId, (tx) =>
      tx.query.accountingSettings.findFirst({
        where: eq(schema.accountingSettings.tenantId, tenantId),
      }),
    );
    expect(settings?.closedThrough).toBe("2026-08-15");
    // Restore June state for any later assertions.
    await withTenant(tenantId, (tx) =>
      setClosedThrough(tx, owner, { date: "2026-06-30" }),
    );
  });

  it("re-close after reopen inserts a fresh row (history preserved)", async () => {
    const { close } = await withTenant(tenantId, (tx) =>
      completeClose(tx, owner, { periodEnd: "2026-07-31" }),
    );
    expect(close.signedOffAt).toBeNull(); // re-close starts unsigned
    const closes = await withTenant(tenantId, (tx) => listCloses(tx, tenantId));
    const julys = closes.filter((c) => c.periodEnd === "2026-07-31");
    expect(julys).toHaveLength(2);
    expect(julys.some((c) => c.status === "reopened")).toBe(true);
    expect(julys.some((c) => c.status === "completed")).toBe(true);
  });

  it("tenant-sync preserves the expert flag; org:admin overrides to owner", async () => {
    const clerkUserId = `${STAMP}-sync-user`;
    await withSystem((tx) =>
      tx.insert(schema.profiles).values({
        clerkUserId,
        email: `${STAMP}-sync@x.test`,
      }),
    );
    const created = await upsertMembership({
      clerkOrgId: STAMP,
      clerkUserId,
      clerkRole: "org:member",
    });
    expect(created?.role).toBe("staff");

    // Owner flags them expert (direct update — the action path is UI-tested).
    await withSystem((tx) =>
      tx
        .update(schema.memberships)
        .set({ role: "expert" })
        .where(eq(schema.memberships.id, created!.id)),
    );

    // A membership.updated webhook re-sync must NOT clobber the flag…
    const resynced = await upsertMembership({
      clerkOrgId: STAMP,
      clerkUserId,
      clerkRole: "org:member",
    });
    expect(resynced?.role).toBe("expert");

    // …but promotion to org:admin wins (owner can never be expert).
    const promoted = await upsertMembership({
      clerkOrgId: STAMP,
      clerkUserId,
      clerkRole: "org:admin",
    });
    expect(promoted?.role).toBe("owner");

    // And demotion back to member lands on staff (expert flag was consumed).
    const demoted = await upsertMembership({
      clerkOrgId: STAMP,
      clerkUserId,
      clerkRole: "org:member",
    });
    expect(demoted?.role).toBe("staff");
  });

  // Nested so it runs before this suite's afterAll drops the fixture tenant.
  describe("close narrative engine (injected model)", () => {
    it("persists a validated narrative + audit row; cooldown blocks a re-run", async () => {
      const closes = await withTenant(tenantId, (tx) => listCloses(tx, tenantId));
      const june = closes.find(
        (c) => c.periodEnd === "2026-06-30" && c.status === "completed",
      )!;

      const canned = {
        narrative: "A quiet month. Cash held steady and nothing unusual posted.",
        highlights: [{ title: "Steady cash", detail: "No large movements." }],
      };
      let sawInputs = false;
      const result = await generateCloseNarrativeForClose(
        owner,
        june.id,
        async (g) => {
          sawInputs = true;
          expect(g.inputs.periodEnd).toBe("2026-06-30");
          // First close of the fixture: period starts at FY start (Jan).
          expect(g.inputs.periodStart).toBe("2026-01-01");
          return canned;
        },
      );
      expect(sawInputs).toBe(true);
      expect(result.narrative).toContain("quiet month");

      const stored = await withTenant(tenantId, (tx) =>
        getClose(tx, tenantId, june.id),
      );
      const n = stored.close.narrative as { narrative: string } | null;
      expect(n?.narrative).toContain("quiet month");
      expect(stored.close.narrativeModel).toBeTruthy();
      expect(stored.close.narrativeGeneratedAt).toBeTruthy();

      const audits = await withTenant(tenantId, (tx) =>
        tx
          .select()
          .from(schema.auditLog)
          .where(eq(schema.auditLog.tenantId, tenantId)),
      );
      expect(
        audits.some(
          (a) =>
            a.action === "close.narrative_generated" && a.targetId === june.id,
        ),
      ).toBe(true);

      // Immediate second run: cooldown claimed in the gather tx.
      await expect(
        generateCloseNarrativeForClose(owner, june.id, async () => canned),
      ).rejects.toMatchObject({ code: "AI_COOLDOWN" });
    });

    it("malformed model output → AI_UNAVAILABLE, old narrative untouched", async () => {
      // Clear the cooldown so gather passes.
      await withSystem((tx) =>
        tx
          .update(schema.accountingSettings)
          .set({ aiLastNarrativeAt: null })
          .where(eq(schema.accountingSettings.tenantId, tenantId)),
      );
      const closes = await withTenant(tenantId, (tx) => listCloses(tx, tenantId));
      const june = closes.find(
        (c) => c.periodEnd === "2026-06-30" && c.status === "completed",
      )!;
      await expect(
        generateCloseNarrativeForClose(owner, june.id, async () => ({ junk: 1 })),
      ).rejects.toMatchObject({ code: "AI_UNAVAILABLE" });
      const stored = await withTenant(tenantId, (tx) =>
        getClose(tx, tenantId, june.id),
      );
      expect(
        (stored.close.narrative as { narrative: string } | null)?.narrative,
      ).toContain("quiet month");
    });

    it("reopened closes cannot gather a narrative", async () => {
      await withSystem((tx) =>
        tx
          .update(schema.accountingSettings)
          .set({ aiLastNarrativeAt: null })
          .where(eq(schema.accountingSettings.tenantId, tenantId)),
      );
      const closes = await withTenant(tenantId, (tx) => listCloses(tx, tenantId));
      const reopened = closes.find((c) => c.status === "reopened")!;
      await expect(
        withTenant(tenantId, (tx) =>
          gatherCloseNarrativeInputs(tx, owner, reopened.id),
        ),
      ).rejects.toMatchObject({ code: "CLOSE_NOT_COMPLETED" });
    });
  });
});

// ---------------------------------------------------------- narrative (pure)

import { validateCloseNarrative } from "../src/modules/accounting/ai/narrative-validate";
import { buildCloseNarrativeUserTurn } from "../src/modules/accounting/ai/narrative-prompt";

describe("close narrative validation (pure)", () => {
  const NOW = "2026-07-23T00:00:00.000Z";

  it("malformed payloads degrade to an empty narrative, never throw", () => {
    for (const raw of [null, 42, "text", [], { narrative: 7 }, {}]) {
      const v = validateCloseNarrative(raw, "m", NOW);
      expect(v.narrative).toBe("");
      expect(v.highlights).toEqual([]);
      expect(v.model).toBe("m");
      expect(v.at).toBe(NOW);
    }
  });

  it("strips heading lines and clamps lengths", () => {
    const v = validateCloseNarrative(
      {
        narrative: "# Big Heading\nReal paragraph.\n### another\nMore text.",
        highlights: [
          { title: "  Revenue up  ", detail: "x".repeat(1000) },
          { title: "" },
          { title: "T2" },
          { title: "T3" },
          { title: "T4" },
          { title: "T5" },
          { title: "T6 over the cap" },
        ],
      },
      "m",
      NOW,
    );
    expect(v.narrative).toBe("Real paragraph.\nMore text.");
    expect(v.highlights).toHaveLength(5);
    expect(v.highlights[0].title).toBe("Revenue up");
    expect(v.highlights[0].detail).toHaveLength(300);
  });

  it("caps a runaway narrative at 4000 chars", () => {
    const v = validateCloseNarrative(
      { narrative: "y".repeat(9000) },
      "m",
      NOW,
    );
    expect(v.narrative).toHaveLength(4000);
  });

  it("prompt builder includes every provided section and cents verbatim", () => {
    const turn = buildCloseNarrativeUserTurn({
      periodStart: "2026-06-01",
      periodEnd: "2026-06-30",
      pnlRows: [{ label: "Sales", cents: 123456, prevCents: 100000 }],
      netIncomeCents: 55555,
      prevNetIncomeCents: null,
      cashRows: [
        { label: "Cash: Checking", openingCents: 1, netCents: 2, closingCents: 3 },
      ],
      totals: { assetsCents: 9, liabilitiesCents: 4, equityCents: 5 },
      openItems: [{ label: "Draft journal entries", count: 2 }],
      topEntries: [
        { date: "2026-06-15", memo: "Truck repair", amountCents: 88800, source: "bill" },
      ],
      newVendors: ["Acme Repairs"],
      newCustomers: [],
    });
    expect(turn).toContain("Sales | 123456 | prev 100000");
    expect(turn).toContain("Net income | 55555");
    expect(turn).toContain("Cash: Checking | 1 | 2 | 3");
    expect(turn).toContain("Truck repair");
    expect(turn).toContain("Acme Repairs");
    expect(turn).toContain("Draft journal entries: 2");
    expect(turn).not.toContain("NEW CUSTOMERS");
  });

  it("a clean close says so", () => {
    const turn = buildCloseNarrativeUserTurn({
      periodStart: "2026-06-01",
      periodEnd: "2026-06-30",
      pnlRows: [],
      netIncomeCents: 0,
      prevNetIncomeCents: null,
      cashRows: [],
      totals: { assetsCents: 0, liabilitiesCents: 0, equityCents: 0 },
      openItems: [],
      topEntries: [],
      newVendors: [],
      newCustomers: [],
    });
    expect(turn).toContain("none — a clean close");
  });
});

import {
  gatherCloseNarrativeInputs,
  generateCloseNarrativeForClose,
} from "../src/modules/accounting/ai/narrative";
