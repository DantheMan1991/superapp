import { readFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import type { NeonDatabase } from "drizzle-orm/neon-serverless";
import * as schema from "../../src/db/schema";

/**
 * USDA'S TWO LISTS, LOADED BY THE SEED. `npm run db:seed` writes
 * `scripts/data/usda-foods.json` (the eating log's foods as eaten, FNDDS, made
 * by `scripts/build-usda-foods.ts`; Food D4a, ADR 0126) into `food_usda_foods`,
 * and `scripts/data/usda-ingredients.json` (a recipe's ingredients as bought,
 * SR Legacy, made by `scripts/build-usda-ingredients.ts`; Food D4, ADR 0131)
 * into `food_usda_ingredients`, so both reach every database through the
 * before-the-merge ritual that already carries the catalogue, need no network,
 * and `npm run db:verify-modules` can say when they have not.
 */

export type UsdaList = "foods" | "ingredients";

/** Each list: its file, its table, and what a person calls it. */
export const USDA_LISTS = {
  foods: { file: "usda-foods.json", table: "food_usda_foods", what: "food list" },
  ingredients: { file: "usda-ingredients.json", table: "food_usda_ingredients", what: "ingredient list" },
} as const;

/** One food as the file keeps it: `columns` in the file's header names each place. */
type FileFood = [
  fdcId: number,
  name: string,
  category: string,
  calories: number,
  proteinG: number,
  carbsG: number,
  fatG: number,
  fiberG: number,
  sugarG: number,
  sodiumMg: number,
  portions: [label: string, grams: number][],
];

export interface UsdaFoodFile {
  release: string;
  foods: FileFood[];
}

export function readUsdaFoodFile(list: UsdaList = "foods"): UsdaFoodFile {
  const name = USDA_LISTS[list].file;
  const file = JSON.parse(readFileSync(path.join(process.cwd(), "scripts", "data", name), "utf8"));
  if (typeof file.release !== "string" || !Array.isArray(file.foods) || file.foods.length === 0) {
    throw new Error(`scripts/data/${name} is not a ${USDA_LISTS[list].what}`);
  }
  return { release: file.release, foods: file.foods };
}

const BATCH = 500;

/**
 * Load a list, unless this release is already there in full. Foods a new
 * release no longer has are deleted: what was eaten keeps its numbers and its
 * name (`food_eaten.fdc_id` is set to null, never the row deleted), and a
 * recipe's worked-out lines keep the name they were matched to.
 */
async function seedUsdaList(
  db: NeonDatabase<typeof schema>,
  list: UsdaList,
): Promise<{ release: string; loaded: number; removed: number }> {
  const { release, foods } = readUsdaFoodFile(list);
  // The two tables have the same columns; the one written is named by the list.
  const t = (list === "foods" ? schema.foodUsdaFoods : schema.foodUsdaIngredients) as typeof schema.foodUsdaFoods;
  const table = sql.identifier(USDA_LISTS[list].table);
  return db.transaction(async (tx) => {
    // Trusted system code; RLS requires an explicit context (scripts/seed.ts).
    await tx.execute(sql`select set_config('app.role', 'superadmin', true)`);
    const counted = await tx.execute(sql`
      select count(*)::int as total, count(*) filter (where release = ${release})::int as current
        from ${table}`);
    const { total, current } = counted.rows[0] as { total: number; current: number };
    if (total === foods.length && current === foods.length) return { release, loaded: 0, removed: 0 };

    for (let i = 0; i < foods.length; i += BATCH) {
      const rows = foods.slice(i, i + BATCH).map((f) => ({
        fdcId: f[0],
        name: f[1],
        category: f[2],
        calories: f[3],
        proteinG: f[4],
        carbsG: f[5],
        fatG: f[6],
        fiberG: f[7],
        sugarG: f[8],
        sodiumMg: f[9],
        portions: f[10].map(([label, grams]) => ({ label, grams })),
        release,
      }));
      await tx
        .insert(t)
        .values(rows)
        .onConflictDoUpdate({
          target: t.fdcId,
          set: {
            name: sql`excluded.name`,
            category: sql`excluded.category`,
            calories: sql`excluded.calories`,
            proteinG: sql`excluded.protein_g`,
            carbsG: sql`excluded.carbs_g`,
            fatG: sql`excluded.fat_g`,
            fiberG: sql`excluded.fiber_g`,
            sugarG: sql`excluded.sugar_g`,
            sodiumMg: sql`excluded.sodium_mg`,
            portions: sql`excluded.portions`,
            release: sql`excluded.release`,
          },
        });
    }
    const removed = await tx.execute(sql`delete from ${table} where release <> ${release} returning fdc_id`);
    return { release, loaded: foods.length, removed: removed.rows.length };
  });
}

/** The eating log's food list (D4a). */
export function seedUsdaFoods(db: NeonDatabase<typeof schema>) {
  return seedUsdaList(db, "foods");
}

/** The ingredient list a recipe's nutrition is worked out from (D4). */
export function seedUsdaIngredients(db: NeonDatabase<typeof schema>) {
  return seedUsdaList(db, "ingredients");
}
