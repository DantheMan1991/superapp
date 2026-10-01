/**
 * A RECIPE PAGE, READ (D1, ADR 0123).
 *
 * Most recipe pages carry the recipe a second time, as data for search
 * engines: a schema.org `Recipe` in a `<script type="application/ld+json">`.
 * When a page has one, this reads the recipe from it exactly, with no model
 * and no guessing. When it has none, `pageText` gives Claude the page's words
 * instead, and `pageImage` its photo. A page that answers with a bot check is
 * recognised as one (`looksBlocked`) and never got around.
 *
 * Pure: the server fetches (`src/lib/net/fetch-page.ts`), this only reads
 * text, so every shape a site sends is tested on invented pages.
 */

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  frac12: "½",
  frac14: "¼",
  frac34: "¾",
  frac13: "⅓",
  frac23: "⅔",
  frac18: "⅛",
  deg: "°",
  ndash: "–",
  mdash: "—",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  hellip: "…",
  times: "×",
  eacute: "é",
  egrave: "è",
  ecirc: "ê",
  aacute: "á",
  agrave: "à",
  iacute: "í",
  oacute: "ó",
  uacute: "ú",
  ntilde: "ñ",
  ccedil: "ç",
  uuml: "ü",
  ouml: "ö",
  auml: "ä",
  szlig: "ß",
  reg: "®",
  copy: "©",
  trade: "™",
};

/** HTML entities to characters: named ones a recipe uses, and every numeric one. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED[body.toLowerCase()] ?? whole;
  });
}

/** Text from a snippet of HTML: tags out, entities decoded, spaces tidied. */
export function plainText(html: string): string {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(?:p|li|div|h[1-6])>/gi, "\n")
      .replace(/<[^>]*>/g, " "),
  )
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/** Every JSON-LD block on the page that parses. A block that does not is skipped, not fatal. */
export function jsonLdBlocks(html: string): unknown[] {
  const out: unknown[] = [];
  const pattern = /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script\s*>/gi;
  for (const match of html.matchAll(pattern)) {
    const body = match[1]
      .trim()
      .replace(/^<!--/, "")
      .replace(/-->$/, "")
      .replace(/^\/\/\s*<!\[CDATA\[/, "")
      .replace(/\/\/\s*\]\]>$/, "")
      .trim();
    if (!body) continue;
    try {
      out.push(JSON.parse(body));
    } catch {
      // Raw line breaks inside strings are the commonest fault in the wild.
      try {
        out.push(JSON.parse(body.replace(/[\u0000-\u001f]+/g, " ")));
      } catch {
        // Not data this can read; the page's words are still there for Claude.
      }
    }
  }
  return out;
}

function isRecipeType(type: unknown): boolean {
  const types = Array.isArray(type) ? type : [type];
  return types.some((t) => typeof t === "string" && /(^|[/:])Recipe$/.test(t));
}

/** The first schema.org Recipe in the blocks: at the top, in `@graph`, under `mainEntity` or in a list. */
export function findRecipe(blocks: readonly unknown[]): Record<string, unknown> | null {
  let seen = 0;
  const walk = (value: unknown, depth: number): Record<string, unknown> | null => {
    if (depth > 6 || seen > 2_000 || value === null || typeof value !== "object") return null;
    seen += 1;
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = walk(item, depth + 1);
        if (found) return found;
      }
      return null;
    }
    const node = value as Record<string, unknown>;
    if (isRecipeType(node["@type"])) return node;
    for (const key of ["@graph", "mainEntity", "mainEntityOfPage", "itemListElement", "item"]) {
      if (key in node) {
        const found = walk(node[key], depth + 1);
        if (found) return found;
      }
    }
    return null;
  };
  for (const block of blocks) {
    const found = walk(block, 0);
    if (found) return found;
  }
  return null;
}

/** ISO 8601 durations ("PT1H30M", "P1DT2H", "PT90M") and the plain words some sites write instead, as minutes. */
export function durationMinutes(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.round(value);
  if (typeof value !== "string") return null;
  const text = value.trim();
  const iso = /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i.exec(text);
  if (iso && text.length > 1 && text.toUpperCase() !== "PT") {
    const [, d, h, m, s] = iso;
    const total = Number(d ?? 0) * 1440 + Number(h ?? 0) * 60 + Number(m ?? 0) + Number(s ?? 0) / 60;
    return Number.isFinite(total) ? Math.round(total) : null;
  }
  let total = 0;
  let any = false;
  for (const match of text.matchAll(/(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m)\b/gi)) {
    any = true;
    total += /^h/i.test(match[2]) ? Number(match[1]) * 60 : Number(match[1]);
  }
  return any ? Math.round(total) : null;
}

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (typeof value === "number") return [String(value)];
  if (Array.isArray(value)) return value.flatMap(strings);
  return [];
}

/** "4 servings", "Serves 4", "Makes 24 cookies", 4, ["4", "4 servings"]: an amount and what it is. */
export function readYield(value: unknown): { amount: number; unit: string | null } | null {
  const candidates = strings(value)
    .map((text) => plainText(text))
    .map((text) => {
      const m = /(\d+(?:[.,]\d+)?)(?:\s*(?:-|–|to)\s*\d+(?:[.,]\d+)?)?\s*([A-Za-z][A-Za-z ]{0,30})?/.exec(text);
      if (!m) return null;
      const amount = Number(m[1].replace(",", "."));
      const unit = (m[2] ?? "").trim().replace(/\s+/g, " ") || null;
      return amount > 0 ? { amount, unit } : null;
    })
    .filter((found): found is { amount: number; unit: string | null } => found !== null);
  return candidates.find((found) => found.unit) ?? candidates[0] ?? null;
}

function textOf(value: unknown): string {
  if (typeof value === "string") return plainText(value);
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const node = value as Record<string, unknown>;
    return textOf(node.text ?? node.name ?? "");
  }
  return "";
}

/** A loose line, the shape the draft's reader takes from Claude and from here alike. */
interface LooseLine {
  text: string;
  heading?: boolean;
}

/** `recipeInstructions` in every shape sites use: one string, strings, HowToSteps, HowToSections. */
export function readInstructions(value: unknown, depth = 0): LooseLine[] {
  if (depth > 4) return [];
  if (typeof value === "string") {
    return plainText(value)
      .split("\n")
      .map((text) => ({ text }))
      .filter((line) => line.text);
  }
  if (Array.isArray(value)) return value.flatMap((item) => readInstructions(item, depth + 1));
  if (!value || typeof value !== "object") return [];
  const node = value as Record<string, unknown>;
  const types = Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]];
  if (types.includes("HowToSection") || (node.itemListElement && !node.text)) {
    const name = typeof node.name === "string" ? plainText(node.name) : "";
    const inner = readInstructions(node.itemListElement, depth + 1);
    return name ? [{ text: name, heading: true }, ...inner] : inner;
  }
  const text = textOf(node);
  return text ? text.split("\n").map((part) => ({ text: part })) : [];
}

/** One nutrition value: "410 calories", "34 g", "34g", "0.56 g" of sodium as 560 mg. */
function nutritionNumber(value: unknown, as: "kcal" | "g" | "mg"): number | undefined {
  const text = strings(value)[0];
  if (!text) return undefined;
  const m = /(\d+(?:[.,]\d+)?)\s*(kcal|cal|calories|mg|g|grams?|milligrams?)?/i.exec(text);
  if (!m) return undefined;
  let amount = Number(m[1].replace(",", "."));
  const unit = (m[2] ?? "").toLowerCase();
  if (as === "mg" && (unit === "g" || unit.startsWith("gram"))) amount *= 1000;
  if (as === "g" && (unit === "mg" || unit.startsWith("milligram"))) amount /= 1000;
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 10) / 10 : undefined;
}

export function readNutrition(value: unknown): Record<string, number> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const node = value as Record<string, unknown>;
  const out: Record<string, number | undefined> = {
    calories: nutritionNumber(node.calories, "kcal"),
    protein_g: nutritionNumber(node.proteinContent, "g"),
    carbs_g: nutritionNumber(node.carbohydrateContent, "g"),
    fat_g: nutritionNumber(node.fatContent, "g"),
    fiber_g: nutritionNumber(node.fiberContent, "g"),
    sugar_g: nutritionNumber(node.sugarContent, "g"),
    sodium_mg: nutritionNumber(node.sodiumContent, "mg"),
  };
  const kept = Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined)) as Record<string, number>;
  return Object.keys(kept).length > 0 ? kept : null;
}

/** A web address on the page, made absolute against the page's own. */
export function absoluteUrl(value: string, base: string): string | null {
  try {
    const url = new URL(decodeEntities(value.trim()), base);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function imageOf(value: unknown, base: string): string | null {
  if (typeof value === "string") return absoluteUrl(value, base);
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = imageOf(item, base);
      if (found) return found;
    }
    return null;
  }
  if (value && typeof value === "object") {
    const node = value as Record<string, unknown>;
    return imageOf(node.url ?? node.contentUrl ?? null, base);
  }
  return null;
}

/**
 * What a schema.org Recipe says, in the loose shape the draft reader takes
 * (`normalizeDraft`, the same one Claude's answer goes through), and its photo.
 */
export function draftFromRecipeData(
  recipe: Record<string, unknown>,
  pageUrl: string,
): { draft: Record<string, unknown>; imageUrl: string | null } {
  const yielded = readYield(recipe.recipeYield ?? recipe.yield);
  const tags = [...strings(recipe.recipeCategory), ...strings(recipe.recipeCuisine)]
    .flatMap((tag) => plainText(tag).split(","))
    .map((tag) => tag.trim())
    .filter(Boolean);
  return {
    draft: {
      found: true,
      title: typeof recipe.name === "string" ? plainText(recipe.name) : "",
      yield_amount: yielded?.amount ?? null,
      yield_unit: yielded?.unit ?? null,
      prep_minutes: durationMinutes(recipe.prepTime),
      cook_minutes: durationMinutes(recipe.cookTime),
      total_minutes: durationMinutes(recipe.totalTime),
      tags,
      ingredients: strings(recipe.recipeIngredient ?? recipe.ingredients).map((text) => ({ text: plainText(text) })),
      steps: readInstructions(recipe.recipeInstructions),
      notes: null,
      nutrition: readNutrition(recipe.nutrition),
    },
    imageUrl: imageOf(recipe.image, pageUrl),
  };
}

/** The attributes of each `<meta>` tag, lower-cased names. */
function metaTags(html: string): Array<Record<string, string>> {
  const out: Array<Record<string, string>> = [];
  for (const match of html.matchAll(/<meta\b([^>]*)>/gi)) {
    const attributes: Record<string, string> = {};
    for (const attr of match[1].matchAll(/([a-z:_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi)) {
      attributes[attr[1].toLowerCase()] = attr[2] ?? attr[3] ?? attr[4] ?? "";
    }
    out.push(attributes);
  }
  return out;
}

function metaContent(html: string, names: readonly string[]): string | null {
  for (const tag of metaTags(html)) {
    const key = (tag.property ?? tag.name ?? "").toLowerCase();
    if (names.includes(key) && tag.content) return decodeEntities(tag.content).trim();
  }
  return null;
}

/** The page's own photo (`og:image`), for a recipe Claude read from the words. */
export function pageImage(html: string, base: string): string | null {
  const found = metaContent(html, ["og:image", "og:image:url", "og:image:secure_url", "twitter:image"]);
  return found ? absoluteUrl(found, base) : null;
}

/** The page's title, for the prompt. */
export function pageTitle(html: string): string | null {
  const og = metaContent(html, ["og:title"]);
  if (og) return og;
  const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return title ? plainText(title[1]) || null : null;
}

/** How much of a page's words go to Claude: a whole recipe and its comments, and then some. */
export const PAGE_TEXT_LIMIT = 60_000;

/**
 * The words a person would see on the page, a line per block, for Claude:
 * scripts, styles, the navigation and the footer taken out first.
 */
export function pageText(html: string): string {
  const body = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template|iframe|head|nav|footer|form|select)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<(br|hr)\b[^>]*>/gi, "\n")
    .replace(/<\/(p|div|li|ul|ol|h[1-6]|tr|section|article|header|aside|table|blockquote|figcaption|dd|dt)>/gi, "\n")
    .replace(/<[^>]*>/g, " ");
  return decodeEntities(body)
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, PAGE_TEXT_LIMIT);
}

/**
 * True when the answer is a bot check, not the page: a challenge page, a
 * captcha, or a refusal. The person is told to copy the recipe instead; the
 * app never tries to get past one.
 */
export function looksBlocked(status: number, html: string): boolean {
  if (status === 403 || status === 429) return true;
  const head = html.slice(0, 20_000).toLowerCase();
  const markers = [
    "cf-browser-verification",
    "cf_chl_",
    "challenge-platform",
    "<title>just a moment",
    "attention required! | cloudflare",
    "px-captcha",
    "g-recaptcha",
    "h-captcha",
    "captcha-delivery",
    "are you a robot",
    "verify you are human",
    "access denied</title>",
  ];
  return markers.some((marker) => head.includes(marker));
}
