import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { withTenant, schema } from "@/db";
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
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Import statement — {bankAccount.name}
        </h1>
        <p className="text-sm text-muted-foreground">
          Upload the CSV your bank exports. Re-importing an overlapping file is
          safe — duplicates are skipped automatically.
        </p>
      </div>
      <AccountingNav />
      <ImportWizard bankAccountId={id} canImport={ctx.role === "owner"} />
    </div>
  );
}
