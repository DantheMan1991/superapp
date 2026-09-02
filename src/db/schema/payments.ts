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
 * **AND SINCE 2026-09-02 THERE ARE TWO PROVIDERS ON THIS TABLE.** `provider`
 * says which: `stripe` (a Connect account the platform created and acts on
 * with its own key) or `square` (the Square account the farm ALREADY HAD,
 * which authorised this application through OAuth). The pilot pays with Square
 * today; Square is what farmers markets run on; so Square is the provider on
 * offer and Stripe Connect is parked, its rows and code intact. The Square
 * token lives in `payment_credentials` below — a table with NO member policy —
 * never on this row. See ADR 0017.
 *
 * See docs/decisions/0015-a-connected-account-belongs-to-a-company.md and
 * docs/decisions/0017-the-square-account-the-farm-already-has.md.
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
 * **ONE COMPANY'S ABILITY TO TAKE A CARD, THROUGH ONE PROVIDER.** Either a
 * Stripe Connect connected account, created and owned by the client and acted
 * on by us with `stripeAccount`; or the client's own Square account, acting for
 * which requires the OAuth token held in `payment_credentials`.
 *
 * **NOTHING ON THIS ROW IS A CREDENTIAL.** `stripe_account_id` and
 * `square_merchant_id` are identifiers. For Stripe the authority to act comes
 * from the PLATFORM key plus Stripe's own record that we created the account;
 * for Square it comes from a scoped, revocable OAuth token that lives in a
 * separate table no member policy can read. The tenant's own Stripe secret key
 * is never stored, never asked for and never seen — a column holding one would
 * be a C5 secret per client granting UNLIMITED authority over their money,
 * which is the shortcut ADR 0015 refuses; a Square token is bounded by its
 * scopes and the seller can revoke it from Square, which is why ADR 0017 accepts
 * holding one, encrypted (S8), off this row.
 *
 * **EVERY OTHER COLUMN IS THE PROVIDER'S VERDICT, NOT THE APP'S.** A capability
 * status is the outcome of a review we do not perform and cannot second-guess.
 * These are written only from a signature-verified event or a server→provider
 * read (S7) — and the RLS policies give that rule teeth rather than leaving it
 * to care: **members hold SELECT only.** No tenant transaction can write this
 * table at all, so a forgotten `withTenant` or a careless future action cannot
 * make the app believe a farm can take money when the provider says it cannot.
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
 * **ONE ROW PER COMPANY PER PROVIDER.** ADR 0015 rejected a `provider` column
 * while there was one provider ("a column with one value documents nothing")
 * and said the second provider would be a new column rather than a new table.
 * That is what happened: `provider` arrived with Square, the Stripe-only columns
 * are null on a Square row and vice versa, and the CHECKs below make a row that
 * lies about its provider unrepresentable. The columns the till reads —
 * `card_payments_status`, `closed_at` — mean the same thing for both.
 *
 * Deliberately NOT here, each because nothing would read it yet:
 *
 *   - **Settlements, payouts and fees.** Those post to the books, and the
 *     company they post into is the `entity_id` on this row.
 *   - **Square devices.** `payment_readers` is Stripe-shaped (its CHECKs insist
 *     on `tmr_`/`tml_` ids); a paired Square Terminal gets its own columns when
 *     the Terminal slice knows the shape rather than guesses it.
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
     * `stripe` | `square`. Decides which of the two id columns is set and which
     * lib may write the row.
     *
     * **THE DATABASE DEFAULT STAYS, against the convention that discriminators
     * get none.** The column was added to a table with live Stripe rows and
     * running code that inserts without naming a provider. Migrations go out
     * BEFORE the deploy, so for the minutes between the two a default is the
     * only thing keeping that insert working; dropping it would be a second
     * migration after the deploy, for a column every insert site now names
     * anyway. Recorded so nobody "tidies" it into an outage.
     */
    provider: text("provider").notNull().default("stripe"),
    /**
     * `acct_…`. An identifier, never a secret. **Confirmed against a real v2
     * account** — v2 kept v1's id prefix, which is what lets the CHECK below
     * stay as written. Null on a Square row, and only there (CHECK).
     */
    stripeAccountId: text("stripe_account_id"),
    /**
     * Square's merchant id — the account the farm signed up for itself. An
     * identifier: the authority to act on it is the token in
     * `payment_credentials`. Null on a Stripe row, and only there (CHECK). How
     * the Square webhook finds the row: a notification carries `merchant_id`
     * and nothing else about us.
     */
    squareMerchantId: text("square_merchant_id"),
    /**
     * Where a charge from the till is made until a later slice lets a channel
     * pick its own. Square's `main_location_id`, or the first active location
     * when Square leaves that unset.
     */
    squareMainLocationId: text("square_main_location_id"),
    /**
     * `[{ id, name, status, type, canTakeCards }]` — the account's locations,
     * trimmed to what a screen and a till need. **A projection, not the raw
     * object**, for the same reason `requirements` is. Empty on a Stripe row.
     */
    squareLocations: jsonb("square_locations").notNull().default([]),
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
     * **ONE ACCOUNT PER COMPANY PER PROVIDER.** Postgres treats NULLs as
     * distinct, so this says nothing about the unadopted case — hence the
     * partial index below.
     */
    uniqueIndex("payment_accounts_tenant_entity_idx").on(
      t.tenantId,
      t.entityId,
      t.provider,
    ),
    /**
     * **AND AT MOST ONE UNADOPTED ACCOUNT PER TENANT PER PROVIDER.** Without it
     * a books-less tenant could mint connected accounts without limit, each one
     * a real Stripe object asking a real person for a tax ID.
     */
    uniqueIndex("payment_accounts_tenant_unassigned_idx")
      .on(t.tenantId, t.provider)
      .where(sql`${t.entityId} is null`),
    /** Tenant-leading, per the security.md §4 checklist. */
    uniqueIndex("payment_accounts_tenant_account_idx").on(
      t.tenantId,
      t.stripeAccountId,
    ),
    /** How the Connect event finds the row: it knows `acct_…` and nothing else. */
    index("payment_accounts_account_idx").on(t.stripeAccountId),
    /**
     * One Square account connects to one company per tenant. The same merchant
     * on two companies would put one bank account's takings in two sets of
     * books, which is the mistake ADR 0015 exists to make impossible.
     */
    uniqueIndex("payment_accounts_tenant_square_merchant_idx").on(
      t.tenantId,
      t.squareMerchantId,
    ),
    /** How the Square webhook finds the row: it knows the merchant id and nothing else. */
    index("payment_accounts_square_merchant_idx").on(t.squareMerchantId),
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
      sql`${t.stripeAccountId} is null or ${t.stripeAccountId} ~ '^acct_[A-Za-z0-9]+$'`,
    ),
    check(
      "payment_accounts_provider_known",
      sql`${t.provider} in ('stripe', 'square')`,
    ),
    /**
     * **A ROW CANNOT LIE ABOUT ITS PROVIDER.** A Stripe row has a Stripe id and
     * no merchant id; a Square row the reverse. Two libs write this table now,
     * and the one thing worse than a row with no id is a row with the wrong
     * one, which the Terminal lib would then hand to Stripe as an account.
     */
    check(
      "payment_accounts_stripe_id_matches_provider",
      sql`(${t.provider} = 'stripe') = (${t.stripeAccountId} is not null)`,
    ),
    check(
      "payment_accounts_square_id_matches_provider",
      sql`(${t.provider} = 'square') = (${t.squareMerchantId} is not null)`,
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

/**
 * **THE ONE SECRET IN THIS DOMAIN, IN A TABLE OF ITS OWN.** A Square OAuth
 * access token and its refresh token, encrypted with `encryptSecret()` (S8),
 * for one `payment_accounts` row whose provider is `square`.
 *
 * **WHY NOT COLUMNS ON `payment_accounts`.** That table gives members a SELECT
 * policy, because the till has to read "can this company take a card". A token
 * column there would put ciphertext in front of every member. `mail_accounts`
 * accepts that for a mailbox token ("the encryption is what makes the residual
 * exposure uninteresting"); this token authorises charges and refunds on the
 * farm's money, and the cheaper answer is to keep it out of member reach
 * entirely. So: **NO MEMBER POLICY AT ALL.** Superadmin and `withSystem` only.
 * The lib decrypts in exactly one function, and a tenant transaction that
 * selects from this table gets zero rows — its own tenant's included.
 *
 * **WHY A TOKEN AT ALL, when ADR 0015 refused to store a Stripe secret key.**
 * A Stripe secret key is unlimited authority over the account. A Square OAuth
 * token is bounded by the scopes the seller consented to, expires in thirty
 * days unless renewed, and the seller can revoke it from Square's own dashboard
 * — at which point Square tells us (`oauth.authorization.revoked`) and the row
 * below is wiped. Square offers no Connect-style alternative: there is no way
 * to act for a Square seller without holding their token. ADR 0017 weighs it.
 *
 * Marked `revoked_at` and wiped rather than deleted, so "when did this stop"
 * has an answer; the `payment_accounts` row it hangs off survives for the same
 * reason its Stripe cousin does.
 */
export const paymentCredentials = pgTable(
  "payment_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    paymentAccountId: uuid("payment_account_id").notNull(),
    /** AES-256-GCM via `src/lib/crypto.ts`. Never plaintext, never logged. */
    accessTokenEnc: text("access_token_enc").notNull(),
    /** Empty when the provider sent none. Kept, not overwritten, on a refresh that returns none. */
    refreshTokenEnc: text("refresh_token_enc").notNull().default(""),
    /** Square: thirty days from issue; renewed inside the last week (`needsSquareRefresh`). */
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),
    /** The permissions the seller actually granted — `["PAYMENTS_WRITE", …]`. */
    scopes: jsonb("scopes").notNull().default([]),
    obtainedAt: timestamp("obtained_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Set — and the ciphertext blanked — when the seller or we revoke the grant. */
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("payment_credentials_tenant_id_id_idx").on(t.tenantId, t.id),
    /** One credential per account. Reconnecting replaces it rather than adding a second. */
    uniqueIndex("payment_credentials_tenant_account_idx").on(
      t.tenantId,
      t.paymentAccountId,
    ),
    /**
     * Composite, so a token can never be filed against another tenant's
     * account. CASCADE: a token for an account that no longer exists is
     * meaningless, and deleting the account is the one time deleting a token
     * is right.
     */
    foreignKey({
      name: "payment_credentials_account_fk",
      columns: [t.tenantId, t.paymentAccountId],
      foreignColumns: [paymentAccounts.tenantId, paymentAccounts.id],
    }).onDelete("cascade"),
  ],
);

export type PaymentAccount = typeof paymentAccounts.$inferSelect;
export type NewPaymentAccount = typeof paymentAccounts.$inferInsert;
export type PaymentReader = typeof paymentReaders.$inferSelect;
export type NewPaymentReader = typeof paymentReaders.$inferInsert;
export type PaymentCredential = typeof paymentCredentials.$inferSelect;
export type NewPaymentCredential = typeof paymentCredentials.$inferInsert;
