"use server";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { get } from "@vercel/blob";
import { z } from "zod";
import { schema, withTenant } from "@/db";
import { blobToken, isTenantBlobPath } from "@/lib/blob";
import { resolveBrandForSite } from "@/lib/brand/read";
import { isModuleEnabled, productCatalogue } from "@/lib/modules";
import { overPublicCap } from "@/lib/public-caps";
import { PageContentSchema, readPageContent, readSiteSettings, SectionSchema, type PageContent, type Section } from "@/lib/sites/schema";
import {
  isStarterPhoto,
  pageSpots,
  readShotNotes,
  shotNotesFor,
  spotSubject,
  storeFrom,
  type ShotNoteStore,
} from "@/lib/sites/shots";
import { templateFor } from "@/lib/site-templates/resolve";
import { listSiteImages } from "@/lib/sites/read";
import { logAuditInTx } from "@/lib/audit";
import { revalidatePath } from "next/cache";
import { PAGE_SENTENCE_MAX, REWRITE_INSTRUCTION_MAX } from "./ai/assistant-prompt";
import { assistantOn, describePhoto, draftPageContent, rewriteSectionWords, writeShotNotes } from "./assistant";
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

/* ---------------------------------------------------------------------------
 * THE SHOT LIST (slice 19)
 *
 * Two actions, and they are deliberately separate: asking the assistant costs
 * a call and a wait, and correcting one line should cost neither. The owner
 * knows the farm; the model knows the page. Whoever is right about a spot
 * should be able to say so without re-running the other.
 * ------------------------------------------------------------------------ */

/** The shot list's own route, so a written or corrected note shows at once. */
function revalidateShots(): void {
  revalidatePath("/dashboard/m/marketing/website/photos");
}

const shotsInput = z.object({ pageId: z.string().uuid() });

/**
 * Write a note for every spot on one page, and store them.
 *
 * The page is read, the model is called OUTSIDE the transaction (the house
 * rule that a transaction never waits on the network), and the answer is
 * written in a second one. The spots are recomputed from the same draft that
 * was read, so a note cannot be pinned to words that changed while the model
 * was thinking — and if they did change, `storedNoteIsFor` drops it on the
 * next read rather than showing advice about a section that moved.
 */
export async function suggestShotsAction(input: unknown): Promise<ActionResult<{ written: number }>> {
  try {
    const ctx = await open();
    const parsed = shotsInput.safeParse(input);
    if (!parsed.success) return { error: "Which page?" };
    const { pageId } = parsed.data;

    const read = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const page = await tx.query.sitePages.findFirst({
          where: and(eq(schema.sitePages.tenantId, ctx.tenantId), eq(schema.sitePages.id, pageId)),
          columns: { id: true, title: true, path: true, draft: true, siteId: true },
        });
        if (!page) throw new MarketingError("PAGE_MISSING", "no page");
        const site = await findSiteById(tx, ctx.tenantId, page.siteId);
        if (!site) throw new MarketingError("SITE_MISSING", "no site");
        const brand = await resolveBrandForSite(tx, ctx.tenantId, site.id);
        const tenant = await tx.query.tenants.findFirst({
          where: eq(schema.tenants.id, ctx.tenantId),
          columns: { industry: true },
        });
        const images = await listSiteImages(tx, ctx.tenantId, site.id);
        // NOT this tenant's switched-on modules: a business whose site sells
        // this software to an industry is usually not itself in it. The
        // operator tenant runs Professional services and none of the farm
        // packs, while its Homestead site sells exactly the farm packs. What
        // bounds a screenshot is what the PRODUCT has (`productCatalogue`).
        const catalogue = await productCatalogue(tx);
        return {
          catalogue,
          page,
          brand,
          settings: readSiteSettings(site.settings),
          industry: tenant?.industry,
          starters: new Set(images.filter((i) => isStarterPhoto(i.pathname)).map((i) => i.id)),
        };
      },
      { role: ctx.role },
    );

    const content = readPageContent(read.page.draft);
    const spots = pageSpots(
      { path: read.page.path, content },
      read.starters,
      shotNotesFor(templateFor(read.industry)),
    );
    if (spots.length === 0) return { ok: true, data: { written: 0 } };

    const notes = await writeShotNotes({
      brief: siteBriefFor({
        brand: read.brand,
        industry: industryLabel(read.industry),
        settings: read.settings,
      }),
      pageTitle: read.page.title,
      pagePath: read.page.path,
      pageDescription: content.description,
      spots,
      catalogue: read.catalogue,
    });

    const store = storeFrom(spots, notes);
    await withTenant(
      ctx.tenantId,
      async (tx) => {
        const [updated] = await tx
          .update(schema.sitePages)
          .set({ shotNotes: store, updatedAt: new Date() })
          .where(and(eq(schema.sitePages.tenantId, ctx.tenantId), eq(schema.sitePages.id, pageId)))
          .returning({ id: schema.sitePages.id });
        if (!updated) throw new MarketingError("FORBIDDEN", "notes not saved");
        await logAuditInTx(tx, {
          action: "marketing.site.shots_written",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "site_page",
          targetId: pageId,
          meta: { spots: spots.length, written: Object.keys(store).length },
        });
      },
      { role: ctx.role },
    );
    revalidateShots();
    return { ok: true, data: { written: Object.keys(store).length } };
  } catch (err) {
    return fail(err);
  }
}

const oneShotInput = z.object({
  pageId: z.string().uuid(),
  key: z.string().max(40),
  note: z.string().trim().max(600),
});

/**
 * One note, as the owner would rather have it said. No model call.
 *
 * An emptied note is a REMOVAL, not an empty string: the spot goes back to
 * its standing line, which is what somebody clearing a box means. The pin is
 * written from the spot as it is now, so correcting a note also re-pins it.
 */
export async function saveShotNoteAction(input: unknown): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = oneShotInput.safeParse(input);
    if (!parsed.success) return { error: "Check the note and try again." };
    const { pageId, key, note } = parsed.data;
    await withTenant(
      ctx.tenantId,
      async (tx) => {
        const page = await tx.query.sitePages.findFirst({
          where: and(eq(schema.sitePages.tenantId, ctx.tenantId), eq(schema.sitePages.id, pageId)),
          columns: { id: true, path: true, draft: true, shotNotes: true, siteId: true },
        });
        if (!page) throw new MarketingError("PAGE_MISSING", "no page");
        const site = await findSiteById(tx, ctx.tenantId, page.siteId);
        if (!site) throw new MarketingError("SITE_MISSING", "no site");
        const spot = pageSpots({ path: page.path, content: readPageContent(page.draft) }).find(
          (s) => s.key === key,
        );
        if (!spot) throw new MarketingError("INVALID_INPUT", "no such spot");

        const store: ShotNoteStore = { ...readShotNotes(page.shotNotes) };
        if (note) store[key] = { note, for: spotSubject(spot) };
        else delete store[key];

        const [updated] = await tx
          .update(schema.sitePages)
          .set({ shotNotes: store, updatedAt: new Date() })
          .where(and(eq(schema.sitePages.tenantId, ctx.tenantId), eq(schema.sitePages.id, pageId)))
          .returning({ id: schema.sitePages.id });
        if (!updated) throw new MarketingError("FORBIDDEN", "note not saved");
      },
      { role: ctx.role },
    );
    revalidateShots();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
