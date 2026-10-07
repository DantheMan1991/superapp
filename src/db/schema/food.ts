/**
 * FOOD — the second personal tool (ADR 0111, docs/modules/food.md): recipes
 * now (D1), the week's meals, the shopping list and what was eaten later.
 *
 * A RECIPE is the person's own copy. It is typed in, or read from a link,
 * from pasted text or from a photo of a page and checked by them before a row
 * here is written (`food_imports`). Every table is an ordinary tenant table in
 * a PERSONAL space; RLS knows nothing about that, and does not need to.
 *
 * ── WHY THE LINES ARE KEPT AS WRITTEN ───────────────────────────────────────
 *
 * An ingredient is the line the recipe gave ("1 ½ lb chicken thighs"), not an
 * amount, a unit and a food in three columns. What scales is read from the
 * line every time it is shown (`core/amounts.ts`, ADR 0123), so a reader that
 * gets better makes every recipe better without touching a row, and a line it
 * cannot read is still shown exactly as the cook wrote it.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./platform";

/** One line of a recipe's ingredients or steps; a heading starts a group ("For the sauce"). */
export interface FoodLine {
  text: string;
  heading?: boolean;
}

/**
 * Nutrition PER SERVING as the recipe states it (D1, the founder's call): kept
 * when a page, a card or a pasted recipe gives it, and labelled as the
 * recipe's own. Never worked out here; that is D4, and it gets its own label.
 */
export interface FoodNutrition {
  calories?: number;
  proteinG?: number;
  carbsG?: number;
  fatG?: number;
  fiberG?: number;
  sugarG?: number;
  sodiumMg?: number;
}

/**
 * One ingredient line as it was worked out (D4): the food on USDA's
 * ingredient list it was matched to, its grams and where they came from
 * (`line`: the line's own weight; `list`: USDA's weight for a portion;
 * `estimate`: Claude's; `typed`: the person's), and whether it counts.
 */
export interface WorkedLine {
  line: string;
  fdcId: number | null;
  food: string | null;
  grams: number | null;
  source: "line" | "list" | "estimate" | "typed" | "none";
  counted: boolean;
}

/**
 * A recipe's nutrition WORKED OUT from its ingredients (D4, ADR 0131): the
 * WHOLE recipe as written, with each line as the person checked it. A serving
 * is the whole divided by what the recipe makes when it is read, so changing
 * what it makes never leaves this out of date. The numbers are USDA's, for
 * the grams; Claude only matched and weighed. The recipe's own `nutrition`,
 * where it states a number, comes first (the founder's call).
 */
export interface WorkedNutrition {
  whole: FoodNutrition;
  lines: WorkedLine[];
  workedAt: string;
}

export const foodRecipes = pgTable(
  "food_recipes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    /**
     * What one batch makes: `4` `servings`, `24` `cookies`, `1` `loaf`. The
     * amount is what the recipe page's stepper scales from; with none, the
     * recipe shows as written and does not scale.
     */
    yieldAmount: doublePrecision("yield_amount"),
    yieldUnit: text("yield_unit"),
    prepMinutes: integer("prep_minutes"),
    cookMinutes: integer("cook_minutes"),
    totalMinutes: integer("total_minutes"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    ingredients: jsonb("ingredients").$type<FoodLine[]>().notNull().default(sql`'[]'::jsonb`),
    steps: jsonb("steps").$type<FoodLine[]>().notNull().default(sql`'[]'::jsonb`),
    notes: text("notes"),
    nutrition: jsonb("nutrition").$type<FoodNutrition>(),
    /** Its nutrition worked out from its ingredients (D4), when the person did; null until then. */
    workedNutrition: jsonb("worked_nutrition").$type<WorkedNutrition>(),
    /** Where it came from: the page it was read from, or a link the person typed. */
    sourceUrl: text("source_url"),
    /**
     * The one photo kept (`food/<tenant>/photos/…` in the private store): the
     * derivative `preparePhoto` made, never the upload itself.
     */
    photoPathname: text("photo_pathname"),
    photoWidth: integer("photo_width"),
    photoHeight: integer("photo_height"),
    createdByClerkUserId: text("created_by_clerk_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The composite key D2's week and a food log will point at, by
    // `(tenant_id, recipe_id)`, as every tenant table's children do.
    uniqueIndex("food_recipes_tenant_id_id_idx").on(t.tenantId, t.id),
    index("food_recipes_tenant_updated_idx").on(t.tenantId, t.updatedAt),
    check("food_recipes_title_present", sql`length(btrim(${t.title})) > 0`),
    check("food_recipes_yield_positive", sql`${t.yieldAmount} is null or ${t.yieldAmount} > 0`),
    check(
      "food_recipes_minutes_range",
      sql`(${t.prepMinutes} is null or ${t.prepMinutes} between 0 and 10080)
        and (${t.cookMinutes} is null or ${t.cookMinutes} between 0 and 10080)
        and (${t.totalMinutes} is null or ${t.totalMinutes} between 0 and 10080)`,
    ),
    check(
      "food_recipes_photo_whole",
      sql`(${t.photoPathname} is null) = (${t.photoWidth} is null)
        and (${t.photoPathname} is null) = (${t.photoHeight} is null)`,
    ),
  ],
);

/** Where an import reads from. */
export const foodImportKind = pgEnum("food_import_kind", ["link", "text", "photo"]);

/**
 * An import's life: `reading` while the page is fetched or Claude reads,
 * `draft` when there is something to check, `failed` with the reason. Saving
 * or discarding one deletes it: the recipe keeps its own `source_url`.
 */
export const foodImportStatus = pgEnum("food_import_status", ["reading", "draft", "failed"]);

/**
 * A RECIPE ON ITS WAY IN (D1): read from a link, pasted text or a photo of a
 * page. The row exists from the moment reading starts, so a person who leaves
 * while Claude reads still finds the draft in their recipes, as Workouts'
 * imports do. A photo of a page is read and never kept; the page's own photo,
 * from a link, is prepared at once and held here until the recipe takes it or
 * the draft is discarded.
 */
export const foodImports = pgTable(
  "food_imports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    kind: foodImportKind("kind").notNull(),
    /** The link read, for a `link` import. */
    sourceUrl: text("source_url"),
    status: foodImportStatus("status").notNull().default("reading"),
    /**
     * The draft, as the editor opens it (`normalizeDraft`, then read back
     * through `recipeInputSchema`); null until it is read.
     */
    draft: jsonb("draft"),
    /** Why a `failed` import failed, in words the person can act on. */
    error: text("error"),
    photoPathname: text("photo_pathname"),
    photoWidth: integer("photo_width"),
    photoHeight: integer("photo_height"),
    createdByClerkUserId: text("created_by_clerk_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("food_imports_tenant_id_id_idx").on(t.tenantId, t.id),
    index("food_imports_tenant_created_idx").on(t.tenantId, t.createdAt),
    check("food_imports_link_has_url", sql`${t.kind} <> 'link' or ${t.sourceUrl} is not null`),
    check(
      "food_imports_photo_whole",
      sql`(${t.photoPathname} is null) = (${t.photoWidth} is null)
        and (${t.photoPathname} is null) = (${t.photoHeight} is null)`,
    ),
  ],
);

/**
 * A TIME A RECIPE WAS COOKED (D1b, the founder's call): "Log that you made it"
 * at the end of cook mode. The recipe shows how many times and when last; it
 * is the first record of what the person ate, which his health goal wants
 * (docs/modules/food.md). The id is the phone's, made when cook mode opens,
 * so a log sent twice is one log; undo deletes it. Deleting the recipe takes
 * its cooks with it.
 */
export const foodCooks = pgTable(
  "food_cooks",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    recipeId: uuid("recipe_id").notNull(),
    /** The space's own day it was made (`todayInTimezone`). */
    madeOn: date("made_on").notNull(),
    /** What it was made for, in the recipe's own unit: the servings cook mode was set to. */
    servings: doublePrecision("servings"),
    createdByClerkUserId: text("created_by_clerk_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("food_cooks_tenant_recipe_idx").on(t.tenantId, t.recipeId, t.madeOn),
    foreignKey({
      name: "food_cooks_recipe_fk",
      columns: [t.tenantId, t.recipeId],
      foreignColumns: [foodRecipes.tenantId, foodRecipes.id],
    }).onDelete("cascade"),
    check("food_cooks_servings_positive", sql`${t.servings} is null or ${t.servings} > 0`),
  ],
);

/** A household measure of a food and what it weighs: "1 banana", 126 g. */
export interface FoodPortion {
  label: string;
  grams: number;
}

/**
 * THE FOOD LIST (D4a, ADR 0126): USDA FoodData Central's survey foods (FNDDS),
 * the foods people report eating, each with its nutrients PER 100 G and its
 * household portions. Reference data, the same in every space, so no tenant:
 * read by any member (the `modules` table's policy), written only by the seed
 * (`scripts/data/usda-foods.json`, made by `scripts/build-usda-foods.ts`).
 *
 * Searched through `search_tsv`, a generated column made in the migration and
 * not modelled here, as `documents.search_tsv` is (0026): drizzle has no
 * tsvector type, and a column it cannot see is safe from a spurious DROP.
 */
export const foodUsdaFoods = pgTable(
  "food_usda_foods",
  {
    /** FoodData Central's id: stable across releases while the food is in them. */
    fdcId: integer("fdc_id").primaryKey(),
    /** As a person reads it ("NS as to" and "NFS" spelled out). */
    name: text("name").notNull(),
    /** USDA's WWEIA category: "Bananas", "Chicken, whole pieces". */
    category: text("category").notNull(),
    calories: doublePrecision("calories").notNull(),
    proteinG: doublePrecision("protein_g").notNull(),
    carbsG: doublePrecision("carbs_g").notNull(),
    fatG: doublePrecision("fat_g").notNull(),
    fiberG: doublePrecision("fiber_g").notNull(),
    sugarG: doublePrecision("sugar_g").notNull(),
    sodiumMg: doublePrecision("sodium_mg").notNull(),
    portions: jsonb("portions").$type<FoodPortion[]>().notNull(),
    /** Which release the row came from, so a new one can be told apart. */
    release: text("release").notNull(),
  },
  (t) => [
    check(
      "food_usda_foods_nutrients_positive",
      sql`${t.calories} >= 0 and ${t.proteinG} >= 0 and ${t.carbsG} >= 0 and ${t.fatG} >= 0
        and ${t.fiberG} >= 0 and ${t.sugarG} >= 0 and ${t.sodiumMg} >= 0`,
    ),
  ],
);

/**
 * THE INGREDIENT LIST (D4, ADR 0131; the founder's call): USDA FoodData
 * Central's Standard Reference Legacy, about 7,800 foods as bought, raw and
 * packaged, each with its nutrients per 100 g and its household portions
 * ("1 clove", "1 cup, chopped"), which a recipe's lines are matched to when its
 * nutrition is worked out. The eating log's list (`food_usda_foods`, FNDDS) is
 * foods as eaten and has no uncooked rice, flour or spices. Reference data like
 * that list: no tenant, read by any member, written only by the seed from
 * `scripts/data/usda-ingredients.json`; searched through a generated
 * `search_tsv` made in the migration.
 */
export const foodUsdaIngredients = pgTable(
  "food_usda_ingredients",
  {
    fdcId: integer("fdc_id").primaryKey(),
    name: text("name").notNull(),
    /** USDA's food group: "Vegetables and Vegetable Products", "Spices and Herbs". */
    category: text("category").notNull(),
    calories: doublePrecision("calories").notNull(),
    proteinG: doublePrecision("protein_g").notNull(),
    carbsG: doublePrecision("carbs_g").notNull(),
    fatG: doublePrecision("fat_g").notNull(),
    fiberG: doublePrecision("fiber_g").notNull(),
    sugarG: doublePrecision("sugar_g").notNull(),
    sodiumMg: doublePrecision("sodium_mg").notNull(),
    portions: jsonb("portions").$type<FoodPortion[]>().notNull(),
    release: text("release").notNull(),
  },
  (t) => [
    check(
      "food_usda_ingredients_nutrients_positive",
      sql`${t.calories} >= 0 and ${t.proteinG} >= 0 and ${t.carbsG} >= 0 and ${t.fatG} >= 0
        and ${t.fiberG} >= 0 and ${t.sugarG} >= 0 and ${t.sodiumMg} >= 0`,
    ),
  ],
);

/** Which meal something was eaten in (D4a, the founder's call). */
export const foodMeal = pgEnum("food_meal", ["breakfast", "lunch", "dinner", "snack"]);

/** How an eaten thing came in: found on the food list, a saved recipe, or read from a photo of the plate. */
export const foodEatenSource = pgEnum("food_eaten_source", ["food", "recipe", "photo"]);

/** What a planned meal is (D2): a recipe cooked there, leftovers of one cooked earlier, or a food from the list. */
export const foodPlanKind = pgEnum("food_plan_kind", ["cook", "leftover", "food"]);

/**
 * THE WEEK (D2, ADR 0129; the founder's calls 2026-10-03, from a mockup):
 * what the person means to eat, on a day, in a meal. A `cook` is a recipe made
 * there, `make` servings of it, of which they eat `servings` (none, for a batch
 * made ahead); a `leftover` eats `servings` from a cook earlier on (`cook_id`),
 * so the shopping list buys once for the batch and Cook opens it at `make`; a
 * `food` is one from the list, by its amount, as Log food has it.
 *
 * No numbers are kept: a plan is the future, worked out from the recipe and
 * the list as they are when it is read. What was eaten keeps its own, in
 * `food_eaten`, whose `plan_id` says which planned meal it was ("Ate it").
 *
 * The id is the phone's, so a Put on the week sent twice is one row. Deleting
 * a recipe takes its cooks off the week, and deleting a cook takes its
 * leftovers; a leftover reads its recipe through its cook.
 */
export const foodPlan = pgTable(
  "food_plan",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** The space's own day it is planned for. */
    plannedOn: date("planned_on").notNull(),
    meal: foodMeal("meal").notNull(),
    kind: foodPlanKind("kind").notNull(),
    /** A cook's recipe. A leftover's is its cook's. */
    recipeId: uuid("recipe_id"),
    /** The cook a leftover eats from. */
    cookId: uuid("cook_id"),
    /** What the person eats here, in servings: a cook's may be 0, a leftover's is more; null for a food. */
    servings: doublePrecision("servings"),
    /** What a cook makes, in servings: the batch the shopping list buys for. */
    make: doublePrecision("make"),
    fdcId: integer("fdc_id").references(() => foodUsdaFoods.fdcId, { onDelete: "set null" }),
    /** A food's name as it was planned. A recipe's title is read from the recipe. */
    name: text("name"),
    /** A food's amount of `portion`, and what that weighs, as `food_eaten` keeps them. */
    amount: doublePrecision("amount"),
    portion: text("portion"),
    grams: doublePrecision("grams"),
    createdByClerkUserId: text("created_by_clerk_user_id").notNull(),
    /** `clock_timestamp()`, as `food_eaten`'s: a cook and its leftovers are written in one transaction. */
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The composite key a leftover's cook and an eaten row's plan point at.
    uniqueIndex("food_plan_tenant_id_id_idx").on(t.tenantId, t.id),
    index("food_plan_tenant_day_idx").on(t.tenantId, t.plannedOn),
    index("food_plan_tenant_cook_idx").on(t.tenantId, t.cookId),
    foreignKey({
      name: "food_plan_recipe_fk",
      columns: [t.tenantId, t.recipeId],
      foreignColumns: [foodRecipes.tenantId, foodRecipes.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "food_plan_cook_fk",
      columns: [t.tenantId, t.cookId],
      foreignColumns: [t.tenantId, t.id],
    }).onDelete("cascade"),
    check(
      "food_plan_shape",
      sql`(${t.kind} = 'cook' and ${t.recipeId} is not null and ${t.cookId} is null
          and ${t.make} > 0 and ${t.make} <= 999 and ${t.servings} >= 0 and ${t.servings} <= ${t.make}
          and ${t.fdcId} is null and ${t.name} is null and ${t.amount} is null and ${t.portion} is null and ${t.grams} is null)
        or (${t.kind} = 'leftover' and ${t.recipeId} is null and ${t.cookId} is not null
          and ${t.make} is null and ${t.servings} > 0 and ${t.servings} <= 999
          and ${t.fdcId} is null and ${t.name} is null and ${t.amount} is null and ${t.portion} is null and ${t.grams} is null)
        or (${t.kind} = 'food' and ${t.recipeId} is null and ${t.cookId} is null and ${t.make} is null and ${t.servings} is null
          and char_length(${t.name}) between 1 and 300 and ${t.amount} > 0 and ${t.amount} <= 100000
          and ${t.portion} is not null and ${t.grams} > 0)`,
    ),
  ],
);

/**
 * WHAT WAS EATEN (D4a, the founder's calls 2026-10-03): one food or one recipe,
 * on a day, in a meal, with what it came to. The numbers are kept as they were
 * worked out when it was logged, so a recipe changed later, or a new release of
 * the food list, never rewrites a day already eaten; a recipe that states no
 * nutrition leaves them null, and the day says so.
 *
 * The id is the phone's, so an Add sent twice is one row. A food points at the
 * list (`fdc_id`) and a recipe at the person's own (`recipe_id`, a composite
 * key); deleting the recipe keeps the row and its numbers, with the name it
 * had (`ON DELETE SET NULL ("recipe_id")`, hand-edited in the migration).
 */
export const foodEaten = pgTable(
  "food_eaten",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** The space's own day it was eaten. */
    eatenOn: date("eaten_on").notNull(),
    meal: foodMeal("meal").notNull(),
    source: foodEatenSource("source").notNull(),
    fdcId: integer("fdc_id").references(() => foodUsdaFoods.fdcId, { onDelete: "set null" }),
    recipeId: uuid("recipe_id"),
    /** What it was called when it was logged: the food's name or the recipe's title. */
    name: text("name").notNull(),
    /** How many of `portion`: 1.5 (servings), 150 (g), 2 ("1 egg"). */
    amount: doublePrecision("amount").notNull(),
    /** "g", "oz", "1 banana", or "serving" for a recipe. */
    portion: text("portion").notNull(),
    /** What a food came to, in grams; null for a recipe, whose servings have no weight. */
    grams: doublePrecision("grams"),
    calories: doublePrecision("calories"),
    proteinG: doublePrecision("protein_g"),
    carbsG: doublePrecision("carbs_g"),
    fatG: doublePrecision("fat_g"),
    fiberG: doublePrecision("fiber_g"),
    sugarG: doublePrecision("sugar_g"),
    sodiumMg: doublePrecision("sodium_mg"),
    /**
     * The planned meal this was (D2, "Ate it" on Today, or Change first): one
     * eaten row a plan at most. Clearing the week keeps what was eaten
     * (`ON DELETE SET NULL ("plan_id")`, hand-edited in the migration).
     */
    planId: uuid("plan_id"),
    createdByClerkUserId: text("created_by_clerk_user_id").notNull(),
    /**
     * `clock_timestamp()`, not `now()`: a plate's foods are written in one
     * transaction, where `now()` is one instant for every row, and the day
     * lists a meal in the order things were logged (0445).
     */
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("food_eaten_tenant_day_idx").on(t.tenantId, t.eatenOn),
    // Hand-edited in the migration to the column-list form `ON DELETE SET NULL ("recipe_id")`:
    // a bare SET NULL would try to null tenant_id too and can never run on a composite key.
    foreignKey({
      name: "food_eaten_recipe_fk",
      columns: [t.tenantId, t.recipeId],
      foreignColumns: [foodRecipes.tenantId, foodRecipes.id],
    }).onDelete("set null"),
    // Hand-edited the same way: `ON DELETE SET NULL ("plan_id")`.
    foreignKey({
      name: "food_eaten_plan_fk",
      columns: [t.tenantId, t.planId],
      foreignColumns: [foodPlan.tenantId, foodPlan.id],
    }).onDelete("set null"),
    uniqueIndex("food_eaten_plan_once_idx")
      .on(t.tenantId, t.planId)
      .where(sql`${t.planId} is not null`),
    check("food_eaten_amount_range", sql`${t.amount} > 0 and ${t.amount} <= 100000`),
    check("food_eaten_grams_for_foods", sql`(${t.source} = 'recipe') = (${t.grams} is null)`),
    check("food_eaten_grams_positive", sql`${t.grams} is null or ${t.grams} > 0`),
    check("food_eaten_name_length", sql`char_length(${t.name}) between 1 and 300`),
    check(
      "food_eaten_nutrients_positive",
      sql`coalesce(${t.calories}, 0) >= 0 and coalesce(${t.proteinG}, 0) >= 0 and coalesce(${t.carbsG}, 0) >= 0
        and coalesce(${t.fatG}, 0) >= 0 and coalesce(${t.fiberG}, 0) >= 0 and coalesce(${t.sugarG}, 0) >= 0
        and coalesce(${t.sodiumMg}, 0) >= 0`,
    ),
  ],
);

/**
 * A PERSON'S DAILY TARGETS (D4a, the founder's call: calories and protein).
 * One row a space; either may be left unset. A day is judged against the
 * targets as they are now, not as they were that day.
 */
export const foodTargets = pgTable(
  "food_targets",
  {
    tenantId: uuid("tenant_id")
      .primaryKey()
      .references(() => tenants.id, { onDelete: "cascade" }),
    calories: integer("calories"),
    proteinG: integer("protein_g"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("food_targets_calories_range", sql`${t.calories} is null or ${t.calories} between 500 and 10000`),
    check("food_targets_protein_range", sql`${t.proteinG} is null or ${t.proteinG} between 10 and 500`),
  ],
);

/** Where a thing to buy is found in a shop (D3): the shopping list's groups, in the order a shop is walked. */
export const foodAisle = pgEnum("food_aisle", ["produce", "meat", "dairy", "bakery", "pantry", "frozen", "drinks", "other"]);

/**
 * WHAT A LINE BUYS (D3, ADR 0130; the founder's call: Claude names each line,
 * the app adds the amounts): an ingredient line as a recipe writes it ("2 cups
 * long-grain white rice, rinsed"), or a planned food's name, with the thing a
 * shopper looks for (`item`, "long-grain white rice"), its aisle, and whether
 * most kitchens keep it (`staple`: salt, oil, spices, asked about once). A row
 * a thing: "Salt and pepper to taste" is two. Named once per space and kept,
 * so a list is sorted at once the next time; one row with `item` null is a
 * line that buys nothing (water). No amount is kept here: the list reads those
 * from the line every time (`core/amounts.ts`).
 */
export const foodLineNames = pgTable(
  "food_line_names",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    line: text("line").notNull(),
    item: text("item"),
    aisle: foodAisle("aisle").notNull(),
    staple: boolean("staple").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One row a line and thing; NULLS NOT DISTINCT, so "buys nothing" is kept once too.
    unique("food_line_names_tenant_line_item_key").on(t.tenantId, t.line, t.item).nullsNotDistinct(),
    check("food_line_names_line_length", sql`char_length(${t.line}) between 1 and 500`),
    check("food_line_names_item_length", sql`${t.item} is null or char_length(${t.item}) between 1 and 80`),
  ],
);

/**
 * WHAT THE PERSON ALWAYS HAS AT HOME (D3, the founder's call): an item the
 * shopping list asked about once ("Have these at home?") and was told
 * "Always have", left off every list after, until put back.
 */
export const foodStaples = pgTable(
  "food_staples",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    item: text("item").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.item] }),
    check("food_staples_item_length", sql`char_length(${t.item}) between 1 and 80`),
  ],
);

export type FoodRecipe = typeof foodRecipes.$inferSelect;
export type FoodCook = typeof foodCooks.$inferSelect;
export type FoodImport = typeof foodImports.$inferSelect;
export type FoodUsdaFood = typeof foodUsdaFoods.$inferSelect;
export type FoodUsdaIngredient = typeof foodUsdaIngredients.$inferSelect;
export type FoodEatenRow = typeof foodEaten.$inferSelect;
export type FoodPlanRow = typeof foodPlan.$inferSelect;
export type FoodLineName = typeof foodLineNames.$inferSelect;
