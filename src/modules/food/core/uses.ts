import type { FoodLine } from "@/db/schema/food";
import { readLine } from "./amounts";

/**
 * WHAT A STEP USES (D1b, the founder's call): the ingredient lines whose food
 * the step's words name, so cook mode can show "Uses: 4 tbsp butter" under a
 * step at the servings being cooked.
 *
 * Read from the words, so it can miss one (a step that says "the dry
 * things") and the full list is always a tap away. It errs toward missing
 * rather than guessing: a word two lines share ("oil" in olive oil and
 * sesame oil) only counts when the step names the whole food.
 */

/** Words that say how a food is, not what it is. */
const DESCRIBING = new Set([
  "a", "an", "the", "of", "and", "or", "to", "for", "plus", "more", "about", "into", "with", "taste",
  "serving", "optional", "divided", "packed", "fresh", "freshly", "chopped", "minced", "diced", "sliced",
  "thinly", "finely", "roughly", "coarsely", "ground", "melted", "softened", "room", "temperature", "large",
  "medium", "small", "extra", "virgin", "whole", "cold", "warm", "hot", "cut", "peeled", "rinsed", "drained",
  "beaten", "grated", "shredded", "cubed", "crushed", "toasted", "raw", "dried", "frozen", "canned",
  "boneless", "skinless", "ripe", "juice", "juiced", "zest", "zested", "red", "green", "yellow", "white",
  "black", "brown", "pieces", "piece", "inch", "inches", "cm", "thin", "thick", "halved", "quartered",
  "trimmed", "stemmed", "seeded", "pitted", "lightly", "well", "plain", "unsalted", "salted", "low",
  "sodium", "fat", "free", "organic", "handful", "pinch", "dash", "bunch", "sprig", "sprigs", "leaves",
]);

/**
 * The food a line names: after its amount and unit, with anything in brackets
 * (a can's size, an equivalent) taken out, and before a comma.
 */
export function foodWords(line: string): string[] {
  const read = readLine(line);
  const rest = read.scales
    ? read.pieces
        .filter((piece) => piece.kind === "text" || piece.kind === "counted")
        .map((piece) => piece.text)
        .join("")
    : line;
  const food = rest.replace(/\([^)]*\)/g, " ").split(/[,;]/)[0];
  return food
    .toLowerCase()
    .split(/[^a-zà-ÿ'-]+/)
    .map((word) => word.replace(/^['-]+|['-]+$/g, ""))
    .filter((word) => word.length >= 3 && !DESCRIBING.has(word));
}

function named(text: string, word: string): boolean {
  const stem = word.replace(/(?:es|s)$/, "");
  const root = stem.length >= 3 ? stem : word;
  return new RegExp(`(?<![a-z])${root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:s|es)?(?![a-z])`, "i").test(text);
}

/**
 * The indices of the ingredient lines a step names, in the recipe's order.
 * Headings never count.
 */
export function stepUses(step: string, ingredients: readonly FoodLine[]): number[] {
  const words = ingredients.map((line) => (line.heading ? [] : foodWords(line.text)));
  const counts = new Map<string, number>();
  for (const list of words) for (const word of new Set(list)) counts.set(word, (counts.get(word) ?? 0) + 1);
  const used: number[] = [];
  words.forEach((list, i) => {
    if (list.length === 0) return;
    const phrase = list.join(" ");
    const whole = list.length > 1 && named(step, phrase);
    const own = list.some((word) => (counts.get(word) ?? 0) === 1 && named(step, word));
    if (whole || own) used.push(i);
  });
  return used;
}
