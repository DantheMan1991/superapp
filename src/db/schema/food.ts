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
  check,
  doublePrecision,
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
 * while Claude reads still finds the draft on the Food page, as Workouts'
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

export type FoodRecipe = typeof foodRecipes.$inferSelect;
export type FoodImport = typeof foodImports.$inferSelect;
