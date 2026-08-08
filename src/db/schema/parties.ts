/**
 * The shared identity spine. `parties` is one row per real-world person or
 * organisation; `customers`/`vendors` are ROLES on it (CRM slice 0).
 *
 * Split out of the former single-file `src/db/schema.ts`; `./index.ts`
 * re-exports every domain, so `@/db/schema` still resolves exactly as before.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./platform";

export const partyKind = pgEnum("party_kind", ["person", "organization"]);

export const parties = pgTable(
  "parties",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /**
     * No database default, deliberately — the `documents.origin` pattern
     * (conventions §4). Every insert site must state what it knows, and the
     * compiler names any that does not.
     */
    kind: partyKind("kind").notNull(),
    /**
     * AUTHORITATIVE, never derived from the structured names. Deriving it means
     * a fight the first time somebody wants "Bob Smith Plumbing" instead of
     * "Robert Smith", and the derivation would have to lose.
     */
    displayName: text("display_name").notNull(),
    /**
     * Null for organizations, and null for a person nobody has split yet. They
     * exist because "Dear Aoife" in a mail template needs a real first name —
     * and needs one with CRM switched off, which is why they sit on the shared
     * spine rather than in CRM's own table.
     *
     * No CHECK ties these to `kind`: a sole trader is genuinely a person
     * trading under a business name, and a constraint saying otherwise becomes
     * a migration the first time somebody models one.
     */
    givenName: text("given_name"),
    familyName: text("family_name"),
    /** The registered name, when it differs from what everyone calls them. */
    legalName: text("legal_name"),
    isActive: boolean("is_active").notNull().default(true),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Every referencing FK in this schema is tenant-aware, so every referenced
    // table needs this pair unique.
    uniqueIndex("parties_tenant_id_id_idx").on(t.tenantId, t.id),
    index("parties_tenant_idx").on(t.tenantId),
  ],
);

/**
 * How to reach a party. The column `parties` deliberately does NOT have.
 *
 * Slice 0 refused to put an `email` on `parties` because a company has several
 * offices and a person has a work address and a personal one, and a single
 * column would have been canonical within a week and then needed unpicking from
 * every read site. This is the shape that was promised instead, arriving when
 * two features finally needed it: CRM contributing recipients to the mail
 * composer, and warning about a duplicate at create time.
 *
 * `normalized_value` IS THE POINT OF THE TABLE. `Bob@Example.COM ` and
 * `bob@example.com` are the same address and must match; `(555) 123-4567` and
 * `+15551234567` are the same phone. Storing both the typed form and the
 * matchable form means the person sees what they typed and the machine compares
 * something that can actually be compared — the alternative is normalizing at
 * every call site, which is the same class of mistake as formatting money twice.
 *
 * SINCE 0075 THIS IS THE ONLY PLACE AN EMAIL OR PHONE IS STORED for a customer
 * or a vendor. The columns it was backfilled from are gone, so nothing has to
 * decide which copy is authoritative and the invoice screen and the CRM cannot
 * show different answers.
 */
export const partyContactKind = pgEnum("party_contact_kind", [
  "email",
  "phone",
  "website",
]);

export const partyContactPoints = pgTable(
  "party_contact_points",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    partyId: uuid("party_id").notNull(),
    kind: partyContactKind("kind").notNull(),
    /**
     * "work", "mobile", "billing". An OPEN taxonomy (P1) with no CHECK: which
     * labels a business uses is its own business, and a profile may seed a set.
     * Empty string rather than null so a filter never handles two spellings of
     * "not said".
     */
    label: text("label").notNull().default(""),
    /** Exactly as typed. This is what gets displayed back. */
    value: text("value").notNull(),
    /** Derived by `normalizeContactValue`. What matching compares. */
    normalizedValue: text("normalized_value").notNull(),
    isPrimary: boolean("is_primary").notNull().default(false),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("party_contact_points_tenant_id_id_idx").on(t.tenantId, t.id),
    // One primary per party PER KIND — a party has a main email and a main
    // phone, and those are different questions.
    uniqueIndex("party_contact_points_primary_idx")
      .on(t.tenantId, t.partyId, t.kind)
      .where(sql`is_primary = true`),
    // The same address twice on one party is a duplicate, not a second way to
    // reach them. Compared on the NORMALIZED value, so differing capitalisation
    // does not sneak one past.
    uniqueIndex("party_contact_points_unique_idx").on(
      t.tenantId,
      t.partyId,
      t.kind,
      t.normalizedValue,
    ),
    // THE DEDUP LOOKUP: "does any party already have this address?" Without
    // this index that question is a sequential scan on every keystroke.
    index("party_contact_points_lookup_idx").on(
      t.tenantId,
      t.kind,
      t.normalizedValue,
    ),
    index("party_contact_points_party_idx").on(t.tenantId, t.partyId),
    foreignKey({
      name: "party_contact_points_party_fk",
      columns: [t.tenantId, t.partyId],
      foreignColumns: [parties.tenantId, parties.id],
    }).onDelete("cascade"),
  ],
);

/* ------------------------------------------------------------------------
 * Invoicing / AR (session 4). The tenant's OWN customers. Invoices carry an
 * explicit state machine; `partial`/`paid` are derived from payments,
 * never set directly. Issuance posts Dr AR / Cr income through the core
 * engine; payments post Dr deposit / Cr AR.
 * ---------------------------------------------------------------------- */

/** The shared identity spine. Written by Accounting and by CRM — see src/lib/parties/. */
export type Party = typeof parties.$inferSelect;

export type PartyKind = Party["kind"];

export type PartyContactPoint = typeof partyContactPoints.$inferSelect;

export type PartyContactKind = PartyContactPoint["kind"];
