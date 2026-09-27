import { notFound } from "next/navigation";
import { requirePersonalSpace } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { getRenderableFeature } from "@/lib/features";

export const dynamic = "force-dynamic";

/**
 * A PERSONAL TOOL'S FRONT PAGE (ADR 0111) — the personal twin of
 * `src/app/dashboard/m/[slug]/page.tsx`, with the personal space's door in
 * place of the business one.
 *
 * The module gate is the same call, and it is what keeps the two halves
 * apart here: `requireModuleEnabled` answers not-found for a tool that is not
 * a personal tool (`moduleFitsTenant`), so `/personal/m/accounting` is a 404
 * even for a person whose business runs Accounting. A tool's deeper screens
 * are real routes beside this one (`m/fitness/...`), each gating itself.
 */
export default async function PersonalToolPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const def = getRenderableFeature(slug);
  if (!def) notFound();
  const ctx = await requirePersonalSpace();
  await requireModuleEnabled(ctx.tenant.id, def.slug);
  const Component = def.Component;
  return <Component ctx={ctx} searchParams={await searchParams} />;
}
