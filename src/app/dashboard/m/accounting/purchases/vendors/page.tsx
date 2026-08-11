import { and, eq } from "drizzle-orm";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { withTenant, schema } from "@/db";
import { Building2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/app/page-header";
import { DataTable } from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listContactPointsFor } from "@/lib/parties/contacts";
import { preferredContactValue } from "@/lib/parties/contact-values";
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
    // The vendor's email and phone are contact points on its party since 0075
    // — one query for the page rather than one per row.
    const contacts = await listContactPointsFor(
      tx,
      tenantId,
      vendors.map((v) => v.partyId),
    );
    return { vendors, accounts, contacts };
  });

  const reach = (partyId: string) => {
    const points = data.contacts.get(partyId) ?? [];
    return {
      email: preferredContactValue(points, "email"),
      phone: preferredContactValue(points, "phone"),
    };
  };

  const accountName = new Map(
    data.accounts.map((a) => [a.id, `${a.code} · ${a.name}`]),
  );
  const accountOptions = data.accounts
    .filter((a) => ["expense", "asset"].includes(a.accountType))
    .map((a) => ({ id: a.id, label: `${a.code} · ${a.name}` }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vendors"
        description={`Who ${ctx.tenant.name} buys from. A default expense account prefills new bill lines.`}
        actions={<VendorDialogButton accounts={accountOptions} />}
      />

      <AccountingNav />
      <PurchasesNav />

      <DataTable
        isEmpty={data.vendors.length === 0}
        empty={
          <EmptyState
            icon={<Building2 />}
            title="No vendors yet"
            description="They are created for you when a bill comes in from an emailed document, or you can add one now."
            action={<VendorDialogButton accounts={accountOptions} />}
          />
        }
      >
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
                  {[reach(vendor.partyId).email, reach(vendor.partyId).phone]
                    .filter(Boolean)
                    .join(" · ") || "—"}
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
                      email: reach(vendor.partyId).email,
                      phone: reach(vendor.partyId).phone,
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
      </DataTable>
    </div>
  );
}
