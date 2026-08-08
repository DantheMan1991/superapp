/**
 * CRM: party detail, affiliations, pipelines, deals, activities and tasks,
 * plus saved views, custom fields and automation rules.
 *
 * Split out of the former single-file `src/db/schema.ts`; `./index.ts`
 * re-exports every domain, so `@/db/schema` still resolves exactly as before.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./platform";
import { parties } from "./parties";

/**
 * Who may see a CRM record.
 *
 * `members` is spelled the same as `documents.effective_visibility` on
 * purpose — it is the same concept and the same RLS mechanism
 * (`app_current_tenant_role()`), and two vocabularies for one idea is how a
 * codebase teaches the next reader to invent a third.
 *
 * `restricted` is spelled DIFFERENTLY from Documents' `owners`, and that is
 * also deliberate. In a CRM "owner" already means the person a record is
 * assigned to, so a visibility value called `owners` would read as "only the
 * rep who owns it" when it actually means "only the business's owners". The
 * collision is worth one inconsistent word to avoid.
 *
 * An enum rather than a boolean so a third tier costs a value and not a
 * migration of every read site.
 */
export const crmVisibility = pgEnum("crm_visibility", ["members", "restricted"]);

/**
 * What CRM knows about a party: 1:1, created when CRM first touches the record.
 *
 * A party with no row here is one Accounting created and CRM has never been
 * asked about — which is a normal state, not a gap to backfill.
 */
export const crmPartyDetails = pgTable(
  "crm_party_details",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    partyId: uuid("party_id").notNull(),
    /**
     * The person this record is assigned to. AN ATTRIBUTION, NOT A PERMISSION
     * — it answers "whose account is this?" and grants nothing. Visibility is
     * the column below, decided by tenant role in RLS. Keeping the two apart
     * is what stops "owner" meaning two things in one table.
     *
     * Nullable: unassigned is a real and common state, and a default of
     * "whoever created it" would be a lie the pipeline reports on.
     */
    ownerClerkUserId: text("owner_clerk_user_id"),
    visibility: crmVisibility("visibility").notNull().default("members"),
    /**
     * Open taxonomy (primitive P1) — no CHECK on the values. Core stores and
     * filters; a Layer 2b profile supplies the vocabulary a trade actually
     * uses. Empty string rather than null so a filter never has to handle two
     * spellings of "not set".
     */
    lifecycleStage: text("lifecycle_stage").notNull().default(""),
    /** Same shape, same reason: "referral", "website", whatever a pack names. */
    source: text("source").notNull().default(""),
    notes: text("notes").notNull().default(""),
    /**
     * Extension bag (primitive P2) for the per-tenant custom fields slice 2
     * defines. NOT NULL DEFAULT '{}' so `custom->>'x'` is always safe, per
     * conventions §4. Nothing writes it yet.
     */
    custom: jsonb("custom").notNull().default({}),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("crm_party_details_tenant_id_id_idx").on(t.tenantId, t.id),
    // 1:1 with the party. The unique is what makes "the CRM record for this
    // party" a lookup rather than a query that might return two answers.
    uniqueIndex("crm_party_details_tenant_party_idx").on(t.tenantId, t.partyId),
    index("crm_party_details_tenant_owner_idx").on(t.tenantId, t.ownerClerkUserId),
    foreignKey({
      name: "crm_party_details_party_fk",
      columns: [t.tenantId, t.partyId],
      foreignColumns: [parties.tenantId, parties.id],
    }).onDelete("cascade"),
  ],
);

/**
 * A person's connection to an organization — "this person is Operations
 * Manager at that company".
 *
 * A JOIN TABLE RATHER THAN A COLUMN ON `parties`, because people change
 * employers and the old connection is the thing you want when you find a
 * three-year-old thread. A `parent_party_id` would have to be overwritten to
 * record that, losing exactly the history a CRM exists to keep.
 *
 * `ended_at` is what makes it former rather than deleted.
 */
export const crmAffiliations = pgTable(
  "crm_affiliations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** The party with kind='person'. Not CHECKed — see the sole-trader note. */
    personPartyId: uuid("person_party_id").notNull(),
    organizationPartyId: uuid("organization_party_id").notNull(),
    /** "Operations Manager". Free text: job titles are not an enumeration. */
    title: text("title").notNull().default(""),
    /**
     * The one to write to at that company. Partial-unique below rather than a
     * plain unique, so any number of non-primary affiliations may exist.
     */
    isPrimary: boolean("is_primary").notNull().default(false),
    startedOn: date("started_on", { mode: "string" }),
    endedOn: date("ended_on", { mode: "string" }),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("crm_affiliations_tenant_id_id_idx").on(t.tenantId, t.id),
    index("crm_affiliations_tenant_person_idx").on(t.tenantId, t.personPartyId),
    index("crm_affiliations_tenant_org_idx").on(t.tenantId, t.organizationPartyId),
    // The same person at the same company, twice, is a duplicate — but only
    // while it is current. Somebody who leaves and returns years later gets a
    // second row, which is the history this table exists to keep.
    uniqueIndex("crm_affiliations_current_idx")
      .on(t.tenantId, t.personPartyId, t.organizationPartyId)
      .where(sql`ended_on is null`),
    // At most one primary company per person, and again only among current
    // ones. A partial unique index is the whole enforcement; no trigger.
    uniqueIndex("crm_affiliations_primary_idx")
      .on(t.tenantId, t.personPartyId)
      .where(sql`is_primary = true and ended_on is null`),
    foreignKey({
      name: "crm_affiliations_person_fk",
      columns: [t.tenantId, t.personPartyId],
      foreignColumns: [parties.tenantId, parties.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "crm_affiliations_org_fk",
      columns: [t.tenantId, t.organizationPartyId],
      foreignColumns: [parties.tenantId, parties.id],
    }).onDelete("cascade"),
    // A party affiliated with itself is meaningless and is the shape a bad
    // merge produces, so the database refuses it rather than the UI hiding it.
    check(
      "crm_affiliations_distinct_parties",
      sql`${t.personPartyId} <> ${t.organizationPartyId}`,
    ),
  ],
);

/**
 * Named people who may see a RESTRICTED record.
 *
 * Slice 1 gave visibility two values and nothing in between: `members` means
 * everybody, `restricted` means tenant owners. That is a real cliff — the
 * commonest thing a business wants is "this acquisition is confidential, but
 * the two people working it need it", and the only way to say that was to make
 * the whole record visible to everybody.
 *
 * A GRANT IS NOT AN ASSIGNMENT, and the two stay structurally apart exactly as
 * 0064 insisted. `crm_party_details.owner_clerk_user_id` records who a record
 * is assigned to and grants nothing; a row HERE grants access and says nothing
 * about who is doing the work. Making assignment imply access would have been
 * the cheaper feature and it is the wrong one: a rep's name lands on records
 * for a dozen reasons, and none of them is a decision about confidentiality.
 *
 * READ THE POLICY NOTE IN THE MIGRATION BEFORE CHANGING EITHER TABLE'S RLS.
 * `crm_party_details` now reads this table, so this table's own policy must
 * NOT read `crm_party_details` — Postgres would recurse. 0064's promise that
 * "crm_party_details' own policy reads no other table" is what slice 6 spends,
 * and it can only be spent once.
 */
export const crmRecordCollaborators = pgTable(
  "crm_record_collaborators",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    partyId: uuid("party_id").notNull(),
    /** Who may see it. Clerk's id, like every other actor column here. */
    clerkUserId: text("clerk_user_id").notNull(),
    /**
     * Who granted it. An audit trail on the row itself as well as in
     * `audit_log`, because "who let them in" is the first question asked about
     * a confidential record and the row is where somebody will look.
     */
    grantedByClerkUserId: text("granted_by_clerk_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("crm_record_collaborators_tenant_id_id_idx").on(t.tenantId, t.id),
    // One grant per person per record. Granting twice is not two facts.
    uniqueIndex("crm_record_collaborators_unique_idx").on(
      t.tenantId,
      t.partyId,
      t.clerkUserId,
    ),
    // The lookup the details policy runs on every read of a restricted record.
    index("crm_record_collaborators_party_idx").on(t.tenantId, t.partyId),
    foreignKey({
      name: "crm_record_collaborators_party_fk",
      columns: [t.tenantId, t.partyId],
      foreignColumns: [parties.tenantId, parties.id],
    }).onDelete("cascade"),
  ],
);

/**
 * A saved list view: which records, in what order.
 *
 * THE FILTER IS jsonb AND `src/modules/crm/core/views.ts` IS ITS WHOLE
 * INTEGRITY, exactly as `crm_party_details.custom` depends on
 * `core/custom-fields.ts`. A stored filter names a FIELD KEY from a registry in
 * that file — never a column name — so nothing a browser sent can reach a WHERE
 * clause as an identifier. Read `parseFilter` before changing this column's
 * shape.
 *
 * NOT VISIBILITY-BEARING, and it does not need to be. A view is a saved
 * QUESTION, and the answer is computed inside the caller's transaction where
 * RLS has already removed what they may not see — so two people running one
 * shared view legitimately get different rows, and a view can be shared without
 * anybody auditing what it might expose. That is the property that makes
 * `is_shared` a boolean rather than an access list.
 *
 * NO `version` COLUMN. Every other editable row here has one, and the absence
 * is deliberate: a view is edited by the one person who made it, so the
 * concurrent-edit problem optimistic locking solves does not arise.
 */
export const crmSavedViews = pgTable(
  "crm_saved_views",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** Open taxonomy (P1) so deals and follow-ups need no migration. */
    entityType: text("entity_type").notNull().default("party"),
    name: text("name").notNull(),
    /** Who made it, and therefore who may edit it. */
    ownerClerkUserId: text("owner_clerk_user_id").notNull(),
    /** Private, or visible to the whole tenant. Not an access list — see above. */
    isShared: boolean("is_shared").notNull().default(false),
    /** `FilterCondition[]`, validated by `parseFilter` on every read. */
    filter: jsonb("filter").notNull().default([]),
    /** `{ field, direction }`, validated by `parseSort`. */
    sort: jsonb("sort").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("crm_saved_views_tenant_id_id_idx").on(t.tenantId, t.id),
    index("crm_saved_views_tenant_entity_idx").on(t.tenantId, t.entityType),
    // One person cannot have two views of the same name for the same thing.
    // Scoped to the OWNER rather than the tenant, because two people naming
    // their own private view "Mine" have not collided.
    uniqueIndex("crm_saved_views_name_idx").on(
      t.tenantId,
      t.entityType,
      t.ownerClerkUserId,
      t.name,
    ),
  ],
);

/**
 * "When this happens, do that."
 *
 * `trigger` IS A COLUMN AND THE REST IS jsonb, which is the one place this
 * table's shape differs from `crm_reports` and `crm_saved_views`. The engine's
 * only query is "which rules watch this trigger?", so that field has to be
 * indexable; conditions and the action are read once the row is already in
 * hand and never queried into. The trigger is NOT also stored inside the
 * jsonb — one fact, one place.
 *
 * NO `last_run_at` OR `run_count`, deliberately. Both were drafted and both
 * would mean every triggered transaction writing to the rule row, which turns a
 * busy rule into a serialization point for unrelated work. "Is this rule
 * actually doing anything?" is better answered by `audit_log`, which already
 * gets a row per firing with the record it touched — strictly more useful than
 * a counter, and it contends with nothing.
 *
 * READABLE BY EVERY MEMBER, WRITABLE BY OWNERS. The write half matches the
 * merge tool and the collaborator grants: a rule changes everybody's data, so
 * it is the business's decision. The read half is deliberately wider than those
 * two, because somebody who finds a follow-up they did not create is owed the
 * ability to discover which rule made it — a rules engine nobody can inspect is
 * indistinguishable from a haunted database.
 */
export const crmAutomationRules = pgTable(
  "crm_automation_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** One of `TRIGGERS` in `core/automation.ts`. Indexed; the engine's lookup. */
    trigger: text("trigger").notNull(),
    /** `{ conditions, action }`, validated by `parseRule` on every read. */
    definition: jsonb("definition").notNull().default({}),
    /**
     * Off is a first-class state. Somebody debugging "why did this record
     * change?" needs to be able to stop a rule without deleting it and losing
     * what it said.
     */
    isActive: boolean("is_active").notNull().default(true),
    createdByClerkUserId: text("created_by_clerk_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("crm_automation_rules_tenant_id_id_idx").on(t.tenantId, t.id),
    // The engine's query, and the reason `trigger` is a column: only the ACTIVE
    // rules for one trigger, on every write that could fire one.
    index("crm_automation_rules_trigger_idx")
      .on(t.tenantId, t.trigger)
      .where(sql`is_active = true`),
    uniqueIndex("crm_automation_rules_name_idx").on(t.tenantId, t.name),
  ],
);

/**
 * CRM's per-tenant settings row. Today it holds exactly one thing: the AI
 * cooldown marker.
 *
 * Mirrors `accounting_settings`, which has carried four `ai_last_*` markers
 * since the accounting AI shipped. The pattern matters more than the column:
 * the extractor CLAIMS this timestamp inside the same transaction that checks
 * it, so two people pasting notes at once serialize on the write instead of
 * both calling the model.
 *
 * A table for one column is worth it only because it has a reader from day one
 * — the gate below. It is not a home for settings nobody has asked for yet.
 */
export const crmSettings = pgTable(
  "crm_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** Cooldown marker for note extraction. Null = never run. */
    aiLastExtractedAt: timestamp("ai_last_extracted_at", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("crm_settings_tenant_idx").on(t.tenantId)],
);

/**
 * Whether a rule is actually working.
 *
 * A SEPARATE TABLE BECAUSE HEALTH IS AN OBSERVATION, NOT PART OF THE RULE.
 * The definition is the business's decision and is owner-write-only
 * (`drizzle/0083`). Health is written by the ENGINE, which runs inside the
 * transaction of whoever happened to trigger it — usually staff. Columns on the
 * rules table would therefore be unwritable exactly when a rule was failing for
 * a staff member, which is the case this exists to catch.
 *
 * Members may READ it, on the same reasoning `0083` gives for letting them read
 * rules: somebody who finds a follow-up they did not create is owed the ability
 * to find out which rule did it — and "that rule has been failing since
 * Tuesday" is part of that answer. Nobody but the engine may write it, so a
 * member cannot forge a failure against a rule they dislike.
 *
 * A ROW EXISTS ONLY WHILE SOMETHING IS WRONG. The engine writes on STATE
 * CHANGE — healthy→failing inserts, failing→recovered deletes — so a working
 * tenant carries no rows here and pays nothing for the feature. Absence means
 * healthy, which is also the honest reading for a rule that has never run.
 */
export const crmAutomationRuleHealth = pgTable(
  "crm_automation_rule_health",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    ruleId: uuid("rule_id")
      .notNull()
      .references(() => crmAutomationRules.id, { onDelete: "cascade" }),
    /** Since the last success. Resets by the row being deleted. */
    consecutiveFailures: integer("consecutive_failures").notNull().default(1),
    /**
     * The error, truncated by the writer. A message, never a stack — a stack
     * can carry row values through interpolated SQL, and this table is readable
     * by every member (S9).
     */
    lastError: text("last_error").notNull().default(""),
    lastErrorAt: timestamp("last_error_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("crm_automation_rule_health_rule_idx").on(t.ruleId)],
);

/**
 * A saved report: a question somebody wanted to keep asking.
 *
 * THE SAME SHAPE AS `crm_saved_views` AND FOR THE SAME REASONS — read the note
 * there before changing either. A report is a QUESTION, and the answer is
 * computed in the reader's own transaction where RLS has already removed what
 * they may not see, so `is_shared` is a boolean rather than an access list and
 * two people opening one shared report correctly get different totals.
 *
 * `definition` IS ONE jsonb COLUMN RATHER THAN FOUR, and that is deliberate:
 * `parseDefinition` in `core/reports.ts` already validates the whole shape on
 * every read — type, filter, grouping, measure — and splitting it into columns
 * would mean four things to validate separately and a fifth state where they
 * disagree. The column is opaque to SQL, which is fine because nothing queries
 * into it; a report is looked up by id and then run.
 *
 * `name` IS THE QUESTION IT ANSWERS, by convention rather than by CHECK. Every
 * built-in ends in a question mark and there is a test enforcing that for them,
 * but refusing to save "Q3 pipeline" because somebody left the punctuation off
 * would be a product telling its user how to write. The placeholder asks; the
 * database does not insist.
 */
export const crmReports = pgTable(
  "crm_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** A `ReportDefinition`, validated by `parseDefinition` on every read. */
    definition: jsonb("definition").notNull().default({}),
    ownerClerkUserId: text("owner_clerk_user_id").notNull(),
    isShared: boolean("is_shared").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("crm_reports_tenant_id_id_idx").on(t.tenantId, t.id),
    index("crm_reports_tenant_idx").on(t.tenantId),
    // One person cannot have two reports of the same name. Scoped to the owner,
    // because two people each keeping their own "My pipeline" have not collided.
    uniqueIndex("crm_reports_name_idx").on(
      t.tenantId,
      t.ownerClerkUserId,
      t.name,
    ),
  ],
);

/**
 * Which view a person lands on.
 *
 * PER USER, NOT PER TENANT. A pin is a preference about how somebody works, and
 * one person pinning "Assigned to me" must not change what anybody else opens.
 *
 * `view_id` IS TEXT AND HAS NO FOREIGN KEY, deliberately: it holds either a
 * `crm_saved_views.id` or a built-in id like `builtin:mine`, which is code
 * rather than a row. Resolution falls back to the default when the id names
 * nothing the caller can see — which covers a deleted view, a shared view that
 * was made private, and a built-in that a later release retires, without any of
 * the three needing a cleanup job.
 */
export const crmViewPins = pgTable(
  "crm_view_pins",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    clerkUserId: text("clerk_user_id").notNull(),
    entityType: text("entity_type").notNull().default("party"),
    viewId: text("view_id").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("crm_view_pins_unique_idx").on(
      t.tenantId,
      t.clerkUserId,
      t.entityType,
    ),
  ],
);

/**
 * The types a custom field can be. A CLOSED enumeration on purpose: every value
 * here needs a parser, an input control and a display, so adding one is a code
 * change in three places and should look like one.
 */
export const crmFieldType = pgEnum("crm_field_type", [
  "text",
  "number",
  "date",
  "boolean",
  "select",
  "multi_select",
  "url",
]);

/**
 * Per-tenant custom field definitions — the thing that makes this a CRM a
 * business can shape rather than a fixed form, and the seam a Layer 2b industry
 * profile fills with data instead of code.
 *
 * TWO IDENTIFIERS, AND WHICH ONE IS AUTHORITATIVE MATTERS.
 *
 *   `id`  — what `crm_party_details.custom` is keyed by. Stable forever.
 *   `key` — a human- and import-facing alias. RENAMEABLE.
 *
 * Storing values against the id means correcting a typo in `key` rewrites one
 * row instead of every record that ever held the field. This is deliberately
 * the OPPOSITE choice from `document_tags`, where the slug is immutable and
 * `documents.tags` stores slugs — and the difference is who types the string. A
 * tag is a label somebody picks from a list; a custom field key is closer to a
 * column name, invented once under time pressure and regretted later. The cost
 * is that `custom` is not readable without joining to this table, which is a
 * price worth paying for a rename that cannot lose data.
 *
 * `entity_type` is an OPEN taxonomy (P1) with no CHECK: 'party' today, 'deal'
 * when slice 3 lands, and a pack's own record type after that — none of which
 * should need a migration to core.
 */
export const crmFieldDefs = pgTable(
  "crm_field_defs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull().default("party"),
    key: text("key").notNull(),
    label: text("label").notNull(),
    fieldType: crmFieldType("field_type").notNull(),
    /**
     * `[{ value, label }]` for the select kinds, `[]` for everything else.
     * NOT NULL DEFAULT so `options` is always an array to iterate, never a null
     * to test for (conventions §4).
     */
    options: jsonb("options").notNull().default([]),
    /**
     * Required for a LIFECYCLE TRANSITION, not for every save.
     *
     * Required-on-create is how imports and lead capture become unusable: a
     * half-known record is the normal state at the moment somebody first types
     * a name, and a form that refuses it just moves the record into a
     * spreadsheet. The check runs when the stage changes, which is the point at
     * which the business actually asserts something.
     */
    isRequired: boolean("is_required").notNull().default(false),
    helpText: text("help_text").notNull().default(""),
    sortOrder: integer("sort_order").notNull().default(0),
    /**
     * ARCHIVED, NEVER DELETED. Values already stored against this id stay in
     * `custom` and stop being rendered. Hard-deleting the definition would turn
     * every stored value into an orphan nobody can interpret — the data would
     * still be there and would no longer mean anything.
     */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("crm_field_defs_tenant_id_id_idx").on(t.tenantId, t.id),
    // Unique among LIVE definitions only, so archiving `warranty_expiry` frees
    // the name for a replacement without touching the old one's stored values.
    uniqueIndex("crm_field_defs_tenant_key_idx")
      .on(t.tenantId, t.entityType, t.key)
      .where(sql`archived_at is null`),
    index("crm_field_defs_tenant_entity_idx").on(
      t.tenantId,
      t.entityType,
      t.sortOrder,
    ),
    // Lowercase, underscore-separated. The same shape `mail_links.entity_type`
    // uses — a format constraint, never a value whitelist.
    check("crm_field_defs_key_format", sql`${t.key} ~ '^[a-z][a-z0-9_]{0,62}$'`),
  ],
);

/* ------------------------------------------------------------------------
 * CRM pipelines and deals (slice 3).
 *
 * The neutrality line, because this is where it is easiest to cross: core owns
 * a pipeline with ORDERED STAGES and a deal with an amount. It does NOT own
 * what the stages are called. "Estimate sent", "Treatment plan accepted",
 * "Survey booked" are vocabulary a Layer 2b profile supplies as seed data —
 * core ships one deliberately dull default set and nothing else.
 * ---------------------------------------------------------------------- */

/**
 * What reaching a stage MEANS. The terminal semantics live on the stage rather
 * than as a separate column on the deal, so "is this deal won?" has exactly one
 * answer and cannot desync — the same "derived, never stored" discipline the
 * accounting module applies to invoice status.
 */
export const crmDealOutcome = pgEnum("crm_deal_outcome", ["open", "won", "lost"]);

export const crmPipelines = pgTable(
  "crm_pipelines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("crm_pipelines_tenant_id_id_idx").on(t.tenantId, t.id),
    // At most one default, and only among live pipelines. A partial unique is
    // the whole enforcement — no trigger, no application invariant to remember.
    uniqueIndex("crm_pipelines_default_idx")
      .on(t.tenantId)
      .where(sql`is_default = true and archived_at is null`),
    index("crm_pipelines_tenant_sort_idx").on(t.tenantId, t.sortOrder),
  ],
);

export const crmPipelineStages = pgTable(
  "crm_pipeline_stages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    pipelineId: uuid("pipeline_id").notNull(),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    /**
     * Default likelihood, 0–100, used for a weighted forecast. On the STAGE
     * rather than the deal: a per-deal override is a real want, but it is one
     * more number to keep honest and slice 9 can add it once there is a report
     * arguing for it.
     */
    probability: integer("probability").notNull().default(0),
    outcome: crmDealOutcome("outcome").notNull().default("open"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("crm_pipeline_stages_tenant_id_id_idx").on(t.tenantId, t.id),
    index("crm_pipeline_stages_pipeline_idx").on(
      t.tenantId,
      t.pipelineId,
      t.sortOrder,
    ),
    foreignKey({
      name: "crm_pipeline_stages_pipeline_fk",
      columns: [t.tenantId, t.pipelineId],
      foreignColumns: [crmPipelines.tenantId, crmPipelines.id],
    }).onDelete("cascade"),
    check(
      "crm_pipeline_stages_probability",
      sql`${t.probability} between 0 and 100`,
    ),
  ],
);

export const crmDeals = pgTable(
  "crm_deals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /**
     * WHO THE DEAL IS WITH. Required, and a column rather than a row in
     * `crm_deal_parties`, so the database guarantees exactly one — a deal with
     * no party is unfilterable in every board view, and "there should be one
     * row flagged primary" is an invariant an application has to remember.
     */
    partyId: uuid("party_id").notNull(),
    /** The person to talk to. Optional: plenty of deals are with a company. */
    primaryContactPartyId: uuid("primary_contact_party_id"),
    pipelineId: uuid("pipeline_id").notNull(),
    stageId: uuid("stage_id").notNull(),
    title: text("title").notNull(),
    /**
     * NULLABLE, and that is the honest shape rather than an oversight. A deal
     * whose value is not yet known is a real and common state; defaulting it to
     * zero would make every forecast quietly understate itself, and nothing
     * downstream could tell "worth nothing" from "not priced yet".
     *
     * Integer cents in a bigint, like every other amount here (conventions §3).
     * There is no currency column — the platform is single-currency today, and
     * a second one is a change to `@/lib/money` before it is a change here.
     */
    amountCents: bigint("amount_cents", { mode: "number" }),
    expectedCloseOn: date("expected_close_on", { mode: "string" }),
    ownerClerkUserId: text("owner_clerk_user_id"),
    /**
     * Denormalized from the stage history, stamped when the deal first reaches
     * a stage whose outcome is not `open`. Derivable by walking
     * `crm_deal_stage_events`, but "won deals this quarter" would then be a
     * join-and-aggregate on every dashboard load — the same reasoning behind
     * `invoices.total_cents`. Cleared if the deal reopens.
     */
    closedAt: timestamp("closed_at", { withTimezone: true }),
    /** Slice 2's custom fields, for definitions with `entity_type = 'deal'`. */
    custom: jsonb("custom").notNull().default({}),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("crm_deals_tenant_id_id_idx").on(t.tenantId, t.id),
    index("crm_deals_board_idx").on(t.tenantId, t.pipelineId, t.stageId),
    index("crm_deals_party_idx").on(t.tenantId, t.partyId),
    index("crm_deals_owner_idx").on(t.tenantId, t.ownerClerkUserId),
    foreignKey({
      name: "crm_deals_party_fk",
      columns: [t.tenantId, t.partyId],
      foreignColumns: [parties.tenantId, parties.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "crm_deals_contact_fk",
      columns: [t.tenantId, t.primaryContactPartyId],
      foreignColumns: [parties.tenantId, parties.id],
    }),
    foreignKey({
      name: "crm_deals_pipeline_fk",
      columns: [t.tenantId, t.pipelineId],
      foreignColumns: [crmPipelines.tenantId, crmPipelines.id],
    }),
    foreignKey({
      name: "crm_deals_stage_fk",
      columns: [t.tenantId, t.stageId],
      foreignColumns: [crmPipelineStages.tenantId, crmPipelineStages.id],
    }),
    check("crm_deals_amount_nonnegative", sql`${t.amountCents} >= 0`),
  ],
);

/**
 * Every stage change, append-only.
 *
 * SHIPPED NOW EVEN THOUGH NOTHING READS IT YET, and that is deliberate rather
 * than speculative. Velocity, win rate and "how long does a deal sit in
 * Proposal" are the reports slice 9 exists to build, and every one of them is a
 * question about history. History is the single thing that cannot be
 * reconstructed later — a table added in slice 9 starts empty and answers
 * nothing until a quarter has passed. The cost of carrying it now is one insert
 * per stage move.
 *
 * No `version` column: nothing updates these rows. A correction is a new event.
 */
export const crmDealStageEvents = pgTable(
  "crm_deal_stage_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    dealId: uuid("deal_id").notNull(),
    /** Null on the first event — the deal was created into its opening stage. */
    fromStageId: uuid("from_stage_id"),
    toStageId: uuid("to_stage_id").notNull(),
    changedByClerkUserId: text("changed_by_clerk_user_id").notNull(),
    changedAt: timestamp("changed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("crm_deal_stage_events_tenant_id_id_idx").on(t.tenantId, t.id),
    index("crm_deal_stage_events_deal_idx").on(t.tenantId, t.dealId, t.changedAt),
    foreignKey({
      name: "crm_deal_stage_events_deal_fk",
      columns: [t.tenantId, t.dealId],
      foreignColumns: [crmDeals.tenantId, crmDeals.id],
    }).onDelete("cascade"),
  ],
);

/**
 * Additional people on a deal beyond the primary contact — the finance
 * approver, the site manager, the person who actually signs.
 *
 * A relation table rather than more columns, because the count is genuinely
 * unbounded and each one carries its own role.
 */
export const crmDealParties = pgTable(
  "crm_deal_parties",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    dealId: uuid("deal_id").notNull(),
    partyId: uuid("party_id").notNull(),
    /** "Approver", "Site contact". Free text — roles are not an enumeration. */
    role: text("role").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("crm_deal_parties_tenant_id_id_idx").on(t.tenantId, t.id),
    // The same person twice on one deal is a duplicate, not a second role.
    uniqueIndex("crm_deal_parties_unique_idx").on(t.tenantId, t.dealId, t.partyId),
    index("crm_deal_parties_party_idx").on(t.tenantId, t.partyId),
    foreignKey({
      name: "crm_deal_parties_deal_fk",
      columns: [t.tenantId, t.dealId],
      foreignColumns: [crmDeals.tenantId, crmDeals.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "crm_deal_parties_party_fk",
      columns: [t.tenantId, t.partyId],
      foreignColumns: [parties.tenantId, parties.id],
    }).onDelete("cascade"),
  ],
);

/* ------------------------------------------------------------------------
 * CRM activity and follow-ups (slice 4).
 *
 * What was said, and what has to happen next. The timeline these feed is
 * built to take more sources than these two — slice 5 adds mail threads once
 * CRM registers its entity types with Mail, and nothing here has to change
 * for that.
 * ---------------------------------------------------------------------- */

/**
 * What kind of contact this was. A CLOSED enumeration, because each value gets
 * an icon and a verb in the UI — adding one is a code change and should look
 * like one.
 *
 * Note what is absent: no `email`. A logged email would be somebody retyping
 * what the Mail module already holds, and two records of one conversation
 * disagree the moment either is edited. Mail contributes threads to the
 * timeline directly in slice 5.
 */
export const crmActivityKind = pgEnum("crm_activity_kind", [
  "note",
  "call",
  "meeting",
]);

export const crmActivities = pgTable(
  "crm_activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** The record this is filed under. Required — an activity about nobody is
     * not an activity, and the visibility policy resolves through it. */
    partyId: uuid("party_id").notNull(),
    /** Optionally also about a specific deal. */
    dealId: uuid("deal_id"),
    kind: crmActivityKind("kind").notNull(),
    subject: text("subject").notNull().default(""),
    body: text("body").notNull().default(""),
    /**
     * WHEN IT HAPPENED, which is not when it was typed. Somebody writing up
     * Friday's site visit on Monday needs the timeline to read Friday, and
     * `created_at` cannot be moved without lying about the row.
     */
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdByClerkUserId: text("created_by_clerk_user_id").notNull(),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("crm_activities_tenant_id_id_idx").on(t.tenantId, t.id),
    // The timeline's own query: one record, newest first.
    index("crm_activities_party_idx").on(t.tenantId, t.partyId, t.occurredAt),
    index("crm_activities_deal_idx").on(t.tenantId, t.dealId, t.occurredAt),
    foreignKey({
      name: "crm_activities_party_fk",
      columns: [t.tenantId, t.partyId],
      foreignColumns: [parties.tenantId, parties.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "crm_activities_deal_fk",
      columns: [t.tenantId, t.dealId],
      foreignColumns: [crmDeals.tenantId, crmDeals.id],
    }).onDelete("cascade"),
  ],
);

/**
 * A follow-up.
 *
 * BOTH `party_id` AND `deal_id` ARE OPTIONAL, deliberately. "Ring the
 * accountant back" is a real task that belongs to nobody in the CRM, and a
 * product that refuses to hold it sends that task to a sticky note. The RLS
 * policy therefore branches: attached tasks inherit the record's visibility,
 * unattached ones are plain tenant-scoped.
 */
export const crmTasks = pgTable(
  "crm_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    partyId: uuid("party_id"),
    dealId: uuid("deal_id"),
    title: text("title").notNull(),
    notes: text("notes").notNull().default(""),
    /** A DATE, not a timestamp. Follow-ups are due on a day, not at 14:32. */
    dueOn: date("due_on", { mode: "string" }),
    assigneeClerkUserId: text("assignee_clerk_user_id"),
    /**
     * Completion is a TIME, not a boolean, so "done" and "done last Tuesday"
     * are the same fact rather than two columns that can disagree. Null is
     * open; clearing it reopens.
     */
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedByClerkUserId: text("completed_by_clerk_user_id"),
    createdByClerkUserId: text("created_by_clerk_user_id").notNull(),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("crm_tasks_tenant_id_id_idx").on(t.tenantId, t.id),
    index("crm_tasks_party_idx").on(t.tenantId, t.partyId),
    index("crm_tasks_deal_idx").on(t.tenantId, t.dealId),
    // "What is open, soonest first" — the query the task list is made of.
    index("crm_tasks_open_idx")
      .on(t.tenantId, t.dueOn)
      .where(sql`completed_at is null`),
    index("crm_tasks_assignee_idx").on(t.tenantId, t.assigneeClerkUserId),
    foreignKey({
      name: "crm_tasks_party_fk",
      columns: [t.tenantId, t.partyId],
      foreignColumns: [parties.tenantId, parties.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "crm_tasks_deal_fk",
      columns: [t.tenantId, t.dealId],
      foreignColumns: [crmDeals.tenantId, crmDeals.id],
    }).onDelete("cascade"),
    // Completed means both stamps, or neither. A row with one is a half-write
    // nobody could interpret, so the database refuses it.
    check(
      "crm_tasks_completion_pair",
      sql`(${t.completedAt} is null) = (${t.completedByClerkUserId} is null)`,
    ),
  ],
);

export type CrmPartyDetails = typeof crmPartyDetails.$inferSelect;

export type CrmAffiliation = typeof crmAffiliations.$inferSelect;

export type CrmRecordCollaborator = typeof crmRecordCollaborators.$inferSelect;

export type CrmSavedView = typeof crmSavedViews.$inferSelect;

export type CrmReport = typeof crmReports.$inferSelect;

export type CrmAutomationRule = typeof crmAutomationRules.$inferSelect;

export type CrmAutomationRuleHealth =
  typeof crmAutomationRuleHealth.$inferSelect;

export type CrmSettings = typeof crmSettings.$inferSelect;

export type CrmViewPin = typeof crmViewPins.$inferSelect;

export type CrmFieldDef = typeof crmFieldDefs.$inferSelect;

export type CrmActivity = typeof crmActivities.$inferSelect;

export type CrmActivityKind = CrmActivity["kind"];

export type CrmTask = typeof crmTasks.$inferSelect;

export type CrmPipeline = typeof crmPipelines.$inferSelect;

export type CrmPipelineStage = typeof crmPipelineStages.$inferSelect;

export type CrmDeal = typeof crmDeals.$inferSelect;

export type CrmDealStageEvent = typeof crmDealStageEvents.$inferSelect;

export type CrmDealParty = typeof crmDealParties.$inferSelect;

/** What reaching a stage means for the deal sitting in it. */
export type CrmDealOutcome = CrmPipelineStage["outcome"];

export type CrmFieldType = CrmFieldDef["fieldType"];

/** One choice on a select or multi-select field. */
export type CrmFieldOption = { value: string; label: string };

/** Who may see a CRM record: every member, or the business's owners only. */
export type CrmRecordVisibility = CrmPartyDetails["visibility"];
