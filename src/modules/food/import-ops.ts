import "server-only";
import { and, desc, eq, gt } from "drizzle-orm";
import { schema, withTenant, type Tx } from "@/db";
import type { FoodImport } from "@/db/schema";
import type { TenantContext } from "@/lib/auth";
import { fetchPage, type PageFetchResult } from "@/lib/net/fetch-page";
import { validateHopUrl } from "@/lib/net/ssrf";
import {
  PASTE_LIMIT,
  PASTE_MIN,
  draftSchema,
  normalizeDraft,
  picturesFit,
  type ReadRequest,
} from "./core/draft";
import { FoodError, foodMessage } from "./core/errors";
import { isWebUrl, type RecipeInput } from "./core/recipe";
import {
  draftFromRecipeData,
  findRecipe,
  jsonLdBlocks,
  looksBlocked,
  pageImage,
  pageText,
  pageTitle,
} from "./core/recipe-page";
import { discardPhoto, storePagePhoto, type StoredPhoto } from "./photo-ops";
import { ReadModelError, callReadModel, type ReadModel } from "./read-model";

/**
 * AN IMPORT: a recipe on its way in, from a link, pasted text or photos of a
 * page (src/db/schema/food.ts). `reading` → `draft`, or `failed`; saving or
 * discarding it deletes the row. It exists from the moment Claude starts, so
 * a person who leaves while it reads still finds the draft on the Food page.
 *
 * Every read happens OUTSIDE a transaction, between short ones: a row held
 * open for a minute of Claude reading would be a lock held for a minute.
 */

/**
 * How long a `reading` import holds the door shut for the next Claude read,
 * and after which it was INTERRUPTED: whatever was reading it hit its time
 * limit (the Add page's `maxDuration`, 300 s) or a deploy, and nothing will
 * finish it.
 */
const READING_WINDOW_MS = 5 * 60 * 1000;

export const INTERRUPTED = "The reading was interrupted before it finished. Discard it and try again.";

/** An import as the person should see it: one reading for too long reads as the failure it is. */
export function settleImport(row: FoodImport, now: Date = new Date()): FoodImport {
  return row.status === "reading" && now.getTime() - row.createdAt.getTime() >= READING_WINDOW_MS
    ? { ...row, status: "failed", error: INTERRUPTED }
    : row;
}

export interface ReadDeps {
  model: ReadModel;
  fetch: (url: string) => Promise<PageFetchResult>;
  photo: (tenantId: string, url: string | null) => Promise<StoredPhoto | null>;
}

const LIVE: ReadDeps = { model: callReadModel, fetch: fetchPage, photo: storePagePhoto };

/** What a read gives back to the Add page: the draft to open, or the sentence to show. */
export type ReadResult = { importId: string } | { error: string; importId?: string };

function readFailure(err: unknown): string {
  if (err instanceof FoodError) return foodMessage(err);
  if (!(err instanceof ReadModelError)) console.error("food: reading a recipe failed", err);
  return foodMessage(new FoodError("READ_FAILED"));
}

async function refuseIfBusy(tx: Tx, tenantId: string): Promise<void> {
  const t = schema;
  const [busy] = await tx
    .select({ id: t.foodImports.id })
    .from(t.foodImports)
    .where(
      and(
        eq(t.foodImports.tenantId, tenantId),
        eq(t.foodImports.status, "reading"),
        gt(t.foodImports.createdAt, new Date(Date.now() - READING_WINDOW_MS)),
      ),
    )
    .limit(1);
  if (busy) throw new FoodError("IMPORT_BUSY");
}

async function insertImport(
  tx: Tx,
  ctx: TenantContext,
  values: {
    kind: FoodImport["kind"];
    sourceUrl: string | null;
    status: FoodImport["status"];
    draft?: RecipeInput;
    photo?: StoredPhoto | null;
  },
): Promise<string> {
  const t = schema;
  const [row] = await tx
    .insert(t.foodImports)
    .values({
      tenantId: ctx.tenant.id,
      kind: values.kind,
      sourceUrl: values.sourceUrl,
      status: values.status,
      draft: values.draft ?? null,
      photoPathname: values.photo?.pathname ?? null,
      photoWidth: values.photo?.width ?? null,
      photoHeight: values.photo?.height ?? null,
      createdByClerkUserId: ctx.userId,
    })
    .returning({ id: t.foodImports.id });
  return row.id;
}

/**
 * Claude answered. Only a row still `reading` takes the answer: one the person
 * discarded in the meantime is gone, and the photo kept for it goes too.
 */
async function finishRead(
  ctx: TenantContext,
  importId: string,
  outcome: { draft: RecipeInput; photo: StoredPhoto | null } | { error: string },
): Promise<boolean> {
  const t = schema;
  const values =
    "error" in outcome
      ? { status: "failed" as const, error: outcome.error, updatedAt: new Date() }
      : {
          status: "draft" as const,
          draft: outcome.draft,
          error: null,
          photoPathname: outcome.photo?.pathname ?? null,
          photoWidth: outcome.photo?.width ?? null,
          photoHeight: outcome.photo?.height ?? null,
          updatedAt: new Date(),
        };
  const changed = await withTenant(
    ctx.tenant.id,
    (tx) =>
      tx
        .update(t.foodImports)
        .set(values)
        .where(
          and(
            eq(t.foodImports.tenantId, ctx.tenant.id),
            eq(t.foodImports.id, importId),
            eq(t.foodImports.status, "reading"),
          ),
        )
        .returning({ id: t.foodImports.id }),
    { role: ctx.role },
  );
  if (changed.length === 0 && !("error" in outcome)) await discardPhoto(outcome.photo?.pathname);
  return changed.length > 0;
}

/**
 * Start a Claude read and see it through: the row first (so leaving the page
 * loses nothing), the read outside any transaction, then the answer on the row.
 */
async function readWithClaude(
  ctx: TenantContext,
  start: { kind: FoodImport["kind"]; sourceUrl: string | null },
  read: () => Promise<{ draft: RecipeInput; photo: StoredPhoto | null }>,
): Promise<ReadResult> {
  const importId = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      await refuseIfBusy(tx, ctx.tenant.id);
      return insertImport(tx, ctx, { ...start, status: "reading" });
    },
    { role: ctx.role },
  );
  let outcome: { draft: RecipeInput; photo: StoredPhoto | null } | { error: string };
  try {
    outcome = await read();
  } catch (err) {
    outcome = { error: readFailure(err) };
  }
  await finishRead(ctx, importId, outcome);
  return "error" in outcome ? { error: outcome.error, importId } : { importId };
}

function pageFailure(result: Exclude<PageFetchResult, { ok: true }>): FoodError {
  switch (result.reason) {
    case "invalid":
      return new FoodError("BAD_LINK");
    case "too large":
      return new FoodError("TOO_LARGE");
    case "not a page":
      return new FoodError("NOT_A_PAGE");
    case "status":
      return new FoodError(looksBlocked(result.status ?? 0, result.html ?? "") ? "BLOCKED" : "UNREACHABLE");
    default:
      return new FoodError("UNREACHABLE");
  }
}

/**
 * READ A RECIPE FROM A LINK. The page first, outside any row: a link that
 * cannot be read says so at once and leaves nothing behind. A page with its
 * own recipe data becomes a draft straight away, read exactly; one without
 * goes to Claude as words, the way pasted text does.
 */
export async function readLink(ctx: TenantContext, raw: string, deps: ReadDeps = LIVE): Promise<ReadResult> {
  const url = raw.trim();
  if (!isWebUrl(url) || !validateHopUrl(url).ok) return { error: foodMessage(new FoodError("BAD_LINK")) };

  const page = await deps.fetch(url);
  if (!page.ok) return { error: foodMessage(pageFailure(page)) };
  if (looksBlocked(200, page.html)) return { error: foodMessage(new FoodError("BLOCKED")) };

  const data = findRecipe(jsonLdBlocks(page.html));
  if (data) {
    const mapped = draftFromRecipeData(data, page.url);
    const normalized = normalizeDraft(mapped.draft, url);
    if (normalized.found) {
      const recipe = { ...normalized.recipe, title: normalized.recipe.title || pageTitle(page.html) || "" };
      const photo = await deps.photo(ctx.tenant.id, mapped.imageUrl ?? pageImage(page.html, page.url));
      try {
        const importId = await withTenant(
          ctx.tenant.id,
          (tx) => insertImport(tx, ctx, { kind: "link", sourceUrl: url, status: "draft", draft: recipe, photo }),
          { role: ctx.role },
        );
        return { importId };
      } catch (err) {
        await discardPhoto(photo?.pathname);
        throw err;
      }
    }
  }

  const title = pageTitle(page.html);
  const request: ReadRequest = { kind: "page", url: page.url, title, text: pageText(page.html) };
  try {
    return await readWithClaude(ctx, { kind: "link", sourceUrl: url }, async () => {
      const normalized = normalizeDraft(await deps.model(request), url);
      if (!normalized.found) throw new FoodError("NO_RECIPE");
      const photo = await deps.photo(ctx.tenant.id, pageImage(page.html, page.url));
      return { draft: { ...normalized.recipe, title: normalized.recipe.title || title || "" }, photo };
    });
  } catch (err) {
    if (err instanceof FoodError) return { error: foodMessage(err) };
    throw err;
  }
}

/** READ PASTED TEXT: a caption, a message, a note. */
export async function readText(ctx: TenantContext, raw: string, deps: ReadDeps = LIVE): Promise<ReadResult> {
  const text = raw.trim();
  if (text.length < PASTE_MIN) return { error: foodMessage(new FoodError("PASTE_EMPTY")) };
  if (text.length > PASTE_LIMIT) return { error: foodMessage(new FoodError("PASTE_TOO_LONG")) };
  try {
    return await readWithClaude(ctx, { kind: "text", sourceUrl: null }, async () => {
      const normalized = normalizeDraft(await deps.model({ kind: "text", text }), null);
      if (!normalized.found) throw new FoodError("NO_RECIPE");
      return { draft: normalized.recipe, photo: null };
    });
  } catch (err) {
    if (err instanceof FoodError) return { error: foodMessage(err) };
    throw err;
  }
}

/**
 * READ PHOTOS OF A PAGE: a cookbook page, a card. The photos go to Claude and
 * nowhere else: no row, no store and no log keeps them.
 */
export async function readPhotos(
  ctx: TenantContext,
  pictures: Array<{ jpeg: string }>,
  deps: ReadDeps = LIVE,
): Promise<ReadResult> {
  if (!picturesFit(pictures)) return { error: foodMessage(new FoodError("PICTURES")) };
  try {
    return await readWithClaude(ctx, { kind: "photo", sourceUrl: null }, async () => {
      const normalized = normalizeDraft(await deps.model({ kind: "photo", pictures }), null);
      if (!normalized.found) throw new FoodError("NO_RECIPE");
      return { draft: normalized.recipe, photo: null };
    });
  } catch (err) {
    if (err instanceof FoodError) return { error: foodMessage(err) };
    throw err;
  }
}

export async function getImport(tx: Tx, tenantId: string, importId: string): Promise<FoodImport | null> {
  const t = schema;
  const [row] = await tx
    .select()
    .from(t.foodImports)
    .where(and(eq(t.foodImports.tenantId, tenantId), eq(t.foodImports.id, importId)))
    .limit(1);
  return row ? settleImport(row) : null;
}

/** Every draft still waiting, newest first: reading, ready to check, or failed. */
export async function listImports(tx: Tx, tenantId: string): Promise<FoodImport[]> {
  const t = schema;
  const rows = await tx
    .select()
    .from(t.foodImports)
    .where(eq(t.foodImports.tenantId, tenantId))
    .orderBy(desc(t.foodImports.createdAt))
    .limit(50);
  return rows.map((row) => settleImport(row));
}

/** The draft as the editor opens it, or null if what is stored no longer reads. */
export function importDraft(row: FoodImport): RecipeInput | null {
  const parsed = draftSchema.safeParse(row.draft);
  return parsed.success ? parsed.data : null;
}

/**
 * Throw a draft away: the row now, its photo once the caller's transaction has
 * committed (returned). One still reading inside the window cannot be.
 */
export async function discardImport(tx: Tx, tenantId: string, importId: string): Promise<string | null> {
  const row = await getImport(tx, tenantId, importId);
  if (!row) throw new FoodError("IMPORT_MISSING");
  if (row.status === "reading") throw new FoodError("IMPORT_READING");
  const t = schema;
  await tx.delete(t.foodImports).where(and(eq(t.foodImports.tenantId, tenantId), eq(t.foodImports.id, importId)));
  return row.photoPathname;
}

/**
 * A draft becoming a recipe: the row goes, and its photo is handed to the
 * caller to keep or let go. Locked, so a double press saves it once.
 */
export async function takeImport(
  tx: Tx,
  tenantId: string,
  importId: string,
): Promise<{ photo: StoredPhoto | null }> {
  const t = schema;
  const [row] = await tx
    .select()
    .from(t.foodImports)
    .where(and(eq(t.foodImports.tenantId, tenantId), eq(t.foodImports.id, importId)))
    .for("update")
    .limit(1);
  if (!row) throw new FoodError("IMPORT_MISSING");
  if (row.status !== "draft") throw new FoodError(row.status === "reading" ? "IMPORT_READING" : "IMPORT_MISSING");
  await tx.delete(t.foodImports).where(and(eq(t.foodImports.tenantId, tenantId), eq(t.foodImports.id, importId)));
  return {
    photo:
      row.photoPathname && row.photoWidth !== null && row.photoHeight !== null
        ? { pathname: row.photoPathname, width: row.photoWidth, height: row.photoHeight }
        : null,
  };
}
