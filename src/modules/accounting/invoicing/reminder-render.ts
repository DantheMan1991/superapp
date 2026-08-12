import "server-only";
import { renderInvoicePdf } from "./invoice-pdf";
import { buildReminderEmail, type ReminderEmail } from "./reminder-email";
import type { DueReminder } from "./reminder-run";

/**
 * Turning one due reminder into the message that goes out — subject, body and
 * the attached invoice.
 *
 * THE WHOLE POINT OF THIS FILE IS THAT THERE IS ONE OF IT. The nightly sweep
 * and the owner's "send a test to me" button both call it, so a test can never
 * prove a message the sweep would not actually send. Two code paths that
 * build "the same" email is exactly how a test button becomes reassuring and
 * wrong.
 */

/** The per-invoice extras the PDF needs beyond `DueReminder`. */
export interface ReminderRenderContext {
  businessName: string;
  customerAddress: string;
  customerEmail: string;
  lines: ReadonlyArray<{
    description: string;
    /** A decimal string, not a number — see `lines.ts` (P15/P16). */
    quantity: string;
    unitPriceCents: number;
    amountCents: number;
  }>;
}

export async function renderReminderMessage(
  due: DueReminder,
  ctx: ReminderRenderContext,
): Promise<{ email: ReminderEmail; pdf: Uint8Array }> {
  const email = buildReminderEmail({
    businessName: ctx.businessName,
    invoiceNumber: due.invoiceNumber,
    customerName: due.customerName,
    balanceCents: due.balanceCents,
    dueDate: due.dueDate,
    offset: due.offset,
    memo: due.memo,
  });

  // The invoice AS ISSUED, not the balance. A reminder that attaches a
  // document whose total silently equals the outstanding amount is a different
  // invoice from the one the customer agreed to, and the first person to
  // notice would be their bookkeeper.
  const pdf = await renderInvoicePdf({
    businessName: ctx.businessName,
    invoiceNumber: due.invoiceNumber,
    status: due.status,
    issueDate: due.issueDate,
    dueDate: due.dueDate,
    memo: due.memo,
    totalCents: due.totalCents,
    paidCents: due.paidCents,
    customerName: due.customerName,
    customerAddress: ctx.customerAddress,
    customerEmail: ctx.customerEmail,
    lines: [...ctx.lines],
  });

  return { email, pdf };
}
