import { and, asc, eq } from "drizzle-orm";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { withTenant, schema } from "@/db";
import { PageHeader } from "@/components/app/page-header";
import { AccountingNav } from "@/modules/accounting/components/accounting-nav";
import { getDefaultEntityId, listEntities } from "@/modules/accounting/core";
import { todayInTimezone } from "@/modules/accounting/lib/money";
import { EntryEditor } from "../entry-editor";

export const dynamic = "force-dynamic";

export default async function NewEntryPage() {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "accounting");

  const { accounts, today, entities, defaultEntityId } = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const accounts = await tx
        .select({
          id: schema.accounts.id,
          code: schema.accounts.code,
          name: schema.accounts.name,
          accountType: schema.accounts.accountType,
        })
        .from(schema.accounts)
        .where(
          and(
            eq(schema.accounts.tenantId, ctx.tenant.id),
            eq(schema.accounts.isActive, true),
          ),
        )
        .orderBy(asc(schema.accounts.code));
      return {
        accounts,
        today: todayInTimezone(ctx.tenant.timezone),
        entities: await listEntities(tx, ctx.tenant.id),
        defaultEntityId: await getDefaultEntityId(tx, ctx.tenant.id),
      };
    },
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="New journal entry"
        description="Debits on the left, credits on the right — they must match to post."
      />
      <AccountingNav />
      <EntryEditor
        accounts={accounts}
        entities={entities.map((e) => ({ id: e.id, name: e.name }))}
        defaultEntityId={defaultEntityId}
        canPost={ctx.role === "owner"}
        today={today}
      />
    </div>
  );
}
