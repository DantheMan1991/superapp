import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { Inbox } from "lucide-react";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { withTenant, schema } from "@/db";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";
import { EmptyState } from "@/components/app/empty-state";
import { FilterPills } from "@/components/app/filter-pills";
import { AccountingNav } from "@/modules/accounting/components/accounting-nav";
import { getDefaultEntityId, listEntities } from "@/modules/accounting/core";
import { listUndepositedPayments } from "@/modules/accounting/banking/deposits";
import { todayInTimezone } from "@/modules/accounting/lib/money";
import { NewDepositForm } from "./new-deposit-form";

export const dynamic = "force-dynamic";

/**
 * Pick the payments that went to the bank together, and the account.
 *
 * ONE COMPANY AT A TIME: a deposit posts in the register's company and may
 * only take that company's payments (`recordDeposit`), so the page is scoped
 * before the form is drawn — pills for the companies, when there is more
 * than one, rather than a list that mixes them and a submit that refuses.
 * The single-company business, which is most of them, never sees a pill.
 */
export default async function NewDepositPage({
  searchParams,
}: {
  searchParams: Promise<{ entity?: string }>;
}) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "accounting");
  const tenantId = ctx.tenant.id;
  const sp = await searchParams;

  const data = await withTenant(tenantId, async (tx) => {
    const entities = await listEntities(tx, tenantId);
    const defaultEntityId = await getDefaultEntityId(tx, tenantId);
    const entityId =
      entities.find((e) => e.id === sp.entity)?.id ??
      (entities.length === 1 ? entities[0].id : defaultEntityId);
    const registers = await tx.query.bankAccounts.findMany({
      where: and(
        eq(schema.bankAccounts.tenantId, tenantId),
        eq(schema.bankAccounts.entityId, entityId),
        eq(schema.bankAccounts.isActive, true),
      ),
      orderBy: (b, { asc }) => [asc(b.createdAt)],
    });
    return {
      entities,
      entityId,
      // A card is not something money is deposited INTO. Nor, here, is the
      // owner's personal account: banking the business's takings there is a
      // draw, and until a deposit can say so it is not offered (ADR 0034).
      registers: registers
        .filter((b) => b.kind !== "credit_card" && b.kind !== "personal")
        .map((b) => ({ id: b.id, name: b.name })),
      payments: await listUndepositedPayments(tx, tenantId, { entityId }),
    };
  });
  if (ctx.role !== "owner") {
    return (
      <div className="space-y-6">
        <PageHeader title="New deposit" />
        <AccountingNav />
        <Panel>
          <EmptyState
            icon={<Inbox />}
            title="Owners record deposits"
            description="Ask the business owner to bank these payments."
          />
        </Panel>
      </div>
    );
  }
  const today = todayInTimezone(ctx.tenant.timezone);

  return (
    <div className="space-y-6">
      <PageHeader
        title="New deposit"
        description="Pick the payments that went to the bank together, and the account they went into."
        actions={
          <Button asChild size="sm" variant="outline">
            <Link href="/dashboard/m/accounting/banking/deposits">All deposits</Link>
          </Button>
        }
      />

      <AccountingNav />

      {data.entities.length > 1 && (
        <FilterPills
          activeKey={data.entityId}
          items={data.entities.map((e) => ({
            key: e.id,
            label: e.name,
            href: `/dashboard/m/accounting/banking/deposits/new?entity=${e.id}`,
          }))}
          variant="accent"
        />
      )}

      {data.payments.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<Inbox />}
            title="Nothing is waiting to be deposited"
            description="A payment recorded into Undeposited Funds appears here until it is banked. One recorded straight into a bank account needs no deposit."
            action={
              <Button asChild size="sm" variant="outline">
                <Link href="/dashboard/m/accounting/sales/invoices">Invoices</Link>
              </Button>
            }
          />
        </Panel>
      ) : data.registers.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<Inbox />}
            title="No bank account to deposit into"
            description="This company has no open checking or savings account. Add one on Banking, then come back."
            action={
              <Button asChild size="sm" variant="outline">
                <Link href="/dashboard/m/accounting/banking">Banking</Link>
              </Button>
            }
          />
        </Panel>
      ) : (
        <NewDepositForm
          registers={data.registers}
          payments={data.payments.map((p) => ({
            id: p.id,
            paymentDate: p.paymentDate,
            amountCents: p.amountCents,
            method: p.method,
            memo: p.memo,
            invoiceNumber: p.invoiceNumber,
            customerName: p.customerName,
          }))}
          today={today}
        />
      )}
    </div>
  );
}
