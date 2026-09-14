import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema, withSystem, withTenant, type Tx } from "../src/db";
import { accountingTellSource } from "../src/modules/accounting/tell/source";
import { provisionAccounting } from "../src/modules/accounting/templates/apply";
import { createBankAccount } from "../src/modules/accounting/banking/accounts";
import { createVendor } from "../src/modules/accounting/payables/vendors";
import type { TellAction, TellCtx, TellValues } from "../src/lib/tell-sources/types";

/**
 * TELLING THE BOOKS SOMETHING (tell.md, slice C1) — the first source that
 * touches money, and the one every rule in ADR 0054 was written for.
 *
 * What this certifies: the posting is read back BEFORE the button, in the
 * accounts it will actually hit; a non-owner's entry is a draft and SAYS so;
 * the outside accountant is offered nothing; and a line can never be coded to
 * an account the module's own pickers refuse.
 */

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;

const TODAY = "2026-09-13";

d("telling the books something", () => {
  const STAMP = `tell-acct-${process.pid}`;

  let tenantId = "";
  let bankAccountId = "";
  let bankLedgerAccountId = "";
  let vendorId = "";

  const ctxFor = (role: "owner" | "staff" | "expert"): TellCtx => ({
    tenantId,
    userId: `${STAMP}-${role}`,
    role,
    now: new Date("2026-09-13T14:00:00.000Z"),
    timezone: "UTC",
    industry: "homestead-farm",
    today: TODAY,
  });
  const as = <T,>(role: "owner" | "staff" | "expert", fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantId, fn, { role, userId: `${STAMP}-${role}` });

  const actionsFor = (role: "owner" | "staff" | "expert") =>
    as(role, (tx) => accountingTellSource.actions(tx, ctxFor(role)));
  const paidFor = async (role: "owner" | "staff"): Promise<TellAction> => {
    const found = (await actionsFor(role)).find((a) => a.slug === "accounting.paid");
    if (!found) throw new Error("accounting.paid was not offered");
    return found;
  };

  const billFor = async (role: "owner" | "staff"): Promise<TellAction> => {
    const found = (await actionsFor(role)).find((a) => a.slug === "accounting.bill");
    if (!found) throw new Error("accounting.bill was not offered");
    return found;
  };

  beforeAll(async () => {
    await withSystem(async (tx) => {
      const [tenant] = await tx
        .insert(schema.tenants)
        .values({
          clerkOrgId: `org_${STAMP}`,
          name: `Books ${STAMP}`,
          slug: STAMP,
          industry: "homestead-farm",
          // So this file asserts BOTH halves of the house rule: the summary is
          // a sentence and carries the tenant’s symbol, the preview’s debit and
          // credit columns stay symbol-free because their header carries it.
          currencySymbol: "$",
        })
        .returning();
      tenantId = tenant.id;
      await tx
        .insert(schema.tenantModules)
        .values({ tenantId, moduleId: "accounting", enabled: true })
        .onConflictDoNothing();
    });

    await withTenant(tenantId, (tx) => provisionAccounting(tx, tenantId));
    await as("owner", async (tx) => {
      const made = await createBankAccount(tx, ctxFor("owner"), {
        name: "Farm Checking",
        kind: "checking",
        institution: "Test Bank",
        last4: "4321",
        openingBalanceCents: 500_00,
        openingBalanceDate: "2026-01-01",
      });
      bankAccountId = made.bankAccount.id;
      bankLedgerAccountId = made.ledgerAccount.id;
    });
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
    });
  });

  /** The category the sentence's own words reach, through the field's search. */
  const categoryFor = async (said: string) => {
    const paid = await paidFor("owner");
    const field = paid.fields.find((f) => f.key === "category")!;
    const found = await as("owner", (tx) => field.find!(tx, ctxFor("owner"), said));
    return found;
  };

  it("offers one thing, and it records nothing by itself", async () => {
    const list = await actionsFor("owner");
    expect(list.map((a) => a.slug)).toEqual(["accounting.paid"]);
    // It moves money, which fails ADR 0050's third test outright.
    expect(list[0].unattended).toBeUndefined();
    // And ADR 0054 §2 is not optional for anything that posts.
    expect(typeof list[0].preview).toBe("function");
  });

  /**
   * The outside accountant is read-only in this module. `quickAddTransaction`
   * throws for them either way — this is the courtesy, so they are not offered
   * something that would refuse.
   */
  it("offers the outside accountant nothing at all", async () => {
    expect(await actionsFor("expert")).toEqual([]);
  });

  it("searches for the account by the words somebody would say", async () => {
    const paid = await paidFor("owner");
    for (const key of ["account", "category"]) {
      const field = paid.fields.find((f) => f.key === key)!;
      expect(field.choices, `${key} enumerates`).toBeUndefined();
      expect(typeof field.find, `${key} does not search`).toBe("function");
    }
    const found = await as("owner", (tx) =>
      paid.fields.find((f) => f.key === "account")!.find!(tx, ctxFor("owner"), "the checking"),
    );
    expect(found.map((c) => c.label)).toContain("Farm Checking");
  });

  /**
   * **A LINE MAY NEVER BE CODED WHERE THE MODULE'S OWN PICKERS REFUSE IT.**
   *
   * `isCodableAccount` keeps a line off the registers themselves, off owner
   * funds and opening balances, and off GRNI and Inventory — where coding by
   * hand capitalises a delivery a second time (ADR 0012). A second opinion
   * about that here would be a second opinion about somebody's books.
   */
  it("never offers an account the pickers would refuse", async () => {
    const offered = new Set((await categoryFor("")).map((c) => c.value));
    expect(offered.has(bankLedgerAccountId), "the register's own account").toBe(false);

    const refused = await as("owner", (tx) =>
      tx.query.accounts.findMany({
        where: and(
          eq(schema.accounts.tenantId, tenantId),
          eq(schema.accounts.accountType, "expense"),
        ),
      }),
    );
    for (const account of refused) {
      if (["goods_received", "opening_balance", "owner_funds"].includes(account.subtype)) {
        expect(offered.has(account.id), `${account.subtype} was offered`).toBe(false);
      }
    }
    // And it offered something, or the assertions above are vacuous.
    expect(offered.size).toBeGreaterThan(0);
  });

  /**
   * **THE POSTING, NOT THE WORDS** (ADR 0054 §2). `Feed store · $240 · today`
   * looks exactly as correct whether it hits 5010 or 6200, and the wrong
   * account is the commonest error in the whole of bookkeeping.
   */
  it("reads the posting back before it writes it", async () => {
    const categories = await categoryFor("");
    const category = categories[0];
    const paid = await paidFor("owner");

    const values: TellValues = {
      account: bankAccountId,
      category: category.value,
      amount: 240,
      payee: "the feed store",
      on: TODAY,
    };
    const shown = await as("owner", (tx) => paid.preview!(tx, ctxFor("owner"), values));

    expect(shown!.lines).toHaveLength(2);
    // Positive figures either side with Dr and Cr said out loud — never a
    // signed number, which is the one thing everybody reads differently.
    expect(shown!.lines[0].label.startsWith("Dr ")).toBe(true);
    expect(shown!.lines[0].value).toBe("240.00");
    expect(shown!.lines[1].label.startsWith("Cr ")).toBe(true);
    expect(shown!.lines[1].value).toBe("240.00");
    // The money leaves the register it was paid from.
    expect(shown!.lines[1].label).toContain("Farm Checking");
    // An owner posts, so there is nothing to warn about.
    expect(shown!.warning).toBeUndefined();
  });

  it("says nothing rather than guessing at a card it cannot work out", async () => {
    const paid = await paidFor("owner");
    const shown = await as("owner", (tx) =>
      paid.preview!(tx, ctxFor("owner"), {
        account: bankAccountId,
        category: null,
        amount: 240,
        payee: null,
        on: TODAY,
      }),
    );
    expect(shown).toBeNull();
  });

  it("refuses an amount that is not money", async () => {
    const paid = await paidFor("owner");
    const category = (await categoryFor(""))[0];
    for (const amount of [0, -5]) {
      const shown = await as("owner", (tx) =>
        paid.preview!(tx, ctxFor("owner"), {
          account: bankAccountId,
          category: category.value,
          amount,
          payee: null,
          on: TODAY,
        }),
      );
      expect(shown, `${amount} previewed`).toBeNull();
    }
  });

  it("an owner's payment is posted, and says so", async () => {
    const paid = await paidFor("owner");
    const category = (await categoryFor(""))[0];
    const done = await as("owner", (tx) =>
      paid.record(tx, ctxFor("owner"), {
        account: bankAccountId,
        category: category.value,
        amount: 240,
        payee: "the feed store",
        on: TODAY,
      }),
    );
    expect(done.summary).toBe("$240.00 to the feed store — paid");

    const entries = await as("owner", (tx) =>
      tx.query.journalEntries.findMany({
        where: eq(schema.journalEntries.tenantId, tenantId),
      }),
    );
    expect(entries.some((e) => e.status === "posted" && e.memo === "the feed store")).toBe(true);
  });

  /**
   * **A DRAFT IS NOT A RECORDING, AND SAYING SO IS THE POINT.** Somebody who
   * walks away believing their books are up to date has been misled by a
   * confirmation that was technically true — which matters more when the
   * confirmation is SPOKEN and there is no screen to check.
   */
  it("a staff member's payment waits as a draft, and both the card and the words say so", async () => {
    const paid = await paidFor("staff");
    const category = (await categoryFor(""))[0];
    const values: TellValues = {
      account: bankAccountId,
      category: category.value,
      amount: 98.5,
      payee: "the vet",
      on: TODAY,
    };

    const shown = await as("staff", (tx) => paid.preview!(tx, ctxFor("staff"), values));
    expect(shown!.warning).toBe("This will wait as a draft until an owner posts it.");
    // Cents survive a number that is not whole, which is the classic one.
    expect(shown!.lines[0].value).toBe("98.50");

    const done = await as("staff", (tx) => paid.record(tx, ctxFor("staff"), values));
    expect(done.summary).toBe("$98.50 to the vet — draft, for an owner to post");

    const drafted = await as("staff", (tx) =>
      tx.query.journalEntries.findMany({
        where: and(
          eq(schema.journalEntries.tenantId, tenantId),
          eq(schema.journalEntries.status, "draft"),
        ),
      }),
    );
    expect(drafted.some((e) => e.memo === "the vet")).toBe(true);
  });
  /* ── a bill that arrived (slice C2) ─────────────────────────────────────── */

  /**
   * **A VENDOR IS NEVER CREATED FROM A SENTENCE**, so a business with none is
   * not offered the action. A misheard name would make a party that outlives
   * the mistake and turns up in every picker afterwards.
   *
   * Runs FIRST of the bill cases on purpose: the vendor is made by the one
   * below it, and this is the only moment there is not one.
   */
  it("does not offer a bill until the business has a vendor", async () => {
    const list = await actionsFor("owner");
    expect(list.map((a) => a.slug)).toEqual(["accounting.paid"]);
  });

  it("offers it once there is somebody it could be from", async () => {
    await as("owner", async (tx) => {
      const vendor = await createVendor(tx, ctxFor("owner"), { name: "The Feed Store" });
      vendorId = vendor.id;
    });
    const list = await actionsFor("owner");
    expect(list.map((a) => a.slug).sort()).toEqual(["accounting.bill", "accounting.paid"]);

    const bill = await billFor("owner");
    // Nothing here posts, and nothing records itself.
    expect(bill.unattended).toBeUndefined();
    expect(typeof bill.preview).toBe("function");
    // What it is FOR is optional: a bill line's account is nullable by design,
    // and a sentence that does not say should leave it uncoded rather than
    // guess at an account somebody has to notice was wrong.
    expect(bill.fields.find((f) => f.key === "category")!.required).toBeUndefined();
  });

  /**
   * **NOTHING POSTS.** `createBillDraft` makes a draft; approving it is what
   * writes Dr expense / Cr Accounts Payable. So the preview shows what
   * approving WILL do, and says out loud that it has not happened.
   */
  it("shows what approving it will do, and that it has not happened", async () => {
    const bill = await billFor("owner");
    const category = (await categoryFor(""))[0];
    const shown = await as("owner", (tx) =>
      bill.preview!(tx, ctxFor("owner"), {
        vendor: vendorId,
        amount: 380,
        category: category.value,
        due: "2026-09-15",
        on: TODAY,
      }),
    );

    expect(shown!.lines[0].label.startsWith("Dr ")).toBe(true);
    expect(shown!.lines[0].value).toBe("380.00");
    expect(shown!.lines[1].label).toContain("Accounts Payable");
    expect(shown!.lines[1].value).toBe("380.00");
    expect(shown!.lines[2]).toEqual({ label: "due", value: "2026-09-15" });
    // Said as a LINE rather than a warning: it is always true, and a warning
    // that never varies stops being read.
    expect(shown!.lines[3].label).toBe("a draft until somebody approves it");
    expect(shown!.warning).toBeUndefined();
  });

  it("leaves a bill uncoded when the sentence does not say what it was for", async () => {
    const bill = await billFor("owner");
    const shown = await as("owner", (tx) =>
      bill.preview!(tx, ctxFor("owner"), {
        vendor: vendorId,
        amount: 380,
        category: null,
        due: null,
        on: TODAY,
      }),
    );
    expect(shown!.lines[0].label).toBe("Dr — not coded yet");
  });

  it("drafts the bill, uncoded, with the total it was told", async () => {
    const bill = await billFor("owner");
    const done = await as("owner", (tx) =>
      bill.record(tx, ctxFor("owner"), {
        vendor: vendorId,
        amount: 380,
        category: null,
        due: "2026-09-15",
        on: TODAY,
      }),
    );
    expect(done.summary).toBe("$380.00 from The Feed Store — bill drafted");

    const bills = await as("owner", (tx) =>
      tx.query.bills.findMany({ where: eq(schema.bills.tenantId, tenantId) }),
    );
    expect(bills).toHaveLength(1);
    expect(bills[0].status).toBe("draft");
    expect(bills[0].totalCents).toBe(380_00);
    expect(bills[0].dueDate).toBe("2026-09-15");
  });

  /**
   * **THE SAME BILL TWICE IS THE FAILURE THIS PREVENTS.** The module already
   * looks for it on the screen; a sentence is if anything likelier to repeat
   * one, because saying it again is cheaper than checking.
   */
  it("warns that this vendor already has a bill like this one", async () => {
    const bill = await billFor("owner");
    const shown = await as("owner", (tx) =>
      bill.preview!(tx, ctxFor("owner"), {
        vendor: vendorId,
        amount: 380,
        category: null,
        due: null,
        on: TODAY,
      }),
    );
    expect(shown!.warning).toBe(
      "The Feed Store already has a bill for this amount around this date.",
    );
  });
});
