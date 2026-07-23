import { and, eq } from "drizzle-orm";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { withTenant, schema } from "@/db";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AccountingNav } from "@/modules/accounting/components/accounting-nav";
import { listVendors } from "@/modules/accounting/payables/vendors";
import { PurchasesNav } from "../purchases-nav";
import { VendorDialogButton } from "./vendor-dialogs";

export const dynamic = "force-dynamic";

export default async function VendorsPage() {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "accounting");
  const tenantId = ctx.tenant.id;

  const data = await withTenant(tenantId, async (tx) => {
    const vendors = await listVendors(tx, tenantId, { includeInactive: true });
    const accounts = await tx.query.accounts.findMany({
      where: and(
        eq(schema.accounts.tenantId, tenantId),
        eq(schema.accounts.isActive, true),
      ),
      orderBy: (a, { asc }) => [asc(a.code)],
    });
    return { vendors, accounts };
  });

  const accountName = new Map(
    data.accounts.map((a) => [a.id, `${a.code} · ${a.name}`]),
  );
  const accountOptions = data.accounts
    .filter((a) => ["expense", "asset"].includes(a.accountType))
    .map((a) => ({ id: a.id, label: `${a.code} · ${a.name}` }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Vendors</h1>
          <p className="text-sm text-muted-foreground">
            Who {ctx.tenant.name} buys from. A default expense account prefills
            new bill lines.
          </p>
        </div>
        <VendorDialogButton accounts={accountOptions} />
      </div>

      <AccountingNav />
      <PurchasesNav />

      {data.vendors.length === 0 ? (
        <p className="rounded-md border px-4 py-10 text-center text-sm text-muted-foreground">
          No vendors yet — they're created automatically when you make a bill
          from an emailed document, or add one here.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="hidden sm:table-cell">Contact</TableHead>
              <TableHead className="hidden md:table-cell">Default account</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.vendors.map((vendor) => (
              <TableRow key={vendor.id}>
                <TableCell className="font-medium">{vendor.name}</TableCell>
                <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">
                  {[vendor.email, vendor.phone].filter(Boolean).join(" · ") || "—"}
                </TableCell>
                <TableCell className="hidden text-sm md:table-cell">
                  {vendor.defaultExpenseAccountId
                    ? accountName.get(vendor.defaultExpenseAccountId)
                    : "—"}
                </TableCell>
                <TableCell>
                  {vendor.isActive ? (
                    <Badge variant="secondary">active</Badge>
                  ) : (
                    <Badge variant="outline">inactive</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <VendorDialogButton
                    accounts={accountOptions}
                    vendor={{
                      id: vendor.id,
                      version: vendor.version,
                      name: vendor.name,
                      email: vendor.email,
                      phone: vendor.phone,
                      address: vendor.address,
                      notes: vendor.notes,
                      defaultExpenseAccountId: vendor.defaultExpenseAccountId,
                      isActive: vendor.isActive,
                    }}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
