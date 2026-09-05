"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@/db";
import { logAuditInTx } from "@/lib/audit";
import {
  normalizePagePath,
  pagePathReasonMessage,
} from "@/lib/sites/pages";
import { PageContentSchema, type PageContent } from "@/lib/sites/schema";
import { MarketingError } from "./core/errors";
import { fail, gate, type ActionResult } from "./gate";
import {
  addPage,
  deletePage,
  reorderPages,
  restoreVersion,
  savePageDraft,
} from "./page-ops";
import { findSite } from "./site-ops";

/**
 * Server actions for one page: the editor's save, adding and removing pages,
 * the menu order, and history. Owner-only through the module's one gate.
 *
 * WHAT GOES LIVE WHEN. A page's WORDS wait for Publish (the public renderer
 * reads the published snapshot). Its place in the menu, its title in the
 * menu and whether it is in the menu at all are read from the page row and
 * so show on the live site as soon as they are saved — which is why every
 * action here revalidates the public routes as well as the dashboard.
 */
const BASE = "/dashboard/m/marketing/website";

function revalidateAll(): void {
  revalidatePath(BASE);
  revalidatePath(`${BASE}/pages/[pageId]`, "page");
  revalidatePath("/sites/[slug]/[[...path]]", "page");
  revalidatePath("/hosted/[slug]/[[...path]]", "page");
}

/** "sections.2.headline: Too small" → "Section 3: headline is missing." */
function contentProblem(issue: z.ZodIssue): string {
  const [head, index, field] = issue.path;
  if (head === "sections" && typeof index === "number") {
    const where = `Section ${index + 1}`;
    if (field === undefined) return `${where}: ${issue.message}.`;
    return `${where}: ${String(field)} ${
      /small|required|expected/i.test(issue.message) ? "is missing" : "is too long"
    }.`;
  }
  return `${issue.path.join(".") || "Page"}: ${issue.message}.`;
}

function parseContent(raw: unknown): PageContent {
  const parsed = PageContentSchema.safeParse(raw);
  if (!parsed.success) {
    throw new MarketingError(
      "PAGE_INVALID",
      contentProblem(parsed.error.issues[0]) || "Check the sections and try again.",
    );
  }
  return parsed.data;
}

function parsePath(raw: string): string {
  const check = normalizePagePath(raw);
  if (!check.ok) throw new MarketingError("PAGE_PATH_INVALID", pagePathReasonMessage(check.reason));
  return check.path;
}

const saveInput = z.object({
  pageId: z.string().uuid(),
  title: z.string().trim().min(1, "Give the page a title.").max(80),
  /** Null for the home page, whose path never changes. */
  path: z.string().max(120).nullable(),
  inNav: z.boolean(),
  content: z.unknown(),
});

export async function savePageAction(input: unknown): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = saveInput.safeParse(input);
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message || "Check the fields and try again." };
    }
    const content = parseContent(parsed.data.content);
    const path = parsed.data.path === null ? null : parsePath(parsed.data.path);
    await withTenant(
      ctx.tenantId,
      async (tx) => {
        const page = await savePageDraft(tx, ctx, parsed.data.pageId, {
          title: parsed.data.title,
          path,
          inNav: parsed.data.inNav,
          content,
        });
        await logAuditInTx(tx, {
          action: "marketing.site.page_saved",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "site_page",
          targetId: page.id,
          meta: { path: page.path, sections: content.sections.length },
        });
      },
      { role: ctx.role },
    );
    revalidateAll();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

const addInput = z.object({
  title: z.string().trim().min(1, "Give the page a title.").max(80),
  path: z.string().max(120),
});

export async function addPageAction(
  input: unknown,
): Promise<ActionResult<{ pageId: string }>> {
  try {
    const ctx = await gate();
    const parsed = addInput.safeParse(input);
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message || "Check the fields and try again." };
    }
    const path = parsePath(parsed.data.path);
    const content: PageContent = {
      description: "",
      sections: [{ type: "text", heading: parsed.data.title, body: ["Write this page here."] }],
    };
    const pageId = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const site = await findSite(tx, ctx.tenantId);
        if (!site) throw new MarketingError("SITE_MISSING", "no site");
        const page = await addPage(tx, ctx, site.id, { title: parsed.data.title, path, content });
        await logAuditInTx(tx, {
          action: "marketing.site.page_added",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "site_page",
          targetId: page.id,
          meta: { path },
        });
        return page.id;
      },
      { role: ctx.role },
    );
    revalidateAll();
    return { ok: true, data: { pageId } };
  } catch (err) {
    return fail(err);
  }
}

const pageInput = z.object({ pageId: z.string().uuid() });

export async function deletePageAction(input: unknown): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = pageInput.safeParse(input);
    if (!parsed.success) return { error: "Pick a page and try again." };
    await withTenant(
      ctx.tenantId,
      async (tx) => {
        const page = await deletePage(tx, ctx, parsed.data.pageId);
        await logAuditInTx(tx, {
          action: "marketing.site.page_deleted",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "site_page",
          targetId: page.id,
          meta: { path: page.path },
        });
      },
      { role: ctx.role },
    );
    revalidateAll();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

const orderInput = z.object({ order: z.array(z.string().uuid()).max(50) });

export async function reorderPagesAction(input: unknown): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = orderInput.safeParse(input);
    if (!parsed.success) return { error: "Check the order and try again." };
    await withTenant(
      ctx.tenantId,
      async (tx) => {
        const site = await findSite(tx, ctx.tenantId);
        if (!site) throw new MarketingError("SITE_MISSING", "no site");
        await reorderPages(tx, ctx, site.id, parsed.data.order);
      },
      { role: ctx.role },
    );
    revalidateAll();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

const restoreInput = z.object({ pageId: z.string().uuid(), versionId: z.string().uuid() });

export async function restorePageVersionAction(input: unknown): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = restoreInput.safeParse(input);
    if (!parsed.success) return { error: "Pick a version and try again." };
    await withTenant(
      ctx.tenantId,
      async (tx) => {
        const { page } = await restoreVersion(tx, ctx, parsed.data.pageId, parsed.data.versionId);
        await logAuditInTx(tx, {
          action: "marketing.site.page_restored",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "site_page",
          targetId: page.id,
          meta: { versionId: parsed.data.versionId },
        });
      },
      { role: ctx.role },
    );
    revalidateAll();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
