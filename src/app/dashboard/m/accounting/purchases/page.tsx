import { notFound, redirect } from "next/navigation";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled, canReach } from "@/lib/modules";

/** Purchases lands on the first section this person can open. See sales/page.tsx. */
const SECTIONS = [
  ["accounting:bills", "/dashboard/m/accounting/purchases/bills"],
  ["accounting:vendors", "/dashboard/m/accounting/purchases/vendors"],
] as const;

export default async function PurchasesPage() {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "accounting");
  for (const [key, href] of SECTIONS) {
    if (await canReach(ctx.tenant.id, key)) redirect(href);
  }
  notFound();
}
