/**
 * WORKOUTS — the first personal tool (ADR 0111, docs/modules/fitness.md).
 *
 * A PROGRAM is what somebody follows: phases in order, and in each phase the
 * exercises with what to do (sets, a count, per side or not, optional or not).
 * It comes from a PDF the person was given — read in their browser, drafted by
 * Claude, checked by them before a row here is written (`fitness_imports`) —
 * or it is typed in by hand. Every table is an ordinary tenant table in a
 * PERSONAL space; RLS knows nothing about that, and does not need to.
 *
 * ── WHY AN EDIT KEEPS EVERY ROW'S ID ────────────────────────────────────────
 *
 * The program is saved by id, not replaced: an edit updates the phases, items
 * and exercises it kept, inserts the new ones and deletes the ones it dropped.
 * Workout mode (F2) logs every set against a phase item and an exercise, and a
 * save that deleted and re-created the program would orphan every log the day
 * somebody fixed a typo.
 *
 * ── WHY AN EXERCISE BELONGS TO ITS PROGRAM, FOR NOW ─────────────────────────
 *
 * `fitness_exercises.program_id` is NOT NULL. A shared library — the same
 * exercise in two programs, "last time's numbers" across them — is F5, and
 * relaxing this column is where it starts. Until then an exercise is written,
 * edited and deleted with the program that made it, and nothing has to decide
 * whose an exercise is.
 */
import { sql } from "drizzle-orm";
import {
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

/**
 * What an exercise is counted in. The founder's program counts most drills in
 * BREATHS ("2 × 8 breaths per side"), the release sequence in rolls, and a hold
 * would be seconds. A set/rep tracker that only knew reps could not run it.
 */
export const fitnessUnit = pgEnum("fitness_unit", ["reps", "breaths", "rolls", "seconds"]);

/** Where a program came from. */
export const fitnessProgramSource = pgEnum("fitness_program_source", ["imported", "own"]);

/**
 * Which side an exercise is done on once the person's side is known (F4b):
 * both, the side they lean toward, or the side they lean away from.
 */
export const fitnessSideRule = pgEnum("fitness_side_rule", ["both", "toward", "away"]);

/**
 * What "the side" is for an exercise done lying down, so the screen and the
 * coach can say it: the side itself ("Left side only"), the side lain on
 * ("Lying on your left side") or the leg on top ("Left leg on top"). The
 * founder's program has the last two: one exercise named by the side lain
 * on, another by the leg on top.
 */
export const fitnessSideMeans = pgEnum("fitness_side_means", ["side", "lying", "top_leg"]);

/**
 * An import's life. `drafting` while Claude reads it (a minute or so);
 * `draft` when there is something to review; `failed` with the reason;
 * `saved` once it made a program; `discarded` when the person threw it away.
 */
export const fitnessImportStatus = pgEnum("fitness_import_status", [
  "drafting",
  "draft",
  "failed",
  "saved",
  "discarded",
]);

/**
 * A video as an exercise keeps it: a YouTube id, never a copy of the video.
 * The author published it on YouTube; it plays through YouTube's own embedded
 * player (`youtube-nocookie.com`), and a clip start and end are ours to set.
 * `embeddable` is YouTube's own answer, asked when the program is drafted and
 * again for any video a save brings that nobody has asked about: a video its
 * uploader will not let be embedded gets "Open in YouTube" instead of a dead
 * player. Null means not asked, or YouTube did not answer.
 */
export interface FitnessVideo {
  provider: "youtube";
  id: string;
  startS: number | null;
  endS: number | null;
  /**
   * What a second (third…) video is called: the book's own word
   * ("Alternative"), the person's, or else its YouTube title ("Inner Foot
   * Roll"), filled in by `markVideos`. Null on the first, which is THE video.
   */
  label: string | null;
  embeddable: boolean | null;
}

/**
 * A PROGRAM'S SIDE SELF-ASSESSMENT (F4b): the tests that say which side a
 * person leans to, and how many must agree. The founder's program has a few,
 * each comparing how far a movement goes on the left with the right, and a
 * table saying which side each result points to.
 *
 * `leftMeans` is that table in one field: which side a test points to when
 * the LEFT side went further. Most point the same way; a reversed one (where
 * leaning left shows as the RIGHT side going further) says "right". So the
 * person answers what they saw, and never needs the table.
 */
export interface FitnessAssessment {
  /** The author's video that shows the tests; the first link, like an exercise's. */
  video: FitnessVideo | null;
  /** How many tests must point one way for a side, as the program sets it. */
  least: number;
  tests: { name: string; question: string; leftMeans: "left" | "right" }[];
  /** What the program says about it, in a sentence or two of our own words. */
  notes: string;
}

/**
 * AN EXERCISE THAT GETS HARDER IN STEPS (F4c): its levels in order, and the
 * mark for moving up one. The founder's program starts its calf raise at the
 * first level and moves on once a number of good sets comes without much
 * fatigue; the levels themselves are only shown in the exercise's video, so
 * the person names them, each with the part of the video that shows it.
 * `sets` × `target` is the mark, on each side for an exercise done per side;
 * the program's effort and nothing hurting complete it (core/levels.ts).
 */
export interface FitnessProgression {
  levels: { name: string; startS: number | null; endS: number | null }[];
  sets: number;
  target: number;
}

export const fitnessPrograms = pgTable(
  "fitness_programs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Who wrote it, as the book says. Blank for one the person made. */
    author: text("author").notNull().default(""),
    source: fitnessProgramSource("source").notNull().default("own"),
    /** The program's own rules, in a few sentences: how often, how hard, how to breathe. */
    notes: text("notes").notNull().default(""),
    /** "3 is good, 4 is great": a week's sessions, as a range. Null when the program says none. */
    sessionsPerWeekMin: integer("sessions_per_week_min"),
    sessionsPerWeekMax: integer("sessions_per_week_max"),
    /** "3/10, never beyond 5/10": the effort the program asks for, 1–10. */
    effortMin: integer("effort_min"),
    effortMax: integer("effort_max"),
    /**
     * The breathing pace the program asks for ("about 5 seconds out, 5 seconds
     * softly in"), which workout mode's pacer keeps (F2). Null when the program
     * gives none; the pacer then uses 5 and 5.
     */
    breathOutS: integer("breath_out_s"),
    breathInS: integer("breath_in_s"),
    /** The side self-assessment, when the program has one (F4b). Checked in the app, like `videos`. */
    assessment: jsonb("assessment").$type<FitnessAssessment>(),
    /** Put away, not deleted: F2's logs will hang off it. */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("fitness_programs_tenant_id_id_idx").on(t.tenantId, t.id),
    index("fitness_programs_tenant_created_idx").on(t.tenantId, t.createdAt),
    check("fitness_programs_name_present", sql`length(btrim(${t.name})) > 0`),
    check(
      "fitness_programs_sessions_range",
      sql`(${t.sessionsPerWeekMin} is null or ${t.sessionsPerWeekMin} between 1 and 14)
        and (${t.sessionsPerWeekMax} is null or (${t.sessionsPerWeekMin} is not null and ${t.sessionsPerWeekMax} between ${t.sessionsPerWeekMin} and 14))`,
    ),
    check(
      "fitness_programs_effort_range",
      sql`(${t.effortMin} is null or ${t.effortMin} between 1 and 10)
        and (${t.effortMax} is null or (${t.effortMin} is not null and ${t.effortMax} between ${t.effortMin} and 10))`,
    ),
    check(
      "fitness_programs_breath_pace",
      sql`(${t.breathOutS} is null or ${t.breathOutS} between 1 and 30)
        and (${t.breathInS} is null or ${t.breathInS} between 1 and 30)`,
    ),
  ],
);

export const fitnessPhases = pgTable(
  "fitness_phases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    programId: uuid("program_id").notNull(),
    /** 0-based order within the program. */
    position: integer("position").notNull(),
    /** "Weeks 1–2", "Phase 3". */
    name: text("name").notNull(),
    /**
     * The gate: DONE days in this phase before the next may start ("complete at
     * least 14 days of the given exercises before moving on"). Days on which
     * the phase was done, not days on a calendar; F3 counts them. Null when
     * the program sets no gate.
     */
    minDoneDays: integer("min_done_days"),
    notes: text("notes").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("fitness_phases_tenant_id_id_idx").on(t.tenantId, t.id),
    index("fitness_phases_tenant_program_position_idx").on(t.tenantId, t.programId, t.position),
    foreignKey({
      name: "fitness_phases_program_fk",
      columns: [t.tenantId, t.programId],
      foreignColumns: [fitnessPrograms.tenantId, fitnessPrograms.id],
    }).onDelete("cascade"),
    check("fitness_phases_name_present", sql`length(btrim(${t.name})) > 0`),
    check("fitness_phases_position_nonnegative", sql`${t.position} >= 0`),
    check(
      "fitness_phases_min_done_days_positive",
      sql`${t.minDoneDays} is null or ${t.minDoneDays} between 1 and 365`,
    ),
  ],
);

export const fitnessExercises = pgTable(
  "fitness_exercises",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** The program that made it — see the header for why this is NOT NULL for now. */
    programId: uuid("program_id").notNull(),
    name: text("name").notNull(),
    /** What it is for, in a sentence or two. */
    purpose: text("purpose").notNull().default(""),
    /** "How to know you're doing it right": a short list, shown during the set. */
    cues: jsonb("cues").$type<string[]>().notNull().default([]),
    unit: fitnessUnit("unit").notNull().default("reps"),
    videos: jsonb("videos").$type<FitnessVideo[]>().notNull().default([]),
    notes: text("notes").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("fitness_exercises_tenant_id_id_idx").on(t.tenantId, t.id),
    index("fitness_exercises_tenant_program_idx").on(t.tenantId, t.programId),
    foreignKey({
      name: "fitness_exercises_program_fk",
      columns: [t.tenantId, t.programId],
      foreignColumns: [fitnessPrograms.tenantId, fitnessPrograms.id],
    }).onDelete("cascade"),
    check("fitness_exercises_name_present", sql`length(btrim(${t.name})) > 0`),
    check("fitness_exercises_cues_array", sql`jsonb_typeof(${t.cues}) = 'array'`),
    check("fitness_exercises_videos_array", sql`jsonb_typeof(${t.videos}) = 'array'`),
  ],
);

/**
 * An exercise in a phase, with what to do: the prescription. Ranges because
 * programs are written in ranges ("2–3 × 8–10"); the MINIMUM is what F3 counts
 * a day done by.
 */
export const fitnessPhaseItems = pgTable(
  "fitness_phase_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    phaseId: uuid("phase_id").notNull(),
    exerciseId: uuid("exercise_id").notNull(),
    /** 0-based order within the phase: the program says do them in order. */
    position: integer("position").notNull(),
    setsMin: integer("sets_min").notNull().default(1),
    setsMax: integer("sets_max"),
    /** The count per set, in the exercise's unit: 8 breaths, 15 rolls. */
    targetMin: integer("target_min").notNull(),
    targetMax: integer("target_max"),
    perSide: boolean("per_side").notNull().default(false),
    /** "Do this if you have extra time." */
    optional: boolean("optional").notNull().default(false),
    /** What the book says about THIS use of it: a side rule, a progression, a variation. */
    notes: text("notes").notNull().default(""),
    /**
     * Done on one side only, once the person's side is known (F4b): on the
     * side they lean TOWARD, or the one they lean AWAY from. `both` until then,
     * and for everybody who never takes the assessment: the program's default.
     */
    sideRule: fitnessSideRule("side_rule").notNull().default("both"),
    /** What that side is, for the words: the side itself, the side lain on, or the leg on top. */
    sideMeans: fitnessSideMeans("side_means").notNull().default("side"),
    /** Its levels and the mark for moving up (F4c); null without levels. Checked in the app, like `videos`. */
    progression: jsonb("progression").$type<FitnessProgression>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("fitness_phase_items_tenant_id_id_idx").on(t.tenantId, t.id),
    index("fitness_phase_items_tenant_phase_position_idx").on(t.tenantId, t.phaseId, t.position),
    index("fitness_phase_items_tenant_exercise_idx").on(t.tenantId, t.exerciseId),
    foreignKey({
      name: "fitness_phase_items_phase_fk",
      columns: [t.tenantId, t.phaseId],
      foreignColumns: [fitnessPhases.tenantId, fitnessPhases.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "fitness_phase_items_exercise_fk",
      columns: [t.tenantId, t.exerciseId],
      foreignColumns: [fitnessExercises.tenantId, fitnessExercises.id],
    }).onDelete("cascade"),
    check("fitness_phase_items_position_nonnegative", sql`${t.position} >= 0`),
    check(
      "fitness_phase_items_sets_range",
      sql`${t.setsMin} between 1 and 20 and (${t.setsMax} is null or ${t.setsMax} between ${t.setsMin} and 20)`,
    ),
    check(
      "fitness_phase_items_target_range",
      sql`${t.targetMin} between 1 and 1000 and (${t.targetMax} is null or ${t.targetMax} between ${t.targetMin} and 1000)`,
    ),
    // One side only is a thing only an exercise done per side can be.
    check("fitness_phase_items_side_rule_per_side", sql`${t.sideRule} = 'both' or ${t.perSide}`),
  ],
);

/**
 * A PDF on its way to being a program: what was read, what Claude drafted,
 * and what became of it. **The book itself is never stored** — it is read in
 * the person's browser and only its words and links are sent, to draft from;
 * this row keeps the draft and the counts, not the text.
 */
export const fitnessImports = pgTable(
  "fitness_imports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    fileName: text("file_name").notNull(),
    pageCount: integer("page_count").notNull(),
    linkCount: integer("link_count").notNull().default(0),
    status: fitnessImportStatus("status").notNull().default("drafting"),
    /**
     * The draft, as the editor opens it (`normalizeDraft`, then read back
     * through `programInputSchema` by `importDraft`); null until Claude
     * answers, and again once the program is saved.
     */
    draft: jsonb("draft"),
    /** Why a `failed` import failed, in words the person can act on. */
    error: text("error"),
    /** The program it became. Deleting that program takes this record with it. */
    programId: uuid("program_id"),
    createdByClerkUserId: text("created_by_clerk_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("fitness_imports_tenant_id_id_idx").on(t.tenantId, t.id),
    index("fitness_imports_tenant_created_idx").on(t.tenantId, t.createdAt),
    foreignKey({
      name: "fitness_imports_program_fk",
      columns: [t.tenantId, t.programId],
      foreignColumns: [fitnessPrograms.tenantId, fitnessPrograms.id],
    }).onDelete("cascade"),
    check("fitness_imports_file_name_present", sql`length(btrim(${t.fileName})) > 0`),
    check("fitness_imports_page_count_positive", sql`${t.pageCount} >= 1`),
  ],
);

/* ── WORKOUT MODE (F2): following a program, and what was done ─────────────
 *
 * A session is made ON THE DEVICE and sent whole (`saveSession`): its id, and
 * the ids of everything in it, are the phone's, so a phone that lost signal
 * and sends again sends the SAME rows, never a second session; `revision`
 * counts the phone's changes, so an older copy arriving late never overwrites
 * a newer one.
 *
 * A log outlives an edit. The program stays editable after it has been done
 * (F1 saves by id), so a session names its phase, and each exercise in it its
 * item and exercise, by keys that SET NULL (column-list form: a bare SET NULL
 * would try to null `tenant_id` too) when an edit removes them, and keeps
 * their names and units as they were. Deleting the whole program still
 * cascades through its enrollment to every session.
 */

/** Which side a set was done on, and which side a program favours for a person (F4). */
export const fitnessSide = pgEnum("fitness_side", ["left", "right"]);

/** "Anything hurt?", answered after each exercise. */
export const fitnessHurt = pgEnum("fitness_hurt", ["none", "pinch", "yes"]);

/**
 * FOLLOWING A PROGRAM: made by the first session, ended when the person stops
 * or starts it over. One open enrollment per program. F3 counts done days
 * inside it; `side` is where the program's left-or-right self-assessment
 * lands (F4, or the founder's posture tool), null meaning both sides, the
 * program's own default.
 */
export const fitnessEnrollments = pgTable(
  "fitness_enrollments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    programId: uuid("program_id").notNull(),
    /** The person's own calendar day the first session was on. */
    startedOn: date("started_on").notNull(),
    side: fitnessSide("side"),
    /**
     * The self-assessment behind `side` (F4b): each test by name, with what
     * the person saw ("left", "right" or "same" for which side went further),
     * so the result can be shown and redone. Null until it is taken.
     */
    sideAnswers: jsonb("side_answers").$type<{ name: string; further: "left" | "right" | "same" }[]>(),
    sideAssessedAt: timestamp("side_assessed_at", { withTimezone: true }),
    /**
     * The level the person is on for each exercise with levels (F4c): the
     * item's id to a 0-based level. An item not in it, or null, is at its first.
     */
    levels: jsonb("levels").$type<Record<string, number>>(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("fitness_enrollments_tenant_id_id_idx").on(t.tenantId, t.id),
    uniqueIndex("fitness_enrollments_open_idx")
      .on(t.tenantId, t.programId)
      .where(sql`${t.endedAt} is null`),
    foreignKey({
      name: "fitness_enrollments_program_fk",
      columns: [t.tenantId, t.programId],
      foreignColumns: [fitnessPrograms.tenantId, fitnessPrograms.id],
    }).onDelete("cascade"),
  ],
);

/** ONE WORKOUT: a phase done on a day, with how the body felt before and after. */
export const fitnessSessions = pgTable(
  "fitness_sessions",
  {
    /** The phone's id for it (see the header). */
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    enrollmentId: uuid("enrollment_id").notNull(),
    /** Null once an edit removes the phase; `phase_name` still says which it was. */
    phaseId: uuid("phase_id"),
    phaseName: text("phase_name").notNull().default(""),
    /** The person's own calendar day, as the phone said it. F3's done days count these. */
    localDay: date("local_day").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    /** Null while the session is still going (or was never finished). */
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    /** "How does your body feel?", 0–10, before the first exercise and after the last. */
    feelBefore: integer("feel_before"),
    feelAfter: integer("feel_after"),
    note: text("note").notNull().default(""),
    /** The phone's count of changes to it (see the header). */
    revision: integer("revision").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("fitness_sessions_tenant_id_id_idx").on(t.tenantId, t.id),
    index("fitness_sessions_tenant_enrollment_day_idx").on(t.tenantId, t.enrollmentId, t.localDay),
    foreignKey({
      name: "fitness_sessions_enrollment_fk",
      columns: [t.tenantId, t.enrollmentId],
      foreignColumns: [fitnessEnrollments.tenantId, fitnessEnrollments.id],
    }).onDelete("cascade"),
    // Hand-edited in the migration to the column-list form `ON DELETE SET NULL ("phase_id")`:
    // a bare SET NULL would try to null tenant_id too and can never run on a composite key.
    foreignKey({
      name: "fitness_sessions_phase_fk",
      columns: [t.tenantId, t.phaseId],
      foreignColumns: [fitnessPhases.tenantId, fitnessPhases.id],
    }).onDelete("set null"),
    check("fitness_sessions_feel_before_range", sql`${t.feelBefore} is null or ${t.feelBefore} between 0 and 10`),
    check("fitness_sessions_feel_after_range", sql`${t.feelAfter} is null or ${t.feelAfter} between 0 and 10`),
    check("fitness_sessions_revision_positive", sql`${t.revision} >= 1`),
  ],
);

/**
 * AN EXERCISE AS IT WAS DONE IN A SESSION, with the three taps after it:
 * effort, the "doing it right" cues felt, and anything that hurt. Its name,
 * unit and per-side are kept as they were, because the program's exercise may
 * be edited or removed later.
 */
export const fitnessSessionExercises = pgTable(
  "fitness_session_exercises",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").notNull(),
    itemId: uuid("item_id"),
    exerciseId: uuid("exercise_id"),
    /** 0-based order within the session. */
    position: integer("position").notNull(),
    name: text("name").notNull(),
    unit: fitnessUnit("unit").notNull(),
    perSide: boolean("per_side").notNull().default(false),
    /** The level it was done at, 0-based (F4c); null for an exercise without levels. */
    level: integer("level"),
    /**
     * "Move up" was chosen after it (F4c). The enrollment's level moves when
     * this first arrives true, and never again for the same exercise, however
     * often the session is sent, or after the person goes back a level.
     */
    levelUp: boolean("level_up").notNull().default(false),
    /** 1–10; the program's own zone is on the program. */
    effort: integer("effort"),
    /** The cues ticked as felt, in the exercise's own words. */
    cuesFelt: jsonb("cues_felt").$type<string[]>().notNull().default([]),
    hurt: fitnessHurt("hurt"),
    hurtNote: text("hurt_note").notNull().default(""),
    skipped: boolean("skipped").notNull().default(false),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("fitness_session_exercises_tenant_id_id_idx").on(t.tenantId, t.id),
    index("fitness_session_exercises_tenant_session_idx").on(t.tenantId, t.sessionId),
    index("fitness_session_exercises_tenant_item_idx").on(t.tenantId, t.itemId),
    foreignKey({
      name: "fitness_session_exercises_session_fk",
      columns: [t.tenantId, t.sessionId],
      foreignColumns: [fitnessSessions.tenantId, fitnessSessions.id],
    }).onDelete("cascade"),
    // Hand-edited in the migration to the column-list form `ON DELETE SET NULL ("item_id")`.
    foreignKey({
      name: "fitness_session_exercises_item_fk",
      columns: [t.tenantId, t.itemId],
      foreignColumns: [fitnessPhaseItems.tenantId, fitnessPhaseItems.id],
    }).onDelete("set null"),
    // And `ON DELETE SET NULL ("exercise_id")`.
    foreignKey({
      name: "fitness_session_exercises_exercise_fk",
      columns: [t.tenantId, t.exerciseId],
      foreignColumns: [fitnessExercises.tenantId, fitnessExercises.id],
    }).onDelete("set null"),
    check("fitness_session_exercises_position_nonnegative", sql`${t.position} >= 0`),
    check("fitness_session_exercises_effort_range", sql`${t.effort} is null or ${t.effort} between 1 and 10`),
    check("fitness_session_exercises_cues_array", sql`jsonb_typeof(${t.cuesFelt}) = 'array'`),
    check("fitness_session_exercises_level_range", sql`${t.level} is null or ${t.level} between 0 and 19`),
  ],
);

/** ONE SET: its number, its side, what was asked and what was done. */
export const fitnessSets = pgTable(
  "fitness_sets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    sessionExerciseId: uuid("session_exercise_id").notNull(),
    /** 1-based. Both sides of a per-side set share its number. */
    number: integer("number").notNull(),
    side: fitnessSide("side"),
    /** What was asked: 8 breaths, 15 rolls. */
    target: integer("target").notNull(),
    /** What was done. The pacer counts breaths; reps and rolls confirm the target, or fewer. */
    count: integer("count").notNull(),
    /** When the phone says it was done. */
    doneAt: timestamp("done_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("fitness_sets_tenant_id_id_idx").on(t.tenantId, t.id),
    index("fitness_sets_tenant_session_exercise_idx").on(t.tenantId, t.sessionExerciseId),
    foreignKey({
      name: "fitness_sets_session_exercise_fk",
      columns: [t.tenantId, t.sessionExerciseId],
      foreignColumns: [fitnessSessionExercises.tenantId, fitnessSessionExercises.id],
    }).onDelete("cascade"),
    check("fitness_sets_number_range", sql`${t.number} between 1 and 20`),
    check("fitness_sets_target_range", sql`${t.target} between 1 and 1000`),
    check("fitness_sets_count_range", sql`${t.count} between 0 and 1000`),
  ],
);

/** The two halves of a split day the program allows: a reminder for each. */
export const fitnessReminderSlot = pgEnum("fitness_reminder_slot", ["morning", "evening"]);

/**
 * A WORKOUT REMINDER (F4a, ADR 0116): a time of day on the space's clock at
 * which the person's phone is told about today's workout on this program,
 * unless the day's sets are already done. The founder's call, 2026-09-28: a
 * day that is done is skipped, which is what makes a reminder clear itself by
 * the workout being done (the notifications rule).
 *
 * `last_handled_on` is the space's day the cron last took it, sent or skipped
 * as done: the cron claims a reminder by moving it forward, so two runs that
 * overlap send it once.
 */
export const fitnessReminders = pgTable(
  "fitness_reminders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    programId: uuid("program_id").notNull(),
    slot: fitnessReminderSlot("slot").notNull(),
    /** Minutes after midnight on the space's clock, in tens (the cron's step): 1170 is 7:30 PM. */
    atMinute: integer("at_minute").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    lastHandledOn: date("last_handled_on"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("fitness_reminders_tenant_id_id_idx").on(t.tenantId, t.id),
    uniqueIndex("fitness_reminders_program_slot_idx").on(t.tenantId, t.programId, t.slot),
    foreignKey({
      name: "fitness_reminders_program_fk",
      columns: [t.tenantId, t.programId],
      foreignColumns: [fitnessPrograms.tenantId, fitnessPrograms.id],
    }).onDelete("cascade"),
    check("fitness_reminders_at_minute_range", sql`${t.atMinute} between 0 and 1430 and ${t.atMinute} % 10 = 0`),
  ],
);

/**
 * One view held still in a posture check, as the phone measured it: where each
 * sticker and each of the pose model's 33 points sat (medians over the hold,
 * frame pixels), true up in the same pixels and where it came from, and the
 * scale. The shape of `ViewCapture` in the posture module
 * (`src/modules/fitness/posture/core/measures.ts`), which a test holds to this.
 */
export interface FitnessPostureCapture {
  view: "front" | "right" | "back" | "left";
  round: number;
  up: { x: number; y: number };
  upFrom: "plumb" | "sensor" | "none";
  pxPerMetre: number | null;
  width: number;
  height: number;
  stickers: Record<string, { x: number; y: number }>;
  pose: { x: number; y: number; visibility: number }[] | null;
  frames: number;
  stillPx: number | null;
}

/**
 * A POSTURE CHECK (docs/modules/posture.md, slice 3; ADR 0120): the views the
 * phone held still, as numbers, and what happened along the way. Never a
 * picture: those stay on the phone that took them, and only if the person
 * chose to keep them (ADR 0118).
 *
 * Kept as the captures, not as results: every measure, comparison and noise
 * figure is worked out from these each time they are read, so a fix to the
 * arithmetic reaches every check already taken. The id is the phone's, made
 * when the check started, so sending it again is the same row, and a photo the
 * phone kept still knows its check.
 */
export const fitnessPostureChecks = pgTable(
  "fitness_posture_checks",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** When the check started, as the phone said it (bounded a little into the future). */
    takenAt: timestamp("taken_at", { withTimezone: true }).notNull(),
    /** The person's own calendar day, as the phone said it. */
    localDay: date("local_day").notNull(),
    captures: jsonb("captures").$type<FitnessPostureCapture[]>().notNull(),
    notes: jsonb("notes").$type<string[]>().notNull().default([]),
    /** The shape of `captures`; 1 is slice 2's. */
    version: integer("version").notNull().default(1),
    /**
     * The check this one repeats (slice 3b): the same day, every sticker taken
     * off and put back on, so the difference between the two is the person's
     * own measuring noise. Null for an ordinary check, and when the check it
     * repeated is deleted.
     */
    repeatOf: uuid("repeat_of"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("fitness_posture_checks_tenant_id_id_idx").on(t.tenantId, t.id),
    index("fitness_posture_checks_tenant_taken_idx").on(t.tenantId, t.takenAt),
    // Hand-edited in the migration to the column-list form `ON DELETE SET NULL ("repeat_of")`:
    // a bare SET NULL would try to null tenant_id too and can never run on a composite key.
    foreignKey({
      name: "fitness_posture_checks_repeat_fk",
      columns: [t.tenantId, t.repeatOf],
      foreignColumns: [t.tenantId, t.id],
    }).onDelete("set null"),
    check("fitness_posture_checks_captures_array", sql`jsonb_typeof(${t.captures}) = 'array'`),
    check("fitness_posture_checks_notes_array", sql`jsonb_typeof(${t.notes}) = 'array'`),
    check("fitness_posture_checks_version_known", sql`${t.version} = 1`),
    check("fitness_posture_checks_repeat_not_self", sql`${t.repeatOf} is null or ${t.repeatOf} <> ${t.id}`),
  ],
);

export type FitnessProgram = typeof fitnessPrograms.$inferSelect;
export type FitnessPhase = typeof fitnessPhases.$inferSelect;
export type FitnessExercise = typeof fitnessExercises.$inferSelect;
export type FitnessPhaseItem = typeof fitnessPhaseItems.$inferSelect;
export type FitnessImport = typeof fitnessImports.$inferSelect;
export type FitnessEnrollment = typeof fitnessEnrollments.$inferSelect;
export type FitnessSession = typeof fitnessSessions.$inferSelect;
export type FitnessSessionExercise = typeof fitnessSessionExercises.$inferSelect;
export type FitnessSet = typeof fitnessSets.$inferSelect;
export type FitnessReminder = typeof fitnessReminders.$inferSelect;
export type FitnessPostureCheck = typeof fitnessPostureChecks.$inferSelect;
