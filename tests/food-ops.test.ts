import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema, withSystem, withTenant } from "../src/db";
import type { Tenant } from "../src/db/schema";
import type { TenantContext } from "../src/lib/auth";
import type { PageFetchResult } from "../src/lib/net/fetch-page";
import type { ReadRequest } from "../src/modules/food/core/draft";
import { FOOD_MESSAGES, FoodError } from "../src/modules/food/core/errors";
import { emptyRecipe, type RecipeInput } from "../src/modules/food/core/recipe";
import {
  INTERRUPTED,
  discardImport,
  getImport,
  importDraft,
  listImports,
  readLink,
  readPhotos,
  readText,
  takeImport,
  type ReadDeps,
} from "../src/modules/food/import-ops";
import {
  deleteRecipe,
  insertRecipe,
  knownTags,
  listRecipes,
  loadRecipe,
  recipeToInput,
  updateRecipe,
} from "../src/modules/food/recipe-ops";
import { ReadModelError } from "../src/modules/food/read-model";
import { cookSummary, logCook, undoCook } from "../src/modules/food/cook-ops";
import type { StoredPhoto } from "../src/modules/food/photo-ops";

/**
 * Food against a real database (docs/modules/food.md, D1): recipes saved,
 * edited and deleted whole, and recipes read from a link, a paste and photos
 * of a page into drafts, with the page fetch, the photo and the Claude call
 * each replaced by a function. Invented recipes only.
 */

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;
const STAMP = `food-ops-${process.pid}`;
const LINK = "https://recipes.example/overnight-oats";

let tenant: Tenant;
let ctx: TenantContext;

function oats(): RecipeInput {
  return {
    ...emptyRecipe(),
    title: "Overnight oats",
    yieldAmount: 1,
    yieldUnit: "serving",
    prepMinutes: 5,
    tags: ["Breakfast", "Quick"],
    ingredients: [{ text: "½ cup rolled oats" }, { text: "For the top", heading: true }, { text: "1 tbsp honey" }],
    steps: [{ text: "Stir it together." }, { text: "Chill overnight." }],
    nutrition: { calories: 320, proteinG: 11 },
    sourceUrl: LINK,
  };
}

function page(html: string): ReadDeps["fetch"] {
  return async (): Promise<PageFetchResult> => ({ ok: true, url: LINK, html });
}

const WITH_DATA = `<html><head><script type="application/ld+json">${JSON.stringify({
  "@type": "Recipe",
  name: "Overnight oats",
  recipeYield: "1 serving",
  recipeIngredient: ["½ cup rolled oats", "1 tbsp honey"],
  recipeInstructions: "Stir it together.\nChill overnight.",
  image: "https://recipes.example/oats.jpg",
})}</script></head><body>Oats</body></html>`;

const WITHOUT_DATA = "<html><head><title>Oats, my way</title></head><body><p>Oats and honey, chilled.</p></body></html>";

function fakePhoto(): StoredPhoto {
  return { pathname: `food/${tenant.id}/photos/recipe-test.jpg`, width: 1600, height: 1200 };
}

function deps(overrides: Partial<ReadDeps>): ReadDeps {
  return {
    model: async () => {
      throw new Error("the model should not have been called");
    },
    fetch: page(WITH_DATA),
    photo: async () => null,
    ...overrides,
  };
}

/** A model that answers with a recipe, and remembers what it was asked. */
function answering(asked: ReadRequest[]) {
  return async (request: ReadRequest) => {
    asked.push(request);
    return {
      found: true,
      title: "Honey oats",
      yield_amount: 2,
      ingredients: [{ text: "1 cup oats" }],
      steps: [{ text: "Stir." }],
      tags: [],
    };
  };
}

async function clearImports() {
  await withSystem((tx) => tx.delete(schema.foodImports).where(eq(schema.foodImports.tenantId, tenant.id)));
}

d("food (db)", () => {
  beforeAll(async () => {
    tenant = await withSystem(async (tx) => {
      const [row] = await tx
        .insert(schema.tenants)
        .values({
          clerkOrgId: `${STAMP}-org`,
          name: "Personal",
          slug: `${STAMP}-slug`,
          kind: "personal",
          personalOwnerClerkUserId: `user_foodops${process.pid}`,
        })
        .returning();
      return row;
    });
    ctx = { tenant, userId: `user_foodops${process.pid}`, role: "owner", support: null };
  });

  afterAll(async () => {
    if (tenant) await withSystem((tx) => tx.delete(schema.tenants).where(eq(schema.tenants.id, tenant.id)));
  });

  describe("recipes", () => {
    it("are saved whole, listed by name, edited, and deleted with their photo's pathname", async () => {
      const id = await withTenant(tenant.id, (tx) => insertRecipe(tx, ctx, oats(), fakePhoto()));
      const loaded = await withTenant(tenant.id, (tx) => loadRecipe(tx, tenant.id, id));
      expect(loaded && recipeToInput(loaded)).toEqual(oats());
      expect(loaded?.photoPathname).toBe(fakePhoto().pathname);

      const second = await withTenant(tenant.id, (tx) =>
        insertRecipe(tx, ctx, { ...oats(), title: "apple crumble", tags: ["Dessert"], sourceUrl: null }, null),
      );
      const list = await withTenant(tenant.id, (tx) => listRecipes(tx, tenant.id));
      expect(list.map((r) => r.title)).toEqual(["apple crumble", "Overnight oats"]);
      const listed = list.find((r) => r.id === id);
      expect(listed?.minutes).toBe(5);
      expect(listed?.photoUrl).toMatch(new RegExp(`^/personal/m/food/recipes/${id}/photo\\?v=`));
      expect(listed?.search).toContain("rolled oats");
      expect(await withTenant(tenant.id, (tx) => knownTags(tx, tenant.id))).toEqual(["Breakfast", "Dessert", "Quick"]);

      const kept = await withTenant(tenant.id, (tx) =>
        updateRecipe(tx, tenant.id, id, { ...oats(), title: "Oats overnight" }, "keep"),
      );
      expect(kept.replaced).toBeNull();
      const removed = await withTenant(tenant.id, (tx) => updateRecipe(tx, tenant.id, id, oats(), null));
      expect(removed.replaced).toBe(fakePhoto().pathname);
      const after = await withTenant(tenant.id, (tx) => loadRecipe(tx, tenant.id, id));
      expect(after?.photoPathname).toBeNull();
      expect(after?.photoWidth).toBeNull();

      await expect(
        withTenant(tenant.id, (tx) => updateRecipe(tx, tenant.id, crypto.randomUUID(), oats(), "keep")),
      ).rejects.toMatchObject({ code: "RECIPE_MISSING" });

      expect(await withTenant(tenant.id, (tx) => deleteRecipe(tx, tenant.id, id))).toBeNull();
      expect(await withTenant(tenant.id, (tx) => deleteRecipe(tx, tenant.id, second))).toBeNull();
      await expect(withTenant(tenant.id, (tx) => deleteRecipe(tx, tenant.id, id))).rejects.toBeInstanceOf(FoodError);
    });

    it("refuse a photo given only in part", async () => {
      await expect(
        withTenant(tenant.id, (tx) =>
          tx.insert(schema.foodRecipes).values({
            tenantId: tenant.id,
            title: "Half a photo",
            photoPathname: "food/x/photos/a.jpg",
            createdByClerkUserId: ctx.userId,
          }),
        ),
      ).rejects.toThrow();
    });
  });

  describe("cooking it (D1b)", () => {
    it("logs a cook once however often it is sent, on the space's day, and undoes it", async () => {
      const recipeId = await withTenant(tenant.id, (tx) => insertRecipe(tx, ctx, oats(), null));
      const cookId = crypto.randomUUID();
      // 23:30 in UTC is already tomorrow in Auckland: the space's clock decides the day.
      const late = new Date("2026-10-01T23:30:00Z");
      const spaced = { ...ctx, tenant: { ...ctx.tenant, timezone: "Pacific/Auckland" } };
      const first = await withTenant(tenant.id, (tx) => logCook(tx, spaced, { cookId, recipeId, servings: 2 }, late));
      expect(first.madeOn).toBe("2026-10-02");
      const again = await withTenant(tenant.id, (tx) => logCook(tx, spaced, { cookId, recipeId, servings: 2 }));
      expect(again.madeOn).toBe("2026-10-02");
      expect(await withTenant(tenant.id, (tx) => cookSummary(tx, tenant.id, recipeId))).toEqual({
        count: 1,
        lastOn: "2026-10-02",
      });

      await withTenant(tenant.id, (tx) =>
        logCook(tx, ctx, { cookId: crypto.randomUUID(), recipeId, servings: null }, new Date("2026-09-20T12:00:00Z")),
      );
      expect(await withTenant(tenant.id, (tx) => cookSummary(tx, tenant.id, recipeId))).toEqual({
        count: 2,
        lastOn: "2026-10-02",
      });
      const listed = (await withTenant(tenant.id, (tx) => listRecipes(tx, tenant.id))).find((r) => r.id === recipeId);
      expect(listed?.made).toBe(2);

      await withTenant(tenant.id, (tx) => undoCook(tx, tenant.id, cookId));
      await withTenant(tenant.id, (tx) => undoCook(tx, tenant.id, cookId));
      expect(await withTenant(tenant.id, (tx) => cookSummary(tx, tenant.id, recipeId))).toEqual({
        count: 1,
        lastOn: "2026-09-20",
      });

      // Deleting the recipe takes its cooks with it.
      await withTenant(tenant.id, (tx) => deleteRecipe(tx, tenant.id, recipeId));
      const left = await withSystem((tx) =>
        tx.select({ id: schema.foodCooks.id }).from(schema.foodCooks).where(eq(schema.foodCooks.recipeId, recipeId)),
      );
      expect(left).toEqual([]);
    });

    it("refuses a cook for a recipe that is not there, or an id already used for another", async () => {
      await expect(
        withTenant(tenant.id, (tx) =>
          logCook(tx, ctx, { cookId: crypto.randomUUID(), recipeId: crypto.randomUUID(), servings: null }),
        ),
      ).rejects.toMatchObject({ code: "RECIPE_MISSING" });
      const a = await withTenant(tenant.id, (tx) => insertRecipe(tx, ctx, oats(), null));
      const b = await withTenant(tenant.id, (tx) => insertRecipe(tx, ctx, { ...oats(), title: "Other oats" }, null));
      const cookId = crypto.randomUUID();
      await withTenant(tenant.id, (tx) => logCook(tx, ctx, { cookId, recipeId: a, servings: null }));
      await expect(
        withTenant(tenant.id, (tx) => logCook(tx, ctx, { cookId, recipeId: b, servings: null })),
      ).rejects.toMatchObject({ code: "INVALID" });
      await withTenant(tenant.id, async (tx) => {
        await deleteRecipe(tx, tenant.id, a);
        await deleteRecipe(tx, tenant.id, b);
      });
    });
  });

  describe("reading a link", () => {
    it("reads a page's own recipe data into a draft at once, with its photo, and no model", async () => {
      await clearImports();
      const result = await readLink(ctx, LINK, deps({ photo: async () => fakePhoto() }));
      expect("importId" in result && !("error" in result)).toBe(true);
      const row = "importId" in result && result.importId ? await withTenant(tenant.id, (tx) => getImport(tx, tenant.id, result.importId!)) : null;
      expect(row?.status).toBe("draft");
      expect(row?.kind).toBe("link");
      expect(row?.sourceUrl).toBe(LINK);
      expect(row?.photoPathname).toBe(fakePhoto().pathname);
      const draft = row ? importDraft(row) : null;
      expect(draft?.title).toBe("Overnight oats");
      expect(draft?.ingredients).toEqual([{ text: "½ cup rolled oats" }, { text: "1 tbsp honey" }]);
      expect(draft?.steps).toEqual([{ text: "Stir it together." }, { text: "Chill overnight." }]);
      expect(draft?.sourceUrl).toBe(LINK);

      // Saving takes the draft, and the row goes with it.
      const taken = await withTenant(tenant.id, (tx) => takeImport(tx, tenant.id, row!.id));
      expect(taken.photo).toEqual(fakePhoto());
      expect(await withTenant(tenant.id, (tx) => getImport(tx, tenant.id, row!.id))).toBeNull();
      await expect(withTenant(tenant.id, (tx) => takeImport(tx, tenant.id, row!.id))).rejects.toMatchObject({
        code: "IMPORT_MISSING",
      });
    });

    it("sends a page without recipe data to Claude as words, with its title", async () => {
      await clearImports();
      const asked: ReadRequest[] = [];
      const result = await readLink(ctx, LINK, deps({ fetch: page(WITHOUT_DATA), model: answering(asked) }));
      expect(asked).toHaveLength(1);
      expect(asked[0]).toMatchObject({ kind: "page", url: LINK, title: "Oats, my way" });
      expect(asked[0].kind === "page" && asked[0].text).toContain("Oats and honey, chilled.");
      const row = "importId" in result && result.importId ? await withTenant(tenant.id, (tx) => getImport(tx, tenant.id, result.importId!)) : null;
      expect(row?.status).toBe("draft");
      expect(row && importDraft(row)?.title).toBe("Honey oats");
    });

    it("says why a link could not be read, and leaves nothing behind", async () => {
      await clearImports();
      const cases: Array<[PageFetchResult, string]> = [
        [{ ok: false, reason: "status", status: 403, html: "" }, FOOD_MESSAGES.BLOCKED],
        [{ ok: false, reason: "status", status: 503, html: "<title>Just a moment...</title>" }, FOOD_MESSAGES.BLOCKED],
        [{ ok: false, reason: "status", status: 404, html: "<title>Not found</title>" }, FOOD_MESSAGES.UNREACHABLE],
        [{ ok: false, reason: "unreachable" }, FOOD_MESSAGES.UNREACHABLE],
        [{ ok: false, reason: "too large" }, FOOD_MESSAGES.TOO_LARGE],
        [{ ok: false, reason: "not a page" }, FOOD_MESSAGES.NOT_A_PAGE],
        [{ ok: false, reason: "invalid" }, FOOD_MESSAGES.BAD_LINK],
        [{ ok: true, url: LINK, html: "<title>Just a moment...</title>" }, FOOD_MESSAGES.BLOCKED],
      ];
      for (const [fetched, message] of cases) {
        const result = await readLink(ctx, LINK, deps({ fetch: async () => fetched }));
        expect(result).toEqual({ error: message });
      }
      expect(await readLink(ctx, "recipes.example/oats", deps({}))).toEqual({ error: FOOD_MESSAGES.BAD_LINK });
      expect(await readLink(ctx, "http://127.0.0.1/oats", deps({}))).toEqual({ error: FOOD_MESSAGES.BAD_LINK });
      expect(await withTenant(tenant.id, (tx) => listImports(tx, tenant.id))).toEqual([]);
    });

    it("keeps a draft that Claude found no recipe in as failed, with the reason", async () => {
      await clearImports();
      const result = await readLink(
        ctx,
        LINK,
        deps({ fetch: page(WITHOUT_DATA), model: async () => ({ found: false, title: "", ingredients: [], steps: [] }) }),
      );
      expect(result).toMatchObject({ error: FOOD_MESSAGES.NO_RECIPE });
      const [row] = await withTenant(tenant.id, (tx) => listImports(tx, tenant.id));
      expect(row.status).toBe("failed");
      expect(row.error).toBe(FOOD_MESSAGES.NO_RECIPE);
      expect("importId" in result && result.importId).toBe(row.id);
    });
  });

  describe("reading text and photos", () => {
    it("reads pasted text, and refuses an empty or a too-long paste without a row", async () => {
      await clearImports();
      const asked: ReadRequest[] = [];
      expect(await readText(ctx, "  oats ", deps({ model: answering(asked) }))).toEqual({ error: FOOD_MESSAGES.PASTE_EMPTY });
      expect(await readText(ctx, "x".repeat(30_001), deps({ model: answering(asked) }))).toEqual({
        error: FOOD_MESSAGES.PASTE_TOO_LONG,
      });
      expect(asked).toHaveLength(0);
      const result = await readText(ctx, "Honey oats. 1 cup oats. Stir.", deps({ model: answering(asked) }));
      expect(asked).toEqual([{ kind: "text", text: "Honey oats. 1 cup oats. Stir." }]);
      const row = "importId" in result && result.importId ? await withTenant(tenant.id, (tx) => getImport(tx, tenant.id, result.importId!)) : null;
      expect(row?.kind).toBe("text");
      expect(row?.sourceUrl).toBeNull();
      expect(row?.photoPathname).toBeNull();
    });

    it("sends photos of a page to Claude and keeps none of them", async () => {
      await clearImports();
      const asked: ReadRequest[] = [];
      const pictures = [{ jpeg: "A".repeat(200) }, { jpeg: "B".repeat(200) }];
      const result = await readPhotos(ctx, pictures, deps({ model: answering(asked) }));
      expect(asked).toEqual([{ kind: "photo", pictures }]);
      const row = "importId" in result && result.importId ? await withTenant(tenant.id, (tx) => getImport(tx, tenant.id, result.importId!)) : null;
      expect(row?.kind).toBe("photo");
      expect(row?.photoPathname).toBeNull();
      expect(JSON.stringify(row?.draft)).not.toContain("AAAA");
      expect(await readPhotos(ctx, [], deps({}))).toEqual({ error: FOOD_MESSAGES.PICTURES });
    });

    it("fails the draft when Claude's answer cannot be used, and says so", async () => {
      await clearImports();
      const result = await readText(
        ctx,
        "Honey oats. 1 cup oats. Stir.",
        deps({
          model: async () => {
            throw new ReadModelError("TRUNCATED");
          },
        }),
      );
      expect(result).toMatchObject({ error: FOOD_MESSAGES.READ_FAILED });
      const [row] = await withTenant(tenant.id, (tx) => listImports(tx, tenant.id));
      expect(row.status).toBe("failed");
    });
  });

  describe("drafts", () => {
    it("read one at a time: a second Claude read waits for the first", async () => {
      await clearImports();
      await withTenant(tenant.id, (tx) =>
        tx.insert(schema.foodImports).values({
          tenantId: tenant.id,
          kind: "text",
          status: "reading",
          createdByClerkUserId: ctx.userId,
        }),
      );
      const asked: ReadRequest[] = [];
      expect(await readText(ctx, "Honey oats. 1 cup oats. Stir.", deps({ model: answering(asked) }))).toEqual({
        error: FOOD_MESSAGES.IMPORT_BUSY,
      });
      expect(asked).toHaveLength(0);
      // A page with its own data needs no model, so it is not held up.
      const quick = await readLink(ctx, LINK, deps({}));
      expect("error" in quick).toBe(false);
    });

    it("cannot be discarded while reading, unless it was interrupted", async () => {
      await clearImports();
      const [reading] = await withTenant(tenant.id, (tx) =>
        tx
          .insert(schema.foodImports)
          .values({ tenantId: tenant.id, kind: "text", status: "reading", createdByClerkUserId: ctx.userId })
          .returning(),
      );
      await expect(withTenant(tenant.id, (tx) => discardImport(tx, tenant.id, reading.id))).rejects.toMatchObject({
        code: "IMPORT_READING",
      });
      await withSystem((tx) =>
        tx
          .update(schema.foodImports)
          .set({ createdAt: new Date(Date.now() - 6 * 60 * 1000) })
          .where(eq(schema.foodImports.id, reading.id)),
      );
      const settled = await withTenant(tenant.id, (tx) => getImport(tx, tenant.id, reading.id));
      expect(settled?.status).toBe("failed");
      expect(settled?.error).toBe(INTERRUPTED);
      // An interrupted read no longer holds the door shut.
      const asked: ReadRequest[] = [];
      const result = await readText(ctx, "Honey oats. 1 cup oats. Stir.", deps({ model: answering(asked) }));
      expect("error" in result).toBe(false);
      expect(await withTenant(tenant.id, (tx) => discardImport(tx, tenant.id, reading.id))).toBeNull();
      expect(await withTenant(tenant.id, (tx) => getImport(tx, tenant.id, reading.id))).toBeNull();
    });

    it("hand a draft's photo back on discard, for the store", async () => {
      await clearImports();
      const result = await readLink(ctx, LINK, deps({ photo: async () => fakePhoto() }));
      const importId = "importId" in result ? result.importId! : "";
      expect(await withTenant(tenant.id, (tx) => discardImport(tx, tenant.id, importId))).toBe(fakePhoto().pathname);
      await expect(withTenant(tenant.id, (tx) => discardImport(tx, tenant.id, importId))).rejects.toMatchObject({
        code: "IMPORT_MISSING",
      });
    });
  });
});
