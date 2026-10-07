import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { onlyEntry, round } from "./build-usda-foods";

/**
 * BUILDS THE INGREDIENT LIST a recipe's nutrition is worked out from (D4,
 * docs/modules/food.md; ADR 0131): `scripts/data/usda-ingredients.json`, from
 * USDA FoodData Central's Standard Reference Legacy (the 2021-10-28 release),
 * about 7,800 foods as bought, raw and packaged ("Rice, white, long-grain,
 * regular, raw, enriched", "Spices, chili powder", "Tomatoes, crushed,
 * canned"), each with its nutrients per 100 g and its household portions.
 * The eating log's list (FNDDS, `build-usda-foods.ts`) is foods as eaten and
 * has none of these. Public domain (CC0 1.0); USDA asks for a credit, which
 * the screens carry.
 *
 * Run by hand when the release changes, never in CI or a deploy:
 *   npx tsx scripts/build-usda-ingredients.ts [path/to/the.zip]
 * With a path, the zip already downloaded is read (and checked) instead of
 * fetched again. The output is committed, and `npm run db:seed` loads it into
 * `food_usda_ingredients`.
 *
 * Pinned by URL and SHA-256: a changed file is refused, not loaded.
 */

const SOURCE = {
  url: "https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_json_2021-10-28.zip",
  sha256: "789240d42d51640b931782310403c415eb4aa03383d8f0a52f6315db80f96bc7",
  release: "SR Legacy (FoodData Central, 2021-10-28)",
};
const OUTPUT = "scripts/data/usda-ingredients.json";

/** The nutrients kept, by FoodData Central nutrient id, in the food list's order. */
const NUTRIENTS = [
  { id: 1008, key: "calories" }, // Energy, kcal
  { id: 1003, key: "proteinG" },
  { id: 1005, key: "carbsG" }, // Carbohydrate, by difference
  { id: 1004, key: "fatG" }, // Total lipid (fat)
  { id: 1079, key: "fiberG" }, // Fiber, total dietary
  { id: 2000, key: "sugarG" }, // Sugars, total including NLEA
  { id: 1093, key: "sodiumMg" }, // Sodium, Na
] as const;

/**
 * The four a recipe is counted by. Every SR Legacy food has them; fiber,
 * sugar and sodium are missing for some (562, 1,786 and 84 foods), and are
 * kept as 0 there: they are kept, never shown, and never targets.
 */
const REQUIRED = new Set<number>([1008, 1003, 1005, 1004]);

interface LegacyFood {
  fdcId: number;
  description: string;
  foodCategory?: { description?: string };
  foodNutrients: { nutrient: { id: number }; amount?: number }[];
  foodPortions: { modifier?: string; gramWeight: number; sequenceNumber: number }[];
}

/**
 * A portion as a person reads it. SR Legacy's portions are one of a measure
 * whose words are all in `modifier` ("cup, chopped", "clove", "medium (2-1/2"
 * dia)"), so each is "1 " and those words. The first of two with the same
 * words is kept, and a plural beside its singular is dropped: the release lost
 * each portion's count, so garlic's "cloves" (9 g, three of them) would read
 * as one clove beside "clove" (3 g).
 */
export function legacyPortions(portions: LegacyFood["foodPortions"]): [string, number][] {
  const sorted = [...portions].sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  const all = new Set(sorted.map((p) => (p.modifier ?? "").replace(/\s+/g, " ").trim()));
  const out: [string, number][] = [];
  for (const portion of sorted) {
    const words = (portion.modifier ?? "").replace(/\s+/g, " ").trim();
    if (!words || !(portion.gramWeight > 0)) continue;
    if (/s$/.test(words) && all.has(words.slice(0, -1))) continue;
    const label = `1 ${words}`;
    if (out.some(([seen]) => seen === label)) continue;
    out.push([label, round(portion.gramWeight, 1)]);
  }
  return out;
}

async function zipBytes(path: string | undefined): Promise<Buffer> {
  if (path) return readFileSync(path);
  const response = await fetch(SOURCE.url);
  if (!response.ok) throw new Error(`download failed: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function main() {
  const zip = await zipBytes(process.argv[2]);
  const sha256 = createHash("sha256").update(zip).digest("hex");
  if (sha256 !== SOURCE.sha256) throw new Error(`refusing a changed file: sha256 ${sha256}`);

  const parsed = JSON.parse(onlyEntry(zip).toString("utf8")) as { SRLegacyFoods: LegacyFood[] };
  const foods = [];
  for (const food of parsed.SRLegacyFoods) {
    const amounts = new Map(food.foodNutrients.map((n) => [n.nutrient.id, n.amount]));
    if ([...REQUIRED].some((id) => typeof amounts.get(id) !== "number")) continue;
    foods.push([
      food.fdcId,
      food.description.replace(/\s+/g, " ").trim(),
      food.foodCategory?.description?.trim() ?? "",
      ...NUTRIENTS.map((n) => round((amounts.get(n.id) as number | undefined) ?? 0, n.key === "calories" || n.key === "sodiumMg" ? 0 : 2)),
      legacyPortions(food.foodPortions),
    ]);
  }
  foods.sort((a, b) => (a[0] as number) - (b[0] as number));

  const out = {
    source: "U.S. Department of Agriculture, Agricultural Research Service. FoodData Central. fdc.nal.usda.gov.",
    license: "CC0 1.0 (public domain)",
    release: SOURCE.release,
    url: SOURCE.url,
    sha256: SOURCE.sha256,
    per: "100 g",
    note: "Fiber, sugar and sodium are 0 where SR Legacy does not give them.",
    columns: ["fdcId", "name", "category", ...NUTRIENTS.map((n) => n.key), "portions [label, grams]"],
    foods,
  };
  // One food a line, so a new release reads as a diff of foods.
  const lines = foods.map((food) => JSON.stringify(food));
  const head = JSON.stringify({ ...out, foods: [] }, null, 2).replace(/"foods": \[\]\n\}$/, '"foods": [');
  writeFileSync(OUTPUT, `${head}\n${lines.join(",\n")}\n]\n}\n`);
  console.log(`Wrote ${foods.length} ingredients to ${OUTPUT}.`);
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/build-usda-ingredients.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
