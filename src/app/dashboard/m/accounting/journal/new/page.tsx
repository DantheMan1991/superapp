import { and, asc, eq } from "drizzle-orm";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { withTenant, schema } from "@/db";
import { AccountingNav } from "@/modules/accounting/components/accounting-nav";
import { getSettings } from "@/modules/accounting/core";
import { todayInTimezone } from "@/modules/accounting/lib/money";
import { EntryEditor } from "../entry-editor";

export const dynamic = "force-dynamic";

export default async function NewEntryPage() {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "accounting");

  const { accounts, today } = await withTenant(ctx.tenant.id, async (tx) => {
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
    const settings = await getSettings(tx, ctx.tenant.id);
    return { accounts, today: todayInTimezone(settings.bookkeepingTimezone) };
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New journal entry</h1>
        <p className="text-sm text-muted-foreground">
          Debits on the left, credits on the right — they must match to post.
        </p>
      </div>
      <AccountingNav />
      <EntryEditor
        accounts={accounts}
        canPost={ctx.role === "owner"}
        today={today}
      />
    </div>
  );
}
