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
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const def = getModuleDefinition(slug);
  if (!def) notFound();

  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, def.slug);

  // Search params are handed to the module because this codebase keeps view
  // state in the URL — a folder, a search, an open message. A module rendering
  // here would otherwise have no way to read its own query string.
  const Component = def.Component;
  return <Component ctx={ctx} searchParams={await searchParams} />;
}
