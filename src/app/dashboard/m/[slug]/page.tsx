import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { getModuleDefinition } from "@/modules";

export const dynamic = "force-dynamic";

/**
 * The single seam where modules render into the shell. A module page exists
 * only if (a) the slug has a code-side definition and (b) the module is
 * switched on for this tenant. Both checked server-side on every request.
 */
export default async function ModulePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const def = getModuleDefinition(slug);
  if (!def) notFound();

  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, def.slug);

  const Component = def.Component;
  return <Component ctx={ctx} />;
}
