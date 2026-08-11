import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { withTenant, schema } from "@/db";
import { PageHeader } from "@/components/app/page-header";
import { AccountingNav } from "@/modules/accounting/components/accounting-nav";
import { ImportWizard } from "./import-wizard";

export const dynamic = "force-dynamic";

export default async function ImportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "accounting");

  const bankAccount = await withTenant(ctx.tenant.id, (tx) =>
    tx.query.bankAccounts.findFirst({
      where: and(
        eq(schema.bankAccounts.tenantId, ctx.tenant.id),
        eq(schema.bankAccounts.id, id),
      ),
    }),
  );
  if (!bankAccount) notFound();

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Import statement — ${bankAccount.name}`}
        description="Upload the CSV your bank exports. Re-importing an overlapping file is safe — duplicates are skipped automatically."
      />
      <AccountingNav />
      <ImportWizard bankAccountId={id} canImport={ctx.role === "owner"} />
    </div>
  );
}
