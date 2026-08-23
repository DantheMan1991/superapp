import "server-only";
import { and, eq, like } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { sendEmail, type SendResult } from "@/lib/email/send";
import { preferredContactValue } from "@/lib/parties/contact-values";
import { listContactPoints } from "@/lib/parties/contacts";
import { LedgerError, requireOwnerRole, type LedgerCtx } from "../core";
import {
  reminderKeyPrefix,
  reminderTestIdempotencyKey,
  sentOffsetsFromKeys,
  testSubject,
} from "./reminder-email";
import { renderReminderMessage } from "./reminder-render";
import { invoiceTaxFields } from "./invoices";
import { nextReminder, parseOffsets } from "./reminder-schedule";
import type { DueReminder } from "./reminder-run";

/**
 * "Send this reminder to me" — the owner checking the wording on themselves.
 *
 * WHY THIS EXISTS: automatic reminders were the first thing in the module that
 * emails a person with nobody at the keyboard, and the only way to watch one
 * work was to switch them on over real customers and wait for 8am. That is a
 * bad way to discover a wrong due date or a business name that reads oddly.
 *
 * It goes through the SAME renderer the sweep uses (`reminder-render.ts`), so
 * what arrives is what a customer would get. Three things differ, all of them
 * about safety rather than content:
 *
 *   • the recipient is the owner's own address, read from `profiles` — never
 *     from anything typed into a form, the same rule the digest follows;
 *   • the subject is marked `[Test]` so a forwarded copy cannot be mistaken
 *     for the real thing (the BODY is byte-identical, which is the point);
 *   • the send is keyed outside the `reminder:` namespace, so testing an
 *     offset never suppresses the real reminder for it.
 *
 * It works whether or not reminders are switched ON — checking the wording
 * before committing to send it is the main thing somebody wants to do.
 */

/** Statuses worth chasing, and therefore worth testing. Mirrors the sweep. */
const CHASEABLE = new Set(["issued", "partial"]);

export interface TestReminderResult {
  to: string;
  offset: number;
  result: SendResult;
}

export async function sendTestReminder(
  tx: Tx,
  ctx: LedgerCtx,
  args: { invoiceId: string; nonce: string },
): Promise<TestReminderResult> {
  // Owner only: it sends mail as the business, even though it sends it inward.
  requireOwnerRole(ctx);

  const invoice = await tx.query.invoices.findFirst({
    where: and(
      eq(schema.invoices.tenantId, ctx.tenantId),
      eq(schema.invoices.id, args.invoiceId),
    ),
  });
  if (!invoice) throw new LedgerError("INVOICE_NOT_FOUND", "invoice not found");
  if (!CHASEABLE.has(invoice.status) || invoice.dueDate === null) {
    throw new LedgerError(
      "REMINDER_NOT_TESTABLE",
      "only an unpaid invoice with a due date has a reminder to preview",
    );
  }

  const settings = await tx.query.accountingSettings.findFirst({
    where: eq(schema.accountingSettings.tenantId, ctx.tenantId),
  });
  const offsets = parseOffsets(settings?.reminderOffsets);
  if (offsets.length === 0) {
    throw new LedgerError(
      "REMINDER_SCHEDULE_EMPTY",
      "add at least one reminder before turning them on",
    );
  }

  const [customer, lines, payments, sends] = await Promise.all([
    tx.query.customers.findFirst({
      where: and(
        eq(schema.customers.tenantId, ctx.tenantId),
        eq(schema.customers.id, invoice.customerId),
      ),
    }),
    tx.query.invoiceLines.findMany({
      where: and(
        eq(schema.invoiceLines.tenantId, ctx.tenantId),
        eq(schema.invoiceLines.invoiceId, invoice.id),
      ),
      orderBy: (l, { asc }) => [asc(l.lineNo)],
    }),
    tx.query.invoicePayments.findMany({
      where: and(
        eq(schema.invoicePayments.tenantId, ctx.tenantId),
        eq(schema.invoicePayments.invoiceId, invoice.id),
      ),
      columns: { amountCents: true },
    }),
    tx
      .select({ idempotencyKey: schema.outboundEmails.idempotencyKey })
      .from(schema.outboundEmails)
      .where(
        and(
          eq(schema.outboundEmails.tenantId, ctx.tenantId),
          eq(schema.outboundEmails.kind, "invoice_reminder"),
          like(
            schema.outboundEmails.idempotencyKey,
            `${reminderKeyPrefix(invoice.id)}%`,
          ),
        ),
      ),
  ]);

  const paidCents = payments.reduce((s, p) => s + p.amountCents, 0);
  const balanceCents = invoice.totalCents - paidCents;

  /**
   * WHICH reminder to preview is decided here, not by the caller.
   *
   * The next one this invoice would actually receive, so the button answers
   * "what is about to go out". When the schedule has already run its course
   * there is no next one, and the last offset is the honest stand-in — you are
   * checking the wording, and that is the wording it ended on.
   */
  const next = nextReminder({
    dueDate: invoice.dueDate,
    // `today` only orders the offsets; the due date is what the wording uses.
    today: invoice.dueDate,
    offsets,
    sentOffsets: sentOffsetsFromKeys(sends.map((s) => s.idempotencyKey)),
  });
  const offset = next?.offset ?? offsets[offsets.length - 1];

  const contacts = customer
    ? await listContactPoints(tx, ctx.tenantId, customer.partyId)
    : [];
  const tenant = await tx.query.tenants.findFirst({
    where: eq(schema.tenants.id, ctx.tenantId),
    columns: { name: true },
  });

  // The owner's OWN address, from profiles. Never a parameter.
  const profile = await tx.query.profiles.findFirst({
    where: eq(schema.profiles.clerkUserId, ctx.userId),
    columns: { email: true },
  });
  const to = profile?.email ?? "";
  if (to === "") {
    throw new LedgerError(
      "INVOICE_NO_RECIPIENT",
      "your own account has no email address to send the test to",
    );
  }

  const due: DueReminder = {
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    customerId: invoice.customerId,
    customerName: customer?.name ?? "",
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    status: invoice.status,
    memo: invoice.memo,
    totalCents: invoice.totalCents,
    paidCents,
    balanceCents,
    offset,
  };

  const { email, pdf } = await renderReminderMessage(due, {
    businessName: tenant?.name ?? "",
    customerAddress: customer?.address ?? "",
    customerEmail: preferredContactValue(contacts, "email") ?? "",
    // The same resolver the sweep uses, so the preview shows the tax the real
    // reminder would attach.
    tax: await invoiceTaxFields(tx, ctx.tenantId, invoice),
    lines: lines.map((l) => ({
      description: l.description,
      quantity: l.quantity,
      unitPriceCents: l.unitPriceCents,
      amountCents: l.amountCents,
    })),
  });

  const result = await sendEmail({
    tenantId: ctx.tenantId,
    kind: "invoice_reminder_test",
    to,
    subject: testSubject(email.subject),
    text: email.text,
    html: email.html,
    idempotencyKey: reminderTestIdempotencyKey(invoice.id, offset, to, args.nonce),
    attachments: [{ filename: email.attachmentFilename, content: pdf }],
  });

  return { to, offset, result };
}
