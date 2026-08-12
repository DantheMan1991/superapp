import { formatCents } from "@/lib/money";
import { escapeHtml } from "./invoice-email";
import { reminderTone } from "./reminder-schedule";

/**
 * What the customer receives when an invoice is coming due, due, or late.
 * Pure — no database, no sending.
 *
 * Split from the sender for the same reason `invoice-email.ts` is: the
 * idempotency key is the only thing between a re-run cron and a customer
 * being chased twice for the same invoice on the same day, and a key deserves
 * table tests rather than a careful reading.
 *
 * Money carries no currency symbol here because nothing else in the module
 * does — `formatCents` is what the invoice email, the PDF and every screen
 * use. Consistency with the invoice the customer already received beats
 * being marginally clearer in one message.
 */

export interface ReminderEmailInput {
  businessName: string;
  invoiceNumber: string;
  customerName: string;
  balanceCents: number;
  dueDate: string;
  /** Days relative to the due date; decides whether this nudges or chases. */
  offset: number;
  /** The owner's own note from the invoice, if any. */
  memo: string;
}

export interface ReminderEmail {
  subject: string;
  text: string;
  html: string;
  attachmentFilename: string;
}

/**
 * Stable per (invoice, offset, recipient) and NOTHING else.
 *
 * The offset is in the key rather than the date, so a sweep that runs twice —
 * a retry, an overlapping invocation, a tenant whose local 8am is revisited
 * when clocks go back — is a no-op the second time. Keying on the date instead
 * would make the autumn DST repeat of 01:00–02:00 a second email.
 *
 * Uuids cannot contain a colon and neither can an offset, so the prefix
 * `reminder:<id>:` matches every reminder for one invoice exactly, which is
 * how the sweep learns what it has already sent.
 */
export function reminderIdempotencyKey(
  invoiceId: string,
  offset: number,
  recipient: string,
): string {
  return `reminder:${invoiceId}:${offset}:${recipient.trim().toLowerCase()}`;
}

/** The prefix matching every reminder for one invoice, any offset, any address. */
export function reminderKeyPrefix(invoiceId: string): string {
  return `reminder:${invoiceId}:`;
}

/**
 * Recover the offsets already sent for an invoice from its log keys.
 *
 * This is what makes `sentOffsets` derivable rather than stored — the same
 * call `send-invoice.ts` made when it decided there is no `sent_at` column.
 * Anything unparseable is ignored rather than thrown on: a key written by a
 * future version must not be able to stop today's sweep.
 */
export function sentOffsetsFromKeys(keys: readonly string[]): number[] {
  const offsets: number[] = [];
  for (const key of keys) {
    const parts = key.split(":");
    if (parts.length < 4 || parts[0] !== "reminder") continue;
    const offset = Number(parts[2]);
    if (Number.isInteger(offset)) offsets.push(offset);
  }
  return offsets;
}

export function buildReminderEmail(input: ReminderEmailInput): ReminderEmail {
  const amount = formatCents(input.balanceCents);
  const greetingName = input.customerName.trim();
  const memo = input.memo.trim();
  const tone = reminderTone(input.offset);

  // The number goes in the subject because that is what somebody searches
  // their inbox for — the same reasoning as the invoice email, and it also
  // means a reminder threads next to the invoice it is about.
  const subject =
    tone === "overdue"
      ? `Overdue: invoice ${input.invoiceNumber} from ${input.businessName}`
      : tone === "due_today"
        ? `Due today: invoice ${input.invoiceNumber} from ${input.businessName}`
        : `Reminder: invoice ${input.invoiceNumber} from ${input.businessName}`;

  // No blame, no threat, no invented consequence. The overdue wording states
  // the number of days and stops — anything stronger is a decision only the
  // business owner can make, and they did not type this message.
  const opening =
    tone === "overdue"
      ? `This is a reminder that invoice ${input.invoiceNumber} for ${amount} was due on ${input.dueDate}, ${input.offset === 1 ? "1 day" : `${input.offset} days`} ago.`
      : tone === "due_today"
        ? `This is a reminder that invoice ${input.invoiceNumber} for ${amount} is due today.`
        : `This is a reminder that invoice ${input.invoiceNumber} for ${amount} is due on ${input.dueDate}.`;

  const closing =
    tone === "overdue"
      ? "If you have already sent payment, please ignore this message."
      : "A copy is attached for your records.";

  const lines = [
    greetingName ? `Hi ${greetingName},` : "Hi,",
    "",
    opening,
    ...(memo ? ["", memo] : []),
    "",
    closing,
    "",
    "Thanks,",
    input.businessName,
  ];

  const html = [
    `<p>${greetingName ? `Hi ${escapeHtml(greetingName)},` : "Hi,"}</p>`,
    `<p>${escapeHtml(opening)}</p>`,
    ...(memo ? [`<p>${escapeHtml(memo)}</p>`] : []),
    `<p>${escapeHtml(closing)}</p>`,
    `<p>Thanks,<br>${escapeHtml(input.businessName)}</p>`,
  ].join("\n");

  return {
    subject,
    text: lines.join("\n"),
    html,
    attachmentFilename: `invoice-${input.invoiceNumber.replace(/[^A-Za-z0-9._-]/g, "-")}.pdf`,
  };
}
