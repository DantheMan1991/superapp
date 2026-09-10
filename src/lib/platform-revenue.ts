import "server-only";
import type Stripe from "stripe";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { withSystem, withTenant, schema } from "@/db";
import type { OperatorPosting, RetainerPurchase } from "@/db/schema";
import { isModuleEnabled } from "@/lib/modules";
import { getOperatorTenant } from "@/lib/operator-tenant";
import { loadParty, PartyError } from "@/lib/parties";
import { getStripe, hourBlockForKey } from "@/lib/stripe";
import { getTenantTimezone } from "@/lib/tenant-timezone";
import { DEFAULT_TIMEZONE, dateInTimezone } from "@/lib/timezone";
import { LedgerError } from "@/modules/accounting/core/errors";
import type { LedgerCtx } from "@/modules/accounting/core/types";
import {
  createInvoiceDraft,
  issueInvoice,
} from "@/modules/accounting/invoicing/invoices";
import { recordPayment } from "@/modules/accounting/invoicing/payments";

/**
 * The platform's own revenue reaches the operator's books (ADR 0043,
 * back-office slice 5).
 *
 * What a client pays Stripe — a subscription invoice, an hour block — becomes
 * a PAID INVOICE in the operator tenant's own accounting, made through
 * Accounting's ordinary verbs: a draft with one line to Service Revenue,
 * issued, and paid into Undeposited Funds, on the day Stripe says it was paid.
 * The bank feed later matches the payout, the way any business's card takings
 * reach its bank. Nothing here is a second ledger.
 *
 * IDEMPOTENT ON STRIPE'S ID, twice over. `operator_postings` claims each
 * Stripe object once (`stripe_object_id UNIQUE`) and remembers what became of
 * it — posted, with the invoice; or skipped, with the reason — so the webhook,
 * a redelivery, the backfill and a retry all meet the same row. And the
 * invoice carries the id in its memo, so a crash between the ledger write and
 * the posting row's update is found on the next attempt rather than posted
 * twice.
 *
 * AS THE OPERATOR'S OWNER, WITH NO USER. Every posting verb requires an owner
 * (`requireOwnerRole`), and there is nobody at the keyboard: the caller is the
 * signature-verified webhook or the console's backfill. Nobody is elevated —
 * the platform is posting its own sales into its own books — which is the
 * distinction ADR 0011 drew when it refused to elevate a staff member's role.
 * A machine source for invoices would have widened who may issue one.
 *
 * WHY THIS FILE, UNDER src/lib, IMPORTS A MODULE. Layer 0 billing code has to
 * call Accounting's verbs, exactly as the console's provisioning does;
 * `src/lib/enterprises` is the precedent for a lib that imports a module by
 * name. It never reaches into Accounting's tables directly.
 */

export type PostingKind = "subscription_invoice" | "hour_block";

export interface PlatformCharge {
  kind: PostingKind;
  /** The Stripe object this charge IS — an invoice id, a checkout session id. */
  stripeObjectId: string;
  /** The client the charge was for; null when Stripe's customer is unknown to us. */
  clientTenantId: string | null;
  amountCents: number;
  currency: string;
  /** When Stripe says it was paid. */
  paidAt: Date;
  /** The line's words on the operator's invoice. */
  description: string;
}

export const SKIP_REASONS = {
  pending: "Not attempted yet.",
  zero_amount: "Nothing was paid.",
  currency: "Not in US dollars — the books are single-currency.",
  no_operator: "No operator tenant is named.",
  accounting_off: "Accounting is not switched on for the operator.",
  unknown_client: "Stripe's customer is not a workspace this platform knows.",
  no_party:
    "The client has no party in the operator's CRM yet — create it, then retry.",
  no_income_account:
    "The operator's books have no Service Revenue (4010) or Sales (4000) account.",
  no_deposit_account: "The operator's books have no Undeposited Funds account.",
  before_books_start: "Dated before the day the operator's books begin.",
  ledger_refused: "The ledger refused the posting — see the server log.",
} as const;

export type SkipReason = keyof typeof SKIP_REASONS;

export type PostingOutcome =
  | { status: "posted"; invoiceId: string; already: boolean }
  | { status: "skipped"; reason: SkipReason };

function skip(reason: SkipReason): PostingOutcome {
  return { status: "skipped", reason };
}

/** The marker an operator invoice carries so a Stripe object is never posted twice. */
export function stripeMarker(stripeObjectId: string): string {
  return `stripe:${stripeObjectId}`;
}

/**
 * Post one charge. Claims the Stripe object, attempts the ledger write, and
 * records what became of it. Safe to call again for the same object at any
 * time: a posted one answers with its invoice, a skipped one is attempted
 * again (a client that has since got its party posts on the retry).
 */
export async function postPlatformCharge(charge: PlatformCharge): Promise<PostingOutcome> {
  const claimed = await withSystem(async (tx) => {
    await tx
      .insert(schema.operatorPostings)
      .values({
        kind: charge.kind,
        stripeObjectId: charge.stripeObjectId,
        clientTenantId: charge.clientTenantId,
        amountCents: charge.amountCents,
        currency: charge.currency.toLowerCase(),
        paidAt: charge.paidAt,
        description: charge.description,
        status: "skipped",
        reason: "pending",
      })
      .onConflictDoNothing({ target: schema.operatorPostings.stripeObjectId });
    return tx.query.operatorPostings.findFirst({
      where: eq(schema.operatorPostings.stripeObjectId, charge.stripeObjectId),
    });
  });
  if (!claimed) throw new Error(`posting row missing for ${charge.stripeObjectId}`);
  if (claimed.status === "posted" && claimed.invoiceId) {
    return { status: "posted", invoiceId: claimed.invoiceId, already: true };
  }

  const outcome = await attempt(charge);

  await withSystem((tx) =>
    tx
      .update(schema.operatorPostings)
      .set({
        status: outcome.status,
        reason: outcome.status === "skipped" ? outcome.reason : null,
        invoiceId: outcome.status === "posted" ? outcome.invoiceId : null,
        attempts: sql`${schema.operatorPostings.attempts} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(schema.operatorPostings.id, claimed.id)),
  );
  return outcome;
}

async function attempt(charge: PlatformCharge): Promise<PostingOutcome> {
  if (charge.amountCents <= 0) return skip("zero_amount");
  if (charge.currency.toLowerCase() !== "usd") return skip("currency");
  const operator = await getOperatorTenant();
  if (!operator) return skip("no_operator");
  if (!(await isModuleEnabled(operator.id, "accounting"))) return skip("accounting_off");
  if (!charge.clientTenantId) return skip("unknown_client");

  const client = await withSystem((tx) =>
    tx.query.tenants.findFirst({
      where: eq(schema.tenants.id, charge.clientTenantId!),
      columns: { operatorPartyId: true },
    }),
  );
  const partyId = client?.operatorPartyId ?? null;
  if (!partyId) return skip("no_party");

  const ctx: LedgerCtx = { tenantId: operator.id, userId: "", role: "owner" };
  const marker = stripeMarker(charge.stripeObjectId);

  try {
    return await withTenant(
      operator.id,
      async (tx): Promise<PostingOutcome> => {
        // Posted but not recorded — a crash between the two transactions.
        const prior = await tx.query.invoices.findFirst({
          where: and(eq(schema.invoices.tenantId, operator.id), eq(schema.invoices.memo, marker)),
          columns: { id: true },
        });
        if (prior) return { status: "posted", invoiceId: prior.id, already: true };

        // The accounts, before anything is written.
        const income =
          (await findAccount(tx, operator.id, { code: "4010" })) ??
          (await findAccount(tx, operator.id, { code: "4000" }));
        if (!income) return skip("no_income_account");
        const deposit = await findAccount(tx, operator.id, { subtype: "undeposited_funds" });
        if (!deposit) return skip("no_deposit_account");

        // The customer role on the client's party — the party is the identity
        // (CRM slice 0); the role is what an invoice is for.
        const party = await loadParty(tx, operator.id, partyId);
        let customer = await tx.query.customers.findFirst({
          where: and(
            eq(schema.customers.tenantId, operator.id),
            eq(schema.customers.partyId, party.id),
          ),
        });
        if (!customer) {
          [customer] = await tx
            .insert(schema.customers)
            .values({ tenantId: operator.id, partyId: party.id, name: party.displayName })
            .returning();
        }

        const timezone = await getTenantTimezone(tx, operator.id);
        const day = dateInTimezone(charge.paidAt, timezone);
        const draft = await createInvoiceDraft(tx, ctx, {
          customerId: customer.id,
          issueDate: day,
          dueDate: day,
          memo: marker,
          lines: [
            {
              description: charge.description,
              quantity: "1",
              unitPriceCents: charge.amountCents,
              incomeAccountId: income.id,
            },
          ],
        });
        const issued = await issueInvoice(tx, ctx, {
          invoiceId: draft.id,
          expectedVersion: draft.version,
        });
        await recordPayment(tx, ctx, {
          invoiceId: issued.id,
          expectedVersion: issued.version,
          paymentDate: day,
          amountCents: charge.amountCents,
          depositAccountId: deposit.id,
          method: "stripe",
          memo: marker,
        });
        return { status: "posted", invoiceId: issued.id, already: false };
      },
      { role: "owner" },
    );
  } catch (err) {
    if (err instanceof LedgerError) {
      if (err.code === "BEFORE_BOOKS_START") return skip("before_books_start");
      console.error(`platform revenue: ledger refused ${charge.stripeObjectId}: ${err.code}`);
      return skip("ledger_refused");
    }
    if (err instanceof PartyError) return skip("no_party");
    throw err;
  }
}

async function findAccount(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  tenantId: string,
  by: { code: string } | { subtype: string },
): Promise<{ id: string } | null> {
  const row = await tx.query.accounts.findFirst({
    where: and(
      eq(schema.accounts.tenantId, tenantId),
      eq(schema.accounts.isActive, true),
      "code" in by
        ? eq(schema.accounts.code, by.code)
        : eq(schema.accounts.subtype, by.subtype),
    ),
    columns: { id: true },
  });
  return row ?? null;
}

/* -- Where a charge comes from ------------------------------------------- */

/** Which workspace a Stripe customer is — OUR subscriptions row, never the payload. */
export async function tenantForStripeCustomer(
  stripeCustomerId: string,
): Promise<{ tenantId: string; planName: string | null } | null> {
  const row = await withSystem((tx) =>
    tx.query.subscriptions.findFirst({
      where: eq(schema.subscriptions.stripeCustomerId, stripeCustomerId),
      columns: { tenantId: true, planName: true },
    }),
  );
  return row ? { tenantId: row.tenantId, planName: row.planName } : null;
}

export function chargeFromStripeInvoice(
  invoice: Pick<Stripe.Invoice, "id" | "amount_paid" | "currency" | "number" | "created"> & {
    status_transitions?: { paid_at?: number | null } | null;
  },
  clientTenantId: string | null,
  planName: string | null,
): PlatformCharge {
  const paidAtUnix = invoice.status_transitions?.paid_at ?? invoice.created;
  return {
    kind: "subscription_invoice",
    stripeObjectId: invoice.id,
    clientTenantId,
    amountCents: invoice.amount_paid,
    currency: invoice.currency,
    paidAt: new Date(paidAtUnix * 1000),
    description: `Yosher ${planName ?? "subscription"} · Stripe invoice ${invoice.number ?? invoice.id}`,
  };
}

export function chargeFromHourBlock(input: {
  stripeSessionId: string;
  tenantId: string;
  amountCents: number;
  currency?: string | null;
  paidAt: Date;
  blockKey: string;
}): PlatformCharge {
  const block = hourBlockForKey(input.blockKey);
  return {
    kind: "hour_block",
    stripeObjectId: input.stripeSessionId,
    clientTenantId: input.tenantId,
    amountCents: input.amountCents,
    currency: input.currency ?? "usd",
    paidAt: input.paidAt,
    description: `${block?.name ?? input.blockKey} of retainer hours`,
  };
}

/* -- The console's verbs ------------------------------------------------- */

export interface PostingCounts {
  considered: number;
  posted: number;
  already: number;
  skipped: number;
}

function tally(counts: PostingCounts, outcome: PostingOutcome): void {
  counts.considered += 1;
  if (outcome.status === "skipped") counts.skipped += 1;
  else if (outcome.already) counts.already += 1;
  else counts.posted += 1;
}

/**
 * Post everything Stripe already holds: every paid invoice of every customer
 * this platform knows, and every hour block ever credited. Idempotent, so
 * running it twice posts nothing twice.
 */
export async function backfillPlatformRevenue(): Promise<PostingCounts> {
  const counts: PostingCounts = { considered: 0, posted: 0, already: 0, skipped: 0 };

  const subs = await withSystem((tx) =>
    tx
      .select({
        tenantId: schema.subscriptions.tenantId,
        stripeCustomerId: schema.subscriptions.stripeCustomerId,
        planName: schema.subscriptions.planName,
      })
      .from(schema.subscriptions)
      .where(isNotNull(schema.subscriptions.stripeCustomerId)),
  );
  if (process.env.STRIPE_SECRET_KEY) {
    const stripe = getStripe();
    for (const s of subs) {
      if (!s.stripeCustomerId) continue;
      for await (const invoice of stripe.invoices.list({
        customer: s.stripeCustomerId,
        status: "paid",
        limit: 100,
      })) {
        tally(counts, await postPlatformCharge(chargeFromStripeInvoice(invoice, s.tenantId, s.planName)));
      }
    }
  }

  const blocks: RetainerPurchase[] = await withSystem((tx) =>
    tx.select().from(schema.retainerPurchases),
  );
  for (const b of blocks) {
    tally(
      counts,
      await postPlatformCharge(
        chargeFromHourBlock({
          stripeSessionId: b.stripeSessionId,
          tenantId: b.tenantId,
          amountCents: b.amountCents,
          paidAt: b.createdAt,
          blockKey: b.blockKey,
        }),
      ),
    );
  }
  return counts;
}

/** Attempt every skipped posting again — a party made since, books started, accounting switched on. */
export async function retrySkippedPostings(): Promise<PostingCounts> {
  const counts: PostingCounts = { considered: 0, posted: 0, already: 0, skipped: 0 };
  const rows = await withSystem((tx) =>
    tx.query.operatorPostings.findMany({
      where: eq(schema.operatorPostings.status, "skipped"),
    }),
  );
  for (const row of rows) {
    tally(
      counts,
      await postPlatformCharge({
        kind: row.kind as PostingKind,
        stripeObjectId: row.stripeObjectId,
        clientTenantId: row.clientTenantId,
        amountCents: row.amountCents,
        currency: row.currency,
        paidAt: row.paidAt,
        description: row.description,
      }),
    );
  }
  return counts;
}

export interface PlatformRevenueView {
  posted: number;
  postedCents: number;
  skipped: number;
  recent: Array<{
    id: string;
    description: string;
    clientName: string | null;
    amountCents: number;
    paidOn: string;
    status: string;
    reason: SkipReason | null;
  }>;
}

/** What the operator's page shows: totals and the latest postings, with client names. */
export async function loadPlatformRevenue(limit = 12): Promise<PlatformRevenueView> {
  const operator = await getOperatorTenant();
  return withSystem(async (tx) => {
    const [totals] = await tx
      .select({
        posted: sql<number>`count(*) filter (where ${schema.operatorPostings.status} = 'posted')::int`,
        postedCents: sql<number>`coalesce(sum(${schema.operatorPostings.amountCents}) filter (where ${schema.operatorPostings.status} = 'posted'), 0)::bigint`,
        skipped: sql<number>`count(*) filter (where ${schema.operatorPostings.status} = 'skipped')::int`,
      })
      .from(schema.operatorPostings);
    const rows = await tx
      .select({ posting: schema.operatorPostings, clientName: schema.tenants.name })
      .from(schema.operatorPostings)
      .leftJoin(schema.tenants, eq(schema.tenants.id, schema.operatorPostings.clientTenantId))
      .orderBy(desc(schema.operatorPostings.paidAt))
      .limit(limit);
    const timezone = operator ? await getTenantTimezone(tx, operator.id) : DEFAULT_TIMEZONE;
    return {
      posted: totals?.posted ?? 0,
      postedCents: Number(totals?.postedCents ?? 0),
      skipped: totals?.skipped ?? 0,
      recent: rows.map(({ posting, clientName }: { posting: OperatorPosting; clientName: string | null }) => ({
        id: posting.id,
        description: posting.description,
        clientName,
        amountCents: posting.amountCents,
        paidOn: dateInTimezone(posting.paidAt, timezone),
        status: posting.status,
        reason: (posting.reason as SkipReason | null) ?? null,
      })),
    };
  });
}
