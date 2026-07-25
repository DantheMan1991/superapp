import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { FolderBrowser } from "@/modules/documents/components/folder-browser";

export const dynamic = "force-dynamic";

export default async function BrowseRootPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>;
}) {
  const { cursor } = await searchParams;
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "documents");

  return <FolderBrowser ctx={ctx} folderId={null} cursor={cursor} />;
}
