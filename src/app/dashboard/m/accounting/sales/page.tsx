import { notFound, redirect } from "next/navigation";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled, canReach } from "@/lib/modules";

/**
 * Sales has no page of its own — it lands on the first section this person can
 * open (ADR 0097).
 *
 * It used to redirect flatly to Invoices. Once each child became an area that
 * an access level can take away, a flat redirect sent anybody without Invoices
 * into a 404 — and the alternative, giving this path to the Invoices area,
 * hid the Sales tab entirely and stranded Customers: reachable by URL, with no
 * door in the product.
 *
 * Landing past what somebody cannot open means any combination works. The order
 * is the sub-nav's own, so the landing matches the first pill they see.
 */
const SECTIONS = [
  ["accounting:invoices", "/dashboard/m/accounting/sales/invoices"],
  ["accounting:customers", "/dashboard/m/accounting/sales/customers"],
  ["accounting:reminders", "/dashboard/m/accounting/sales/reminders"],
  ["accounting:catalogue", "/dashboard/m/accounting/sales/catalogue"],
  ["accounting:credit-memos", "/dashboard/m/accounting/sales/credit-memos"],
  ["accounting:invoice-recurring", "/dashboard/m/accounting/sales/recurring"],
] as const;

export default async function SalesPage() {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "accounting");
  for (const [key, href] of SECTIONS) {
    if (await canReach(ctx.tenant.id, key)) redirect(href);
  }
  // Every section of Sales is closed to them, so Sales is closed to them.
  notFound();
}
