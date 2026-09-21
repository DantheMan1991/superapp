/**
 * Estimate outlines — the order a business prices a job in, and what it asks
 * itself at each stop.
 *
 * Part of the `jobs` pack (Layer 2a, P4). Slice X1 of the estimate interview
 * ([ADR 0098](../../../docs/decisions/0098-an-estimate-outline-is-the-tenants-and-a-question-is-a-row-so-an-answer-can-point-at-one.md)),
 * and the only slice of it with no model in the loop: an outline is a list, a
 * person edits it, and the interview that reads it comes later.
 *
 * ── WHY THIS IS DATA AND NOT A SCRIPT IN THE PACK ───────────────────────────
 *
 * The founder's ask was a conversation that walks a builder through pricing a
 * house — foundation first, in-house or bid, block or poured, footer width,
 * rebar — and the tempting shape is a function with that conversation in it.
 * It is the wrong shape twice over. A remodel is not a new build and neither
 * is a tenant fit-out, so one business needs SEVERAL; and the pack must never
 * carry one business's sizes or prices, which `tests/packs.test.ts` scans for.
 * An outline is therefore the tenant's own rows, seeded from a profile the way
 * cost code lists are (ADR 0057), and editable to nothing from the first day.
 *
 * ── THE COST CODE IS TEXT, NOT AN ID ────────────────────────────────────────
 *
 * The same call `resolveCostCode` made for assemblies (ADR 0086) and for the
 * same reason: a code's id belongs to ONE cost code set, and an outline is
 * used across every job this business runs — some on the residential list,
 * some on CSI. The code is matched by its digits when the interview reaches a
 * job, and no match means no code rather than a near one.
 *
 * ── A QUESTION IS A ROW, BECAUSE AN ANSWER HAS TO POINT AT ONE ──────────────
 *
 * The cheap shape is a `jsonb` array of question strings on the step. It costs
 * nothing today and everything later: an answer recorded against a question ID
 * is what lets an interview be resumed exactly, lets the finish gate say "you
 * answered this and no line came of it", and lets a builder ask in six months
 * why a bid never covered the sump. A string in an array has no identity to
 * point at. Rows.
 *
 * ── NOTHING BRANCHES ────────────────────────────────────────────────────────
 *
 * There is no condition column and there will not be one. Coverage is the
 * OUTLINE's job and judgement is the interview's: "any rebar?" is skipped when
 * the answer was block, and the skip is recorded with its reason rather than
 * encoded here in a rule language a builder would have to maintain. `notes`
 * carries "only when they are pouring" as prose, for the interviewer to read.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./platform";
import { jobAssemblies } from "./jobs-estimates";

/**
 * ONE WAY THIS BUSINESS WALKS AN ESTIMATE. "New build", "Remodel", "Garage
 * package". Several per tenant, one of them the default, exactly as a cost
 * code list is — the same shape because it is the same kind of thing: a
 * starter arrives with the profile and is the tenant's from that moment.
 */
export const jobEstimateOutlines = pgTable(
  "job_estimate_outlines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** What this one is for, in the builder's words. Shown when picking. */
    notes: text("notes").notNull().default(""),
    /**
     * The outline an interview uses when none is named. **At most one per
     * tenant**, by the partial unique index below rather than by application
     * code — the cost code set's rule, for the cost code set's reason.
     */
    isDefault: boolean("is_default").notNull().default(false),
    /**
     * A retired outline is not offered for a new interview and is not deleted,
     * because an interview that ran from it keeps pointing at it.
     */
    isActive: boolean("is_active").notNull().default(true),
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
    uniqueIndex("job_estimate_outlines_tenant_id_id_idx").on(t.tenantId, t.id),
    uniqueIndex("job_estimate_outlines_tenant_name_idx").on(t.tenantId, t.name),
    /** ONE DEFAULT, OR NONE — refused by the database, not by a code path. */
    uniqueIndex("job_estimate_outlines_one_default_idx")
      .on(t.tenantId)
      .where(sql`${t.isDefault}`),
    check(
      "job_estimate_outlines_name_present",
      sql`length(btrim(${t.name})) > 0`,
    ),
  ],
);

/**
 * ONE STOP ON THE WALK: a phase of the job, in the order it is priced.
 *
 * `title` is what the interview says out loud ("Let's do the foundation").
 * `guidance` is what it must establish before moving on, in prose, and is the
 * place a business writes the thing that is true of ITS work — that it never
 * subs framing, that a walkout needs the engineer's number first. It is read
 * by the interview and by the person editing the outline, which is why it is
 * one text field and not a schema.
 */
export const jobEstimateOutlineSteps = pgTable(
  "job_estimate_outline_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    outlineId: uuid("outline_id").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    /** "Foundation", "Rough framing", "Demolition and protection". */
    title: text("title").notNull(),
    /**
     * THE PART OF THE BID THIS STEP BELONGS TO — the pilot's *Infrastructure*,
     * *Structural*, *Mechanical*, *Finishes*, *General conditions*; a CSI
     * division; whatever the business heads its price sheet with.
     *
     * It arrives from the cost code's `category` when an outline is read off
     * a chart, and **it is the tenant's to change afterwards, because the two
     * genuinely differ**: the pilot's `Siding Labor` is accounted under
     * `04. Structural` and printed under *Labour* on the sheet it hands a
     * client. The code says where the money goes; this says where the row is
     * read. Blank on every outline written before this existed.
     */
    section: text("section").notNull().default(""),
    /** The code this stop's lines are charged to, by its DIGITS. Blank is fine. */
    costCode: text("cost_code").notNull().default(""),
    /** What to establish here, in prose, for the interviewer to read. */
    guidance: text("guidance").notNull().default(""),
    /**
     * **THE ITEM THIS PHASE ALWAYS MAKES** (X11), or null when it is different
     * every time.
     *
     * The founder, having seen the walk price a phase: *"I'm struggling to
     * see that we are going to get the consistent items being put on the
     * estimate in the way I want with the verbiage I want."* An assembly is
     * the answer to that and always was — but until now the model DECIDED
     * whether to reach for one, from a list of names in a prompt, on every
     * bid. Naming it here is what takes the decision away: *Drywall* is
     * always *Drywall, hung and finished*, and the conversation is left with
     * the only thing it is good at, which is how much of it there is.
     *
     * **NULL IS THE NORMAL CASE AND MUST STAY COMFORTABLE.** He builds luxury
     * custom homes — *"a Fully custom wood door... maybe a client wants a
     * safe room"* — and a phase with no pin behaves exactly as it did before
     * this column existed.
     */
    assemblyId: uuid("assembly_id"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("job_estimate_outline_steps_tenant_id_id_idx").on(t.tenantId, t.id),
    index("job_estimate_outline_steps_tenant_outline_sort_idx").on(
      t.tenantId,
      t.outlineId,
      t.sortOrder,
    ),
    /** A step is part of its outline. */
    foreignKey({
      name: "job_estimate_outline_steps_outline_fk",
      columns: [t.tenantId, t.outlineId],
      foreignColumns: [jobEstimateOutlines.tenantId, jobEstimateOutlines.id],
    }).onDelete("cascade"),
    // Hand-edited in the migration to the column-list form
    // `ON DELETE SET NULL ("assembly_id")`. A bare SET NULL on a composite
    // (tenant_id, x) key would try to null tenant_id too and can NEVER run —
    // the trap this repo has now paid for twice. An assembly taken out of the
    // library leaves the step unpinned, which is what unpinning means; it
    // never takes the step with it.
    foreignKey({
      name: "job_estimate_outline_steps_assembly_fk",
      columns: [t.tenantId, t.assemblyId],
      foreignColumns: [jobAssemblies.tenantId, jobAssemblies.id],
    }).onDelete("set null"),
    check(
      "job_estimate_outline_steps_title_present",
      sql`length(btrim(${t.title})) > 0`,
    ),
  ],
);

/** What a question expects back, which is what decides the buttons under it. */
export const OUTLINE_QUESTION_KINDS = [
  "choice",
  "yes_no",
  "number",
  "money",
  "text",
] as const;

export type OutlineQuestionKind = (typeof OUTLINE_QUESTION_KINDS)[number];

/**
 * ONE QUESTION AT A STOP.
 *
 * `kind` is not decoration: it is what the interview turns into quick replies,
 * so a builder answers with a tap instead of a sentence, and it is what makes
 * an answer storable as something other than prose. `choices` holds a
 * `choice`'s options and nothing else's, by the CHECK below — a choice with
 * one option is a statement, and options on a yes/no are two answers to the
 * same question.
 *
 * `unit` is the unit a `number` is in ("lf", "sf", "ea") so the answer arrives
 * as a quantity the estimate can use rather than a bare figure. Free text,
 * like every other unit in this pack.
 */
export const jobEstimateOutlineQuestions = pgTable(
  "job_estimate_outline_questions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    stepId: uuid("step_id").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    /** As it is asked: "Block or poured?", "Are we doing this in-house?" */
    prompt: text("prompt").notNull(),
    kind: text("kind").notNull().default("text"),
    /** A `choice`'s options, in order. Empty for every other kind. */
    choices: jsonb("choices").notNull().default(sql`'[]'::jsonb`),
    /** The unit a `number` answer is in. Blank otherwise. */
    unit: text("unit").notNull().default(""),
    /** When to ask it, what to watch for — prose, never parsed. */
    notes: text("notes").notNull().default(""),
    /**
     * A QUESTION THE INTERVIEW MAY NEVER DECIDE IS IRRELEVANT.
     *
     * The counterweight to letting the model skip (ADR 0098): *"is there
     * asbestos?"* on a pre-war remodel must not be quietly judged moot
     * because the answers went another way. Off by default, because most
     * questions SHOULD be skippable — a walk that asks about rebar after you
     * said block is a walk somebody learns to click through.
     *
     * It means always ASKED, not always ANSWERED. A hard block would trap
     * somebody who genuinely does not know yet; an unanswered one is named
     * before the bid goes out instead, which is where it is useful.
     */
    alwaysAsk: boolean("always_ask").notNull().default(false),
    /**
     * **THE ANSWER THIS BUSINESS GIVES EVERY TIME** (X13), or blank when it
     * genuinely varies.
     *
     * The founder, on the shape of his work: *"i'd say 80/20 standard vs
     * custom"*, and on what the walk felt like: *"I'm getting questions like
     * this one: who is doing this one."* Thirty-three phases each asking who
     * is doing it is thirty-three questions with one answer, and the target
     * is a bid in forty-five minutes.
     *
     * **BLANK IS THE DEFAULT AND MEANS ASK.** Filling it in is a statement —
     * *we never sub framing* — and it is made per QUESTION, which is what
     * makes it safe: the same prompt on the roofing step stays blank, so the
     * walk still asks the phases that really are decided job by job. That is
     * the difference between skipping what never varies and assuming what
     * does.
     *
     * A standard is never taken silently. The walk states every one of them
     * before the first phase and waits to be told it is right; an answer it
     * then settles says on the record that it came from here, and a person
     * can re-open any of them.
     *
     * **`always_ask` WINS.** A question the outline says may never be judged
     * irrelevant is never settled from a standard either — *"is there
     * asbestos?"* is the reason that flag exists, and a default answer is
     * exactly the quiet judgement it refuses.
     */
    standardAnswer: text("standard_answer").notNull().default(""),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("job_estimate_outline_questions_tenant_id_id_idx").on(t.tenantId, t.id),
    index("job_estimate_outline_questions_tenant_step_sort_idx").on(
      t.tenantId,
      t.stepId,
      t.sortOrder,
    ),
    /** A question is part of its step. */
    foreignKey({
      name: "job_estimate_outline_questions_step_fk",
      columns: [t.tenantId, t.stepId],
      foreignColumns: [jobEstimateOutlineSteps.tenantId, jobEstimateOutlineSteps.id],
    }).onDelete("cascade"),
    check(
      "job_estimate_outline_questions_prompt_present",
      sql`length(btrim(${t.prompt})) > 0`,
    ),
    check(
      "job_estimate_outline_questions_kind_valid",
      sql`${t.kind} in ('choice', 'yes_no', 'number', 'money', 'text')`,
    ),
    /**
     * Options belong to a choice and to nothing else. Two conditions in one
     * CHECK because they are one rule: a `choice` needs at least two options,
     * and every other kind needs none. A CHECK that evaluates to NULL passes,
     * so the `jsonb_typeof` guard comes first — `jsonb_array_length` of an
     * object raises, and of a non-array is not false.
     */
    check(
      "job_estimate_outline_questions_choices_match_kind",
      sql`jsonb_typeof(${t.choices}) = 'array' and (
        case when ${t.kind} = 'choice'
          then jsonb_array_length(${t.choices}) >= 2
          else jsonb_array_length(${t.choices}) = 0
        end
      )`,
    ),
  ],
);

export type JobEstimateOutline = typeof jobEstimateOutlines.$inferSelect;
export type JobEstimateOutlineStep = typeof jobEstimateOutlineSteps.$inferSelect;
export type JobEstimateOutlineQuestion = typeof jobEstimateOutlineQuestions.$inferSelect;

/**
 * WHAT TO MEASURE BEFORE THE QUESTIONS START (X7).
 *
 * The founder's idea, in his words: *"What if before the questions it
 * prompts you to grab measurements. Full exterior elevation square footage,
 * wall square footage, wall perimeter etc. Then the questions can use this
 * information as it goes."*
 *
 * It lives on the outline rather than in code because measuring is not one
 * list. A remodel wants the room count and the existing wall height; a
 * commercial shell wants the bay spacing and the slab area; a new build
 * wants the perimeter. The same reason the steps and the questions are the
 * tenant's, and the same reason nothing in this file names a measurement.
 *
 * `kind` is which takeoff tool gets offered when somebody reaches for the
 * drawings — a length, an area, a count — and `unit` is what the number is
 * in once it lands. They are not the same thing: an area measured in feet
 * is stated in `sf`.
 *
 * **NOT ASKING IS ALSO AN ANSWER.** A measurement that is not `required` is
 * offered and can be waved past without a word; a required one has to be
 * given or explicitly passed before the first phase opens, because the
 * questions after it are the reason it is being asked for at all.
 */
export const jobEstimateOutlineMeasures = pgTable(
  "job_estimate_outline_measures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    outlineId: uuid("outline_id").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    /** "Wall perimeter", "Roof area", "Exterior elevation". */
    name: text("name").notNull(),
    /** What the number is in once it lands: "lf", "sf", "ea". */
    unit: text("unit").notNull().default(""),
    /** Which takeoff tool to offer: length, area or count. */
    kind: text("kind").notNull().default("length"),
    /** What to include and what to leave out, in the builder's words. */
    guidance: text("guidance").notNull().default(""),
    /** Ask for it before the first phase, rather than merely offering it. */
    required: boolean("required").notNull().default(false),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("job_estimate_outline_measures_tenant_id_id_idx").on(t.tenantId, t.id),
    uniqueIndex("job_estimate_outline_measures_tenant_outline_name_idx").on(
      t.tenantId,
      t.outlineId,
      t.name,
    ),
    index("job_estimate_outline_measures_tenant_outline_sort_idx").on(
      t.tenantId,
      t.outlineId,
      t.sortOrder,
    ),
    /** A measure is part of its outline. */
    foreignKey({
      name: "job_estimate_outline_measures_outline_fk",
      columns: [t.tenantId, t.outlineId],
      foreignColumns: [jobEstimateOutlines.tenantId, jobEstimateOutlines.id],
    }).onDelete("cascade"),
    check(
      "job_estimate_outline_measures_name_present",
      sql`length(btrim(${t.name})) > 0`,
    ),
    check(
      "job_estimate_outline_measures_kind_valid",
      sql`${t.kind} in ('length', 'area', 'count')`,
    ),
  ],
);

export type JobEstimateOutlineMeasure = typeof jobEstimateOutlineMeasures.$inferSelect;
