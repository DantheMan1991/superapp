/**
 * The walk: an estimate priced by going through the job and answering
 * questions, instead of typing the lines.
 *
 * Part of the `jobs` pack (Layer 2a, P4). Slice X2a of the estimate interview
 * ([ADR 0098](../../../docs/decisions/0098-an-estimate-outline-is-the-tenants-and-a-question-is-a-row-so-an-answer-can-point-at-one.md)):
 * the conversation and what it learns. **No lines come out of it yet** — X2b
 * turns answers into groups and lines, and doing the conversation first is
 * deliberate, because that is where the design can be wrong and this way it
 * is wrong before anything touches money.
 *
 * ── THE WALK HANGS OFF AN ESTIMATE, NOT A JOB ───────────────────────────────
 *
 * You make an estimate the way you always did and then walk it, rather than
 * the walk making one. That keeps the layer a layer: the estimate is an
 * ordinary estimate before, during and after, and an interview abandoned
 * halfway leaves a perfectly good draft behind.
 *
 * ── THE OUTLINE IS READ LIVE, NOT COPIED ────────────────────────────────────
 *
 * An earlier draft of this had the interview take a snapshot of the outline
 * at the start, so editing the template could not change a bid in flight.
 * **That was the wrong call and the founder's own case is why**: realise
 * mid-bid that the outline never asked about the sump, and you want the
 * question in the walk you are in, not the next one. So the walk reads the
 * outline as it stands, and a step added underneath it is picked up.
 *
 * The truthfulness that a snapshot would have bought is bought a better way:
 * **an answer stores the words it was asked in**. Reword a question tomorrow,
 * or delete it, and the transcript still says what was actually asked and
 * what was actually said.
 *
 * ── AN ANSWER POINTS AT ITS QUESTION, BUT IS NOT OWNED BY IT ────────────────
 *
 * `step_id` and `question_id` are references with NO foreign key, which is a
 * deliberate exception to this pack's habit. A transcript is a RECORD of what
 * happened — the shape of a lien waiver (ADR 0066), a back-charge (ADR 0077)
 * and an acceptance (ADR 0085): record the fact, derive the standing. An
 * answer that vanished because somebody tidied the outline afterwards would
 * be a record that lies, and a `SET NULL` on a composite key is the one
 * migration this repo has got wrong four times over.
 *
 * `question_id` is also NULL whenever the walk asked something the outline
 * never contained, which it is meant to do — the outline is the floor, not
 * the ceiling.
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
import { jobEstimates } from "./jobs-estimates";
import { jobEstimateOutlines } from "./jobs-estimate-outlines";

export const INTERVIEW_STATUSES = ["running", "finished", "abandoned"] as const;
export type InterviewStatus = (typeof INTERVIEW_STATUSES)[number];

export const jobEstimateInterviews = pgTable(
  "job_estimate_interviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    estimateId: uuid("estimate_id").notNull(),
    /** The outline being walked, read live. */
    outlineId: uuid("outline_id").notNull(),
    /** text + CHECK: running, finished, abandoned. */
    status: text("status").notNull().default("running"),
    /**
     * The step the walk is on, by the outline's own step id. Null means it
     * has not started one yet, or has run out of steps. No FK, for the
     * reason at the top: the outline may move underneath it.
     */
    currentStepId: uuid("current_step_id"),
    /**
     * THE QUESTION ON THE SCREEN RIGHT NOW, and the reason it is stored
     * rather than held in the page: a walk is forty-five minutes long and
     * somebody will reload, close the laptop, or come back after lunch. An
     * answer row is only written once there is an answer, so without this
     * the pending question is the one thing a refresh would lose.
     */
    pendingSay: text("pending_say").notNull().default(""),
    /** The outline question being asked, when it is one of theirs. */
    pendingQuestionId: uuid("pending_question_id"),
    /** The buttons under it, which for an off-outline question are the walk's own. */
    pendingQuickReplies: jsonb("pending_quick_replies").notNull().default(sql`'[]'::jsonb`),
    startedByClerkUserId: text("started_by_clerk_user_id"),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    /**
     * When the last turn was taken, so a page that keeps posting is slowed
     * down rather than allowed to spend. The house pattern's cooldown.
     */
    lastTurnAt: timestamp("last_turn_at", { withTimezone: true }),
    /** Every exchange, whichever step it was on — the backstop on a runaway. */
    exchanges: integer("exchanges").notNull().default(0),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("job_estimate_interviews_tenant_id_id_idx").on(t.tenantId, t.id),
    index("job_estimate_interviews_tenant_estimate_idx").on(t.tenantId, t.estimateId),
    /**
     * ONE RUNNING WALK PER ESTIMATE. Two people walking the same estimate
     * would each be banking answers the other cannot see, and at X2b would
     * each be writing lines onto one document. A partial unique index, so the
     * second one fails at the database rather than depending on a check.
     */
    uniqueIndex("job_estimate_interviews_one_running_idx")
      .on(t.tenantId, t.estimateId)
      .where(sql`${t.status} = 'running'`),
    /** A walk is part of the estimate it is pricing. */
    foreignKey({
      name: "job_estimate_interviews_estimate_fk",
      columns: [t.tenantId, t.estimateId],
      foreignColumns: [jobEstimates.tenantId, jobEstimates.id],
    }).onDelete("cascade"),
    /**
     * NO ACTION to the outline: a walk that ran from an outline keeps
     * pointing at it, and deleting an outline somebody is mid-way through is
     * refused rather than silently orphaning the walk.
     */
    foreignKey({
      name: "job_estimate_interviews_outline_fk",
      columns: [t.tenantId, t.outlineId],
      foreignColumns: [jobEstimateOutlines.tenantId, jobEstimateOutlines.id],
    }),
    check(
      "job_estimate_interviews_status_valid",
      sql`${t.status} in ('running', 'finished', 'abandoned')`,
    ),
    /** Finished or abandoned means a date; running means none. Both ways. */
    check(
      "job_estimate_interviews_finished_has_date",
      sql`(${t.status} = 'running') = (${t.finishedAt} is null)`,
    ),
    check("job_estimate_interviews_exchanges_sane", sql`${t.exchanges} >= 0`),
    check(
      "job_estimate_interviews_quick_replies_list",
      sql`jsonb_typeof(${t.pendingQuickReplies}) = 'array'`,
    ),
  ],
);

/**
 * ONE THING ASKED, AND WHAT CAME BACK.
 *
 * Rows rather than a blob, for the reason the outline's questions are rows:
 * this is what a later slice reads to say *"you answered this and no line
 * came of it"*, and what makes a walk resumable to the exact question.
 *
 * A SKIP IS A ROW TOO. The walk is allowed to decide a question does not
 * apply — *"any rebar?"* after you said block — and an unrecorded skip is
 * indistinguishable from a question nobody got to. `skipped` with its reason
 * is what lets the finish gate tell those two apart, and what lets somebody
 * ask in six months why the bid never covered it.
 */
export const jobEstimateInterviewAnswers = pgTable(
  "job_estimate_interview_answers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    interviewId: uuid("interview_id").notNull(),
    /** The outline step, by id. No FK — see the file comment. */
    stepId: uuid("step_id"),
    /** The step's name AS IT WAS, so a renamed step cannot rewrite history. */
    stepTitle: text("step_title").notNull().default(""),
    /** The outline question; NULL when the walk asked one of its own. */
    questionId: uuid("question_id"),
    /** The words it was asked in. */
    prompt: text("prompt").notNull(),
    /** What came back. Blank on a skip. */
    answer: text("answer").notNull().default(""),
    /** Whether the walk decided this one did not apply. */
    skipped: boolean("skipped").notNull().default(false),
    /** Why, in the walk's own words. Blank unless skipped. */
    skipReason: text("skip_reason").notNull().default(""),
    /** The order they were asked in, which is the order they read back. */
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("job_estimate_interview_answers_tenant_id_id_idx").on(t.tenantId, t.id),
    index("job_estimate_interview_answers_tenant_interview_idx").on(
      t.tenantId,
      t.interviewId,
      t.sortOrder,
    ),
    /** An answer is part of the walk it was given in. */
    foreignKey({
      name: "job_estimate_interview_answers_interview_fk",
      columns: [t.tenantId, t.interviewId],
      foreignColumns: [jobEstimateInterviews.tenantId, jobEstimateInterviews.id],
    }).onDelete("cascade"),
    check(
      "job_estimate_interview_answers_prompt_present",
      sql`length(btrim(${t.prompt})) > 0`,
    ),
    /**
     * A skip carries its reason and no answer; an answer carries neither.
     * Half a skip is not a record of anything.
     */
    check(
      "job_estimate_interview_answers_skip_whole",
      sql`(${t.skipped} and length(btrim(${t.skipReason})) > 0 and ${t.answer} = '')
          or (not ${t.skipped} and ${t.skipReason} = '')`,
    ),
  ],
);

export type JobEstimateInterview = typeof jobEstimateInterviews.$inferSelect;
export type JobEstimateInterviewAnswer = typeof jobEstimateInterviewAnswers.$inferSelect;
