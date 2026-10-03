import { readFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import type { NeonDatabase } from "drizzle-orm/neon-serverless";
import * as schema from "../../src/db/schema";

/**
 * THE FOOD LIST, LOADED BY THE SEED (Food D4a, ADR 0126). `npm run db:seed`
 * writes `scripts/data/usda-foods.json` (made by `scripts/build-usda-foods.ts`)
 * into `food_usda_foods`, so the list reaches every database through the
 * before-the-merge ritual that already carries the catalogue, needs no network,
 * and `npm run db:verify-modules` can say when it has not.
 */

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

export function readUsdaFoodFile(): UsdaFoodFile {
  const file = JSON.parse(readFileSync(path.join(process.cwd(), "scripts", "data", "usda-foods.json"), "utf8"));
  if (typeof file.release !== "string" || !Array.isArray(file.foods) || file.foods.length === 0) {
    throw new Error("scripts/data/usda-foods.json is not a food list");
  }
  return { release: file.release, foods: file.foods };
}

const BATCH = 500;

/**
 * Load the list, unless this release is already there in full. Foods a new
 * release no longer has are deleted; what was eaten keeps its numbers and its
 * name (`food_eaten.fdc_id` is set to null, never the row deleted).
 */
export async function seedUsdaFoods(
  db: NeonDatabase<typeof schema>,
): Promise<{ release: string; loaded: number; removed: number }> {
  const { release, foods } = readUsdaFoodFile();
  return db.transaction(async (tx) => {
    // Trusted system code; RLS requires an explicit context (scripts/seed.ts).
    await tx.execute(sql`select set_config('app.role', 'superadmin', true)`);
    const counted = await tx.execute(sql`
      select count(*)::int as total, count(*) filter (where release = ${release})::int as current
        from food_usda_foods`);
    const { total, current } = counted.rows[0] as { total: number; current: number };
    if (total === foods.length && current === foods.length) return { release, loaded: 0, removed: 0 };

    const t = schema.foodUsdaFoods;
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
    const removed = await tx.execute(sql`delete from food_usda_foods where release <> ${release} returning fdc_id`);
    return { release, loaded: foods.length, removed: removed.rows.length };
  });
}
