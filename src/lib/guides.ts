import "server-only";
import { promises as fs } from "fs";
import path from "path";
import type { TenantContext } from "@/lib/auth";
import { featureRegistry } from "@/lib/features";
import { getIndustryProfile } from "@/industries";
import { isModuleEnabled } from "@/lib/modules";
import { collectLabelDefinitions, resolveLabels } from "@/lib/packs/resolve";
import {
  ENTERPRISE_FALLBACK,
  ENTERPRISE_FALLBACK_PLURAL,
  ENTERPRISE_LABEL_KEY,
} from "@/lib/enterprises/vocabulary";
import { walkMarkdown } from "./markdown-tree";
import {
  applyLabels,
  buildVocabulary,
  fixedSection,
  matchGuide,
  openHref,
  parseGuide,
  sortGuides,
  type Guide,
  type GuideMeta,
  type GuideView,
  type LabelWord,
  type Vocabulary,
} from "./guides-core";

/**
 * Tenant guides — the half that touches the disk and the tenant.
 *
 * `docs/help/` is read at request time, like the build record, and traced into
 * the deployment by `outputFileTracingIncludes` in next.config.ts (the
 * `/dashboard/guides` and `/api/help` keys). A guide that renders locally and
 * is missing in production means that list was not updated.
 */
const GUIDES_DIR = path.join(process.cwd(), "docs", "help");

async function readTree(): Promise<Guide[]> {
  const entries = [...(await walkMarkdown(GUIDES_DIR)).entries()];
  const guides = await Promise.all(
    entries.map(async ([slug, entry]) =>
      parseGuide(slug, await fs.readFile(entry.file, "utf8")),
    ),
  );
  return sortGuides(guides);
}

/**
 * Memoised per server instance in production, where the files are part of the
 * deployment and cannot change under a running process — the cache lives
 * exactly as long as the code it describes, which is why this is a module
 * variable and not a data cache that would outlive a deploy. In development
 * every call walks the tree again, so editing a guide is a refresh, not a
 * restart. What is never cached is a tenant's vocabulary: that is applied per
 * request, per tenant.
 */
let tree: Promise<Guide[]> | null = null;

export function listGuides(): Promise<Guide[]> {
  if (process.env.NODE_ENV !== "production") return readTree();
  if (!tree) {
    tree = readTree().catch((error: unknown) => {
      tree = null;
      throw error;
    });
  }
  return tree;
}

/** Looked up in the walked tree — a path is never built from the caller's slug. */
export async function getGuide(slug: string): Promise<Guide | null> {
  const wanted = slug.toLowerCase();
  return (await listGuides()).find((guide) => guide.slug === wanted) ?? null;
}

export async function findGuideFor(pathname: string, search: string): Promise<Guide | null> {
  return matchGuide(await listGuides(), pathname, search);
}

/**
 * Every renameable word a guide may use: each feature's declared labels, plus
 * the platform's one (`enterprise`), which is declared as constants rather
 * than on a feature because four packs name it and none of them owns it.
 */
export function guideDefinitions(): LabelWord[] {
  const { labels } = collectLabelDefinitions(
    Object.values(featureRegistry).map((feature) => ({
      slug: feature.slug,
      name: feature.name,
      labels: feature.labels,
    })),
  );
  return [
    ...labels.map(({ key, fallback }) => ({ key, fallback })),
    {
      key: ENTERPRISE_LABEL_KEY,
      fallback: ENTERPRISE_FALLBACK,
      plural: ENTERPRISE_FALLBACK_PLURAL,
    },
  ];
}

/**
 * Resolved from `ctx.tenant` with no query — the row already carries the
 * industry and the tenant's own overrides, which is the same device the
 * sidebar uses for its renameable word. Labels are tenant-wide, not per pack:
 * `zone` is Land's word that Livestock also displays.
 */
export function guideVocabulary(tenant: { industry: string; labels: unknown }): Vocabulary {
  return buildVocabulary(
    guideDefinitions(),
    resolveLabels(getIndustryProfile(tenant.industry)?.labels, tenant.labels),
  );
}

export function localiseGuide(guide: Guide, vocabulary: Vocabulary): Guide {
  return {
    ...guide,
    title: applyLabels(guide.title, vocabulary),
    summary: applyLabels(guide.summary, vocabulary),
    area: guide.area === null ? null : applyLabels(guide.area, vocabulary),
    content: applyLabels(guide.content, vocabulary),
  };
}

/**
 * The same two gates a module page applies: the feature has to exist AND be
 * switched on for this tenant. A guide for a module the business never bought
 * is not a secret, but a URL that describes a screen the reader cannot reach
 * is a confusing one. `settings` guides are owner-only, like the pages.
 */
export async function canReadGuide(ctx: TenantContext, guide: GuideMeta): Promise<boolean> {
  const fixed = fixedSection(guide.feature);
  if (fixed) return !fixed.ownerOnly || ctx.role === "owner";
  if (!(guide.feature in featureRegistry)) return false;
  return isModuleEnabled(ctx.tenant.id, guide.feature);
}

export function toGuideView(guide: Guide): GuideView {
  return {
    slug: guide.slug,
    feature: guide.feature,
    title: guide.title,
    summary: guide.summary,
    content: guide.content,
    openHref: guide.routes[0] ? openHref(guide.routes[0]) : null,
  };
}
