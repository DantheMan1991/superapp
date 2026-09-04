import "server-only";
import { and, eq, inArray, isNotNull, like, ne } from "drizzle-orm";
import { schema, withSystem, withTenant, type Tx } from "@/db";
import { sendEmail } from "@/lib/email/send";
import { preferredContactValue } from "@/lib/parties/contact-values";
import { listContactPoints } from "@/lib/parties/contacts";
import { localHourInTimezone, todayInTimezone } from "@/lib/timezone";
import {
  reminderIdempotencyKey,
  reminderKeyPrefix,
  sentOffsetsFromKeys,
} from "./reminder-email";
import { loadInvoiceBrand, withLogoBytes } from "./invoice-brand";
import { renderReminderMessage } from "./reminder-render";
import { invoiceTaxFields } from "./invoices";
import {
  dueReminderOffset,
  parseOffsets,
  REMINDER_SEND_HOUR,
} from "./reminder-schedule";

/**
 * The automatic invoice-reminder sweep.
 *
 * ONE CRON SERVES EVERY TIMEZONE, exactly as the digest does: it wakes hourly,
 * asks each tenant what time it is *there*, and acts on the ones where it is
 * `REMINDER_SEND_HOUR`. See `src/lib/notifications/run.ts` for why asking the
 * zone beats storing a UTC send-time (which drifts twice a year) or running a
 * cron per zone (a config change every time a client moves).
 *
 * IT IS ITS OWN CRON RATHER THAN A PASSENGER ON THE DIGEST, and the reason is
 * blast radius rather than tidiness. The digest mails OUR OWN users; this
 * mails our clients' customers, under the client's name, with nobody at the
 * keyboard. Those two want to be stoppable independently — an incident here
 * should not cost every owner their morning digest, and an incident there
 * should not silently stop the chasing that gets our clients paid.
 *
 * Nothing here decides *whether* to remind. That is `reminder-schedule.ts`,
 * which is pure and table-tested; this file finds rows and sends.
 */

export { REMINDER_SEND_HOUR };

/**
 * Reminders one tenant may send in one sweep.
 *
 * Deliberately well under `TENANT_HOURLY_CAP` (100), which is a valve that
 * fails sends rather than deferring them. Turning reminders on over a book of
 * 400 overdue invoices should not spend the tenant's whole hourly allowance
 * and log 300 failures; it should send 50 and pick up tomorrow. The schedule
 * makes that safe for free — an unsent offset is still the latest applicable
 * one on the next run, so the remainder is deferred rather than lost.
 */
export const MAX_REMINDERS_PER_TENANT_RUN = 50;

/** Statuses worth chasing. Draft is not owed yet; paid and void are settled. */
const CHASEABLE = ["issued", "partial"] as const;

export interface ReminderRunResult {
  tenantsConsidered: number;
  /** Tenants where it is `REMINDER_SEND_HOUR` right now. */
  tenantsDue: number;
  /** Of those, the ones that have switched reminders on. */
  tenantsEnabled: number;
  sent: number;
  /** Due, but the customer has no email address on file. */
  skippedNoRecipient: number;
  /** Already in the send log — a re-run, or an overlapping invocation. */
  skippedDuplicate: number;
  failed: number;
  /** Tenants that hit `MAX_REMINDERS_PER_TENANT_RUN` and will resume tomorrow. */
  tenantsCapped: number;
}

export interface DueReminder {
  invoiceId: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  issueDate: string;
  dueDate: string;
  status: string;
  memo: string;
  /** The invoice as issued — what the attached PDF must show. */
  totalCents: number;
  paidCents: number;
  /** What is still owed — what the message asks for. */
  balanceCents: number;
  offset: number;
}

/**
 * Which invoices in this tenant are due a reminder today, and which one each.
 *
 * Exported so the selection can be tested against a real database without
 * sending anything — the interesting failures (a muted customer, a paid
 * invoice, an offset already sent) are all decided here.
 */
export async function remindersDueForTenant(
  tx: Tx,
  tenantId: string,
  today: string,
  offsets: readonly number[],
  limit: number = MAX_REMINDERS_PER_TENANT_RUN,
): Promise<DueReminder[]> {
  if (offsets.length === 0) return [];

  // The two mutes are applied HERE, in the query, rather than filtered after.
  // A mute that is checked late is a mute that a future refactor can drop
  // between the read and the send.
  const candidates = await tx
    .select({
      invoiceId: schema.invoices.id,
      invoiceNumber: schema.invoices.invoiceNumber,
      issueDate: schema.invoices.issueDate,
      dueDate: schema.invoices.dueDate,
      status: schema.invoices.status,
      memo: schema.invoices.memo,
      totalCents: schema.invoices.totalCents,
      customerId: schema.customers.id,
      customerName: schema.customers.name,
    })
    .from(schema.invoices)
    .innerJoin(
      schema.customers,
      and(
        eq(schema.customers.tenantId, schema.invoices.tenantId),
        eq(schema.customers.id, schema.invoices.customerId),
      ),
    )
    .where(
      and(
        eq(schema.invoices.tenantId, tenantId),
        inArray(schema.invoices.status, [...CHASEABLE]),
        isNotNull(schema.invoices.dueDate),
        eq(schema.invoices.remindersMuted, false),
        eq(schema.customers.remindersMuted, false),
      ),
    );

  if (candidates.length === 0) return [];

  const invoiceIds = candidates.map((c) => c.invoiceId);

  const [payments, sends] = await Promise.all([
    tx
      .select({
        invoiceId: schema.invoicePayments.invoiceId,
        amountCents: schema.invoicePayments.amountCents,
      })
      .from(schema.invoicePayments)
      .where(
        and(
          eq(schema.invoicePayments.tenantId, tenantId),
          inArray(schema.invoicePayments.invoiceId, invoiceIds),
        ),
      ),
    tx
      .select({ idempotencyKey: schema.outboundEmails.idempotencyKey })
      .from(schema.outboundEmails)
      .where(
        and(
          eq(schema.outboundEmails.tenantId, tenantId),
          eq(schema.outboundEmails.kind, "invoice_reminder"),
          like(schema.outboundEmails.idempotencyKey, "reminder:%"),
        ),
      ),
  ]);

  const paidByInvoice = new Map<string, number>();
  for (const p of payments) {
    paidByInvoice.set(
      p.invoiceId,
      (paidByInvoice.get(p.invoiceId) ?? 0) + p.amountCents,
    );
  }

  // Bucket the log by invoice once, rather than a `like` query per invoice.
  const keysByInvoice = new Map<string, string[]>();
  for (const s of sends) {
    for (const id of invoiceIds) {
      if (s.idempotencyKey.startsWith(reminderKeyPrefix(id))) {
        const list = keysByInvoice.get(id);
        if (list) list.push(s.idempotencyKey);
        else keysByInvoice.set(id, [s.idempotencyKey]);
        break;
      }
    }
  }

  const due: DueReminder[] = [];
  for (const c of candidates) {
    const paidCents = paidByInvoice.get(c.invoiceId) ?? 0;
    const balanceCents = c.totalCents - paidCents;
    // Status says issued/partial, but a payment landing between the status
    // derivation and here — or an overpayment — should never be chased.
    if (balanceCents <= 0) continue;

    const offset = dueReminderOffset({
      dueDate: c.dueDate,
      today,
      offsets,
      sentOffsets: sentOffsetsFromKeys(keysByInvoice.get(c.invoiceId) ?? []),
    });
    if (offset === null) continue;

    due.push({
      invoiceId: c.invoiceId,
      invoiceNumber: c.invoiceNumber,
      customerId: c.customerId,
      customerName: c.customerName,
      issueDate: c.issueDate,
      dueDate: c.dueDate!,
      status: c.status,
      memo: c.memo,
      totalCents: c.totalCents,
      paidCents,
      balanceCents,
      offset,
    });
  }

  // Most overdue first, so a capped run spends its budget on the invoices that
  // have been waiting longest rather than on whatever the planner returned.
  due.sort((a, b) => b.offset - a.offset);
  return due.slice(0, limit);
}

/** Active tenants, with the timezone that decides whether it is their 8am. */
async function tenantsToConsider() {
  // withSystem, justified (S2): trusted background code enumerating tenants.
  // No user input reaches this — the run picks its own work, the same property
  // the digest and mail-sync crons rely on.
  return withSystem((tx) =>
    tx
      .select({
        id: schema.tenants.id,
        timezone: schema.tenants.timezone,
        name: schema.tenants.name,
      })
      .from(schema.tenants)
      .where(ne(schema.tenants.status, "churned")),
  );
}

/**
 * Send every reminder that is due at this moment.
 *
 * `now` is injectable so the whole thing is testable without waiting for 8am.
 */
export async function runInvoiceReminders(
  now: Date = new Date(),
): Promise<ReminderRunResult> {
  const result: ReminderRunResult = {
    tenantsConsidered: 0,
    tenantsDue: 0,
    tenantsEnabled: 0,
    sent: 0,
    skippedNoRecipient: 0,
    skippedDuplicate: 0,
    failed: 0,
    tenantsCapped: 0,
  };

  const tenants = await tenantsToConsider();
  result.tenantsConsidered = tenants.length;

  for (const tenant of tenants) {
    if (localHourInTimezone(tenant.timezone, now) !== REMINDER_SEND_HOUR) continue;
    result.tenantsDue += 1;

    const today = todayInTimezone(tenant.timezone, now);

    try {
      /**
       * `staff`, the least privileged role, deliberately. Reminders read
       * invoices and customers, neither of which is visibility-bearing, so
       * there is nothing here that needs owner sight — and passing a role that
       * did not come from `requireTenant()` is exactly the mistake the
       * `withTenant` contract warns about.
       */
      const work = await withTenant(tenant.id, async (tx) => {
        const settings = await tx.query.accountingSettings.findFirst({
          where: eq(schema.accountingSettings.tenantId, tenant.id),
        });
        if (!settings?.remindersEnabled) return null;

        const offsets = parseOffsets(settings.reminderOffsets);
        const due = await remindersDueForTenant(tx, tenant.id, today, offsets);

        // Recipients resolved inside the same transaction as the selection, so
        // a customer's contact points cannot change underneath the send.
        const withRecipients = await Promise.all(
          due.map(async (d) => {
            const customer = await tx.query.customers.findFirst({
              where: and(
                eq(schema.customers.tenantId, tenant.id),
                eq(schema.customers.id, d.customerId),
              ),
              columns: { partyId: true, address: true },
            });
            const contacts = customer
              ? await listContactPoints(tx, tenant.id, customer.partyId)
              : [];
            const lines = await tx.query.invoiceLines.findMany({
              where: and(
                eq(schema.invoiceLines.tenantId, tenant.id),
                eq(schema.invoiceLines.invoiceId, d.invoiceId),
              ),
              orderBy: (l, { asc }) => [asc(l.lineNo)],
            });
            const invoiceRow = await tx.query.invoices.findFirst({
              where: and(
                eq(schema.invoices.tenantId, tenant.id),
                eq(schema.invoices.id, d.invoiceId),
              ),
              columns: {
                entityId: true,
                taxRateId: true,
                taxRatePpm: true,
                taxCents: true,
                subtotalCents: true,
              },
            });
            return {
              due: d,
              // Per invoice, because each company may carry its own look;
              // the logo bytes are fetched outside the transaction below.
              brand: await loadInvoiceBrand(
                tx,
                tenant.id,
                invoiceRow?.entityId ?? null,
              ),
              to: preferredContactValue(contacts, "email") ?? "",
              customerAddress: customer?.address ?? "",
              customerEmail: preferredContactValue(contacts, "email") ?? "",
              tax: invoiceRow
                ? await invoiceTaxFields(tx, tenant.id, invoiceRow)
                : { subtotalCents: d.totalCents, taxCents: 0, taxLabel: "Sales Tax" },
              lines: lines.map((l) => ({
                description: l.description,
                quantity: l.quantity,
                unitPriceCents: l.unitPriceCents,
                amountCents: l.amountCents,
              })),
            };
          }),
        );
        return { items: withRecipients };
      });

      if (work === null) continue;
      result.tenantsEnabled += 1;
      if (work.items.length >= MAX_REMINDERS_PER_TENANT_RUN) {
        result.tenantsCapped += 1;
      }

      // Sending happens OUTSIDE the transaction: rendering a PDF and waiting on
      // the mail provider are slow, and holding a tenant's transaction open
      // across them would pin a pooled connection for the whole sweep.
      // One logo fetch per tenant per run, not one per reminder.
      const logoCache = new Map<string, Uint8Array | null>();
      for (const item of work.items) {
        if (item.to === "") {
          result.skippedNoRecipient += 1;
          continue;
        }
        try {
          // Shared with the owner's test-send button — see reminder-render.ts
          // for why there is exactly one of these.
          const { email, pdf } = await renderReminderMessage(item.due, {
            businessName: item.brand.businessName,
            brand: await withLogoBytes(item.brand, logoCache),
            customerAddress: item.customerAddress,
            customerEmail: item.customerEmail,
            tax: item.tax,
            lines: item.lines,
          });

          const sent = await sendEmail({
            tenantId: tenant.id,
            kind: "invoice_reminder",
            to: item.to,
            subject: email.subject,
            text: email.text,
            html: email.html,
            idempotencyKey: reminderIdempotencyKey(
              item.due.invoiceId,
              item.due.offset,
              item.to,
            ),
            attachments: [{ filename: email.attachmentFilename, content: pdf }],
          });

          if (sent.ok && sent.duplicate) result.skippedDuplicate += 1;
          else if (sent.ok) result.sent += 1;
          else {
            result.failed += 1;
            // Reason only — never the address or the subject (S9).
            console.error(
              `invoice reminder failed for tenant ${tenant.id}: ${sent.reason}`,
            );
          }
        } catch (err) {
          result.failed += 1;
          console.error(`invoice reminder failed for tenant ${tenant.id}`, err);
        }
      }
    } catch (err) {
      result.failed += 1;
      console.error(`invoice reminder sweep failed for tenant ${tenant.id}`, err);
    }
  }

  return result;
}
