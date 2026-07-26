import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { cookies } from "next/headers";
import { FolderBrowser } from "@/modules/documents/components/folder-browser";
import {
  resolveViewMode,
  VIEW_MODE_COOKIE,
} from "@/modules/documents/lib/view-mode";

export const dynamic = "force-dynamic";

export default async function BrowseFolderPage({
  params,
  searchParams,
}: {
  params: Promise<{ folderId: string }>;
  searchParams: Promise<{ cursor?: string; view?: string }>;
}) {
  const { folderId } = await params;
  const { cursor, view } = await searchParams;
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "documents");

  // An owners-only folder is invisible to staff at the RLS layer, so this
  // resolves to the same notFound() as a folder that never existed — the
  // application genuinely cannot tell the two apart, which is the point.
  // Read on the server so the first paint is already the right layout.
  const stored = (await cookies()).get(VIEW_MODE_COOKIE)?.value;

  return (
    <FolderBrowser
      ctx={ctx}
      folderId={folderId}
      cursor={cursor}
      view={resolveViewMode(view, stored)}
    />
  );
}
