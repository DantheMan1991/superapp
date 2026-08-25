import "server-only";
import type Stripe from "stripe";
import { and, eq, isNull } from "drizzle-orm";
import { schema, withSystem, withTenant } from "@/db";
import { getStripe } from "@/lib/stripe";
import { appUrl } from "@/lib/stripe-customer";
import { logAudit } from "@/lib/audit";
import {
  describePaymentAccount,
  toRequirementList,
  toStatusDetailList,
  type PaymentAccountView,
  type RequirementFact,
  type StatusDetailFact,
} from "./status";

/**
 * **STRIPE CONNECT — THE TENANT CHARGING THEIR CUSTOMER.**
 *
 * The other direction lives in `src/lib/billing-sync.ts`: the PLATFORM charging
 * the TENANT for its subscription. Same SDK, same platform secret key, opposite
 * direction, and telling them apart is the single most important thing about
 * this file. If you find yourself reaching for `subscriptions` here, or for
 * `payment_accounts` there, stop.
 *
 * **AND NOT EVEN THE SAME API.** Billing is Stripe v1. This is **Accounts v2**
 * (`stripe.v2.core.*`), because Stripe refuses `POST /v1/accounts` for new
 * Connect integrations as of 2026-08-25. Do not "simplify" this back to
 * `stripe.accounts.create` — it will fail at runtime and only at runtime.
 *
 * Shape copied deliberately from `billing-sync.ts` rather than invented:
 *   - one `sync*` function that takes a Stripe object and writes the row,
 *   - one `reconcile*` function that reads Stripe directly and calls it,
 *   - both under `withSystem`, both trusted because of where the data came
 *     from rather than because of who asked.
 *
 * **NOTHING HERE ACCEPTS A FACT FROM THE BROWSER.** The only client-originated
 * input this file takes is "start onboarding for company X", and X is proved
 * against `entities` inside the caller's own tenant scope before it gets here.
 * Capability status is Stripe's to say (S7), and the RLS policies enforce it:
 * members hold SELECT only, so every write below has to be `withSystem` — that
 * is the design, not a shortcut.
 *
 * See docs/decisions/0015-a-connected-account-belongs-to-a-company.md.
 */

export type PaymentCompany = {
  /** Null for the tenant that has no books and therefore no company. */
  entityId: string | null;
  /** What the card is titled. The tenant's own name when there is no company. */
  name: string;
  view: PaymentAccountView;
  stripeAccountId: string | null;
  /** Stripe stops accepting charges after this if the requirements are unmet. */
  requirementsDueBy: Date | null;
  syncedAt: Date | null;
};

/** Stripe is optional in dev and in CI; every screen degrades rather than throws. */
export function isConnectConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

/**
 * **REQUIRED, because v2 returns a skeleton otherwise.** `configuration`,
 * `requirements`, `identity` and `defaults` are all omitted from the response
 * unless asked for by name — so a read that forgets this looks exactly like an
 * account with no capabilities and no outstanding requirements, which is the
 * most dangerous possible wrong answer here.
 */
const INCLUDE = [
  "configuration.merchant",
  "identity",
  "requirements",
  "defaults",
] as const;

/**
 * **WHOSE ACCOUNT, WHOSE LIABILITY, WHOSE TAX FORM.**
 *
 *   - `losses_collector: stripe`  — the FARM carries negative balances, not us.
 *   - `fees_collector: stripe`    — Stripe takes its fee from the farm directly.
 *     (v1 spelled this `account`; that value does not exist in v2.)
 *   - `dashboard: full`           — the farm gets a real Stripe dashboard, can
 *     see its own payouts, and can disconnect us without asking.
 *
 * Together that is the account type Stripe used to call Standard. Stated rather
 * than defaulted, because these four decide who is on the hook when a customer
 * disputes a charge for meat we never saw.
 */
const RESPONSIBILITIES = {
  fees_collector: "stripe",
  losses_collector: "stripe",
} as const;

/**
 * **REQUIRED before `configuration.merchant` can be set** — v1 defaulted the
 * country to the platform's and v2 refuses to guess.
 *
 * Nothing on `tenants` holds a country. The platform is single-currency and
 * US-shaped today (see `tenants.currency_symbol`), so this is a constant, and
 * it is the first thing that has to become a real field when a client outside
 * the US turns up. It is recorded as an open item rather than hidden here.
 */
const DEFAULT_COUNTRY = "US";

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Every company the tenant has, with what each one can do about taking a card.
 *
 * A tenant with no books has no `entities` row at all, so it gets exactly one
 * pseudo-company named after the business — the same rendering, and the client
 * never learns the word (ADR 0010).
 */
export async function loadPaymentCompanies(
  tenantId: string,
  tenantName: string,
  role: "owner" | "staff" | "expert",
): Promise<PaymentCompany[]> {
  const { entities, accounts } = await withTenant(
    tenantId,
    async (tx) => ({
      entities: await tx.query.entities.findMany({
        where: eq(schema.entities.tenantId, tenantId),
        columns: { id: true, name: true, isDefault: true, isActive: true },
      }),
      accounts: await tx.query.paymentAccounts.findMany({
        where: eq(schema.paymentAccounts.tenantId, tenantId),
      }),
    }),
    { role },
  );

  const byEntity = new Map(
    accounts.map((a) => [a.entityId ?? null, a] as const),
  );

  // Default first, then by name — the same order the accounting pickers use, so
  // a two-company farm reads the two screens the same way round.
  const sorted = [...entities].sort((a, b) =>
    a.isDefault === b.isDefault
      ? a.name.localeCompare(b.name)
      : a.isDefault
        ? -1
        : 1,
  );

  if (sorted.length === 0) {
    return [toCompany(null, tenantName, byEntity.get(null) ?? null)];
  }

  const rows = sorted.map((e) =>
    toCompany(e.id, e.name, byEntity.get(e.id) ?? null),
  );

  /**
   * An unadopted account on a tenant that DOES have books means adoption has
   * not run yet — the page runs it, so this is only reachable if the Stripe
   * call that created the row raced the books being opened. Show it rather than
   * hide it: an invisible connected account is one somebody connects twice.
   */
  const orphan = byEntity.get(null);
  if (orphan) rows.push(toCompany(null, tenantName, orphan));
  return rows;
}

function toCompany(
  entityId: string | null,
  name: string,
  row: typeof schema.paymentAccounts.$inferSelect | null,
): PaymentCompany {
  return {
    entityId,
    name,
    stripeAccountId: row?.stripeAccountId ?? null,
    requirementsDueBy: row?.requirementsDueBy ?? null,
    syncedAt: row?.syncedAt ?? null,
    view: describePaymentAccount(
      row
        ? {
            cardPaymentsStatus: row.cardPaymentsStatus,
            statusDetails: toStatusDetailList(row.statusDetails),
            requirements: toRequirementList(row.requirements),
            requirementsDueBy: row.requirementsDueBy,
            closedAt: row.closedAt,
          }
        : null,
    ),
  };
}

/* -------------------------------------------------------------------------- */
/* Trusted writes — Stripe said so, or it did not happen                      */
/* -------------------------------------------------------------------------- */

/**
 * Flatten a v2 account into the columns the screen reads.
 *
 * **A TRIMMED PROJECTION ON PURPOSE.** Storing Stripe's `requirements.entries`
 * wholesale would store `reference` tokens and a shape that rots; storing this
 * means one place to change when Stripe adds a field.
 */
function projectAccount(account: Stripe.V2.Core.Account) {
  const card = account.configuration?.merchant?.capabilities?.card_payments;
  const deadline = account.requirements?.summary?.minimum_deadline;

  const requirements: RequirementFact[] = (
    account.requirements?.entries ?? []
  ).map((entry) => ({
    description: entry.description,
    awaitingActionFrom: entry.awaiting_action_from === "user" ? "user" : "stripe",
    deadline: entry.minimum_deadline?.status ?? null,
    restricts:
      entry.impact?.restricts_capabilities?.map((c) => c.capability) ?? [],
    // Human-readable, and present only once something submitted was rejected.
    errors: (entry.errors ?? []).map((e) => e.description).filter(Boolean),
  }));

  const statusDetails: StatusDetailFact[] = (card?.status_details ?? []).map(
    (d) => ({ code: d.code, resolution: d.resolution }),
  );

  return {
    cardPaymentsStatus: card?.status ?? null,
    statusDetails,
    requirements,
    requirementsDeadlineStatus: deadline?.status ?? null,
    /**
     * **THE TIME IS OFTEN NULL WHILE THE STATUS IS ALREADY `past_due`** — seen
     * on a real account. That is why the status is its own column and why
     * nothing infers urgency from the presence of a date.
     */
    requirementsDueBy: deadline?.time ? new Date(deadline.time) : null,
    country: account.identity?.country ?? null,
    defaultCurrency: account.defaults?.currency ?? null,
    displayName: account.display_name ?? null,
    closedAt: account.closed ? new Date() : null,
  };
}

/**
 * Write one connected account's state from a Stripe v2 `Account` object.
 *
 * The object must have come from a server→Stripe read — which, with v2 thin
 * events, is the ONLY way to get one. **That is a genuinely better property
 * than v1 had**: a Connect event carries no object at all, only a reference, so
 * the webhook is a nudge and the trusted data always comes from the API. S7 is
 * satisfied by construction rather than by discipline.
 *
 * **The tenant is resolved from our own row, never from the account's
 * `metadata`** — metadata is writable by anyone who can reach the account, so
 * trusting it would be exactly the "look up the tenant for the id the client
 * sent" shape S2 names.
 */
export async function syncConnectedAccount(
  account: Stripe.V2.Core.Account,
): Promise<{ tenantId: string; state: string } | null> {
  const projected = projectAccount(account);

  return withSystem(async (tx) => {
    const row = await tx.query.paymentAccounts.findFirst({
      where: eq(schema.paymentAccounts.stripeAccountId, account.id),
      columns: { id: true, tenantId: true, closedAt: true },
    });
    if (!row) {
      // A connected account this platform created but has no row for. Worth a
      // log line and nothing else: inventing a row would mean inventing a
      // tenant to hang it on.
      console.error("connect sync: no payment_accounts row for", account.id);
      return null;
    }

    await tx
      .update(schema.paymentAccounts)
      .set({
        ...projected,
        // Closing is one-way and dated once. Re-stamping it on every sync would
        // move the date every time somebody loaded the page.
        closedAt: row.closedAt ?? projected.closedAt,
        syncedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.paymentAccounts.id, row.id));

    return {
      tenantId: row.tenantId,
      state: projected.cardPaymentsStatus ?? "unknown",
    };
  });
}

/**
 * They revoked us, or Stripe closed the account.
 *
 * **The row survives it.** Slice 2's settlements will reference this account,
 * and a deleted row orphans them; a farm that reconnects also wants its history
 * rather than a second row beside the first.
 */
export async function markClosed(stripeAccountId: string) {
  return withSystem(async (tx) => {
    const rows = await tx
      .update(schema.paymentAccounts)
      .set({ closedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(schema.paymentAccounts.stripeAccountId, stripeAccountId),
          isNull(schema.paymentAccounts.closedAt),
        ),
      )
      .returning({ tenantId: schema.paymentAccounts.tenantId });
    return rows[0]?.tenantId ?? null;
  });
}

/**
 * Read one connected account straight from Stripe and write what it says.
 * The single trusted-write path, shared by the webhook and the reconcile.
 */
export async function refreshConnectedAccount(stripeAccountId: string) {
  const account = await getStripe().v2.core.accounts.retrieve(stripeAccountId, {
    include: [...INCLUDE],
  });
  return syncConnectedAccount(account);
}

/**
 * Read every one of the tenant's connected accounts straight from Stripe.
 *
 * Covers the environment where the Connect event destination cannot reach us
 * (local dev has no public URL) and heals a missed event, exactly as
 * `reconcileSubscriptionFromStripe` does for the other direction. Best effort:
 * the page still renders from local state if Stripe is unreachable.
 *
 * **One API call per company, on every load of the payments page.** Fine at one
 * or two; if a ten-LLC client ever connects ten, this wants a staleness check
 * on `synced_at` rather than an unconditional sweep.
 */
export async function reconcileConnectedAccounts(tenantId: string) {
  if (!isConnectConfigured()) return;

  const rows = await withSystem((tx) =>
    tx.query.paymentAccounts.findMany({
      where: and(
        eq(schema.paymentAccounts.tenantId, tenantId),
        isNull(schema.paymentAccounts.closedAt),
      ),
      columns: { stripeAccountId: true },
    }),
  );
  if (rows.length === 0) return;

  await Promise.all(
    rows.map(async ({ stripeAccountId }) => {
      try {
        await refreshConnectedAccount(stripeAccountId);
      } catch (err) {
        // Deliberately NOT treated as a disconnection. A network blip and a
        // revoked authorization look similar from here, and marking a live
        // account closed would tell a farm mid-market that its till is off.
        // A close event is the fact; this is a guess.
        console.error("connect reconcile failed", stripeAccountId, err);
      }
    }),
  );
}

/* -------------------------------------------------------------------------- */
/* Onboarding                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * **THE BOOKS OPENED AFTER THE CARD READER DID.** `retail` requires
 * `inventory`, not `accounting`, so a farm can connect Stripe with no company
 * to hang the account on. When a company appears, the account joins it.
 *
 * Assigns to the tenant's DEFAULT company — the one that holds every entry
 * posted so far — rather than to "the only one", so a tenant that opened books
 * and added a second company before ever loading this page still resolves
 * instead of sitting in a state with no way out.
 *
 * `withSystem` justified (S2): the table refuses tenant writes by policy, the
 * tenant id comes from the session, and nothing here reads client input.
 * `provisionAccounting` would be the natural home and cannot be — it runs
 * inside a tenant transaction. So this is lazy, and ADR 0015 records the cost.
 */
export async function adoptUnassignedAccount(tenantId: string) {
  await withSystem(async (tx) => {
    const orphan = await tx.query.paymentAccounts.findFirst({
      where: and(
        eq(schema.paymentAccounts.tenantId, tenantId),
        isNull(schema.paymentAccounts.entityId),
      ),
      columns: { id: true },
    });
    if (!orphan) return;

    const entity = await tx.query.entities.findFirst({
      where: and(
        eq(schema.entities.tenantId, tenantId),
        eq(schema.entities.isDefault, true),
      ),
      columns: { id: true },
    });
    if (!entity) return;

    await tx
      .update(schema.paymentAccounts)
      .set({ entityId: entity.id, updatedAt: new Date() })
      .where(eq(schema.paymentAccounts.id, orphan.id));
  });
}

export class ConnectError extends Error {
  constructor(
    readonly code: "NOT_CONFIGURED" | "ENTITY_NOT_FOUND" | "STRIPE_FAILED",
    message: string,
  ) {
    super(message);
    this.name = "ConnectError";
  }
}

/**
 * Find or create the connected account for one company, then mint a
 * Stripe-hosted onboarding link for it.
 *
 * **THE APP NEVER SEES A TAX ID, A BANK ACCOUNT OR AN ID DOCUMENT.** Everything
 * Stripe needs is collected on Stripe's own pages; we hand out a URL and read
 * back a verdict.
 *
 * @param entityId proved to belong to this tenant by the CALLER, inside its own
 *   tenant scope. Null only when the tenant has no books at all.
 */
export async function startOnboarding(input: {
  tenantId: string;
  tenantName: string;
  entityId: string | null;
  entityName: string;
  actorClerkUserId: string;
}): Promise<{ url: string; stripeAccountId: string; created: boolean }> {
  if (!isConnectConfigured()) {
    throw new ConnectError(
      "NOT_CONFIGURED",
      "Card payments are not set up on this deployment yet.",
    );
  }
  const stripe = getStripe();

  const existing = await withSystem((tx) =>
    tx.query.paymentAccounts.findFirst({
      where: and(
        eq(schema.paymentAccounts.tenantId, input.tenantId),
        input.entityId
          ? eq(schema.paymentAccounts.entityId, input.entityId)
          : isNull(schema.paymentAccounts.entityId),
        isNull(schema.paymentAccounts.closedAt),
      ),
      columns: { stripeAccountId: true },
    }),
  );

  let stripeAccountId = existing?.stripeAccountId ?? null;
  const created = !stripeAccountId;

  if (!stripeAccountId) {
    let account: Stripe.V2.Core.Account;
    try {
      account = await stripe.v2.core.accounts.create({
        display_name: input.entityName,
        identity: { country: DEFAULT_COUNTRY },
        configuration: {
          merchant: { capabilities: { card_payments: { requested: true } } },
        },
        dashboard: "full",
        defaults: { responsibilities: RESPONSIBILITIES },
        /**
         * Visible to the farm in its own Stripe dashboard, and never read back
         * as authority — `syncConnectedAccount` resolves the tenant from our
         * own row precisely so that this stays decoration.
         */
        metadata: {
          tenantId: input.tenantId,
          entityId: input.entityId ?? "",
          platform: "yosher",
        },
        include: [...INCLUDE],
      });
    } catch (err) {
      console.error("connect account create failed", err);
      /**
       * **"TRY AGAIN IN A MOMENT" IS THE WRONG ADVICE FOR A PERMANENT
       * PROBLEM**, and this is the one that greets every fresh deployment.
       * Connect has to be switched on for the PLATFORM's Stripe account once,
       * by hand, in Stripe's own dashboard — until it is, every farm's first
       * click fails identically and no farm can do anything about it. Telling
       * them to retry means they retry, and then they ring us.
       *
       * Stripe gives no error `code` for it (checked against a live test-mode
       * account, 2026-08-25: `code`, `param` and `doc_url` are all undefined),
       * so the message is the only signal there is. Narrow match, unchanged
       * fallback: a wording change on Stripe's side costs the better sentence
       * and nothing else.
       */
      if (err instanceof Error && /signed up for Connect/i.test(err.message)) {
        throw new ConnectError(
          "NOT_CONFIGURED",
          "Card payments are not switched on for Yosher yet — that is ours to fix, not yours. Get in touch and we will sort it.",
        );
      }
      throw new ConnectError(
        "STRIPE_FAILED",
        "Stripe could not start the setup. Try again in a moment.",
      );
    }
    stripeAccountId = account.id;

    /**
     * Inserted BEFORE the link is minted. If the insert fails we have created a
     * Stripe account with no row, which the unique index would then let happen
     * a second time — so this is the write that must not be deferred to the
     * return trip. `withSystem` justified as above.
     */
    await withSystem((tx) =>
      tx
        .insert(schema.paymentAccounts)
        .values({
          tenantId: input.tenantId,
          entityId: input.entityId,
          stripeAccountId: account.id,
          ...projectAccount(account),
          syncedAt: new Date(),
        })
        .onConflictDoNothing(),
    );

    await logAudit({
      action: "payments.account_created",
      tenantId: input.tenantId,
      actorClerkUserId: input.actorClerkUserId,
      targetType: "payment_account",
      targetId: account.id,
      // Identifiers only (S9). The entity id says which set of books, which is
      // the fact somebody auditing this would need.
      meta: { entityId: input.entityId ?? null },
    });
  }

  let link: Stripe.V2.Core.AccountLink;
  try {
    link = await stripe.v2.core.accountLinks.create({
      account: stripeAccountId,
      use_case: {
        type: "account_onboarding",
        account_onboarding: {
          configurations: ["merchant"],
          // Ask for everything Stripe will EVENTUALLY want, in one sitting,
          // rather than sending the farmer back a month later for a document.
          collection_options: { fields: "eventually_due" },
          /**
           * Hit when the link has EXPIRED — they last minutes, and a farmer who
           * leaves the tab open over lunch comes back to a dead one. The page
           * says so and offers the button again rather than pretending.
           */
          refresh_url: appUrl("/dashboard/settings/payments?status=expired"),
          /**
           * **THE RETURN URL DOES NOT MEAN SUCCESS.** Stripe sends them here
           * when they finish AND when they simply navigate back, so the page
           * reconciles from the API rather than believing the redirect. This is
           * the trap that makes onboarding screens claim a farm is ready when
           * it is not.
           */
          return_url: appUrl("/dashboard/settings/payments?status=returned"),
        },
      },
    });
  } catch (err) {
    console.error("connect account link failed", err);
    throw new ConnectError(
      "STRIPE_FAILED",
      "Stripe could not open the setup form. Try again in a moment.",
    );
  }

  return { url: link.url, stripeAccountId, created };
}
