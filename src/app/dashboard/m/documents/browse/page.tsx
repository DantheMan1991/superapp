import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { FolderBrowser } from "@/modules/documents/components/folder-browser";
import { parseViewMode } from "@/modules/documents/lib/view-mode";

export const dynamic = "force-dynamic";

export default async function BrowseRootPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string; view?: string }>;
}) {
  const { cursor, view } = await searchParams;
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "documents");

  return (
    <FolderBrowser
      ctx={ctx}
      folderId={null}
      cursor={cursor}
      view={parseViewMode(view)}
    />
  );
}
