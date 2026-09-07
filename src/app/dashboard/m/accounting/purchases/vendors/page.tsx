import { and, eq } from "drizzle-orm";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { withTenant, schema } from "@/db";
import { Building2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/app/page-header";
import { DataTable } from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import { ListSearch } from "@/components/app/list-search";
import { Pager } from "@/components/app/pager";
import { matchesAny, pageFrom, pageWindow, searchTerm } from "@/lib/list-query";
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
import { listPaymentTerms } from "@/modules/accounting/invoicing/catalogue";
import { PurchasesNav } from "../purchases-nav";
import { VendorDialogButton } from "./vendor-dialogs";

export const dynamic = "force-dynamic";

/** Rows per page. */
const PAGE_SIZE = 50;

export default async function VendorsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "accounting");
  const tenantId = ctx.tenant.id;
  const sp = await searchParams;
  const term = searchTerm(sp.q);

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
    // Every term, active or not — see the customers page.
    const terms = await listPaymentTerms(tx, tenantId);
    return { vendors, accounts, contacts, terms };
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
  const termName = new Map(data.terms.map((t) => [t.id, t.name]));
  const termOptions = data.terms.map((t) => ({ id: t.id, name: t.name, isActive: t.isActive }));

  // Filtered in memory, like the customer list: the search reads the name,
  // the email and the phone the row shows.
  const matching = data.vendors.filter((v) => {
    const r = reach(v.partyId);
    return matchesAny(term, [v.name, r.email, r.phone]);
  });
  const window = pageWindow(pageFrom(sp.page), PAGE_SIZE, matching.length);
  const shown = matching.slice(window.offset, window.offset + PAGE_SIZE);
  const pageHref = (page: number) => {
    const p = new URLSearchParams();
    if (term) p.set("q", term);
    if (page > 1) p.set("page", String(page));
    const s = p.toString();
    return `/dashboard/m/accounting/purchases/vendors${s ? `?${s}` : ""}`;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vendors"
        description={`Who ${ctx.tenant.name} buys from. A default expense account prefills new bill lines.`}
        actions={<VendorDialogButton accounts={accountOptions} terms={termOptions} />}
      />

      <AccountingNav />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <PurchasesNav />
        <ListSearch placeholder="Search name, email or phone" />
      </div>

      <DataTable
        isEmpty={shown.length === 0}
        empty={
          <EmptyState
            icon={<Building2 />}
            title={term ? `Nothing matches “${term}”` : "No vendors yet"}
            description={
              term
                ? "Try fewer words, or add them now."
                : "They are created for you when a bill comes in from an emailed document, or you can add one now."
            }
            action={<VendorDialogButton accounts={accountOptions} terms={termOptions} />}
          />
        }
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="hidden sm:table-cell">Contact</TableHead>
              <TableHead className="hidden md:table-cell">Default account</TableHead>
              <TableHead className="hidden md:table-cell">Terms</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((vendor) => (
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
                <TableCell className="hidden text-sm md:table-cell">
                  {vendor.paymentTermsId ? (termName.get(vendor.paymentTermsId) ?? "—") : "—"}
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
                    terms={termOptions}
                    vendor={{
                      id: vendor.id,
                      version: vendor.version,
                      name: vendor.name,
                      email: reach(vendor.partyId).email,
                      phone: reach(vendor.partyId).phone,
                      address: vendor.address,
                      notes: vendor.notes,
                      defaultExpenseAccountId: vendor.defaultExpenseAccountId,
                      paymentTermsId: vendor.paymentTermsId,
                      isActive: vendor.isActive,
                    }}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </DataTable>

      <Pager
        window={window}
        noun={{ one: "vendor", many: "vendors" }}
        hrefFor={pageHref}
        labels={{ prev: "Previous", next: "Next" }}
      />
    </div>
  );
}
