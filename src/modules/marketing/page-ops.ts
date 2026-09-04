import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { SitePage } from "@/db/schema";
import { PAGE_VERSIONS_KEEP, versionIdsToPrune } from "@/lib/sites/pages";
import type { PageContent } from "@/lib/sites/schema";
import { MarketingError } from "./core/errors";
import type { MarketingCtx } from "./kit-ops";

/**
 * Writing one page and its history. Takes the caller's `tx`; the action
 * layer owns the transaction, the gate and the audit row.
 *
 * Every content change leaves a version behind — a save, a publish, a
 * restore — and the history is trimmed to the newest `PAGE_VERSIONS_KEEP` on
 * every write, so it cannot grow without bound and never needs a sweep.
 */
function isUniqueViolation(err: unknown): boolean {
  const code =
    (err as { code?: string })?.code ?? (err as { cause?: { code?: string } })?.cause?.code;
  return code === "23505";
}

async function pageOrThrow(tx: Tx, ctx: MarketingCtx, pageId: string): Promise<SitePage> {
  const page = await tx.query.sitePages.findFirst({
    where: and(eq(schema.sitePages.tenantId, ctx.tenantId), eq(schema.sitePages.id, pageId)),
  });
  // 404-shaped: another tenant's page looks exactly like no page.
  if (!page) throw new MarketingError("PAGE_MISSING", "no such page");
  return page;
}

export async function recordVersion(
  tx: Tx,
  ctx: MarketingCtx,
  pageId: string,
  kind: "save" | "publish" | "restore",
  content: PageContent,
): Promise<void> {
  await tx.insert(schema.sitePageVersions).values({
    tenantId: ctx.tenantId,
    pageId,
    kind,
    content,
    createdByClerkUserId: ctx.userId,
  });
  const all = await tx.query.sitePageVersions.findMany({
    where: and(
      eq(schema.sitePageVersions.tenantId, ctx.tenantId),
      eq(schema.sitePageVersions.pageId, pageId),
    ),
    columns: { id: true, createdAt: true },
  });
  const prune = versionIdsToPrune(all, PAGE_VERSIONS_KEEP);
  if (prune.length > 0) {
    await tx
      .delete(schema.sitePageVersions)
      .where(
        and(
          eq(schema.sitePageVersions.tenantId, ctx.tenantId),
          inArray(schema.sitePageVersions.id, prune),
        ),
      );
  }
}

export interface PagePatch {
  title: string;
  /** Null leaves the path alone (always the case for the home page). */
  path: string | null;
  inNav: boolean;
  content: PageContent;
}

/** The draft, the title, the nav flag and (not for home) the path. */
export async function savePageDraft(
  tx: Tx,
  ctx: MarketingCtx,
  pageId: string,
  patch: PagePatch,
): Promise<SitePage> {
  const page = await pageOrThrow(tx, ctx, pageId);
  if (patch.path !== null && page.path === "/") {
    throw new MarketingError("PAGE_IS_HOME", "home keeps its path");
  }
  const changed = JSON.stringify(page.draft) !== JSON.stringify(patch.content);
  let updated: SitePage | undefined;
  try {
    [updated] = await tx
      .update(schema.sitePages)
      .set({
        title: patch.title,
        inNav: page.path === "/" ? true : patch.inNav,
        ...(patch.path !== null ? { path: patch.path } : {}),
        draft: patch.content,
        updatedAt: new Date(),
      })
      .where(and(eq(schema.sitePages.tenantId, ctx.tenantId), eq(schema.sitePages.id, pageId)))
      .returning();
  } catch (err) {
    if (isUniqueViolation(err)) throw new MarketingError("PAGE_PATH_TAKEN", patch.path ?? "");
    throw err;
  }
  if (!updated) throw new MarketingError("FORBIDDEN", "page not updated");
  if (changed) await recordVersion(tx, ctx, pageId, "save", patch.content);
  return updated;
}

export async function addPage(
  tx: Tx,
  ctx: MarketingCtx,
  siteId: string,
  input: { title: string; path: string; content: PageContent },
): Promise<SitePage> {
  const siblings = await tx.query.sitePages.findMany({
    where: and(eq(schema.sitePages.tenantId, ctx.tenantId), eq(schema.sitePages.siteId, siteId)),
    columns: { navOrder: true },
  });
  const navOrder = siblings.reduce((max, p) => Math.max(max, p.navOrder), -1) + 1;
  try {
    const [created] = await tx
      .insert(schema.sitePages)
      .values({
        tenantId: ctx.tenantId,
        siteId,
        path: input.path,
        title: input.title,
        navOrder,
        inNav: true,
        draft: input.content,
      })
      .returning();
    if (!created) throw new MarketingError("FORBIDDEN", "page not created");
    await recordVersion(tx, ctx, created.id, "save", input.content);
    return created;
  } catch (err) {
    if (isUniqueViolation(err)) throw new MarketingError("PAGE_PATH_TAKEN", input.path);
    throw err;
  }
}

/** Gone from the draft AND from the internet: the page, its snapshot and its history. */
export async function deletePage(tx: Tx, ctx: MarketingCtx, pageId: string): Promise<SitePage> {
  const page = await pageOrThrow(tx, ctx, pageId);
  if (page.path === "/") throw new MarketingError("PAGE_IS_HOME", "home cannot be deleted");
  const [deleted] = await tx
    .delete(schema.sitePages)
    .where(and(eq(schema.sitePages.tenantId, ctx.tenantId), eq(schema.sitePages.id, pageId)))
    .returning();
  if (!deleted) throw new MarketingError("FORBIDDEN", "page not deleted");
  return deleted;
}

/**
 * The nav order, from a list of page ids. Ids that are not this site's pages
 * are ignored rather than refused: a stale list from a screen that missed a
 * deletion should still reorder what it knows about.
 */
export async function reorderPages(
  tx: Tx,
  ctx: MarketingCtx,
  siteId: string,
  order: string[],
): Promise<void> {
  const pages = await tx.query.sitePages.findMany({
    where: and(eq(schema.sitePages.tenantId, ctx.tenantId), eq(schema.sitePages.siteId, siteId)),
    columns: { id: true },
  });
  const known = new Set(pages.map((p) => p.id));
  let index = 0;
  for (const id of order) {
    if (!known.has(id)) continue;
    await tx
      .update(schema.sitePages)
      .set({ navOrder: index, updatedAt: new Date() })
      .where(and(eq(schema.sitePages.tenantId, ctx.tenantId), eq(schema.sitePages.id, id)));
    index += 1;
  }
}

export async function restoreVersion(
  tx: Tx,
  ctx: MarketingCtx,
  pageId: string,
  versionId: string,
): Promise<{ page: SitePage; content: PageContent }> {
  await pageOrThrow(tx, ctx, pageId);
  const version = await tx.query.sitePageVersions.findFirst({
    where: and(
      eq(schema.sitePageVersions.tenantId, ctx.tenantId),
      eq(schema.sitePageVersions.pageId, pageId),
      eq(schema.sitePageVersions.id, versionId),
    ),
  });
  if (!version) throw new MarketingError("VERSION_MISSING", "no such version");
  const content = version.content as PageContent;
  const [updated] = await tx
    .update(schema.sitePages)
    .set({ draft: content, updatedAt: new Date() })
    .where(and(eq(schema.sitePages.tenantId, ctx.tenantId), eq(schema.sitePages.id, pageId)))
    .returning();
  if (!updated) throw new MarketingError("FORBIDDEN", "page not restored");
  await recordVersion(tx, ctx, pageId, "restore", content);
  return { page: updated, content };
}
