import { describe, expect, it } from "vitest";
import {
  PICTURES_BASE64_LIMIT,
  PICTURE_BASE64_LIMIT,
  buildReadPrompt,
  normalizeDraft,
  picturesFit,
} from "../src/modules/food/core/draft";
import { fromEditor, linesOfText, readNumber, textOfLines, toEditor, type EditorRecipe } from "../src/modules/food/core/editor";
import { FOOD_MESSAGES } from "../src/modules/food/core/errors";
import {
  cleanIngredient,
  cleanStep,
  emptyRecipe,
  hostOf,
  minutesWords,
  recipeInputSchema,
  timeOf,
  uniqueTags,
  yieldWords,
  type RecipeInput,
} from "../src/modules/food/core/recipe";
import {
  decodeEntities,
  draftFromRecipeData,
  durationMinutes,
  findRecipe,
  jsonLdBlocks,
  looksBlocked,
  pageImage,
  pageText,
  pageTitle,
  readInstructions,
  readNutrition,
  readYield,
} from "../src/modules/food/core/recipe-page";

/**
 * FOOD D1 (docs/modules/food.md): a recipe page read from its own recipe data,
 * a draft read back from Claude's answer, and the editor's form both ways with
 * every message its guide lists. Invented recipes and invented pages only.
 */

const PAGE_URL = "https://recipes.example/lemon-herb-chicken";

/** An invented recipe page, shaped the way recipe sites send theirs. */
function recipePage(recipe: Record<string, unknown>, extra = ""): string {
  return `<!doctype html><html><head>
<title>Lemon Herb Chicken | Recipes Example</title>
<meta property="og:image" content="/img/chicken.jpg">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"WebSite","name":"Recipes Example"}</script>
<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": [{ "@type": "Organization", name: "Recipes Example" }, recipe] })}</script>
${extra}
</head><body><nav>Home · Dinners · Desserts</nav><article><h1>Lemon Herb Chicken</h1><p>A bright weeknight dinner.</p></article><footer>© Recipes Example</footer></body></html>`;
}

const CHICKEN = {
  "@type": ["Recipe"],
  name: "Lemon Herb Chicken",
  image: [{ "@type": "ImageObject", url: "https://recipes.example/img/chicken-1x1.jpg" }],
  recipeYield: ["4", "4 servings"],
  prepTime: "PT15M",
  cookTime: "PT20M",
  totalTime: "PT35M",
  recipeCategory: "Dinner",
  recipeCuisine: ["Mediterranean"],
  recipeIngredient: [
    "1 &frac12; lb chicken thighs",
    "2 tbsp olive oil",
    "1 lemon, juiced",
    "3 cloves garlic, minced",
    "salt and pepper to taste",
  ],
  recipeInstructions: [
    { "@type": "HowToStep", text: "Mix the oil, lemon and garlic." },
    { "@type": "HowToStep", text: "<p>Coat the chicken and rest it 10 minutes.</p>" },
    { "@type": "HowToStep", text: "Roast at 425&deg;F for 20 minutes." },
  ],
  nutrition: {
    "@type": "NutritionInformation",
    calories: "410 kcal",
    proteinContent: "34 g",
    carbohydrateContent: "12g",
    fatContent: "24 g",
    sodiumContent: "0.56 g",
  },
};

describe("a recipe page's own recipe data", () => {
  it("finds the Recipe among the page's blocks, in its @graph", () => {
    const found = findRecipe(jsonLdBlocks(recipePage(CHICKEN)));
    expect(found?.name).toBe("Lemon Herb Chicken");
  });

  it("reads it into a draft exactly, with its photo", () => {
    const { draft, imageUrl } = draftFromRecipeData(CHICKEN, PAGE_URL);
    const { found, recipe } = normalizeDraft(draft, PAGE_URL);
    expect(found).toBe(true);
    expect(imageUrl).toBe("https://recipes.example/img/chicken-1x1.jpg");
    expect(recipe).toEqual<RecipeInput>({
      title: "Lemon Herb Chicken",
      yieldAmount: 4,
      yieldUnit: "servings",
      prepMinutes: 15,
      cookMinutes: 20,
      totalMinutes: 35,
      tags: ["Dinner", "Mediterranean"],
      ingredients: [
        { text: "1 ½ lb chicken thighs" },
        { text: "2 tbsp olive oil" },
        { text: "1 lemon, juiced" },
        { text: "3 cloves garlic, minced" },
        { text: "salt and pepper to taste" },
      ],
      steps: [
        { text: "Mix the oil, lemon and garlic." },
        { text: "Coat the chicken and rest it 10 minutes." },
        { text: "Roast at 425°F for 20 minutes." },
      ],
      notes: null,
      nutrition: { calories: 410, proteinG: 34, carbsG: 12, fatG: 24, sodiumMg: 560 },
      sourceUrl: PAGE_URL,
    });
    expect(recipeInputSchema.safeParse(recipe).success).toBe(true);
  });

  it("skips a block that does not parse, and reads one with raw line breaks in its strings", () => {
    const html = `<script type="application/ld+json">{ not json </script>
<script type="application/ld+json">
<!--
{"@type":"Recipe","name":"Two
lines","recipeIngredient":["1 cup oats"]}
-->
</script>`;
    const blocks = jsonLdBlocks(html);
    expect(blocks).toHaveLength(1);
    expect(findRecipe(blocks)?.name).toBe("Two lines");
  });

  it("finds a recipe under mainEntity, or with a schema.org type URL", () => {
    expect(findRecipe([{ "@type": "WebPage", mainEntity: { "@type": "Recipe", name: "A" } }])?.name).toBe("A");
    expect(findRecipe([{ "@type": "http://schema.org/Recipe", name: "B" }])?.name).toBe("B");
    expect(findRecipe([{ "@type": "Article", name: "C" }])).toBeNull();
  });

  it.each([
    ["PT1H30M", 90],
    ["PT90M", 90],
    ["P0DT0H20M", 20],
    ["P1DT2H", 1560],
    ["PT0.5H", 30],
    ["1 hour 10 minutes", 70],
    ["45 mins", 45],
    [25, 25],
    ["PT", null],
    ["soon", null],
  ] as const)("reads %s as %s minutes", (value, minutes) => {
    expect(durationMinutes(value)).toBe(minutes);
  });

  it.each([
    [["4", "4 servings"], { amount: 4, unit: "servings" }],
    ["Serves 6", { amount: 6, unit: null }],
    ["Makes 24 cookies", { amount: 24, unit: "cookies" }],
    ["4-6 servings", { amount: 4, unit: "servings" }],
    [8, { amount: 8, unit: null }],
    ["1 loaf (12 slices)", { amount: 1, unit: "loaf" }],
    ["some", null],
  ] as const)("reads the yield %j", (value, expected) => {
    expect(readYield(value)).toEqual(expected);
  });

  it("reads instructions in every shape: a string, strings, steps and sections", () => {
    expect(readInstructions("Mix it.\nBake it.")).toEqual([{ text: "Mix it." }, { text: "Bake it." }]);
    expect(readInstructions("<ol><li>Mix it.</li><li>Bake it.</li></ol>")).toEqual([
      { text: "Mix it." },
      { text: "Bake it." },
    ]);
    expect(
      readInstructions([
        {
          "@type": "HowToSection",
          name: "For the sauce",
          itemListElement: [{ "@type": "HowToStep", text: "Whisk the dressing." }],
        },
        { "@type": "HowToStep", name: "Serve it." },
      ]),
    ).toEqual([{ text: "For the sauce", heading: true }, { text: "Whisk the dressing." }, { text: "Serve it." }]);
  });

  it("reads nutrition strings as numbers, sodium in milligrams", () => {
    expect(readNutrition({ calories: "410 calories", sodiumContent: "560 mg", fiberContent: "3.5 g" })).toEqual({
      calories: 410,
      sodium_mg: 560,
      fiber_g: 3.5,
    });
    expect(readNutrition({ "@type": "NutritionInformation" })).toBeNull();
    expect(readNutrition("410")).toBeNull();
  });

  it("decodes entities, named and numeric", () => {
    expect(decodeEntities("Mac &amp; cheese &#8211; &#x2019;s &frac34; cup &unknown;")).toBe("Mac & cheese – ’s ¾ cup &unknown;");
  });
});

describe("a page without recipe data, for Claude", () => {
  it("gives the page's words, without its scripts, navigation and footer", () => {
    const text = pageText(recipePage(CHICKEN));
    expect(text).toContain("Lemon Herb Chicken");
    expect(text).toContain("A bright weeknight dinner.");
    expect(text).not.toContain("Desserts");
    expect(text).not.toContain("schema.org");
    expect(text).not.toContain("©");
  });

  it("gives the page's title and its photo, made absolute", () => {
    const html = recipePage(CHICKEN, '<meta property="og:title" content="Lemon Herb Chicken &amp; Rice">');
    expect(pageTitle(html)).toBe("Lemon Herb Chicken & Rice");
    expect(pageImage(html, PAGE_URL)).toBe("https://recipes.example/img/chicken.jpg");
    expect(pageTitle("<title> Plain </title>")).toBe("Plain");
  });

  it("knows a bot check when it gets one", () => {
    expect(looksBlocked(403, "")).toBe(true);
    expect(looksBlocked(429, "")).toBe(true);
    expect(looksBlocked(200, "<html><title>Just a moment...</title>")).toBe(true);
    expect(looksBlocked(503, '<div id="cf-browser-verification">')).toBe(true);
    expect(looksBlocked(200, recipePage(CHICKEN))).toBe(false);
    expect(looksBlocked(404, "<title>Not found</title>")).toBe(false);
  });
});

describe("Claude's answer, read back", () => {
  it("takes the tool's snake case, cleans the lines, and finds the headings", () => {
    const { found, recipe } = normalizeDraft(
      {
        found: true,
        title: "  Overnight   oats ",
        yield_amount: 1,
        yield_unit: "serving",
        prep_minutes: 5.4,
        cook_minutes: null,
        total_minutes: "5",
        ingredients: [{ text: "▢ ½ cup rolled oats" }, { text: "For the topping:" }, "• 1 tbsp honey", { text: "  " }],
        steps: [{ text: "1. Stir it together." }, { text: "Step 2: Chill overnight." }, { text: "Serving", heading: true }],
        tags: ["Breakfast", "breakfast", "Quick"],
        notes: "Keeps three days.",
        nutrition: { calories: 320, protein_g: "11", made_up: 4 },
      },
      null,
    );
    expect(found).toBe(true);
    expect(recipe.title).toBe("Overnight oats");
    expect(recipe.yieldAmount).toBe(1);
    expect(recipe.yieldUnit).toBe("serving");
    expect(recipe.prepMinutes).toBe(5);
    expect(recipe.totalMinutes).toBe(5);
    expect(recipe.ingredients).toEqual([
      { text: "½ cup rolled oats" },
      { text: "For the topping", heading: true },
      { text: "1 tbsp honey" },
    ]);
    expect(recipe.steps).toEqual([
      { text: "Stir it together." },
      { text: "Chill overnight." },
      { text: "Serving", heading: true },
    ]);
    expect(recipe.tags).toEqual(["Breakfast", "Quick"]);
    expect(recipe.nutrition).toEqual({ calories: 320, proteinG: 11 });
    expect(recipe.sourceUrl).toBeNull();
  });

  it("is not found when Claude says so, or when nothing came back", () => {
    expect(normalizeDraft({ found: false, title: "", ingredients: [], steps: [] }, null).found).toBe(false);
    expect(normalizeDraft({ title: "Just a name", ingredients: [], steps: [] }, null).found).toBe(false);
    expect(normalizeDraft(null, null).found).toBe(false);
  });

  it("drops a yield's word with no number, and keeps a long word short", () => {
    expect(normalizeDraft({ yield_unit: "servings", ingredients: ["1 egg"], steps: [] }, null).recipe.yieldUnit).toBeNull();
    expect(
      normalizeDraft({ yield_amount: 4, yield_unit: "generous servings as a main course", ingredients: ["1 egg"], steps: [] }, null)
        .recipe.yieldUnit,
    ).toBe("generous servings as");
  });

  it("says what each read sends", () => {
    expect(buildReadPrompt({ kind: "page", url: PAGE_URL, title: "Lemon", text: "words" })).toContain("<page>\nwords\n</page>");
    expect(buildReadPrompt({ kind: "text", text: "pasted" })).toContain("<pasted>\npasted\n</pasted>");
    expect(buildReadPrompt({ kind: "photo", pictures: [{ jpeg: "a" }, { jpeg: "b" }] })).toBe("2 photos of a recipe, in order:");
  });

  it("lets photos through only within their limits", () => {
    expect(picturesFit([{ jpeg: "a".repeat(1000) }])).toBe(true);
    expect(picturesFit([])).toBe(false);
    expect(picturesFit(Array.from({ length: 5 }, () => ({ jpeg: "a" })))).toBe(false);
    expect(picturesFit([{ jpeg: "a".repeat(PICTURE_BASE64_LIMIT + 1) }])).toBe(false);
    const each = Math.floor(PICTURES_BASE64_LIMIT / 2) + 1;
    expect(picturesFit([{ jpeg: "a".repeat(each) }, { jpeg: "a".repeat(each) }])).toBe(false);
  });
});

describe("a recipe's small words", () => {
  it("cleans a copied line and a numbered step", () => {
    expect(cleanIngredient("▢  2  cups flour ")).toBe("2 cups flour");
    expect(cleanIngredient("- 1 egg")).toBe("1 egg");
    expect(cleanStep("3) Bake it.")).toBe("Bake it.");
    expect(cleanStep("Step 4: Rest it.")).toBe("Rest it.");
    expect(cleanStep("Step 5")).toBe("");
    expect(cleanStep("350 degrees is hot.")).toBe("350 degrees is hot.");
  });

  it("keeps tags once each, the first spelling winning", () => {
    expect(uniqueTags(["Dinner", " dinner ", "", "High  protein"])).toEqual(["Dinner", "High protein"]);
  });

  it("writes times, yields and hosts", () => {
    expect(minutesWords(35)).toBe("35 min");
    expect(minutesWords(70)).toBe("1 hr 10 min");
    expect(minutesWords(120)).toBe("2 hr");
    expect(yieldWords(4, "servings")).toBe("4 servings");
    expect(yieldWords(1, "servings")).toBe("1 serving");
    expect(yieldWords(1.5, null)).toBe("1.5 servings");
    expect(yieldWords(24, "cookies")).toBe("24 cookies");
    expect(hostOf("https://www.recipes.example/a")).toBe("recipes.example");
    expect(hostOf("not a link")).toBeNull();
    expect(timeOf({ prepMinutes: 10, cookMinutes: 20, totalMinutes: null })).toBe(30);
    expect(timeOf({ prepMinutes: null, cookMinutes: null, totalMinutes: null })).toBeNull();
  });
});

describe("the editor's form", () => {
  const chicken: RecipeInput = {
    ...emptyRecipe(),
    title: "Lemon herb chicken",
    yieldAmount: 4,
    yieldUnit: "servings",
    prepMinutes: 15,
    tags: ["Dinner"],
    ingredients: [{ text: "For the chicken", heading: true }, { text: "1 ½ lb chicken thighs" }],
    steps: [{ text: "Roast it." }],
    nutrition: { calories: 410 },
    sourceUrl: "https://recipes.example/lemon",
  };

  it("goes to the form and back unchanged", () => {
    const form = toEditor(chicken);
    expect(form.ingredients).toBe("For the chicken:\n1 ½ lb chicken thighs");
    expect(form.nutrition.calories).toBe("410");
    expect(fromEditor(form)).toEqual({ ok: true, recipe: chicken });
  });

  it("reads the boxes' lines: blank lines out, a colon a heading", () => {
    expect(linesOfText("\n2 eggs\n\nFor the sauce:\n• 1 cup milk\n", "ingredient")).toEqual([
      { text: "2 eggs" },
      { text: "For the sauce", heading: true },
      { text: "1 cup milk" },
    ]);
    expect(textOfLines([{ text: "Sauce", heading: true }, { text: "Stir." }])).toBe("Sauce:\nStir.");
  });

  it("reads a number typed in a box", () => {
    expect(readNumber("4")).toBe(4);
    expect(readNumber("1,5")).toBe(1.5);
    expect(readNumber("½")).toBe(0.5);
    expect(readNumber("")).toBeNull();
    expect(readNumber("four")).toBeNaN();
  });

  it("calls an amount with no word servings", () => {
    const form: EditorRecipe = { ...toEditor(chicken), yieldUnit: "" };
    const out = fromEditor(form);
    expect(out.ok && out.recipe.yieldUnit).toBe("servings");
  });

  it("says every problem, in the order of the form", () => {
    const form: EditorRecipe = {
      ...toEditor(emptyRecipe()),
      title: " ",
      yieldAmount: "0",
      prep: "ten",
      cook: "1.5",
      total: "20000",
      tags: ["x".repeat(41)],
      ingredients: "x".repeat(501),
      steps: "y".repeat(3001),
      notes: "z".repeat(10_001),
      nutrition: { ...toEditor(emptyRecipe()).nutrition, calories: "lots", sodiumMg: "-3" },
      sourceUrl: "recipes.example",
    };
    const out = fromEditor(form);
    expect(out.ok).toBe(false);
    expect(!out.ok && out.problems).toEqual([
      "Give the recipe a name.",
      "Write how many it makes as a number, like 4.",
      "Write the prep time as whole minutes, like 20.",
      "Write the cook time as whole minutes, like 20.",
      "Write the total time as whole minutes, like 20.",
      "Keep each tag under 40 characters.",
      "Keep each ingredient line under 500 characters.",
      "Keep each step under 3,000 characters.",
      "Keep the notes under 10,000 characters.",
      "Write calories as a number, like 12.",
      "Write sodium as a number, like 12.",
      "Write the source as a web address that starts with https://.",
    ]);
  });

  it("asks for a number when what it makes has only a word", () => {
    const out = fromEditor({ ...toEditor({ ...chicken, yieldAmount: null }), yieldUnit: "cookies" });
    expect(!out.ok && out.problems).toEqual(["Write how many it makes, like 4, or clear the word after it."]);
  });

  it("counts the lines and the tags", () => {
    const many = (n: number, word: string) => Array.from({ length: n }, (_, i) => `${word} ${i}`).join("\n");
    const out = fromEditor({
      ...toEditor(chicken),
      tags: Array.from({ length: 13 }, (_, i) => `Tag ${i}`),
      ingredients: many(151, "1 egg"),
      steps: many(101, "Stir"),
    });
    expect(!out.ok && out.problems).toEqual([
      "Keep the tags to 12 or fewer.",
      "A recipe can have up to 150 ingredient lines.",
      "A recipe can have up to 100 steps.",
    ]);
  });
});

describe("the messages", () => {
  it("has a sentence for every code, each ending in a full stop", () => {
    for (const message of Object.values(FOOD_MESSAGES)) expect(message).toMatch(/^[A-Z].*\.$/);
  });
});
