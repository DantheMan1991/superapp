import { redirect } from "next/navigation";

/**
 * Recurring invoices moved out of Sales.
 *
 * They live with recurring bills and journals now — one table, one engine, one
 * list. This page stays behind because bookmarks and browser history do not
 * update themselves, and a 404 is a worse answer than the list they wanted.
 */
export default function RecurringInvoicesMoved() {
  redirect("/dashboard/m/accounting/recurring");
}
