import Link from "next/link";
import { notFound } from "next/navigation";
import { createElement, type CSSProperties } from "react";
import { ArrowLeft } from "lucide-react";
import { requireTenant } from "@/lib/auth";
import { getFeature } from "@/lib/features";
import { canReadGuide, getGuide, guideVocabulary, localiseGuide } from "@/lib/guides";
import { fixedSection, GUIDES_HREF, openHref } from "@/lib/guides-core";
import { PageHeader } from "@/components/app/page-header";
import { Markdown } from "@/components/app/markdown";
import { getIcon } from "@/components/app/icon-registry";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

/**
 * One guide, in full. The same two gates as the module page it describes —
 * the feature exists and is switched on for this tenant — so a guide URL never
 * describes a screen the reader cannot open.
 *
 * The route sits outside `/dashboard/m/`, so `--module-accent` is unset here;
 * it is set by hand from the guide's folder, the way the module layout does,
 * with the same fallback to the brand accent for a folder that has no token.
 */
export default async function GuidePage({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}) {
  const { slug } = await params;
  const ctx = await requireTenant();
  const guide = await getGuide(slug.join("/"));
  if (!guide || !(await canReadGuide(ctx, guide))) notFound();

  const view = localiseGuide(guide, guideVocabulary(ctx.tenant));
  const fixed = fixedSection(guide.feature);
  const feature = fixed ? null : getFeature(guide.feature);
  // `createElement` rather than `const Icon = …; <Icon />`: the registry hands
  // back an existing component, but `react-hooks/static-components` cannot
  // tell that from one created during render and rejects the variable form.
  const icon = createElement(getIcon(fixed?.icon ?? feature?.icon));
  const sectionName = fixed?.label ?? feature?.name ?? guide.feature;
  const screen = guide.routes[0] ? openHref(guide.routes[0]) : null;

  return (
    <div
      style={
        {
          display: "contents",
          "--module-accent": `var(--accent-${guide.feature}, var(--accent-brand))`,
        } as CSSProperties
      }
    >
      <div className="space-y-6">
        <Link
          href={GUIDES_HREF}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Guides
          <span className="text-muted-foreground"> / {sectionName}</span>
        </Link>

        <PageHeader
          title={view.title}
          description={view.summary}
          icon={icon}
          actions={
            screen ? (
              <Button asChild variant="outline" size="sm">
                <Link href={screen}>Open this screen</Link>
              </Button>
            ) : undefined
          }
        />

        <Markdown
          source={view.content}
          flavor="guide"
          linkBase={{ root: GUIDES_HREF, slug: guide.slug }}
          className="max-w-3xl"
        />
      </div>
    </div>
  );
}
