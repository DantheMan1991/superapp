/**
 * Party documents — what a subcontractor or supplier has on file with the
 * business: the certificate of insurance and the day it expires, the W-9,
 * the licence, whatever else the business asks for before it pays.
 *
 * Part of the `jobs` pack (Layer 2a, P4). Slice 11b of the construction plan
 * (`compliance`), the party-level half of it: a lien waiver (11a) is per
 * payment, a certificate of insurance is per party and runs out on a date.
 *
 * ── PER PARTY, NOT PER JOB (ADR 0068) ───────────────────────────────────────
 *
 * A framer's insurance covers every job he is on; asking for the certificate
 * on each one is how a GC ends up with four copies and one expiry nobody
 * watched. So the row hangs off the PARTY, and the page that reads it lists
 * every party with an order on a live job — the insurance audit's own view.
 *
 * ── THE KIND IS THE BUSINESS'S; THE EXPIRY IS THE ONLY BEHAVIOUR ────────────
 *
 * What a business requires of a subcontractor differs by state, by insurer
 * and by lawyer: a certificate of insurance and a W-9 almost everywhere, a
 * contractor's licence in some states, a signed master agreement, a safety
 * plan, a bond. So `kind` is an open taxonomy with a format check, as a
 * contract's kind is, and the pack suggests the common three and a default
 * list of which are REQUIRED before a party is in good standing — a tenant
 * config value, not a branch. The one thing the pack does with a kind is
 * read `expires_on`: a certificate past its date is as good as missing, and
 * one within a month of it is worth a sentence.
 *
 * ── THE GAP IS DERIVED, NEVER STORED ────────────────────────────────────────
 *
 * "Missing", "expired" and "expiring" are computed at read time against
 * today and the required list, as a waiver's gap is against the bill. The
 * signed copy is a Documents attachment on the row.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./platform";
import { parties } from "./parties";

export const jobPartyDocuments = pgTable(
  "job_party_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** Whose document it is: the subcontractor or supplier. */
    partyId: uuid("party_id").notNull(),
    /** Open taxonomy, format-checked: `insurance_certificate`, `w9`, `license`, or whatever the business names. */
    kind: text("kind").notNull(),
    /** "General liability — Erie", "Contractor's licence, Ohio". */
    title: text("title").notNull().default(""),
    /** The policy, licence or form number. */
    reference: text("reference").notNull().default(""),
    /** Who issued it: the carrier, the state board. */
    issuer: text("issuer").notNull().default(""),
    issuedOn: date("issued_on", { mode: "string" }),
    /** When it stops being good. Null for a document that does not run out, such as a W-9. */
    expiresOn: date("expires_on", { mode: "string" }),
    /** The coverage limit a certificate states, in cents, when there is one. */
    limitCents: bigint("limit_cents", { mode: "number" }),
    /** text + CHECK: requested (asked for), received (on file), void. */
    status: text("status").notNull().default("received"),
    requestedOn: date("requested_on", { mode: "string" }),
    receivedOn: date("received_on", { mode: "string" }),
    notes: text("notes").notNull().default(""),
    createdByClerkUserId: text("created_by_clerk_user_id"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("job_party_documents_tenant_id_id_idx").on(t.tenantId, t.id),
    index("job_party_documents_tenant_party_idx").on(t.tenantId, t.partyId),
    index("job_party_documents_tenant_kind_idx").on(t.tenantId, t.kind),
    index("job_party_documents_tenant_expires_idx").on(t.tenantId, t.expiresOn),
    /** No cascade: a party with documents on file cannot be merged away underneath them. */
    foreignKey({
      name: "job_party_documents_party_fk",
      columns: [t.tenantId, t.partyId],
      foreignColumns: [parties.tenantId, parties.id],
    }),
    check("job_party_documents_kind_format", sql`${t.kind} ~ '^[a-z][a-z0-9_]{0,62}$'`),
    check(
      "job_party_documents_status_valid",
      sql`${t.status} in ('requested', 'received', 'void')`,
    ),
    check(
      "job_party_documents_limit_nonnegative",
      sql`${t.limitCents} is null or ${t.limitCents} >= 0`,
    ),
    /** Received has the date it arrived and requested has none; void keeps what it had — the lien waiver's rule. */
    check(
      "job_party_documents_received_has_date",
      sql`(${t.status} = 'requested' and ${t.receivedOn} is null) or (${t.status} = 'received' and ${t.receivedOn} is not null) or ${t.status} = 'void'`,
    ),
  ],
);

export type JobPartyDocument = typeof jobPartyDocuments.$inferSelect;
