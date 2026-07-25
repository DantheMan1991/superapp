import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { FolderBrowser } from "@/modules/documents/components/folder-browser";

export const dynamic = "force-dynamic";

export default async function BrowseFolderPage({
  params,
  searchParams,
}: {
  params: Promise<{ folderId: string }>;
  searchParams: Promise<{ cursor?: string }>;
}) {
  const { folderId } = await params;
  const { cursor } = await searchParams;
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "documents");

  // An owners-only folder is invisible to staff at the RLS layer, so this
  // resolves to the same notFound() as a folder that never existed — the
  // application genuinely cannot tell the two apart, which is the point.
  return <FolderBrowser ctx={ctx} folderId={folderId} cursor={cursor} />;
}
