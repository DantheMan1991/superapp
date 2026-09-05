"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { schema, withTenant } from "@/db";
import { logAuditInTx } from "@/lib/audit";
import { resolveBrandFor } from "@/lib/brand/read";
import { assembleSite } from "@/lib/sites/copy";
import { frameFromInput } from "@/lib/sites/frame";
import { SOCIAL_NETWORKS } from "@/lib/sites/links";
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
import { siteBriefFor, writeSiteCopy } from "./site-generate";
import {
  changeSiteSlug,
  createSite,
  findSite,
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
  revalidatePath(BASE);
  revalidatePath("/sites/[slug]/[[...path]]", "page");
  revalidatePath("/hosted/[slug]/[[...path]]", "page");
  revalidatePath("/domain/[host]/[[...path]]", "page");
}

const detailsInput = z.object({
  title: z.string().trim().max(80).default(""),
  phone: z.string().trim().max(40).default(""),
  email: z.string().trim().max(120).default(""),
  address: z.string().trim().max(240).default(""),
  /** The textarea, one line per entry. */
  hoursText: z.string().max(800).default(""),
});

/**
 * Textarea → settings, through the schema the renderer reads. The details
 * are four of the settings' fields; the frame (the header, the footer, the
 * bar) is the rest, and a save of the details leaves it as it was.
 */
function settingsFrom(existing: SiteSettings, input: z.infer<typeof detailsInput>): SiteSettings {
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
  });
  if (!parsed.success) throw new MarketingError("INVALID_INPUT", "settings rejected");
  return parsed.data;
}

function slugFrom(raw: string): string {
  const check = normalizeSiteSlug(raw);
  if (!check.ok) throw new MarketingError("SLUG_INVALID", slugReasonMessage(check.reason));
  return check.slug;
}

const buildInput = detailsInput.extend({ slug: z.string().max(80) });

export async function createSiteAction(
  input: unknown,
): Promise<ActionResult<{ slug: string }>> {
  try {
    const ctx = await gate();
    const parsed = buildInput.safeParse(input);
    if (!parsed.success) return { error: "Check the fields and try again." };
    const slug = slugFrom(parsed.data.slug);
    const settings = settingsFrom(EMPTY_SETTINGS, parsed.data);
    const brief = await withTenant(
      ctx.tenantId,
      async (tx) => {
        if (await findSite(tx, ctx.tenantId)) {
          throw new MarketingError("SITE_EXISTS", "site exists");
        }
        const brand = await resolveBrandFor(tx, ctx.tenantId, null);
        const tenant = await tx.query.tenants.findFirst({
          where: eq(schema.tenants.id, ctx.tenantId),
          columns: { industry: true },
        });
        return siteBriefFor({ brand, industry: industryLabel(tenant?.industry), settings });
      },
      { role: ctx.role },
    );
    // The assistant, outside any transaction.
    const { copy, source } = await writeSiteCopy(brief);
    const pages = assembleSite(brief, copy);
    await withTenant(
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
          meta: { slug, copySource: source, pages: pages.length },
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

/** The assistant writes every draft again from the current kit and details. */
export async function rewriteSiteCopyAction(): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const { siteId, brief } = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const site = await findSite(tx, ctx.tenantId);
        if (!site) throw new MarketingError("SITE_MISSING", "no site");
        const brand = await resolveBrandFor(tx, ctx.tenantId, null);
        const tenant = await tx.query.tenants.findFirst({
          where: eq(schema.tenants.id, ctx.tenantId),
          columns: { industry: true },
        });
        const settings = SiteSettingsSchema.parse(site.settings);
        return {
          siteId: site.id,
          brief: siteBriefFor({ brand, industry: industryLabel(tenant?.industry), settings }),
        };
      },
      { role: ctx.role },
    );
    const { copy, source } = await writeSiteCopy(brief);
    const pages = assembleSite(brief, copy);
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
          meta: { copySource: source },
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

export async function saveSiteDetailsAction(input: unknown): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = detailsInput.safeParse(input);
    if (!parsed.success) return { error: "Check the fields and try again." };
    await withTenant(
      ctx.tenantId,
      async (tx) => {
        const site = await findSite(tx, ctx.tenantId);
        if (!site) throw new MarketingError("SITE_MISSING", "no site");
        const settings = settingsFrom(readSiteSettings(site.settings), parsed.data);
        await updateSiteSettings(tx, ctx, site.id, { title: parsed.data.title, settings });
        await logAuditInTx(tx, {
          action: "marketing.site.details_saved",
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

const linkInput = z.object({
  label: z.string().trim().max(40).default(""),
  href: z.string().trim().max(200).default(""),
});

/** The Header and footer form, every row as typed; `frameFromInput` applies the rules. */
const headerFooterInput = z.object({
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
    const checked = frameFromInput(parsed.data);
    if (!checked.ok) return { error: checked.message };
    await withTenant(
      ctx.tenantId,
      async (tx) => {
        const site = await findSite(tx, ctx.tenantId);
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

const slugInput = z.object({ slug: z.string().max(80) });

export async function changeSiteSlugAction(
  input: unknown,
): Promise<ActionResult<{ slug: string }>> {
  try {
    const ctx = await gate();
    const parsed = slugInput.safeParse(input);
    if (!parsed.success) return { error: "Give the site an address." };
    const slug = slugFrom(parsed.data.slug);
    await withTenant(
      ctx.tenantId,
      async (tx) => {
        const site = await findSite(tx, ctx.tenantId);
        if (!site) throw new MarketingError("SITE_MISSING", "no site");
        if (site.slug === slug) return;
        await changeSiteSlug(tx, ctx, site.id, slug);
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

export async function publishSiteAction(): Promise<ActionResult> {
  try {
    const ctx = await gate();
    await withTenant(
      ctx.tenantId,
      async (tx) => {
        const site = await findSite(tx, ctx.tenantId);
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

export async function unpublishSiteAction(): Promise<ActionResult> {
  try {
    const ctx = await gate();
    await withTenant(
      ctx.tenantId,
      async (tx) => {
        const site = await findSite(tx, ctx.tenantId);
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
