import Link from "next/link";
import type { CSSProperties } from "react";
import { BookOpen } from "lucide-react";
import { requireTenant } from "@/lib/auth";
import { getActiveModules } from "@/lib/modules";
import { getRenderableFeature } from "@/lib/features";
import { getIndustryProfile } from "@/industries";
import { guideVocabulary, listGuides } from "@/lib/guides";
import {
  applyLabels,
  guideIndexFor,
  GUIDES_HREF,
  type IndexFeature,
} from "@/lib/guides-core";
import { PageHeader } from "@/components/app/page-header";
import { SectionRow } from "@/components/app/section-row";
import { Panel } from "@/components/app/panel";
import { EmptyState } from "@/components/app/empty-state";
import { getIcon } from "@/components/app/icon-registry";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Every guide for the tools this business has switched on, grouped the way the
 * sidebar is. The feature list is built exactly as the rail builds it — enabled
 * AND renderable — so the two can never disagree about what exists. A feature
 * with no guide yet is listed anyway: the gap is the information.
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
    <div className="space-y-8">
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
            <Panel>
              <ul className="divide-y divide-divider">
                {section.groups.map((group) => {
                  const Icon = getIcon(group.icon);
                  // A fixed section is its own single group; naming it twice is noise.
                  const named = group.slug !== section.key;
                  return (
                    <li
                      key={group.slug}
                      className="flex gap-3 px-4 py-3"
                      style={
                        {
                          "--module-accent": `var(--accent-${group.slug}, var(--accent-brand))`,
                        } as CSSProperties
                      }
                    >
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-module-accent/10 text-module-accent">
                        <Icon className="size-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        {named && <p className="text-sm font-medium">{group.name}</p>}
                        {group.guides.length === 0 ? (
                          <p className="text-sm text-muted-foreground">No guide yet.</p>
                        ) : (
                          <ul className={cn("space-y-2", named && "mt-1")}>
                            {group.guides.map((guide) => (
                              <li key={guide.slug}>
                                <Link
                                  href={`${GUIDES_HREF}/${guide.slug}`}
                                  className="text-sm font-medium hover:underline"
                                >
                                  {applyLabels(guide.title, vocabulary)}
                                </Link>
                                {guide.summary && (
                                  <p className="text-sm text-muted-foreground">
                                    {applyLabels(guide.summary, vocabulary)}
                                  </p>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Panel>
          </SectionRow>
        ))
      )}
    </div>
  );
}
