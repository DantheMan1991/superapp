/**
 * HEALTH — the third personal tool (ADR 0111, docs/modules/health.md): what a
 * person does for their health, logged in a few taps, and their progress
 * across it by week. The founder's goal (2026-10-01): "track progress based on
 * things i am doing with the workout, eating/diet, cold plunge, sleep etc."
 *
 * H1 logs cold plunges (timed on the phone), sleep (bed and wake times, how
 * rested) and the person's own habits (a sauna, stretching, a supplement).
 * H2 adds the body: weigh-ins, a goal weight, and the tape measures the person
 * chooses. Workouts already logs the workouts; the Progress page reads them
 * through a slot Workouts fills (`src/lib/progress-sources`), never from here.
 * Every table is an ordinary tenant table in a PERSONAL space; RLS knows
 * nothing about that.
 */
import { sql } from "drizzle-orm";
import {
  check,
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./platform";

/**
 * A cold plunge: how long, how cold, and how the person felt after. Timed on
 * the phone, or typed in after; its id is the phone's, so a Save sent twice
 * (a weak signal, a second tap) is one plunge.
 */
export const healthPlunges = pgTable(
  "health_plunges",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** The space's own day it was taken (`todayInTimezone`). */
    takenOn: date("taken_on").notNull(),
    /** When the timer started, or when it was typed in. */
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    /** Time in the water. */
    seconds: integer("seconds").notNull(),
    /** The water, in °F as the person reads it; null when not taken. */
    waterF: doublePrecision("water_f"),
    /** 0 to 10, as Workouts asks it. */
    feelAfter: integer("feel_after"),
    createdByClerkUserId: text("created_by_clerk_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("health_plunges_tenant_day_idx").on(t.tenantId, t.takenOn),
    check("health_plunges_seconds_range", sql`${t.seconds} between 1 and 3600`),
    check("health_plunges_water_range", sql`${t.waterF} is null or ${t.waterF} between 28 and 110`),
    check("health_plunges_feel_range", sql`${t.feelAfter} is null or ${t.feelAfter} between 0 and 10`),
  ],
);

/**
 * A night's sleep, logged the morning it ended: one a morning. Kept as the
 * clock times the person gave (no timezone sums), with the minutes they come
 * to, so a night across a clock change is an hour off twice a year rather than
 * a timezone bug every night.
 */
export const healthSleep = pgTable(
  "health_sleep",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** The morning it ended, on the space's calendar. */
    wokeOn: date("woke_on").notNull(),
    /** Into bed, on the evening before (or that morning, after midnight). */
    bedTime: time("bed_time").notNull(),
    wokeTime: time("woke_time").notNull(),
    /** What the two times come to (`core/sleep.ts`): 1 to 1,440. */
    minutes: integer("minutes").notNull(),
    /** How rested, 0 to 10. */
    rested: integer("rested"),
    createdByClerkUserId: text("created_by_clerk_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("health_sleep_tenant_morning_idx").on(t.tenantId, t.wokeOn),
    check("health_sleep_minutes_range", sql`${t.minutes} between 1 and 1440`),
    check("health_sleep_rested_range", sql`${t.rested} is null or ${t.rested} between 0 and 10`),
  ],
);

/**
 * A habit of the person's own (H1, the founder's call): a name, and a unit
 * when it is counted ("min" for a sauna, "g" for creatine); none when it is
 * simply done.
 */
export const healthHabits = pgTable(
  "health_habits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    unit: text("unit"),
    /** Where it sits on Today and in Progress. */
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("health_habits_tenant_id_id_idx").on(t.tenantId, t.id),
    index("health_habits_tenant_position_idx").on(t.tenantId, t.position),
    check("health_habits_name_length", sql`char_length(${t.name}) between 1 and 60`),
    check("health_habits_unit_length", sql`${t.unit} is null or char_length(${t.unit}) between 1 and 20`),
  ],
);

/** A habit done on a day: once a day, with its amount when it is counted. */
export const healthHabitLogs = pgTable(
  "health_habit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    habitId: uuid("habit_id").notNull(),
    /** The space's own day. */
    doneOn: date("done_on").notNull(),
    amount: doublePrecision("amount"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("health_habit_logs_tenant_habit_day_idx").on(t.tenantId, t.habitId, t.doneOn),
    index("health_habit_logs_tenant_day_idx").on(t.tenantId, t.doneOn),
    foreignKey({
      name: "health_habit_logs_habit_fk",
      columns: [t.tenantId, t.habitId],
      foreignColumns: [healthHabits.tenantId, healthHabits.id],
    }).onDelete("cascade"),
    check("health_habit_logs_amount_positive", sql`${t.amount} is null or ${t.amount} > 0`),
  ],
);

/**
 * A weigh-in (H2, the founder's calls 2026-10-03): one a day, typed in, kept
 * in kilograms whatever the person reads (`core/body.ts` turns pounds both
 * ways), so a later setting for kilograms changes words, not rows. Read as a
 * trend through the days, never one reading on its own.
 */
export const healthWeighins = pgTable(
  "health_weighins",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** The space's own day. */
    weighedOn: date("weighed_on").notNull(),
    kg: doublePrecision("kg").notNull(),
    createdByClerkUserId: text("created_by_clerk_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("health_weighins_tenant_day_idx").on(t.tenantId, t.weighedOn),
    check("health_weighins_kg_range", sql`${t.kg} between 20 and 320`),
  ],
);

/**
 * The weight the person is working towards, and about how fast (H2, the
 * founder's call: a goal weight and a pace). One per space. Whether it is to
 * lose or to gain is never kept: it is wherever the goal is from the trend.
 */
export const healthWeightGoals = pgTable(
  "health_weight_goals",
  {
    tenantId: uuid("tenant_id")
      .primaryKey()
      .references(() => tenants.id, { onDelete: "cascade" }),
    goalKg: doublePrecision("goal_kg").notNull(),
    /** About how much a week, either way: 0.1 to 1 kg (a quarter pound to two). */
    paceKg: doublePrecision("pace_kg").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("health_weight_goals_goal_range", sql`${t.goalKg} between 20 and 320`),
    check("health_weight_goals_pace_range", sql`${t.paceKg} between 0.1 and 1`),
  ],
);

/**
 * A tape measure of the person's own (H2, the founder's call: the waist, and
 * the others they pick): a name, and which way is better for it, or neither
 * (an arm can be meant to grow).
 */
export const healthMeasures = pgTable(
  "health_measures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** "smaller" or "bigger"; null when neither is better. */
    better: text("better"),
    /** Where it sits on Body, the Measure page and Progress. */
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("health_measures_tenant_id_id_idx").on(t.tenantId, t.id),
    index("health_measures_tenant_position_idx").on(t.tenantId, t.position),
    check("health_measures_name_length", sql`char_length(${t.name}) between 1 and 40`),
    check("health_measures_better_value", sql`${t.better} is null or ${t.better} in ('smaller', 'bigger')`),
  ],
);

/** A tape measure taken on a day: once a day each, in centimetres whatever the person reads. */
export const healthMeasurements = pgTable(
  "health_measurements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    measureId: uuid("measure_id").notNull(),
    /** The space's own day. */
    measuredOn: date("measured_on").notNull(),
    cm: doublePrecision("cm").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("health_measurements_tenant_measure_day_idx").on(t.tenantId, t.measureId, t.measuredOn),
    index("health_measurements_tenant_day_idx").on(t.tenantId, t.measuredOn),
    foreignKey({
      name: "health_measurements_measure_fk",
      columns: [t.tenantId, t.measureId],
      foreignColumns: [healthMeasures.tenantId, healthMeasures.id],
    }).onDelete("cascade"),
    check("health_measurements_cm_range", sql`${t.cm} between 1 and 400`),
  ],
);

export type HealthPlunge = typeof healthPlunges.$inferSelect;
export type HealthSleep = typeof healthSleep.$inferSelect;
export type HealthHabit = typeof healthHabits.$inferSelect;
export type HealthHabitLog = typeof healthHabitLogs.$inferSelect;
export type HealthWeighin = typeof healthWeighins.$inferSelect;
export type HealthWeightGoal = typeof healthWeightGoals.$inferSelect;
export type HealthMeasure = typeof healthMeasures.$inferSelect;
export type HealthMeasurement = typeof healthMeasurements.$inferSelect;
