"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { schema, withTenant } from "@/db";
import { logAuditInTx } from "@/lib/audit";
import { resolveBrandFor } from "@/lib/brand/read";
import { isModuleEnabled } from "@/lib/modules";
import { siteBlockCatalog } from "@/lib/site-blocks/resolve";
import type { BlockCatalogEntry } from "@/lib/site-blocks/types";
import { assembleTemplate, attachPictures, scenesFor } from "@/lib/site-templates/core";
import { templateFor } from "@/lib/site-templates/resolve";
import type { AssembledPage, SiteTemplate } from "@/lib/site-templates/types";
import type { ResolvedBrand } from "@/lib/brand/core";
import type { SiteBrief } from "@/lib/sites/copy";
import { frameFromInput } from "@/lib/sites/frame";
import { SOCIAL_NETWORKS } from "@/lib/sites/links";
import { geocodeAddress } from "@/lib/sites/map";
import { pinIsFor } from "@/lib/sites/map-core";
import {
  EMPTY_SETTINGS,
  FOOTER_COLUMNS_MAX,
  FOOTER_LINKS_MAX,
  readSiteSettings,
  SiteSettingsSchema,
  SOCIAL_LINKS_MAX,
  type SiteSettings,
} from "@/lib/sites/schema";
import { normalizeSiteSlug, slugReasonMessage } from "@/lib/sites/slug";
import { MarketingError } from "./core/errors";
import { fail, gate, type ActionResult } from "./gate";
import { industryLabel } from "./logo-generate";
import { siteBriefFor, writeSite } from "./site-generate";
import { ensureStarterPictures } from "./starter-pictures";
import { saveKitLook } from "./kit-ops";
import {
  changeSiteSlug,
  createSite,
  findSiteById,
  publishSite,
  replaceDrafts,
  unpublishSite,
  updateSiteSettings,
} from "./site-ops";

/**
 * Server actions for the website. Canonical shape: gate → Zod → withTenant
 * (core + audit) → revalidate. All owner-only through the module's one gate.
 *
 * Building and rewriting have a network call in the middle (the assistant
 * writes the words), so they read in one transaction, call, and write in a
 * second — the house rule that a transaction never waits on the network.
 */
const BASE = "/dashboard/m/marketing/website";

/**
 * The public pages are cached (ISR); this is what makes a publish show up at
 * once. All three route files are named because `revalidatePath` works on
 * the route file, not the URL a visitor sees — the host rewrite lands on
 * the second, a connected domain on the third.
 */
function revalidateSite(): void {
  revalidatePath(BASE, "layout");
  revalidatePath("/sites/[slug]/[[...path]]", "page");
  revalidatePath("/hosted/[slug]/[[...path]]", "page");
  revalidatePath("/domain/[host]/[[...path]]", "page");
}

/**
 * WHICH SITE. Every action that touches a site names it, because a tenant
 * may have several (ADR 0045) and a server action must never infer one from
 * ambient state. The id is a CLAIM until `findSiteById` proves it is this
 * tenant's; RLS is the second lock behind that.
 */
const siteRef = z.object({ siteId: z.string().uuid() });

const detailsInput = siteRef.extend({
  title: z.string().trim().max(80).default(""),
  phone: z.string().trim().max(40).default(""),
  email: z.string().trim().max(120).default(""),
  address: z.string().trim().max(240).default(""),
  /** The textarea, one line per entry. */
  hoursText: z.string().max(800).default(""),
  /** A few lines about the business, for the writer (slice 15b). */
  about: z.string().trim().max(600).default(""),
});

/**
 * Textarea → settings, through the schema the renderer reads. The details
 * are four of the settings' fields; the frame (the header, the footer, the
 * bar) is the rest, and a save of the details leaves it as it was.
 */
function settingsFrom(
  existing: SiteSettings,
  input: Omit<z.infer<typeof detailsInput>, "siteId">,
): SiteSettings {
  const hoursLines = input.hoursText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 7);
  const parsed = SiteSettingsSchema.safeParse({
    ...existing,
    phone: input.phone,
    email: input.email,
    address: input.address,
    hoursLines,
    about: input.about,
  });
  if (!parsed.success) throw new MarketingError("INVALID_INPUT", "settings rejected");
  return parsed.data;
}

function slugFrom(raw: string): string {
  const check = normalizeSiteSlug(raw);
  if (!check.ok) throw new MarketingError("SLUG_INVALID", slugReasonMessage(check.reason));
  return check.slug;
}

const buildInput = detailsInput.omit({ siteId: true }).extend({ slug: z.string().max(80) });

export async function createSiteAction(
  input: unknown,
): Promise<ActionResult<{ slug: string; siteId: string }>> {
  try {
    const ctx = await gate();
    const parsed = buildInput.safeParse(input);
    if (!parsed.success) return { error: "Check the fields and try again." };
    const slug = slugFrom(parsed.data.slug);
    const schedulingOn = await isModuleEnabled(ctx.tenantId, "scheduling");
    const start = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const brand = await resolveBrandFor(tx, ctx.tenantId, null);
        const tenant = await tx.query.tenants.findFirst({
          where: eq(schema.tenants.id, ctx.tenantId),
          columns: { industry: true },
        });
        // The template is the industry's (slice 15): its frame is the site's
        // starting frame, and its look goes on the kit only where nobody chose.
        const template = templateFor(tenant?.industry);
        const settings = settingsFrom({ ...EMPTY_SETTINGS, ...template.frame }, parsed.data);
        if (template.look && !brand.look && !brand.fontPairing && !brand.buttonShape) {
          await saveKitLook(tx, ctx, null, {
            look: template.look.look ?? "",
            fontPairing: template.look.fontPairing ?? "",
            buttonShape: template.look.buttonShape ?? "",
          });
        }
        const brief = siteBriefFor({ brand, industry: industryLabel(tenant?.industry), settings });
        const blocks = await siteBlockCatalog(tx, ctx.tenantId);
        return { template, settings, brief, brand, blocks };
      },
      { role: ctx.role },
    );
    const { template, settings, brief, brand, blocks } = start;
    const assembled = assembleTemplate(template, brief, { schedulingOn, blocks, pictures: null });
    // The writer, outside any transaction.
    const { pages, source } = await writeSite(template, brief, assembled);
    const siteId = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const site = await createSite(tx, ctx, { slug, settings, copySource: source });
        await replaceDrafts(tx, ctx, site.id, pages, source);
        await logAuditInTx(tx, {
          action: "marketing.site.created",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "site",
          targetId: site.id,
          meta: { slug, copySource: source, pages: pages.length, template: template.slug },
        });
        return site.id;
      },
      { role: ctx.role },
    );
    // The starter pictures, once the site exists: network first, rows second,
    // and the drafts take them in a second pass. A picture that fails is left out.
    await placeStarterPictures(ctx, siteId, template, brief, brand, { schedulingOn, blocks }, pages, source);
    if (settings.address) await placeOnMap(ctx, siteId, settings.address);
    revalidateSite();
    return { ok: true, data: { slug, siteId } };
  } catch (err) {
    return fail(err);
  }
}

/** The assistant writes every draft again from the current kit and details. */
export async function rewriteSiteCopyAction(input: unknown): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const ref = siteRef.safeParse(input);
    if (!ref.success) return { error: "Which website?" };
    const { siteId } = ref.data;
    const schedulingOn = await isModuleEnabled(ctx.tenantId, "scheduling");
    const { brief, brand, template, blocks } = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const site = await findSiteById(tx, ctx.tenantId, siteId);
        if (!site) throw new MarketingError("SITE_MISSING", "no site");
        const brand = await resolveBrandFor(tx, ctx.tenantId, null);
        const tenant = await tx.query.tenants.findFirst({
          where: eq(schema.tenants.id, ctx.tenantId),
          columns: { industry: true },
        });
        const settings = SiteSettingsSchema.parse(site.settings);
        return {
          brand,
          template: templateFor(tenant?.industry),
          blocks: await siteBlockCatalog(tx, ctx.tenantId),
          brief: siteBriefFor({ brand, industry: industryLabel(tenant?.industry), settings }),
        };
      },
      { role: ctx.role },
    );
    const assembled = assembleTemplate(template, brief, { schedulingOn, blocks, pictures: null });
    const { pages, source } = await writeSite(template, brief, assembled);
    await withTenant(
      ctx.tenantId,
      async (tx) => {
        await replaceDrafts(tx, ctx, siteId, pages, source);
        await logAuditInTx(tx, {
          action: "marketing.site.rewritten",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "site",
          targetId: siteId,
          meta: { copySource: source, template: template.slug },
        });
      },
      { role: ctx.role },
    );
    await placeStarterPictures(ctx, siteId, template, brief, brand, { schedulingOn, blocks }, pages, source);
    revalidateSite();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function saveSiteDetailsAction(input: unknown): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = detailsInput.safeParse(input);
    if (!parsed.success) return { error: "Check the fields and try again." };
    const { siteId } = parsed.data;
    const saved = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const site = await findSiteById(tx, ctx.tenantId, siteId);
        if (!site) throw new MarketingError("SITE_MISSING", "no site");
        const existing = readSiteSettings(site.settings);
        const settings = settingsFrom(existing, parsed.data);
        // The pin is kept only for the address it was placed from; any other
        // address is placed again below, after the save.
        settings.map = pinIsFor(existing.map, settings.address) ? existing.map : null;
        await updateSiteSettings(tx, ctx, site.id, { title: parsed.data.title, settings });
        await logAuditInTx(tx, {
          action: "marketing.site.details_saved",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "site",
          targetId: site.id,
        });
        return { address: settings.address, placed: settings.map !== null };
      },
      { role: ctx.role },
    );
    if (saved.address && !saved.placed) await placeOnMap(ctx, siteId, saved.address);
    revalidateSite();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/**
 * The address on the map (ADR 0026): the geocoder, outside any transaction,
 * then the pin written beside the address it came from — unless the
 * address changed again in the meantime, in which case the next save does
 * this over. A miss writes nothing; the Website screen says so.
 */
/**
 * The template's starter pictures, after the site and its drafts exist
 * (slice 15): made or reused in the library (network, outside any
 * transaction), then put into the drafts' template slots in a second pass.
 * A site whose pictures fail is a site without pictures, and says nothing.
 */
async function placeStarterPictures(
  ctx: Awaited<ReturnType<typeof gate>>,
  siteId: string,
  template: SiteTemplate,
  brief: SiteBrief,
  brand: ResolvedBrand,
  have: { schedulingOn: boolean; blocks: BlockCatalogEntry[] },
  pages: AssembledPage[],
  source: "model" | "standard",
): Promise<void> {
  const scenes = scenesFor(template);
  if (scenes.length === 0) return;
  const pictures = await ensureStarterPictures(ctx, siteId, brand, scenes);
  if (Object.keys(pictures).length === 0) return;
  const withPictures = attachPictures(template, brief, have, pages, pictures);
  await withTenant(ctx.tenantId, (tx) => replaceDrafts(tx, ctx, siteId, withPictures, source), { role: ctx.role });
}

async function placeOnMap(
  ctx: Awaited<ReturnType<typeof gate>>,
  siteId: string,
  address: string,
): Promise<void> {
  const pin = await geocodeAddress(address);
  if (!pin) return;
  await withTenant(
    ctx.tenantId,
    async (tx) => {
      const site = await findSiteById(tx, ctx.tenantId, siteId);
      if (!site) return;
      const current = readSiteSettings(site.settings);
      if (current.address.trim() !== address.trim()) return;
      await updateSiteSettings(tx, ctx, site.id, { settings: { ...current, map: pin } });
    },
    { role: ctx.role },
  );
}

const linkInput = z.object({
  label: z.string().trim().max(40).default(""),
  href: z.string().trim().max(200).default(""),
});

/** The Header and footer form, every row as typed; `frameFromInput` applies the rules. */
const headerFooterInput = siteRef.extend({
  announcement: z.object({
    text: z.string().trim().max(120).default(""),
    href: z.string().trim().max(200).default(""),
    shown: z.boolean().default(false),
  }),
  headerButton: linkInput,
  social: z
    .array(
      z.object({
        network: z.enum(SOCIAL_NETWORKS),
        url: z.string().trim().max(200).default(""),
        label: z.string().trim().max(30).default(""),
      }),
    )
    .max(SOCIAL_LINKS_MAX),
  footerColumns: z
    .array(
      z.object({
        heading: z.string().trim().max(40).default(""),
        text: z.string().trim().max(300).default(""),
        links: z.array(linkInput).max(FOOTER_LINKS_MAX),
      }),
    )
    .max(FOOTER_COLUMNS_MAX),
  logoSize: z.enum(["small", "medium", "large"]).default("medium"),
  footerNote: z.string().trim().max(160).default(""),
});

/**
 * The frame around every page: the announcement bar, the header's button,
 * the profiles elsewhere, the footer's columns and line. Settings, like the
 * details, so it shows on the live site the moment it is saved.
 */
export async function saveHeaderFooterAction(input: unknown): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = headerFooterInput.safeParse(input);
    if (!parsed.success) return { error: "Check the fields and try again." };
    const { siteId } = parsed.data;
    const checked = frameFromInput(parsed.data);
    if (!checked.ok) return { error: checked.message };
    await withTenant(
      ctx.tenantId,
      async (tx) => {
        const site = await findSiteById(tx, ctx.tenantId, siteId);
        if (!site) throw new MarketingError("SITE_MISSING", "no site");
        const settings = SiteSettingsSchema.safeParse({
          ...readSiteSettings(site.settings),
          ...checked.frame,
        });
        if (!settings.success) throw new MarketingError("INVALID_INPUT", "settings rejected");
        await updateSiteSettings(tx, ctx, site.id, { settings: settings.data });
        await logAuditInTx(tx, {
          action: "marketing.site.header_footer_saved",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "site",
          targetId: site.id,
        });
      },
      { role: ctx.role },
    );
    revalidateSite();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

const slugInput = siteRef.extend({ slug: z.string().max(80) });

export async function changeSiteSlugAction(
  input: unknown,
): Promise<ActionResult<{ slug: string }>> {
  try {
    const ctx = await gate();
    const parsed = slugInput.safeParse(input);
    if (!parsed.success) return { error: "Give the site an address." };
    const { siteId } = parsed.data;
    const slug = slugFrom(parsed.data.slug);
    await withTenant(
      ctx.tenantId,
      async (tx) => {
        const site = await findSiteById(tx, ctx.tenantId, siteId);
        if (!site) throw new MarketingError("SITE_MISSING", "no site");
        if (site.slug === slug) return;
        await changeSiteSlug(tx, ctx, site, slug);
        await logAuditInTx(tx, {
          action: "marketing.site.address_changed",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "site",
          targetId: site.id,
          meta: { from: site.slug, to: slug },
        });
      },
      { role: ctx.role },
    );
    revalidateSite();
    return { ok: true, data: { slug } };
  } catch (err) {
    return fail(err);
  }
}

export async function publishSiteAction(input: unknown): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const ref = siteRef.safeParse(input);
    if (!ref.success) return { error: "Which website?" };
    const { siteId } = ref.data;
    await withTenant(
      ctx.tenantId,
      async (tx) => {
        const site = await findSiteById(tx, ctx.tenantId, siteId);
        if (!site) throw new MarketingError("SITE_MISSING", "no site");
        await publishSite(tx, ctx, site.id);
        await logAuditInTx(tx, {
          action: "marketing.site.published",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "site",
          targetId: site.id,
          meta: { slug: site.slug },
        });
      },
      { role: ctx.role },
    );
    revalidateSite();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function unpublishSiteAction(input: unknown): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const ref = siteRef.safeParse(input);
    if (!ref.success) return { error: "Which website?" };
    const { siteId } = ref.data;
    await withTenant(
      ctx.tenantId,
      async (tx) => {
        const site = await findSiteById(tx, ctx.tenantId, siteId);
        if (!site) throw new MarketingError("SITE_MISSING", "no site");
        await unpublishSite(tx, ctx, site.id);
        await logAuditInTx(tx, {
          action: "marketing.site.unpublished",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "site",
          targetId: site.id,
          meta: { slug: site.slug },
        });
      },
      { role: ctx.role },
    );
    revalidateSite();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
