/**
 * Estimates — what a job is expected to cost and what it will be priced at,
 * line by line, before anybody signs.
 *
 * Part of the `jobs` pack (Layer 2a, P4). Slice 10 of the construction plan
 * (`estimating`), the front end of every job: the number the contract value
 * comes from, the budget comes from, and the schedule of values comes from.
 *
 * ── COST AND PRICE ARE TWO NUMBERS ON EVERY LINE (ADR 0069) ────────────────
 *
 * A line is a quantity of a unit at a UNIT COST — 320 sf of tile at $4.20,
 * one lump of $12,000 for the plumbing subcontract — and what it is SOLD for:
 * either a markup on the cost (this line's, or the estimate's default) or an
 * explicit unit price, which is how a unit-price bid is written. The extended
 * cost and price are computed from these, never typed; the change order made
 * the same choice for the same reason.
 *
 * ── OVERHEAD AND PROFIT SIT BELOW THE LINES ─────────────────────────────────
 *
 * Some businesses mark up every line and stop; some price the lines at cost
 * and add overhead and profit at the bottom; some do both. Two percentages on
 * the estimate — overhead on the lines' price subtotal, profit on the subtotal
 * plus overhead, the "ten and ten" of the trade — cover all three with zeros,
 * and a business that wants contingency writes it as a line.
 *
 * ── AN ESTIMATE BELONGS TO THE JOB AND MAY BECOME A CONTRACT ────────────────
 *
 * Numbered per job, as the business numbers them; several per job, because a
 * bid is revised and a design-phase estimate precedes the build. Accepting one
 * names the contract it priced, and from there the pack's other verbs take
 * over: the budget by code, the schedule of values by line, the value on the
 * contract. Nothing here bills.
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
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./platform";
import { jobProjects, jobCostCodes } from "./jobs";
import { jobContracts } from "./jobs-contracts";

export const jobEstimates = pgTable(
  "job_estimates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull(),
    /** The agreement this estimate priced, once it has one. */
    contractId: uuid("contract_id"),
    /** As the business numbers them: `EST-2`, `Bid 24-108 R3`. Unique per job. */
    number: text("number").notNull(),
    title: text("title").notNull().default(""),
    /** text + CHECK: draft, sent, accepted, declined, superseded. */
    status: text("status").notNull().default("draft"),
    sentOn: date("sent_on", { mode: "string" }),
    decidedOn: date("decided_on", { mode: "string" }),
    validUntil: date("valid_until", { mode: "string" }),
    /** The markup a line takes when it names none, in ppm. */
    markupPpm: integer("markup_ppm").notNull().default(0),
    /** Overhead on the lines' price subtotal, in ppm. */
    overheadPpm: integer("overhead_ppm").notNull().default(0),
    /** Profit on the subtotal plus overhead, in ppm. */
    profitPpm: integer("profit_ppm").notNull().default(0),
    notes: text("notes").notNull().default(""),
    /**
     * THE PROPOSAL (ADR 0070): how the price is shown to the client — line by
     * line, by cost code, by the client-facing groups (ADR 0079) or one sum —
     * and the three texts around it. The
     * words are the agreement's, so they are fixed with the money once the
     * estimate is accepted; the presentation is a printing choice and stays
     * free. A new estimate starts with the last one's terms.
     */
    presentation: text("presentation").notNull().default("lines"),
    /**
     * Whether the `codes` presentation prints a cost code's NUMBER beside its
     * name (ADR 0080). Off: `Tiling`. On: `09 30 00 · Tiling`, for the
     * commercial client who expects the CSI breakdown. A printing choice, so
     * it stays free on an accepted estimate.
     */
    showCodeNumbers: boolean("show_code_numbers").notNull().default(false),
    /**
     * WHAT THE PAPER IS, as against how the money is grouped (E5a, ADR 0083).
     * `letter` is the business document ADR 0070 built — two or three pages on
     * letterhead, and what a production or remodelling job sends. `brochure` is
     * the custom-home document: a cover, a letter, the narrative, the price
     * sheet, the allowances, the milestones. `presentation` is orthogonal and
     * both formats honour it.
     */
    format: text("format").notNull().default("letter"),
    /**
     * The letter the brochure opens with, in the builder's own voice, over a
     * signature. Blank leaves the page out. The words are the agreement's, so
     * they are fixed with the money once the estimate is accepted.
     */
    letter: text("letter").notNull().default(""),
    scope: text("scope").notNull().default(""),
    exclusions: text("exclusions").notNull().default(""),
    terms: text("terms").notNull().default(""),
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
    uniqueIndex("job_estimates_tenant_id_id_idx").on(t.tenantId, t.id),
    uniqueIndex("job_estimates_project_number_idx").on(t.tenantId, t.projectId, t.number),
    index("job_estimates_tenant_project_idx").on(t.tenantId, t.projectId),
    index("job_estimates_tenant_contract_idx").on(t.tenantId, t.contractId),
    /** A job's estimates are part of it. */
    foreignKey({
      name: "job_estimates_project_fk",
      columns: [t.tenantId, t.projectId],
      foreignColumns: [jobProjects.tenantId, jobProjects.id],
    }).onDelete("cascade"),
    /** NO ACTION: the contract an estimate priced stays; the job's cascade takes both together. */
    foreignKey({
      name: "job_estimates_contract_fk",
      columns: [t.tenantId, t.contractId],
      foreignColumns: [jobContracts.tenantId, jobContracts.id],
    }),
    check("job_estimates_number_present", sql`length(btrim(${t.number})) > 0`),
    check("job_estimates_format_valid", sql`${t.format} in ('letter', 'brochure')`),
    check(
      "job_estimates_status_valid",
      sql`${t.status} in ('draft', 'sent', 'accepted', 'declined', 'superseded')`,
    ),
    /** 'groups' joined the three in ADR 0079: the items the client buys. */
    check(
      "job_estimates_presentation_valid",
      sql`${t.presentation} in ('lines', 'codes', 'groups', 'sum')`,
    ),
    check("job_estimates_markup_range", sql`${t.markupPpm} >= 0 and ${t.markupPpm} <= 10000000`),
    check("job_estimates_overhead_range", sql`${t.overheadPpm} >= 0 and ${t.overheadPpm} <= 10000000`),
    check("job_estimates_profit_range", sql`${t.profitPpm} >= 0 and ${t.profitPpm} <= 10000000`),
  ],
);

/**
 * A GROUP IS THE ITEM THE CLIENT BUYS (ADR 0079): "Tile flooring, master and
 * hall baths", with the material, the labour and the thinset behind it. One
 * level deep on purpose — a builder who wants a third writes two groups.
 *
 * Its price either ROLLS UP from its lines, each riding the estimate's
 * overhead and profit as any line does, or is FIXED: the number the client
 * pays, typed, and excluded from the overhead-and-profit spread so that the
 * number typed is the number printed. A lump the business wants COSTED and
 * marked up is a line of quantity one, ADR 0069's rule; this is the other
 * question. The cost is always the lines', so the group's own margin — its
 * price less what is behind it — is there to read.
 */
export const jobEstimateGroups = pgTable(
  "job_estimate_groups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    estimateId: uuid("estimate_id").notNull(),
    /** What the client reads. The lines keep the estimator's shorthand. */
    name: text("name").notNull(),
    /** One paragraph under the item on the proposal; the brochure's narrative, later. */
    clientNote: text("client_note").notNull().default(""),
    /**
     * THE PART OF THE BID THIS ITEM IS PRINTED UNDER — the pilot's
     * *Infrastructure*, *Structural*, *Mechanical*, *Finishes*, *Labour*,
     * *General conditions*; a CSI division; whatever a business heads its
     * own price sheet with.
     *
     * Arrives from the outline step that produced the item and is the
     * tenant's afterwards, because **it is not the cost code's category and
     * the pilot's own sheet is why**: his `Siding Labor` is accounted under
     * `04. Structural` and printed under *Labour*, since Turkel supplied the
     * material and labour is what he sold. The code says where the money
     * goes; this says where the row is read.
     *
     * Blank on every item written before this existed, which prints exactly
     * as it always did.
     */
    section: text("section").notNull().default(""),
    /**
     * WHETHER THE CLIENT SEES WHAT IS IN THIS ITEM (one price, or the
     * material and labour under it). The founder asked for both: *"there
     * are times I want something like a group from framing and then the
     * material, labor etc are in it. then there are times where I want to
     * show the client the labor and material separate."*
     *
     * **BOTH ALREADY WORKED AND NEITHER WAS SAYABLE.** You got one price by
     * HIDING A LINE, and the item collapsed as a side effect — a real rule
     * ([ADR 0080](../../../docs/decisions/0080-an-estimate-line-carries-the-clients-words-beside-the-estimators-and-a-line-kept-off-the-proposal-collapses-the-item-that-holds-it.md))
     * but not one anybody would ever find. This is the same decision said
     * out loud.
     *
     * **DEFAULT TRUE, SO NOTHING ALREADY PRINTED CHANGES.** It is an extra
     * reason to collapse, never a reason to expand: a hidden line or a typed
     * price still collapses whatever this says, because those items would
     * otherwise print a build-up that does not add up to the price above it.
     */
    showLines: boolean("show_lines").notNull().default(true),
    /** text + CHECK: rollup (the children sum) or fixed (the price is typed). */
    priceMode: text("price_mode").notNull().default("rollup"),
    /** The price the client pays, on a fixed group; null on a rollup, by CHECK. */
    fixedPriceCents: bigint("fixed_price_cents", { mode: "number" }),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("job_estimate_groups_tenant_id_id_idx").on(t.tenantId, t.id),
    index("job_estimate_groups_tenant_estimate_idx").on(t.tenantId, t.estimateId, t.sortOrder),
    /** An estimate's groups are part of it. */
    foreignKey({
      name: "job_estimate_groups_estimate_fk",
      columns: [t.tenantId, t.estimateId],
      foreignColumns: [jobEstimates.tenantId, jobEstimates.id],
    }).onDelete("cascade"),
    check("job_estimate_groups_name_present", sql`length(btrim(${t.name})) > 0`),
    check("job_estimate_groups_name_bounded", sql`char_length(${t.name}) <= 200`),
    check("job_estimate_groups_note_bounded", sql`char_length(${t.clientNote}) <= 4000`),
    check("job_estimate_groups_price_mode_valid", sql`${t.priceMode} in ('rollup', 'fixed')`),
    /** The mode and the number say the same thing or the row is refused. */
    check(
      "job_estimate_groups_fixed_priced",
      sql`(${t.priceMode} = 'fixed') = (${t.fixedPriceCents} is not null)`,
    ),
    check(
      "job_estimate_groups_fixed_nonnegative",
      sql`${t.fixedPriceCents} is null or ${t.fixedPriceCents} >= 0`,
    ),
  ],
);

/**
 * One line of an estimate: a quantity of a unit at a cost, and what it sells
 * for. `quantity_thousandths` is 1,000 — one — for a lump sum, so every line
 * is the same arithmetic. The extended figures are never stored.
 */
export const jobEstimateLines = pgTable(
  "job_estimate_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    estimateId: uuid("estimate_id").notNull(),
    /** The client-facing item this line is part of; null makes it loose (ADR 0079). */
    groupId: uuid("group_id"),
    /** Where the cost lands in the budget; null while the chart is not built. */
    costCodeId: uuid("cost_code_id"),
    description: text("description").notNull(),
    /**
     * What the CLIENT reads in place of the description (ADR 0080), blank to
     * use the description itself. The estimator keeps `Tile — mud set,
     * Schluter, mtl only, per AJ quote 8/14`; the client reads `Porcelain tile
     * flooring`. An item needs none: its name is already the client's.
     */
    clientDescription: text("client_description").notNull().default(""),
    /**
     * Whether this line is a row on the proposal at all (ADR 0080).
     * Contingency, supervision, an allowance carry. The money counts
     * everywhere it counted before; it simply is not printed — and **only a
     * line inside an item may be hidden**, by the CHECK below, because hidden
     * money must have somewhere to hide or the printed rows stop adding up.
     */
    clientVisible: boolean("client_visible").notNull().default(true),
    /** "sf", "lf", "cy", "ea", "ls" — the business's own abbreviation; free text. */
    unit: text("unit").notNull().default(""),
    /** In thousandths, the grain estimating works to (ADR 0064). */
    quantityThousandths: bigint("quantity_thousandths", { mode: "number" }).notNull().default(1000),
    unitCostCents: bigint("unit_cost_cents", { mode: "number" }).notNull().default(0),
    /** This line's markup on cost, in ppm; null takes the estimate's default. */
    markupPpm: integer("markup_ppm"),
    /** An explicit price per unit, which overrides the markup: how a unit-price bid is written. */
    unitPriceCents: bigint("unit_price_cents", { mode: "number" }),
    notes: text("notes").notNull().default(""),
    /**
     * WHERE THIS LINE'S NUMBER CAME FROM (X2b, ADR 0098), and blank on every
     * line anybody typed — which is every line written before this existed.
     *
     * A walk produces lines from a saved assembly, from what this business
     * charged last time, or from a figure the estimator gave; the chip on the
     * line says which, and `basis_detail` says the rest — *"your last price
     * on 24-108"*, *"6 from 2 baths at 3 fixtures each"*. The takeoff will
     * want the same column when a measurement pushes a quantity.
     *
     * **BLANK IS NOT A BASIS OF `none`.** Blank means nobody recorded one;
     * `none` means a walk produced the line and could not price it, which is
     * a thing worth seeing.
     */
    basis: text("basis").notNull().default(""),
    basisDetail: text("basis_detail").notNull().default(""),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("job_estimate_lines_tenant_id_id_idx").on(t.tenantId, t.id),
    index("job_estimate_lines_tenant_estimate_idx").on(t.tenantId, t.estimateId, t.sortOrder),
    index("job_estimate_lines_tenant_code_idx").on(t.tenantId, t.costCodeId),
    index("job_estimate_lines_tenant_group_idx").on(t.tenantId, t.groupId),
    /** An estimate's lines are part of it. */
    foreignKey({
      name: "job_estimate_lines_estimate_fk",
      columns: [t.tenantId, t.estimateId],
      foreignColumns: [jobEstimates.tenantId, jobEstimates.id],
    }).onDelete("cascade"),
    // Hand-edited in the migration to the column-list form `ON DELETE SET NULL ("group_id")`: a bare
    // SET NULL would try to null tenant_id too and can never run on a composite key. A group deleted
    // leaves its lines loose, which is what ungrouping means; it never destroys the pricing.
    foreignKey({
      name: "job_estimate_lines_group_fk",
      columns: [t.tenantId, t.groupId],
      foreignColumns: [jobEstimateGroups.tenantId, jobEstimateGroups.id],
    }).onDelete("set null"),
    /** RESTRICT: a code with estimates against it is retired, never deleted. */
    foreignKey({
      name: "job_estimate_lines_code_fk",
      columns: [t.tenantId, t.costCodeId],
      foreignColumns: [jobCostCodes.tenantId, jobCostCodes.id],
    }),
    check("job_estimate_lines_description_present", sql`length(btrim(${t.description})) > 0`),
    check(
      "job_estimate_lines_basis_valid",
      sql`${t.basis} in ('', 'assembly', 'memory', 'said', 'sub', 'none')`,
    ),
    check(
      "job_estimate_lines_client_description_bounded",
      sql`char_length(${t.clientDescription}) <= 300`,
    ),
    /** Hidden money has to have somewhere to hide, and an item is that somewhere (ADR 0080). */
    check(
      "job_estimate_lines_hidden_needs_item",
      sql`${t.clientVisible} or ${t.groupId} is not null`,
    ),
    check("job_estimate_lines_quantity_nonnegative", sql`${t.quantityThousandths} >= 0`),
    check("job_estimate_lines_unit_cost_nonnegative", sql`${t.unitCostCents} >= 0`),
    check(
      "job_estimate_lines_unit_price_nonnegative",
      sql`${t.unitPriceCents} is null or ${t.unitPriceCents} >= 0`,
    ),
    check(
      "job_estimate_lines_markup_range",
      sql`${t.markupPpm} is null or (${t.markupPpm} >= 0 and ${t.markupPpm} <= 10000000)`,
    ),
  ],
);

/* ------------------------------------------------------------------------
 * The client's copy of the proposal, and the acceptance they put their name
 * to (E5c, ADR 0085).
 *
 * A share is a tokenised, anonymous, read-only door onto the document the
 * pack already renders — the brochure or the letter, whichever `format`
 * names — plus one thing the client may write: their acceptance.
 *
 * THE CREDENTIALS FOLLOW `document_shares` EXACTLY, because that table is
 * the platform's answer to this question and a second answer would be a
 * second thing to get wrong. The token is never stored: `token_hash` is a
 * keyed HMAC used for lookup and `token_ciphertext` is the token under
 * AES-GCM so the builder can copy the link again to re-send it. Both keys
 * live in the environment, so a database-only compromise yields nothing.
 * `token_hash` is GLOBALLY unique with no tenant prefix, because the public
 * lookup has no tenant context to scope by.
 *
 * WHAT AN ACCEPTANCE IS, AND WHAT IT IS NOT. It is a RECORD that a person
 * holding the link put a name to this proposal at this moment — the same
 * shape as a lien waiver (ADR 0066) or a back-charge (ADR 0077): record the
 * fact, derive the standing. **It does not accept the estimate.**
 * `acceptEstimate` needs an owner and the CONTRACT the estimate priced, and
 * a client knows neither; the business still accepts it, with the signature
 * in front of them as the reason to.
 *
 * `signed_estimate_version` and `signed_total_cents` are what makes the
 * record truthful rather than approximate: they say WHAT was agreed to, so
 * an estimate that moves afterwards cannot quietly reinterpret a signature.
 * ---------------------------------------------------------------------- */

export const jobEstimateShares = pgTable(
  "job_estimate_shares",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    estimateId: uuid("estimate_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    tokenCiphertext: text("token_ciphertext").notNull(),
    /**
     * No never-expiring anonymous links — `document_shares`' rule. Defaulted
     * from the estimate's own `valid_until` when it has one, because a
     * proposal that has expired should not still be openable.
     */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedByClerkUserId: text("revoked_by_clerk_user_id"),
    createdByClerkUserId: text("created_by_clerk_user_id").notNull(),
    viewCount: integer("view_count").notNull().default(0),
    lastViewedAt: timestamp("last_viewed_at", { withTimezone: true }),
    /* ---- the acceptance: all five together or none of them ---- */
    signedAt: timestamp("signed_at", { withTimezone: true }),
    /** What they typed. Never trusted as identity — it is what they wrote. */
    signedName: text("signed_name"),
    /** Hashed, like every other IP on an anonymous surface. Never raw. */
    signedIpHash: text("signed_ip_hash"),
    /** The estimate's version at the moment of signing, so the record is exact. */
    signedEstimateVersion: integer("signed_estimate_version"),
    /** And the money, so what was agreed to survives a later revision. */
    signedTotalCents: bigint("signed_total_cents", { mode: "number" }),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("job_estimate_shares_tenant_id_id_idx").on(t.tenantId, t.id),
    uniqueIndex("job_estimate_shares_token_hash_idx").on(t.tokenHash),
    index("job_estimate_shares_tenant_estimate_idx").on(t.tenantId, t.estimateId),
    foreignKey({
      name: "job_estimate_shares_estimate_fk",
      columns: [t.tenantId, t.estimateId],
      foreignColumns: [jobEstimates.tenantId, jobEstimates.id],
    }).onDelete("cascade"),
    /** A signature is a whole fact or nothing; half of one is not evidence. */
    check(
      "job_estimate_shares_signature_whole",
      sql`num_nonnulls(${t.signedAt}, ${t.signedName}, ${t.signedIpHash}, ${t.signedEstimateVersion}, ${t.signedTotalCents}) in (0, 5)`,
    ),
    check(
      "job_estimate_shares_signed_name_present",
      sql`${t.signedName} is null or length(btrim(${t.signedName})) > 0`,
    ),
    check(
      "job_estimate_shares_signed_name_bounded",
      sql`${t.signedName} is null or char_length(${t.signedName}) <= 120`,
    ),
    check("job_estimate_shares_view_count_nonneg", sql`${t.viewCount} >= 0`),
  ],
);

/* ------------------------------------------------------------------------
 * ASSEMBLIES: an item, saved, so the next job can have it too (E6, ADR 0086).
 *
 * **AN ASSEMBLY IS A SAVED ITEM.** Not a new kind of thing — the same shape
 * as `job_estimate_groups` and its lines, which is why this waited for the
 * items table rather than arriving with one of its own (ADR 0079).
 *
 * ── BUILT BACKWARDS, ON PURPOSE ────────────────────────────────────────────
 *
 * The library assembles itself out of work somebody has already priced:
 * "save this item as an assembly" comes first, and dropping one comes second.
 * **Nobody ever fills in an assembly library up front** — every estimating
 * product that shipped the drop-down first has an empty drop-down in it.
 *
 * ── WHAT IT IS PER ─────────────────────────────────────────────────────────
 *
 * An item has no quantity of its own: 320 sf of tile, 320 sf of labour and 6
 * bags of thinset are three lines that happen to be one floor. So an assembly
 * records **the size it was saved at** — `driving_quantity` and
 * `driving_unit`, 320 sf — and keeps every line's quantity EXACTLY as it was
 * priced. Dropping it at another size scales by the ratio.
 *
 * Storing the quantities as they were, rather than as ratios, is the decision
 * worth keeping: `6 bags at 320 sf` is a number the estimator recognises from
 * the job it came off, and `0.01875 bags per sf` is not. The division happens
 * once, at the moment of dropping, in one pure function.
 *
 * ── THE COST CODE IS TEXT, AND THAT IS ALSO A DECISION ─────────────────────
 *
 * A code id belongs to one cost code SET. An assembly saved on a job that
 * uses the CSI set and dropped on a job that uses a different one would carry
 * an id that is not merely wrong but unrepresentable there. So the line keeps
 * the code AS WRITTEN — `09 30 00` — and the drop resolves it against the
 * target job's own set, leaving the line uncoded when that set has no such
 * code. An uncoded line still prices; a line pointing at another job's chart
 * would not.
 * ---------------------------------------------------------------------- */

export const jobAssemblies = pgTable(
  "job_assemblies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** What the estimator calls it. One per name, so the picker is a list of things. */
    name: text("name").notNull(),
    /** The item's sentence for the client, carried through to the item it makes. */
    clientNote: text("client_note").notNull().default(""),
    /** The estimator's own note: what is in it, what it assumes. Never printed. */
    notes: text("notes").notNull().default(""),
    /** The size it was saved at — `320` of `sf`. Everything scales off this. */
    drivingQuantityThousandths: bigint("driving_quantity_thousandths", { mode: "number" })
      .notNull()
      .default(1_000),
    drivingUnit: text("driving_unit").notNull().default(""),
    createdByClerkUserId: text("created_by_clerk_user_id").notNull().default(""),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("job_assemblies_tenant_id_id_idx").on(t.tenantId, t.id),
    /** One assembly per name: a library with two `Tile flooring` is not a library. */
    uniqueIndex("job_assemblies_tenant_name_idx").on(t.tenantId, t.name),
    check("job_assemblies_name_present", sql`length(btrim(${t.name})) > 0`),
    /**
     * A size of nothing cannot be scaled from — every dropped quantity would
     * divide by zero — so it is refused at the table, not only in the ops.
     */
    check("job_assemblies_driving_positive", sql`${t.drivingQuantityThousandths} > 0`),
  ],
);

export const jobAssemblyLines = pgTable(
  "job_assembly_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    assemblyId: uuid("assembly_id").notNull(),
    description: text("description").notNull(),
    /** The client's words for this line, kept with it (ADR 0080). */
    clientDescription: text("client_description").notNull().default(""),
    clientVisible: boolean("client_visible").notNull().default(true),
    unit: text("unit").notNull().default(""),
    /** AS IT WAS PRICED, at the assembly's own driving quantity. */
    quantityThousandths: bigint("quantity_thousandths", { mode: "number" }).notNull().default(1_000),
    unitCostCents: bigint("unit_cost_cents", { mode: "number" }).notNull().default(0),
    markupPpm: integer("markup_ppm"),
    unitPriceCents: bigint("unit_price_cents", { mode: "number" }),
    /** The code AS WRITTEN (`09 30 00`), resolved against the target job's set. */
    costCode: text("cost_code").notNull().default(""),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("job_assembly_lines_tenant_id_id_idx").on(t.tenantId, t.id),
    index("job_assembly_lines_tenant_assembly_idx").on(t.tenantId, t.assemblyId),
    foreignKey({
      name: "job_assembly_lines_assembly_fk",
      columns: [t.tenantId, t.assemblyId],
      foreignColumns: [jobAssemblies.tenantId, jobAssemblies.id],
    }).onDelete("cascade"),
    check("job_assembly_lines_description_present", sql`length(btrim(${t.description})) > 0`),
    check("job_assembly_lines_quantity_nonnegative", sql`${t.quantityThousandths} >= 0`),
    check("job_assembly_lines_unit_cost_nonnegative", sql`${t.unitCostCents} >= 0`),
    check(
      "job_assembly_lines_unit_price_nonnegative",
      sql`${t.unitPriceCents} is null or ${t.unitPriceCents} >= 0`,
    ),
    check(
      "job_assembly_lines_markup_range",
      sql`${t.markupPpm} is null or (${t.markupPpm} >= 0 and ${t.markupPpm} <= 10000000)`,
    ),
  ],
);

export type JobEstimate = typeof jobEstimates.$inferSelect;
export type JobEstimateGroup = typeof jobEstimateGroups.$inferSelect;
export type JobEstimateLine = typeof jobEstimateLines.$inferSelect;
export type JobEstimateShare = typeof jobEstimateShares.$inferSelect;
export type JobAssembly = typeof jobAssemblies.$inferSelect;
export type JobAssemblyLine = typeof jobAssemblyLines.$inferSelect;
