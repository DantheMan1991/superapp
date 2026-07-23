import { and, eq } from "drizzle-orm";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { withTenant, schema } from "@/db";
import { AccountingNav } from "@/modules/accounting/components/accounting-nav";
import { getSettings } from "@/modules/accounting/core";
import { listVendors } from "@/modules/accounting/payables/vendors";
import { todayInTimezone } from "@/modules/accounting/lib/money";
import { PurchasesNav } from "../../purchases-nav";
import { BillBuilder } from "../bill-builder";

export const dynamic = "force-dynamic";

export default async function NewBillPage() {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "accounting");
  const tenantId = ctx.tenant.id;

  const data = await withTenant(tenantId, async (tx) => {
    const vendors = await listVendors(tx, tenantId);
    const settings = await getSettings(tx, tenantId);
    // Codable accounts: everything active except bank registers and the
    // AR/AP system accounts (mirrors the AI coding eligibility).
    const accounts = await tx.query.accounts.findMany({
      where: and(
        eq(schema.accounts.tenantId, tenantId),
        eq(schema.accounts.isActive, true),
      ),
      orderBy: (a, { asc }) => [asc(a.code)],
    });
    const registers = await tx.query.bankAccounts.findMany({
      where: eq(schema.bankAccounts.tenantId, tenantId),
    });
    const registerIds = new Set(registers.map((r) => r.accountId));
    return {
      vendors,
      today: todayInTimezone(settings.bookkeepingTimezone),
      accounts: accounts.filter(
        (a) =>
          !registerIds.has(a.id) &&
          a.subtype !== "opening_balance" &&
          !(a.isSystem &&
            ["accounts_receivable", "accounts_payable"].includes(a.subtype)),
      ),
    };
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New bill</h1>
        <p className="text-sm text-muted-foreground">
          Record what a vendor billed {ctx.tenant.name}. Approval posts it to
          the ledger.
        </p>
      </div>
      <AccountingNav />
      <PurchasesNav />
      <BillBuilder
        vendors={data.vendors.map((v) => ({ id: v.id, name: v.name }))}
        accounts={data.accounts.map((a) => ({ id: a.id, code: a.code, name: a.name }))}
        today={data.today}
      />
    </div>
  );
}
