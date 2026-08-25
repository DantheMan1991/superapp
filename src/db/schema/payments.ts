/**
 * Payments — **the TENANT taking money from THEIR customer.**
 *
 * **READ THIS SENTENCE BEFORE TOUCHING ANYTHING HERE.** There are two Stripes
 * in this codebase and they point in opposite directions:
 *
 *   - `subscriptions` (platform.ts) is the PLATFORM charging the TENANT. One
 *     row per tenant, our Stripe customer, our revenue. ADR 0010: ten LLCs is
 *     one subscription.
 *   - `payment_accounts` (here) is the TENANT charging THEIR customer. One row
 *     per LEGAL ENTITY, their Stripe account, their money, their bank, their
 *     1099-K.
 *
 * Same SDK and the same platform secret key; everything else is opposite. The
 * next person will assume there is only one, which is why this table lives in
 * its own domain file rather than beside `subscriptions`.
 *
 * **AND THEY ARE NOT EVEN THE SAME STRIPE API.** Billing is Stripe's v1 API.
 * This is **Accounts v2** (`/v2/core/accounts`), because on 2026-08-25 Stripe
 * began refusing `POST /v1/accounts` for new Connect integrations. The two
 * models are shaped differently and the columns below are v2's vocabulary:
 * there is no `charges_enabled`, no `payouts_enabled` and no
 * `details_submitted` — there is a capability STATUS, and a list of
 * REQUIREMENTS that each say who is holding them up and what they restrict.
 *
 * See docs/decisions/0015-a-connected-account-belongs-to-a-company.md.
 */
import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./platform";
import { entities } from "./ledger";

/**
 * **ONE COMPANY'S ABILITY TO TAKE A CARD.** A Stripe Connect connected account,
 * created and owned by the client, acted on by us with `stripeAccount`.
 *
 * **NOTHING HERE IS A CREDENTIAL.** `stripe_account_id` is an identifier —
 * `acct_…` — and the authority to act on it comes from the PLATFORM key plus
 * Stripe's own record that we created it. The tenant's secret key is never
 * stored, never asked for and never seen; a column holding one would be a C5
 * secret per client granting unlimited authority over their money, which is a
 * posture `docs/security.md` would have to be rewritten to allow.
 *
 * **EVERY OTHER COLUMN IS STRIPE'S VERDICT, NOT THE APP'S.** A capability
 * status is the outcome of a KYC review we do not perform and cannot
 * second-guess. These are written only from a signature-verified Connect event
 * or a server→Stripe read (S7) — and the RLS policies give that rule teeth
 * rather than leaving it to care: **members hold SELECT only.** No tenant
 * transaction can write this table at all, so a forgotten `withTenant` or a
 * careless future action cannot make the app believe a farm can take money when
 * Stripe says it cannot.
 *
 * **THE COMPANY, NOT THE CLIENT.** A connected account is a bank account with a
 * KYC wrapper — an EIN, a legal name, a representative — and ADR 0010 puts
 * anything with a balance on exactly one entity. Two LLCs are two tax IDs and
 * two 1099-Ks; one row per tenant would put one company's card revenue on
 * another company's tax form, and nothing in the app could detect it.
 *
 * **NULLABLE, because `retail` requires `inventory` and not `accounting`.** A
 * farm can sell at a market with no books and therefore no company at all.
 * `entity_id` is adopted when the books open, guarded to nulls, exactly as
 * `provisionAccounting` adopts an asset bought before there were books — except
 * that it cannot run there (that function is inside a tenant transaction and
 * this table refuses tenant writes), so adoption is lazy and lives in
 * `src/lib/payments/connect.ts`.
 *
 * Deliberately NOT here, each because nothing would read it yet:
 *
 *   - **A `provider` column.** Every field below is Stripe's own vocabulary. A
 *     column with one value and no second implementation documents nothing.
 *   - **Terminal locations and readers** (next slice). They will hang off
 *     `(tenant_id, id)`, which is why the composite target index exists now.
 *   - **Settlements, payouts and fees** (the slice after). Those post to the
 *     books, and the company they post into is the `entity_id` on this row.
 */
export const paymentAccounts = pgTable(
  "payment_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /**
     * The company whose bank the money lands in. Null only until the books
     * exist; see the adoption note above.
     */
    entityId: uuid("entity_id"),
    /**
     * `acct_…`. An identifier, never a secret. **Confirmed against a real v2
     * account** — v2 kept v1's id prefix, which is what lets the CHECK below
     * stay as written.
     */
    stripeAccountId: text("stripe_account_id").notNull(),
    /**
     * **THE ONE FACT THE TILL WILL ASK FOR:** can this company take a card.
     * `configuration.merchant.capabilities.card_payments.status` — one of
     * `active`, `pending`, `restricted`, `unsupported`.
     *
     * NULL means Stripe has not said yet, which before the first sync is the
     * truthful answer and is NOT the same as `restricted`. Never default it to
     * a value that sounds safe; `active` is the only one that means yes, and
     * anything that is not `active` is a no for a different reason.
     */
    cardPaymentsStatus: text("card_payments_status"),
    /**
     * `capabilities.card_payments.status_details` — `[{ code, resolution }]`,
     * empty when the status is `active`. `resolution` is the useful half: it is
     * Stripe telling us whether the fix is `provide_info` (send them back to
     * the form), `contact_stripe`, or `no_resolution`. The screen offers the
     * button that matches rather than guessing.
     */
    statusDetails: jsonb("status_details").notNull().default([]),
    /**
     * `requirements.entries`, trimmed to what a screen needs:
     * `[{ description, awaitingActionFrom, deadline, restricts, errors }]`.
     *
     * **A TRIMMED PROJECTION, NOT THE RAW OBJECT.** Storing Stripe's entry
     * wholesale means storing `reference` tokens and shapes that rot; storing
     * a projection means one place to change when Stripe adds a field.
     *
     * `description` is a MACHINE key (`external_account`,
     * `representative.given_name`) despite the name — Stripe's own docs call it
     * "machine-readable". The English lives in `src/lib/payments/status.ts`.
     * `errors[].description` IS human-readable, and only appears once something
     * submitted has been rejected.
     *
     * **THESE ARE FIELD NAMES, NEVER FIELD VALUES.** No tax ID, bank detail or
     * document ever lands in this column.
     */
    requirements: jsonb("requirements").notNull().default([]),
    /**
     * `requirements.summary.minimum_deadline` — the strictest status across
     * every requirement (`currently_due`, `eventually_due`, `past_due`) and the
     * soonest time anything bites. The time is frequently NULL while the status
     * is already `past_due`, which is why they are two columns: a screen that
     * inferred urgency from the presence of a date would call a past-due
     * account relaxed.
     */
    requirementsDeadlineStatus: text("requirements_deadline_status"),
    requirementsDueBy: timestamp("requirements_due_by", { withTimezone: true }),
    /** Display only, from Stripe. Null until the first sync. */
    country: text("country"),
    defaultCurrency: text("default_currency"),
    /**
     * `display_name` as Stripe holds it — so a farm with two companies can tell
     * at a glance which Stripe account is which without opening Stripe.
     */
    displayName: text("display_name"),
    /**
     * The account is finished: Stripe reports `closed`, or the farm revoked us
     * from its own dashboard. **The row survives it**, because slice 2's
     * settlements will reference this account and a deleted row would orphan
     * them, and a farm that reconnects wants its history rather than a second
     * row beside the first. Marked, never deleted.
     */
    closedAt: timestamp("closed_at", { withTimezone: true }),
    /** Last time Stripe told us any of the above — event or reconcile. */
    syncedAt: timestamp("synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    /**
     * Target for the composite FKs the reader and settlement slices will point
     * at. Here now because adding it later means adding it to a table that is
     * already referenced.
     */
    uniqueIndex("payment_accounts_tenant_id_id_idx").on(t.tenantId, t.id),
    /**
     * **ONE ACCOUNT PER COMPANY.** Postgres treats NULLs as distinct, so this
     * says nothing about the unadopted case — hence the partial index below.
     */
    uniqueIndex("payment_accounts_tenant_entity_idx").on(t.tenantId, t.entityId),
    /**
     * **AND AT MOST ONE UNADOPTED ACCOUNT PER TENANT.** Without it a books-less
     * tenant could mint connected accounts without limit, each one a real
     * Stripe object asking a real person for a tax ID.
     */
    uniqueIndex("payment_accounts_tenant_unassigned_idx")
      .on(t.tenantId)
      .where(sql`${t.entityId} is null`),
    /** Tenant-leading, per the security.md §4 checklist. */
    uniqueIndex("payment_accounts_tenant_account_idx").on(
      t.tenantId,
      t.stripeAccountId,
    ),
    /** How the Connect event finds the row: it knows `acct_…` and nothing else. */
    index("payment_accounts_account_idx").on(t.stripeAccountId),
    /**
     * Composite, so a row can never name another tenant's company — the pattern
     * every entity reference in this schema uses. RESTRICT rather than CASCADE:
     * deleting a company that has been taking card payments should fail loudly.
     */
    foreignKey({
      name: "payment_accounts_entity_fk",
      columns: [t.tenantId, t.entityId],
      foreignColumns: [entities.tenantId, entities.id],
    }).onDelete("restrict"),
    /**
     * A cheap shape check on the one column everything else is derived from.
     * A `cus_…` or a `sk_…` in here would mean the two Stripes had been
     * crossed, which is the failure this whole file is written against.
     */
    check(
      "payment_accounts_stripe_account_id_shape",
      sql`${t.stripeAccountId} ~ '^acct_[A-Za-z0-9]+$'`,
    ),
  ],
);

/**
 * **A CARD READER AT A STALL.** A Stripe Terminal reader registered on ONE
 * connected account, which is what makes it the farm's device rather than ours.
 *
 * **THIS ROW IS A MIRROR OF STRIPE, NOT A RECORD OF OUR OWN**, and it takes the
 * same policy as `payment_accounts` for the same reason: members hold SELECT
 * only. A row here that Stripe has never heard of is not a harmless stray — it
 * is a device the till would try to push a payment to, at a stall, with a queue
 * behind it. Every write happens after the Stripe call has already succeeded.
 *
 * **NO LOCATION TABLE, DELIBERATELY.** A Terminal location is an address that
 * groups readers, and Stripe already stores it. Keeping a copy would mean a
 * second thing to keep in step for no reader of it; the id is denormalised here
 * so that a farm with two market addresses is already representable without a
 * migration, and slice 1 simply always uses the account's first one.
 *
 * Deliberately NOT here yet: the charge. A PaymentIntent pushed to this reader
 * has no table until `retail` slice 5 links one to a sale, at which point the
 * shape is known rather than guessed.
 */
export const paymentReaders = pgTable(
  "payment_readers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /**
     * Which connected account the reader belongs to — and therefore which
     * COMPANY takes the money it collects. The composite target index on
     * `payment_accounts` exists for exactly this.
     */
    paymentAccountId: uuid("payment_account_id").notNull(),
    /** `tmr_…`. Stripe's id for the device. */
    stripeReaderId: text("stripe_reader_id").notNull(),
    /** `tml_…`. The address it is registered at. */
    stripeLocationId: text("stripe_location_id").notNull(),
    /** What a person calls it: "Front table", "Elm Street". Theirs to set. */
    label: text("label").notNull(),
    /** Stripe's own model string, e.g. `simulated_wisepos_e`, `stripe_s700`. */
    deviceType: text("device_type"),
    /**
     * `online` \| `offline`, **Stripe's to say**. A reader that has been
     * unplugged is offline whatever this app believes, so this is refreshed
     * from the API rather than assumed.
     */
    status: text("status"),
    /**
     * Retired rather than deleted: a reader that took money last season is
     * still the answer to "what device was that payment collected on".
     */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    syncedAt: timestamp("synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("payment_readers_tenant_id_id_idx").on(t.tenantId, t.id),
    /** One row per physical device. Re-registering the same reader is an update. */
    uniqueIndex("payment_readers_tenant_reader_idx").on(
      t.tenantId,
      t.stripeReaderId,
    ),
    index("payment_readers_tenant_account_idx").on(
      t.tenantId,
      t.paymentAccountId,
    ),
    /**
     * Composite, so a reader can never name another tenant's connected account
     * — which would push a payment into another business's bank. CASCADE:
     * a connected account's readers are meaningless without it.
     */
    foreignKey({
      name: "payment_readers_account_fk",
      columns: [t.tenantId, t.paymentAccountId],
      foreignColumns: [paymentAccounts.tenantId, paymentAccounts.id],
    }).onDelete("cascade"),
    check(
      "payment_readers_stripe_reader_id_shape",
      sql`${t.stripeReaderId} ~ '^tmr_[A-Za-z0-9]+$'`,
    ),
    check(
      "payment_readers_stripe_location_id_shape",
      sql`${t.stripeLocationId} ~ '^tml_[A-Za-z0-9]+$'`,
    ),
  ],
);

export type PaymentAccount = typeof paymentAccounts.$inferSelect;
export type NewPaymentAccount = typeof paymentAccounts.$inferInsert;
export type PaymentReader = typeof paymentReaders.$inferSelect;
export type NewPaymentReader = typeof paymentReaders.$inferInsert;
