import { and, eq } from "drizzle-orm";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { withTenant, schema } from "@/db";
import { PageHeader } from "@/components/app/page-header";
import { AccountingNav } from "@/modules/accounting/components/accounting-nav";
import { listVendors } from "@/modules/accounting/payables/vendors";
import { todayInTimezone } from "@/modules/accounting/lib/money";
import { PurchasesNav } from "../../purchases-nav";
import {
  getDefaultEntityId,
  isCodableAccount,
  listDimensionMembers,
  listEntities,
} from "@/modules/accounting/core";
import { dimensionTypesFrom } from "@/lib/dimension-options";
import { BillBuilder } from "../bill-builder";

export const dynamic = "force-dynamic";

export default async function NewBillPage() {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "accounting");
  const tenantId = ctx.tenant.id;

  const data = await withTenant(tenantId, async (tx) => {
    const vendors = await listVendors(tx, tenantId);
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
      entities: await listEntities(tx, tenantId),
      defaultEntityId: await getDefaultEntityId(tx, tenantId),
      today: todayInTimezone(ctx.tenant.timezone),
      accounts: accounts.filter((a) => isCodableAccount(a, registerIds)),
      // Unfiltered: `dimensionTypesFrom` owns the active-only rule.
      dimensionMembers: await listDimensionMembers(tx, tenantId),
    };
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="New bill"
        description={`Record what a vendor billed ${ctx.tenant.name}. Approval posts it to the ledger.`}
      />
      <AccountingNav />
      <PurchasesNav />
      <BillBuilder
        vendors={data.vendors.map((v) => ({ id: v.id, name: v.name }))}
        entities={data.entities.map((e) => ({ id: e.id, name: e.name }))}
        defaultEntityId={data.defaultEntityId}
        accounts={data.accounts.map((a) => ({ id: a.id, code: a.code, name: a.name }))}
        today={data.today}
        dimensionTypes={dimensionTypesFrom(data.dimensionMembers)}
      />
    </div>
  );
}
