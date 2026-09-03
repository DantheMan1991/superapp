import Link from "next/link";
import { createElement, type CSSProperties } from "react";
import { BookOpen } from "lucide-react";
import { requireTenant } from "@/lib/auth";
import { getActiveModules } from "@/lib/modules";
import { getRenderableFeature } from "@/lib/features";
import { getIndustryProfile } from "@/industries";
import { guideVocabulary, listGuides } from "@/lib/guides";
import {
  applyLabels,
  guideAreas,
  guideIndexFor,
  GUIDES_HREF,
  type GuideMeta,
  type IndexFeature,
  type Vocabulary,
} from "@/lib/guides-core";
import { PageHeader } from "@/components/app/page-header";
import { SectionRow } from "@/components/app/section-row";
import { EmptyState } from "@/components/app/empty-state";
import { getIcon } from "@/components/app/icon-registry";

export const dynamic = "force-dynamic";

/**
 * Every guide for the tools this business has switched on, grouped the way the
 * sidebar is. The feature list is built exactly as the rail builds it — enabled
 * AND renderable — so the two can never disagree about what exists. A feature
 * with no guide yet is listed anyway: the gap is the information.
 *
 * Cards, not a list. The first version stacked a module's guides in one
 * divided list, and Accounting's thirty-five read as a wall (founder,
 * 2026-09-03: "one long list with no separation per guide item"). Each guide
 * is now a tile in a grid, the same tile the Overview uses for modules, and a
 * feature with many guides captions them by `Area` — the feature's own menu
 * words, in its menu's order — so the page reads like the screen it describes.
 */
export default async function GuidesPage() {
  const ctx = await requireTenant();
  const [active, guides] = await Promise.all([
    getActiveModules(ctx.tenant.id),
    listGuides(),
  ]);
  const features: IndexFeature[] = active
    .filter(({ module }) => getRenderableFeature(module.id))
    .map(({ module }) => ({
      slug: module.id,
      name: module.name,
      category: module.category,
      icon: getRenderableFeature(module.id)?.icon ?? "boxes",
    }));
  const vocabulary = guideVocabulary(ctx.tenant);
  const sections = guideIndexFor(guides, features, {
    profileName: getIndustryProfile(ctx.tenant.industry)?.name ?? null,
    isOwner: ctx.role === "owner",
  });
  const written = sections
    .flatMap((section) => section.groups)
    .reduce((count, group) => count + group.guides.length, 0);

  return (
    <div className="space-y-10">
      <PageHeader
        title="Guides"
        description="How to use each part of Yosher, screen by screen."
        icon={<BookOpen />}
      />

      {written === 0 ? (
        <EmptyState
          panel
          icon={<BookOpen />}
          title="No guides written yet"
          description="Guides are being written screen by screen. Check back soon."
        />
      ) : (
        sections.map((section) => (
          <SectionRow key={section.key} title={section.label}>
            <div className="space-y-8">
              {section.groups.map((group) => {
                // A fixed section is its own single group; naming it twice is noise.
                const named = group.slug !== section.key;
                return (
                  <div
                    key={group.slug}
                    style={
                      {
                        "--module-accent": `var(--accent-${group.slug}, var(--accent-brand))`,
                      } as CSSProperties
                    }
                  >
                    {named && (
                      <div className="mb-3 flex items-center gap-3">
                        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-module-accent/10 text-module-accent">
                          {createElement(getIcon(group.icon), { className: "size-4" })}
                        </div>
                        <p className="font-heading font-medium tracking-heading">
                          {group.name}
                        </p>
                        {group.guides.length > 0 && (
                          <p className="text-sm text-muted-foreground">
                            {group.guides.length === 1
                              ? "1 guide"
                              : `${group.guides.length} guides`}
                          </p>
                        )}
                      </div>
                    )}
                    {group.guides.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No guide yet.</p>
                    ) : (
                      <div className="space-y-5">
                        {guideAreas(group.guides).map(({ area, guides: inArea }) => (
                          <div key={area ?? ""}>
                            {area && (
                              <p className="mb-2 text-xs font-medium tracking-wider text-muted-foreground uppercase">
                                {applyLabels(area, vocabulary)}
                              </p>
                            )}
                            <GuideGrid guides={inArea} vocabulary={vocabulary} />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </SectionRow>
        ))
      )}
    </div>
  );
}

/** The Overview's module tile, with a guide's title and summary on it. */
function GuideGrid({
  guides,
  vocabulary,
}: {
  guides: readonly GuideMeta[];
  vocabulary: Vocabulary;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {guides.map((guide) => (
        <Link
          key={guide.slug}
          href={`${GUIDES_HREF}/${guide.slug}`}
          className="group/tile block rounded-2xl bg-card p-4 shadow-elevation-1 transition-shadow hover:shadow-elevation-3 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <p className="font-heading font-medium tracking-heading">
            {applyLabels(guide.title, vocabulary)}
          </p>
          {guide.summary && (
            <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">
              {applyLabels(guide.summary, vocabulary)}
            </p>
          )}
        </Link>
      ))}
    </div>
  );
}
