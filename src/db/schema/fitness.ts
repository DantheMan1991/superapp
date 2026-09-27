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

export type FitnessProgram = typeof fitnessPrograms.$inferSelect;
export type FitnessPhase = typeof fitnessPhases.$inferSelect;
export type FitnessExercise = typeof fitnessExercises.$inferSelect;
export type FitnessPhaseItem = typeof fitnessPhaseItems.$inferSelect;
export type FitnessImport = typeof fitnessImports.$inferSelect;
