"use server";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { get } from "@vercel/blob";
import { z } from "zod";
import { schema, withTenant } from "@/db";
import { blobToken, isTenantBlobPath } from "@/lib/blob";
import { resolveBrandForSite } from "@/lib/brand/read";
import { isModuleEnabled } from "@/lib/modules";
import { overPublicCap } from "@/lib/public-caps";
import { PageContentSchema, readSiteSettings, SectionSchema, type PageContent, type Section } from "@/lib/sites/schema";
import { PAGE_SENTENCE_MAX, REWRITE_INSTRUCTION_MAX } from "./ai/assistant-prompt";
import { assistantOn, describePhoto, draftPageContent, rewriteSectionWords } from "./assistant";
import { MarketingError } from "./core/errors";
import { fail, gate, type ActionResult } from "./gate";
import type { MarketingCtx } from "./kit-ops";
import { industryLabel } from "./logo-generate";
import { siteBriefFor } from "./site-generate";
import { findSiteById } from "./site-ops";

/**
 * The assistant's three doors (slice 12). Each is gate → Zod → a read
 * inside the tenant for the brief → the model call OUTSIDE any transaction
 * → the answer handed back to the editor, which shows it and saves it
 * through the ordinary save, so nothing here writes a row. A valve per
 * tenant per hour, because every press is a model call.
 *
 * What leaves the platform: the brief (the business's name, tagline, kind,
 * address and hours — what its own public page says), the words of the one
 * section or the one sentence, and for a description the photo's pixels.
 * Never the site as a whole, never a visitor's message, never a person.
 */
const CAP = { kind: "site_assistant", hourlyIpCap: 60, dailyCap: 5000 };

/** The valve is per tenant, not per address: the key column holds a hash, so hash the tenant id (never the id itself). */
function tenantKey(tenantId: string): string {
  return createHash("sha256").update(`assistant:${tenantId}`).digest("hex");
}

async function open(): Promise<MarketingCtx> {
  const ctx = await gate();
  if (!assistantOn()) throw new MarketingError("ASSISTANT_OFF", "no key");
  if (await overPublicCap(CAP, tenantKey(ctx.tenantId))) throw new MarketingError("ASSISTANT_BUSY", "capped");
  return ctx;
}

/** The brief, the page's title and its siblings', inside one read. */
async function pageBrief(ctx: MarketingCtx, pageId: string) {
  return withTenant(
    ctx.tenantId,
    async (tx) => {
      // The page names its own site, so nothing has to be told which one
      // (ADR 0045): a tenant may have several, and reading "the" site here
      // would have been a guess the moment it did.
      const page = await tx.query.sitePages.findFirst({
        where: and(eq(schema.sitePages.tenantId, ctx.tenantId), eq(schema.sitePages.id, pageId)),
        columns: { id: true, title: true, siteId: true },
      });
      if (!page) throw new MarketingError("PAGE_MISSING", "no page");
      const site = await findSiteById(tx, ctx.tenantId, page.siteId);
      if (!site) throw new MarketingError("SITE_MISSING", "no site");
      const siblings = await tx.query.sitePages.findMany({
        where: and(eq(schema.sitePages.tenantId, ctx.tenantId), eq(schema.sitePages.siteId, site.id)),
        columns: { id: true, title: true },
      });
      // The SITE's brand (ADR 0045): the name and tagline the writer works
      // from must be the ones on the page it is writing, or a sub-brand's
      // words come back in the parent business's voice.
      const brand = await resolveBrandForSite(tx, ctx.tenantId, site.id);
      const tenant = await tx.query.tenants.findFirst({
        where: eq(schema.tenants.id, ctx.tenantId),
        columns: { industry: true },
      });
      return {
        brief: siteBriefFor({ brand, industry: industryLabel(tenant?.industry), settings: readSiteSettings(site.settings) }),
        pageTitle: page.title,
        otherPages: siblings.filter((p) => p.id !== page.id).map((p) => p.title),
      };
    },
    { role: ctx.role },
  );
}

const rewriteInput = z.object({
  pageId: z.string().uuid(),
  section: z.unknown(),
  instruction: z.string().trim().max(REWRITE_INSTRUCTION_MAX).default(""),
});

export async function rewriteSectionAction(input: unknown): Promise<ActionResult<{ section: Section }>> {
  try {
    const ctx = await open();
    const parsed = rewriteInput.safeParse(input);
    if (!parsed.success) return { error: "Check the fields and try again." };
    const section = SectionSchema.safeParse(parsed.data.section);
    if (!section.success) return { error: "Save the section first, then ask again." };
    const { brief, pageTitle } = await pageBrief(ctx, parsed.data.pageId);
    const next = await rewriteSectionWords({ brief, pageTitle, section: section.data, instruction: parsed.data.instruction });
    return { ok: true, data: { section: next } };
  } catch (err) {
    return fail(err);
  }
}

const draftInput = z.object({
  pageId: z.string().uuid(),
  sentence: z.string().trim().min(3, "Say what the page should be about.").max(PAGE_SENTENCE_MAX),
});

export async function draftPageAction(input: unknown): Promise<ActionResult<{ content: PageContent }>> {
  try {
    const ctx = await open();
    const parsed = draftInput.safeParse(input);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message || "Check the fields and try again." };
    const [{ brief, pageTitle, otherPages }, schedulingOn] = await Promise.all([
      pageBrief(ctx, parsed.data.pageId),
      isModuleEnabled(ctx.tenantId, "scheduling"),
    ]);
    const content = await draftPageContent({ brief, pageTitle, otherPages, sentence: parsed.data.sentence, schedulingOn });
    return { ok: true, data: { content: PageContentSchema.parse(content) } };
  } catch (err) {
    return fail(err);
  }
}

const photoInput = z.object({ id: z.string().uuid() });

export async function describePhotoAction(input: unknown): Promise<ActionResult<{ alt: string }>> {
  try {
    const ctx = await open();
    const parsed = photoInput.safeParse(input);
    if (!parsed.success) return { error: "Pick a photo and try again." };
    const image = await withTenant(
      ctx.tenantId,
      (tx) =>
        tx.query.siteImages.findFirst({
          where: and(eq(schema.siteImages.tenantId, ctx.tenantId), eq(schema.siteImages.id, parsed.data.id)),
          columns: { pathname: true, mimeType: true },
        }),
      { role: ctx.role },
    );
    if (!image || !isTenantBlobPath(ctx.tenantId, image.pathname)) throw new MarketingError("PHOTO_MISSING", "no photo");
    // The photo's bytes, outside the transaction: a blob read is a network call.
    const result = await get(image.pathname, { access: "private", token: blobToken() });
    if (!result || result.statusCode !== 200) throw new MarketingError("PHOTO_MISSING", "blob gone");
    const bytes = new Uint8Array(await new Response(result.stream).arrayBuffer());
    const alt = await describePhoto({ bytes, mimeType: image.mimeType });
    return { ok: true, data: { alt } };
  } catch (err) {
    return fail(err);
  }
}
