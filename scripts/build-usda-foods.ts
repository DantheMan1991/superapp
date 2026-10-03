import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

/**
 * BUILDS THE FOOD LIST Food searches (D4a, docs/modules/food.md; ADR 0126):
 * `scripts/data/usda-foods.json`, from USDA FoodData Central's Survey foods
 * (FNDDS 2021-2023, the 2024-10-31 release), the foods people report eating,
 * each with its nutrients per 100 g and its household portions ("1 banana",
 * "1 cup, cooked"). Public domain (CC0 1.0); USDA asks for a credit, which the
 * search screen carries.
 *
 * Run by hand when the release changes, never in CI or a deploy:
 *   npx tsx scripts/build-usda-foods.ts
 * The output is committed, and `npm run db:seed` loads it into
 * `food_usda_foods`, so a seed needs no network and every database (dev,
 * production, CI's) gets the same list.
 *
 * Pinned by URL and SHA-256, like the listener's model (ADR 0124): a changed
 * file is refused, not loaded.
 */

const SOURCE = {
  url: "https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_survey_food_json_2024-10-31.zip",
  sha256: "dfb06ae7ddc397ccd570b91c14b75438ab2ba39f64f22d321f61d4a52a77f3eb",
  release: "FNDDS 2021-2023 (FoodData Central, 2024-10-31)",
};

const OUTPUT = "scripts/data/usda-foods.json";

/** The nutrients kept, by FoodData Central nutrient id, in `FoodRecord` order. */
const NUTRIENTS = [
  { id: 1008, key: "calories" }, // Energy, kcal
  { id: 1003, key: "proteinG" },
  { id: 1005, key: "carbsG" }, // Carbohydrate, by difference
  { id: 1004, key: "fatG" }, // Total lipid (fat)
  { id: 1079, key: "fiberG" }, // Fiber, total dietary
  { id: 2000, key: "sugarG" }, // Total Sugars
  { id: 1093, key: "sodiumMg" }, // Sodium, Na
] as const;

interface SurveyFood {
  fdcId: number;
  description: string;
  wweiaFoodCategory?: { wweiaFoodCategoryDescription?: string };
  foodNutrients: { nutrient: { id: number }; amount?: number }[];
  foodPortions: { portionDescription: string; gramWeight: number; sequenceNumber: number }[];
}

/**
 * The one file in a FoodData Central zip, read with Node's own inflate: the
 * central directory gives its method, size and where its data starts.
 */
function onlyEntry(zip: Buffer): Buffer {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error("not a zip");
  const central = zip.readUInt32LE(eocd + 16);
  if (zip.readUInt32LE(central) !== 0x02014b50) throw new Error("no central directory");
  const method = zip.readUInt16LE(central + 10);
  const compressed = zip.readUInt32LE(central + 20);
  const local = zip.readUInt32LE(central + 42);
  if (zip.readUInt32LE(local) !== 0x04034b50) throw new Error("no local header");
  const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
  const data = zip.subarray(start, start + compressed);
  if (method === 0) return data;
  if (method === 8) return inflateRawSync(data);
  throw new Error(`zip method ${method}`);
}

/**
 * A survey food's name as a person reads it. FNDDS writes "NS as to cooking
 * method" for "the cooking method was not said" and "NFS" for "not further
 * specified"; both are spelled out, nothing else is changed.
 */
export function readableName(description: string): string {
  return description
    .replace(/\bNS as to ([^,]+)/g, "$1 not specified")
    .replace(/\bNFS\b/g, "not further specified")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A portion as a person reads it: "1 cup, NFS" and "1 fl oz (NFS)" are a cup
 * and a fluid ounce, and "1 egg, NS as to size" is an egg. No food's portions
 * collide once these are taken off (checked when this was written).
 */
export function readablePortion(label: string): string {
  return label
    .replace(/\s*\(NFS\)/g, "")
    .replace(/,\s*NFS\b/g, "")
    .replace(/,\s*NS as to [^,]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

async function main() {
  const response = await fetch(SOURCE.url);
  if (!response.ok) throw new Error(`download failed: ${response.status}`);
  const zip = Buffer.from(await response.arrayBuffer());
  const sha256 = createHash("sha256").update(zip).digest("hex");
  if (sha256 !== SOURCE.sha256) throw new Error(`refusing a changed file: sha256 ${sha256}`);

  const parsed = JSON.parse(onlyEntry(zip).toString("utf8")) as { SurveyFoods: SurveyFood[] };
  const foods = [];
  for (const food of parsed.SurveyFoods) {
    const amounts = new Map(food.foodNutrients.map((n) => [n.nutrient.id, n.amount]));
    // A food without its energy cannot be counted (one in the 2024 release: human milk).
    if (NUTRIENTS.some((n) => typeof amounts.get(n.id) !== "number")) continue;
    const portions = food.foodPortions
      .filter((p) => p.gramWeight > 0 && p.portionDescription !== "Quantity not specified")
      .sort((a, b) => a.sequenceNumber - b.sequenceNumber)
      .map((p) => [readablePortion(p.portionDescription), round(p.gramWeight, 1)] as const);
    foods.push([
      food.fdcId,
      readableName(food.description),
      food.wweiaFoodCategory?.wweiaFoodCategoryDescription?.trim() ?? "",
      ...NUTRIENTS.map((n) => round(amounts.get(n.id) as number, n.key === "calories" || n.key === "sodiumMg" ? 0 : 2)),
      portions,
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
    columns: ["fdcId", "name", "category", ...NUTRIENTS.map((n) => n.key), "portions [label, grams]"],
    foods,
  };
  // One food a line, so a new release reads as a diff of foods.
  const lines = foods.map((food) => JSON.stringify(food));
  const head = JSON.stringify({ ...out, foods: [] }, null, 2).replace(/"foods": \[\]\n\}$/, '"foods": [');
  writeFileSync(OUTPUT, `${head}\n${lines.join(",\n")}\n]\n}\n`);
  console.log(`Wrote ${foods.length} foods to ${OUTPUT}.`);
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/build-usda-foods.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
