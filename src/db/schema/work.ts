/**
 * Work: what has to be done, who it is on, and whether it is done yet.
 *
 * Read docs/modules/work.md before changing anything here. The two decisions
 * that are expensive to reverse are both in this file and both look like
 * over-thinking until you try the alternative:
 *
 *   1. `state` is a fixed CHECK and `status` is an open label. One column
 *      cannot be both, because the moment "done" is a string a tenant chose,
 *      no query in the product can ask whether work is finished.
 *   2. `closed_at` covers done AND cancelled, so open work is `closed_at IS
 *      NULL` — one indexable predicate rather than a `NOT IN` over an enum
 *      that will grow.
 *
 * THE ONE THING TO KNOW: **a work list is the unit of sharing, not an item.**
 * Items resolve visibility through a single EXISTS against `work_lists` and
 * never restate the rule — the same arrangement `schedule_items` has against
 * `schedule_calendars`, and `crm_deals` has against `crm_party_details`, so
 * there are not three copies of one rule to drift apart.
 *
 * TWO tables, not the three the dossier's data model lists. `work_item_links`
 * lands in slice 3 with the surface that reads it: "adding a table with no
 * reader is the speculative build this codebase avoids" (crm.md). Items ARE
 * here, because the property slice 0 exists to certify is that item visibility
 * inherits from the list, and that cannot be proven without both.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
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

/**
 * THE VALUES `state` AND `visibility` MAY HOLD LIVE IN
 * `src/lib/work/vocabulary.ts`, NOT HERE.
 *
 * They are rendered in the browser by a board, and importing them from this
 * file would drag drizzle and every table definition into that bundle — the
 * trap documents.md wrote up after `server-only` propagated through a type
 * import and failed a build. That file has no imports and no directive, so
 * everything can read it.
 *
 * The CHECKs below spell the same values out as SQL literals, because a
 * migration imports nothing. `tests/work.test.ts` reads the constraint back out
 * of Postgres and compares it against `WORK_STATES`, so the two cannot drift
 * into a state the app believes in and the database refuses.
 *
 * **text + CHECK, never a pgEnum.** documents.md paid for this lesson twice: a
 * new enum value needs its own migration file, alone, because it cannot be used
 * in the transaction that adds it (0036 vs 0037). Every discriminator added to
 * this codebase since is a text column with a CHECK.
 */

/**
 * A work list. The container, and THE UNIT OF SHARING.
 *
 * Visible to members by default, restrictable to owners — which is
 * `document_folders`' shape and deliberately NOT `schedule_calendars`'
 * private-until-shared one. crm.md already pinned the reason: *"a follow-up is
 * the business's work, not private correspondence, and whoever covers for
 * somebody on holiday has to see what is outstanding."* A calendar defaulting
 * closed and a work list defaulting open are not an inconsistency; they are two
 * different questions with two different right answers.
 *
 * No grants table, unlike scheduling. `members` | `owners` covers "the owners'
 * list" without the machinery, and per-person work lists have no caller. If they
 * ever do, drizzle/0077 is the proven shape and carries two traps written up in
 * scheduling.md — the grants table's policy must never read back into the
 * container, and WITH CHECK is not consulted for DELETE.
 *
 * No `effective_visibility` either: lists do not nest, so there is no ancestor
 * chain to roll down. That column exists on `document_folders` because a tree
 * needs it, and copying it here would be copying the cost without the reason.
 */
export const workLists = pgTable(
  "work_lists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Free-form so a palette can change without a migration. */
    color: text("color").notNull().default(""),
    visibility: text("visibility").notNull().default("members"),
    /**
     * Exactly one per tenant, created on membership sync, undeletable. The place
     * anything lands when nobody chose a list.
     *
     * Per TENANT rather than per person, which is where this differs from
     * `schedule_calendars.is_primary`: a calendar answers "where do MY events
     * go", a work list answers "where does the business's work go".
     */
    isDefault: boolean("is_default").notNull().default(false),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdByClerkUserId: text("created_by_clerk_user_id").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // The pair every child table's composite FK points at.
    uniqueIndex("work_lists_tenant_id_id_idx").on(t.tenantId, t.id),
    // One default per tenant. Partial, because everything else is unconstrained
    // — and unnamed as a conflict target, so `ensureDefaultWorkList` does not
    // have to restate this predicate to be idempotent.
    uniqueIndex("work_lists_default_idx")
      .on(t.tenantId)
      .where(sql`${t.isDefault}`),
    check(
      "work_lists_visibility",
      sql`${t.visibility} in ('members', 'owners')`,
    ),
  ],
);

/**
 * One thing that has to be done.
 *
 * Its policy inherits from `work_lists` through an EXISTS and states no
 * visibility rule of its own. Note what is NOT in that policy: the assignee.
 * Work is the business's, so who it is ON does not decide who may SEE it —
 * crm.md made the same call for follow-ups and gave the same reason.
 */
export const workItems = pgTable(
  "work_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    listId: uuid("list_id").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    /** One of WORK_STATES. What CODE reasons about. */
    state: text("state").notNull().default("todo"),
    /**
     * The LABEL, when a profile or pack supplies one — "Dispatched", "On the
     * way", "Awaiting parts". Open taxonomy (no CHECK): core writes nothing
     * here, exactly like `schedule_items.kind`. A reader shows this when set and
     * the state's own label otherwise; `core/state.ts` is the only place that
     * decides which, so no surface re-implements it.
     */
    status: text("status").notNull().default(""),
    /**
     * A DATE, not a timestamp. Work is due on a day, not at 14:32 — and the
     * trap that comes with it is written up in crm.md: comparing a `date`
     * column against a server `Date` is wrong by up to a day for anybody off
     * UTC, which the user experiences as the product nagging about something
     * due tomorrow. Compare `yyyy-mm-dd` STRINGS, which is why mode is "string".
     *
     * Something due at a TIME is an appointment, and appointments are
     * scheduling's.
     */
    dueOn: date("due_on", { mode: "string" }),
    /**
     * "Do not show me this until Monday." Without it a list of forty items
     * either nags on day one or stays invisible until it is late.
     */
    startsOn: date("starts_on", { mode: "string" }),
    /**
     * ONE assignee, not many: the digest's per-person model needs a single owner
     * of an obligation, and two assignees means each can assume the other has
     * it.
     *
     * NULL rather than the empty-string sentinel this schema uses elsewhere,
     * because `crm_tasks.assignee_clerk_user_id` is null and slice 5 migrates
     * those rows here — a straight copy beats rewriting a value in a migration.
     * Nothing indexes it uniquely, so the usual reason for the sentinel (keeping
     * a partial unique index out of NULLS NOT DISTINCT) does not apply.
     *
     * Unassigned work is real and is not an error state. The attention contract
     * already carries an `unassigned` flag that rolls it up to owners, which
     * exists because work assigned to nobody is otherwise invisible to
     * everybody.
     */
    assigneeClerkUserId: text("assignee_clerk_user_id"),
    /**
     * Nesting, and the reason there is no checklist table. A checklist item is a
     * child; a stage of a job is a child; both are the same shape.
     *
     * `schedule_items.parent_id`' arrangement copied deliberately, including the
     * self-parent CHECK: deeper cycles are the read path's problem, but the
     * database can refuse the trivial one a bad copy produces.
     */
    parentId: uuid("parent_id"),
    /**
     * Open taxonomy (primitive P1). Core writes nothing. `service_call`,
     * `inspection`, `punch_item` are values a PACK registers — which is how the
     * vocabulary of a trade reaches the product without core learning a word of
     * it.
     */
    kind: text("kind").notNull().default(""),
    /**
     * Extension bag (primitive P2). NOT NULL DEFAULT '{}' so `metadata->>'x'` is
     * always safe. Where a pack keeps progress, estimated hours, the fields a
     * board needs and a list does not.
     */
    metadata: jsonb("metadata").notNull().default({}),
    /**
     * Closed covers `done` AND `cancelled`, and a CHECK below forces it to agree
     * with `state`. Open work is then `closed_at IS NULL` — one indexable
     * predicate, rather than a `NOT IN` over a set that grows.
     *
     * A timestamp rather than a boolean, for `crm_tasks`' reason: "done" and
     * "done last Tuesday" are the same fact, and two columns that can disagree
     * are two columns that will.
     */
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedByClerkUserId: text("closed_by_clerk_user_id"),
    createdByClerkUserId: text("created_by_clerk_user_id").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("work_items_tenant_id_id_idx").on(t.tenantId, t.id),
    // The list view: everything on this list, soonest first.
    index("work_items_list_idx").on(t.tenantId, t.listId, t.dueOn),
    // THE query "my work" runs, and the reason `closed_at` is one column.
    index("work_items_assignee_open_idx")
      .on(t.tenantId, t.assigneeClerkUserId, t.dueOn)
      .where(sql`${t.closedAt} is null`),
    index("work_items_parent_idx").on(t.tenantId, t.parentId),
    foreignKey({
      name: "work_items_list_fk",
      columns: [t.tenantId, t.listId],
      foreignColumns: [workLists.tenantId, workLists.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "work_items_parent_fk",
      columns: [t.tenantId, t.parentId],
      foreignColumns: [t.tenantId, t.id],
    }).onDelete("set null"),
    check(
      "work_items_state",
      sql`${t.state} in ('todo', 'in_progress', 'blocked', 'done', 'cancelled')`,
    ),
    // The invariant that makes `closed_at IS NULL` mean "not finished with".
    check(
      "work_items_closed_matches_state",
      sql`(${t.state} in ('done', 'cancelled')) = (${t.closedAt} is not null)`,
    ),
    // Who closed it and when are one fact; half of it is uninterpretable.
    check(
      "work_items_closed_pair",
      sql`(${t.closedAt} is null) = (${t.closedByClerkUserId} is null)`,
    ),
    check(
      "work_items_starts_before_due",
      sql`${t.startsOn} is null or ${t.dueOn} is null or ${t.startsOn} <= ${t.dueOn}`,
    ),
    check(
      "work_items_no_self_parent",
      sql`${t.parentId} is distinct from ${t.id}`,
    ),
  ],
);
