import "server-only";
import { eq } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { hasAny } from "@/lib/setup-sources/has-any";
import type { SetupCtx, SetupSource, SetupStep } from "@/lib/setup-sources/types";

/**
 * What Accounting is waiting for before it can keep the books.
 *
 * Two steps, and only ever one of them at a time:
 *
 *  1. **A register.** Every transaction starts from one — the account the
 *     business pays from, or a card. Until it exists the module can write an
 *     invoice and nothing else the books need.
 *  2. **Something in it.** A register with no transaction has not started. The
 *     feed — a statement imported, or the bank connected — is what makes the
 *     money side automatic, and it is the single most valuable next step for a
 *     business converting from a shoebox. It clears on the first row and never
 *     comes back.
 *
 * With one account the second step points straight at that account's import
 * page rather than at the Banking list, because a step that lands you on a list
 * has made you do the finding twice. With several it points at the list, and
 * the owner picks.
 *
 * Not a step: the chart of accounts (provisioned), the company (provisioned),
 * customers and vendors (created on the spot from an invoice, a bill or an
 * emailed document — see the vendors and customers guides).
 */
export const accountingSetupSource: SetupSource = {
  slug: "accounting-books",
  moduleSlug: "accounting",
  label: "Accounting",

  async collect(tx: Tx, ctx: SetupCtx): Promise<SetupStep[]> {
    const accounts = await tx
      .select({ id: schema.bankAccounts.id })
      .from(schema.bankAccounts)
      .where(eq(schema.bankAccounts.tenantId, ctx.tenantId))
      .limit(2);

    if (accounts.length === 0) {
      return [
        {
          key: "accounting.bank-account",
          title: "Add your bank account",
          detail:
            "Every transaction starts from a register. Add the account the business pays from, or a card.",
          href: "/dashboard/m/accounting/banking",
          cta: "Add account",
          guide: "accounting/banking",
        },
      ];
    }

    if (await hasAny(tx, schema.bankTransactions, ctx.tenantId)) return [];

    const only = accounts.length === 1 ? accounts[0].id : null;
    return [
      {
        key: "accounting.transactions",
        title: "Bring in your transactions",
        detail:
          "Import a statement or connect the bank, and the review queue starts filling. Rules and the sweep code what they recognise.",
        href: only
          ? `/dashboard/m/accounting/banking/${only}/import`
          : "/dashboard/m/accounting/banking",
        cta: only ? "Import a statement" : "Open Banking",
        guide: only ? "accounting/import-statement" : "accounting/banking",
      },
    ];
  },
};
