/**
 * Scheduling: calendars, who they are shared with, and what is on them.
 *
 * Read docs/modules/scheduling.md before changing anything here — the sharing
 * model is the part that is expensive to get wrong, and it is written up there
 * with the traps it inherits from drizzle/0077.
 *
 * THE ONE THING TO KNOW: **a calendar is the unit of sharing, not an item.**
 * Items, attendees and everything added later resolve visibility through a
 * single EXISTS against `schedule_calendars` and never restate the rule. That is
 * the same arrangement `crm_affiliations`, `crm_deals`, `crm_activities` and
 * `crm_tasks` have against `crm_party_details`, and it exists so there are not
 * four copies of one rule to drift apart.
 *
 * Four tables, not the six the dossier's data model lists. Links (slice 3) and
 * the per-person show/hide preference land with the slices that read them —
 * "adding a table with no reader is the speculative build this codebase avoids"
 * (crm.md). Items and attendees ARE here, because the property slice 0 has to
 * certify is that item visibility inherits from the calendar, and that cannot be
 * proven without both.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./platform";

/**
 * How much of a calendar a grant exposes.
 *
 * Taken from Outlook, which offers exactly these after "not shared": *can view
 * when I'm busy* · *can view titles and locations* · *can view all details* ·
 * *can edit*. The design carried three until the real product was walked on
 * 2026-08-08, and the missing middle one is the one that matters.
 *
 * **`busy` AND `titles` ARE PROJECTIONS, NOT GRANTS.** They are not "you may
 * read this row" or "you may not" — they are "you may read some of its
 * columns". An RLS predicate cannot return a redacted row, so the read path
 * resolves the level first and projects accordingly (src/lib/schedule/access.ts).
 * Do not add a level here expecting a policy alone to enforce it.
 *
 * Ordered least to most, and the order is load-bearing: `accessAtLeast()`
 * compares by index.
 */
export const scheduleAccess = pgEnum("schedule_access", [
  "busy",
  "titles",
  "details",
  "write",
]);

/**
 * Whether an item makes its owner look unavailable.
 *
 * A PROPERTY OF THE ITEM, NOT OF THE SHARE, and the distinction is a real bug
 * rather than a nicety: availability that means "an item exists in this range"
 * makes every all-day note, reminder and blocked-out deadline read as booked
 * solid. Slice 9 reads this column; nothing before it does.
 */
export const scheduleShowAs = pgEnum("schedule_show_as", [
  "free",
  "busy",
  "tentative",
  "away",
]);

/**
 * Outlook's Private flag: one item narrower than the calendar it sits on.
 *
 * `normal` inherits the calendar's sharing. `private` is visible only to the
 * calendar's owner and the item's attendees, however widely the calendar itself
 * is shared — expressible as an RLS predicate, so the database enforces it and
 * no server action has to remember to.
 */
export const scheduleSensitivity = pgEnum("schedule_sensitivity", [
  "normal",
  "private",
]);

/** Where an attendee stands. Mirrors what every calendar client already shows. */
export const scheduleResponse = pgEnum("schedule_response", [
  "needs_action",
  "accepted",
  "declined",
  "tentative",
]);

/**
 * The grantee that means "everyone in this workspace".
 *
 * An EMPTY STRING rather than NULL, for the reason `crm_party_details`
 * spells its open taxonomies the same way: a filter never has to handle two
 * spellings of the same idea. It also keeps the unique index plain (no
 * NULLS NOT DISTINCT) and keeps the policy out of three-valued logic, where
 * `grantee = NULL` is NULL rather than true and the term silently stops working.
 *
 * `app_current_user()` returns NULL when the caller passed no user id, so it can
 * never equal this sentinel by accident.
 */
export const SHARE_EVERYONE = "";

/**
 * A calendar. The container, and THE UNIT OF SHARING.
 *
 * Note what is absent: a `visibility` column. The design carried one — copying
 * `crm_party_details.visibility` — until the four access levels above made it
 * untenable. A binary "members" flag cannot say *everyone may see titles but
 * not details*, which is a thing Outlook lets you say and a thing a pack
 * publishing a business-wide calendar will want. So business-wide sharing is a
 * SHARE ROW with the sentinel grantee, carrying a level like any other grant.
 *
 * One mechanism rather than two. Outlook renders it the same way: "People in my
 * organization" is a row in the sharing list using the same dropdown as a
 * person, not a separate switch.
 */
export const scheduleCalendars = pgTable(
  "schedule_calendars",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /**
     * Whose calendar this is. NULL means the BUSINESS owns it rather than a
     * person — which is also how a bookable resource is modelled, so do not add
     * a `resources` table when meeting rooms or equipment come up. Outlook does
     * the same thing: "add from directory" offers a person, a group, or a
     * resource, and all three resolve to a calendar.
     *
     * An owner is not a grant. It is what makes a calendar yours to share, and
     * it is the only thing that survives every share being revoked.
     */
    ownerClerkUserId: text("owner_clerk_user_id"),
    name: text("name").notNull(),
    /** Free-form so a palette can change without a migration. */
    color: text("color").notNull().default(""),
    /**
     * Open taxonomy (primitive P1) — no CHECK on the values. Core writes
     * `personal` and nothing else; a pack names its own. Empty string rather
     * than null, same reason as everywhere else in this schema.
     */
    kind: text("kind").notNull().default(""),
    /**
     * The pack that provisions and manages this calendar, and its own stable
     * key for it. Both null means a person made it in the core UI.
     *
     * Non-null is also the discriminator the UI groups on — Outlook shows
     * integration-published calendars under "Other calendars", apart from a
     * person's own, and it can do that without knowing which integration it is
     * looking at. The pair is what makes provisioning idempotent on re-enable.
     */
    extensionSlug: text("extension_slug"),
    extensionKey: text("extension_key"),
    /**
     * Exactly one per person, created on membership, undeletable. The place
     * anything lands when nobody chose a calendar.
     */
    isPrimary: boolean("is_primary").notNull().default(false),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // The pair every child table's composite FK points at.
    uniqueIndex("schedule_calendars_tenant_id_id_idx").on(t.tenantId, t.id),
    // One primary per person. Partial, because everything else is unconstrained.
    uniqueIndex("schedule_calendars_primary_idx")
      .on(t.tenantId, t.ownerClerkUserId)
      .where(sql`${t.isPrimary}`),
    // What makes a pack's provisioning idempotent: same slug + key, same row.
    uniqueIndex("schedule_calendars_managed_idx")
      .on(t.tenantId, t.extensionSlug, t.extensionKey)
      .where(sql`${t.extensionSlug} is not null`),
    index("schedule_calendars_owner_idx").on(t.tenantId, t.ownerClerkUserId),
    // A primary calendar with no owner would be a primary calendar for nobody.
    check(
      "schedule_calendars_primary_has_owner",
      sql`not ${t.isPrimary} or ${t.ownerClerkUserId} is not null`,
    ),
    // Half a managed identity cannot be made idempotent, so refuse the halves.
    check(
      "schedule_calendars_extension_pair",
      sql`(${t.extensionSlug} is null) = (${t.extensionKey} is null)`,
    ),
    check(
      "schedule_calendars_extension_slug_format",
      sql`${t.extensionSlug} is null or ${t.extensionSlug} ~ '^[a-z][a-z0-9_-]{0,62}$'`,
    ),
  ],
);

/**
 * One grant: this calendar, to this person (or to everyone), at this level.
 *
 * ============================================================================
 * THIS TABLE'S RLS POLICY MUST NEVER READ `schedule_calendars`.
 * ============================================================================
 *
 * `schedule_calendars`' policy reads THIS table. Postgres evaluates policies
 * inside policy subqueries, so two tables whose policies name each other recurse
 * — `infinite recursion detected in policy for relation`, on the first SELECT,
 * taking the whole module down. drizzle/0077 spent the same one-way promise for
 * `crm_record_collaborators` and said so in capitals; this is that promise
 * again.
 *
 * It binds harder here than it did in CRM, because a calendar's OWNER must be
 * able to share it and not only a tenant owner — which is a read of
 * `schedule_calendars`, which is the trap. 0077 already named the way out:
 * "the answer is a SECURITY DEFINER helper, not an EXISTS". So the write policy
 * calls `app_owns_calendar()`, which leaks nothing but a boolean.
 *
 * The composite FK below is fine and is not the trap — foreign key checks do
 * not run policies. Only policies naming policies recurse.
 */
export const scheduleShares = pgTable(
  "schedule_shares",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    calendarId: uuid("calendar_id").notNull(),
    /**
     * Who the grant is to. `SHARE_EVERYONE` (the empty string) means everyone in
     * the workspace — see that constant for why it is not NULL.
     *
     * Clerk's id rather than a profile FK, matching `crm_record_collaborators`,
     * because `app_current_user()` is what a policy has to compare against.
     */
    granteeClerkUserId: text("grantee_clerk_user_id").notNull(),
    access: scheduleAccess("access").notNull(),
    /** Who decided this. Recorded so "why can they see it?" has an answer. */
    grantedByClerkUserId: text("granted_by_clerk_user_id").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // One grant per grantee per calendar: changing access is an update, never a
    // second row that has to be reconciled against the first.
    uniqueIndex("schedule_shares_unique_idx").on(
      t.tenantId,
      t.calendarId,
      t.granteeClerkUserId,
    ),
    // The lookup the calendars policy runs: "what am I granted here?"
    index("schedule_shares_grantee_idx").on(t.tenantId, t.granteeClerkUserId),
    foreignKey({
      name: "schedule_shares_calendar_fk",
      columns: [t.tenantId, t.calendarId],
      foreignColumns: [scheduleCalendars.tenantId, scheduleCalendars.id],
    }).onDelete("cascade"),
  ],
);

/**
 * One thing on a calendar.
 *
 * Named `schedule_items` rather than `events` while the UI says "event": a bar
 * spanning three weeks is not colloquially an event, and the table name is the
 * one that has to survive contact with packs that draw exactly that.
 */
export const scheduleItems = pgTable(
  "schedule_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    calendarId: uuid("calendar_id").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    location: text("location").notNull().default(""),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    allDay: boolean("all_day").notNull().default(false),
    /**
     * The zone this was AUTHORED in, not the reader's.
     *
     * Needed because an all-day item and a recurring one are anchored to a wall
     * clock rather than an instant: "every Tuesday at 8am" survives a DST change
     * only if the rule knows which 8am it meant. See docs/modules/timezone.md.
     */
    timeZone: text("time_zone").notNull(),
    showAs: scheduleShowAs("show_as").notNull().default("busy"),
    sensitivity: scheduleSensitivity("sensitivity").notNull().default("normal"),
    /**
     * Open taxonomy (primitive P1). Core writes nothing here. `milestone`,
     * `site_visit`, `inspection` are values a PACK registers — which is how the
     * vocabulary of a trade reaches the product without core learning a word of
     * it. A zero-duration item is simply `ends_at = starts_at`.
     */
    kind: text("kind").notNull().default(""),
    /**
     * An RFC 5545 RRULE value, without the `RRULE:` prefix. Empty means this
     * happens once.
     *
     * THE SERIES IS THE ROW. Occurrences are expanded on READ, never
     * materialised — a year of a daily standup is one row here and 365 in a
     * table that would have to be regenerated every time somebody edited the
     * rule. `src/modules/scheduling/core/recurrence.ts` is the only thing that
     * parses it, and it REFUSES rules it does not implement rather than
     * silently dropping a clause.
     */
    recurrenceRule: text("recurrence_rule").notNull().default(""),
    /**
     * Extension bag (primitive P2). NOT NULL DEFAULT '{}' so `metadata->>'x'` is
     * always safe. Where a pack keeps progress, float, baselines — the fields a
     * chart needs and a calendar does not.
     */
    metadata: jsonb("metadata").notNull().default({}),
    /**
     * Nesting. IN CORE ON PURPOSE, while dependencies are not.
     *
     * A month-end close has steps inside it and a new-patient visit has stages,
     * so nesting passes the bookkeeper/dentist/plumber test. Finish-to-start
     * with a lag does not — that is project-management vocabulary and belongs to
     * a pack's own edge table.
     *
     * The asymmetry is what decided it rather than taste: an unused nullable
     * column costs one column, while omitting it forces a pack to keep a
     * parallel tree core's calendar cannot render — and then the chart and the
     * calendar disagree about what exists.
     */
    parentId: uuid("parent_id"),
    createdByClerkUserId: text("created_by_clerk_user_id").notNull().default(""),
    /**
     * Cancelled, not deleted. An appointment that vanishes is worse than one
     * marked off, and it keeps whatever a later slice links to it intact.
     */
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("schedule_items_tenant_id_id_idx").on(t.tenantId, t.id),
    // THE query the module runs: everything on these calendars in this window.
    index("schedule_items_range_idx").on(t.tenantId, t.calendarId, t.startsAt),
    foreignKey({
      name: "schedule_items_calendar_fk",
      columns: [t.tenantId, t.calendarId],
      foreignColumns: [scheduleCalendars.tenantId, scheduleCalendars.id],
    }).onDelete("cascade"),
    // THE `set null` BELOW IS A LOSSY DESCRIPTION OF THE REAL CONSTRAINT, and
    // that is deliberate. Postgres's *bare* `ON DELETE SET NULL` nulls EVERY
    // referencing column — `tenant_id` included, which is NOT NULL — so as
    // declared it could never unparent a child: deleting a parent that had one
    // failed with "null value in column tenant_id violates not-null
    // constraint". `drizzle/0192` rewrites it by hand as PG 15's column-list
    // form, `ON DELETE SET NULL (parent_id)`, which nulls only `parent_id` and
    // finally does what this line always meant.
    //
    // `.onDelete()` takes an action, not a column list, so the line cannot say
    // so. It stays as it is on purpose: the drizzle-kit snapshot already records
    // `set null`, so schema and snapshot agree and `db:generate` never tries to
    // revert the migration. Do not change it without reading 0192's header.
    foreignKey({
      name: "schedule_items_parent_fk",
      columns: [t.tenantId, t.parentId],
      foreignColumns: [t.tenantId, t.id],
    }).onDelete("set null"),
    check("schedule_items_ends_after_starts", sql`${t.endsAt} >= ${t.startsAt}`),
    // Its own parent is the shape a bad copy produces; deeper cycles are the
    // read path's problem, but the database can refuse the trivial one.
    check("schedule_items_no_self_parent", sql`${t.parentId} is distinct from ${t.id}`),
  ],
);

/**
 * Who is on an item.
 *
 * ATTENDANCE IS NOT SHARING, and keeping them separate is what makes "Dave is on
 * this" work when Dave cannot see the office calendar: the item policy carries
 * an attendee term, so being invited shows you the item without granting you the
 * calendar around it. Google works the same way and for the same reason.
 *
 * This ships in slice 0 rather than later because of a documented failure in
 * this repo: notifications.md records that the digest shipped into a product
 * where nothing set an assignee, so every staff member's digest was empty by
 * construction and no test could have caught it. Scheduling is that feature's
 * strongest future source, and it would reproduce the failure exactly.
 */
export const scheduleItemAttendees = pgTable(
  "schedule_item_attendees",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    itemId: uuid("item_id").notNull(),
    /** Somebody in this workspace. Exclusive with the two external columns. */
    clerkUserId: text("clerk_user_id"),
    /** Somebody who is not — a customer, an inspector, a supplier. */
    externalEmail: text("external_email"),
    externalName: text("external_name").notNull().default(""),
    /** Optional attendees exist so a decline reads differently. */
    required: boolean("required").notNull().default(true),
    response: scheduleResponse("response").notNull().default("needs_action"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("schedule_item_attendees_internal_idx")
      .on(t.tenantId, t.itemId, t.clerkUserId)
      .where(sql`${t.clerkUserId} is not null`),
    uniqueIndex("schedule_item_attendees_external_idx")
      .on(t.tenantId, t.itemId, t.externalEmail)
      .where(sql`${t.externalEmail} is not null`),
    // The lookup the items policy runs for the attendee term.
    index("schedule_item_attendees_user_idx").on(t.tenantId, t.clerkUserId),
    foreignKey({
      name: "schedule_item_attendees_item_fk",
      columns: [t.tenantId, t.itemId],
      foreignColumns: [scheduleItems.tenantId, scheduleItems.id],
    }).onDelete("cascade"),
    // Internal or external, never both and never neither. An attendee row that
    // names nobody is a row the item policy would have to guess about.
    check(
      "schedule_item_attendees_exactly_one_identity",
      sql`num_nonnulls(${t.clerkUserId}, ${t.externalEmail}) = 1`,
    ),
  ],
);

/**
 * What an event is ABOUT — the customer, the invoice, the drawing set.
 *
 * MODELLED ON `mail_links` DELIBERATELY, down to the format checks: a thread is
 * attached to an invoice for the same reason an event is, so the second one to
 * need it copies the shape rather than inventing a second one.
 *
 * `entity_type` CARRIES NO WHITELIST, only a format CHECK. That is primitive P3
 * and it is the whole point: a capability pack registers `rfi` or `permit` by
 * writing the string, with no migration to core and no core file naming it.
 * `extension_slug` records who owns the type, so an UNINSTALLED pack's links are
 * ignored rather than repaired — the same rule mail's links follow.
 */
export const scheduleItemLinks = pgTable(
  "schedule_item_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    itemId: uuid("item_id").notNull(),
    /** Which layer owns this link type, so an uninstalled one can be skipped. */
    extensionSlug: text("extension_slug").notNull(),
    /** "invoice" | "customer" | "document" | later "job", "rfi", … */
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    createdByClerkUserId: text("created_by_clerk_user_id").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("schedule_item_links_tenant_id_id_idx").on(t.tenantId, t.id),
    // Attaching the same record twice is a no-op, not a second row.
    uniqueIndex("schedule_item_links_unique_idx").on(
      t.tenantId,
      t.itemId,
      t.entityType,
      t.entityId,
    ),
    // The join a module runs in the other direction: "every event on this
    // invoice". Nothing reads it yet — the reverse view is a later slice — but
    // the index costs nothing now and a migration later.
    index("schedule_item_links_entity_idx").on(
      t.tenantId,
      t.entityType,
      t.entityId,
    ),
    foreignKey({
      name: "schedule_item_links_item_fk",
      columns: [t.tenantId, t.itemId],
      foreignColumns: [scheduleItems.tenantId, scheduleItems.id],
    }).onDelete("cascade"),
    check(
      "schedule_item_links_entity_type_format",
      sql`${t.entityType} ~ '^[a-z][a-z0-9_]{0,62}$'`,
    ),
    check(
      "schedule_item_links_extension_slug_format",
      sql`${t.extensionSlug} ~ '^[a-z][a-z0-9_-]{0,62}$'`,
    ),
  ],
);

/**
 * A per-person subscribe URL for an external calendar app.
 *
 * ============================================================================
 * THE URL *IS* THE CREDENTIAL. There is no session behind this.
 * ============================================================================
 *
 * A phone's calendar cannot log in, so the token in the path is the only thing
 * standing between a stranger and somebody's schedule — and it will end up in a
 * clipboard, a screenshot and an IT ticket. Three consequences, all of them
 * load-bearing:
 *
 *  1. **Only the HASH is stored.** `token_hash` is SHA-256 of the token and the
 *     lookup is by hash, so a dump of this table does not hand anybody a
 *     working feed. The token itself is shown ONCE, at mint, and never again.
 *  2. **Revocation is a row, not a rotation.** `revoked_at` set means the feed
 *     404s from the next fetch. Nothing is ever reused.
 *  3. **`last_used_at`** is what makes "is anything still subscribed to this?"
 *     answerable before somebody revokes it.
 *
 * A REVOKED TOKEN KEEPS WORKING FOR AS LONG AS THE PHONE HAS IT CACHED, and
 * nothing on this side changes that. The revoke UI has to say so rather than
 * implying the link died the instant it was pressed.
 */
export const scheduleFeedTokens = pgTable(
  "schedule_feed_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** Whose calendar this feed shows. Clerk's id, as everywhere else here. */
    clerkUserId: text("clerk_user_id").notNull(),
    /**
     * SHA-256 of the token, hex. UNIQUE GLOBALLY rather than per tenant: the
     * route has no tenant context until this row resolves, so the hash is the
     * entire lookup key and a collision across tenants would be a cross-tenant
     * read. 32 random bytes makes that impossible in practice; the unique index
     * makes it impossible in fact.
     */
    tokenHash: text("token_hash").notNull(),
    /** "iPhone", "Work laptop" — so somebody can tell which one to revoke. */
    label: text("label").notNull().default(""),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("schedule_feed_tokens_hash_idx").on(t.tokenHash),
    index("schedule_feed_tokens_owner_idx").on(t.tenantId, t.clerkUserId),
  ],
);

/**
 * One occurrence of a repeating event, changed or called off.
 *
 * The exception table that makes expand-on-read workable: the series stays a
 * single row, and the handful of occurrences somebody moved or cancelled live
 * here, keyed by the LOCAL DATE the occurrence falls on.
 *
 * WHY THE KEY IS A DATE AND NOT AN INSTANT. The occurrence somebody edited is
 * "the one on the 12th", and it stays that occurrence even if the series' time
 * is later changed from 9am to 10am. Keying on the instant would orphan every
 * override the first time the rule was edited.
 */
export const scheduleItemOverrides = pgTable(
  "schedule_item_overrides",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    itemId: uuid("item_id").notNull(),
    /** `yyyy-mm-dd`, the local date of the occurrence this replaces. */
    occurrenceDate: text("occurrence_date").notNull(),
    /** True means this one does not happen. The rest of the row is then moot. */
    cancelled: boolean("cancelled").notNull().default(false),
    /** Null means "unchanged" — a cancellation carries no times at all. */
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // One override per occurrence. Editing the same occurrence twice is an
    // update, not a second row that would have to be reconciled.
    uniqueIndex("schedule_item_overrides_unique_idx").on(
      t.tenantId,
      t.itemId,
      t.occurrenceDate,
    ),
    foreignKey({
      name: "schedule_item_overrides_item_fk",
      columns: [t.tenantId, t.itemId],
      foreignColumns: [scheduleItems.tenantId, scheduleItems.id],
    }).onDelete("cascade"),
    check(
      "schedule_item_overrides_date_format",
      // `[0-9]` rather than `\d`: this is a TS TEMPLATE LITERAL, where `\d` is
      // an invalid escape that silently becomes a bare `d` — the generated
      // migration read `~ '^d{4}-d{2}-d{2}$'`, which matches the literal letter
      // d and nothing else. Caught by reading the generated SQL.
      sql`${t.occurrenceDate} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'`,
    ),
  ],
);
