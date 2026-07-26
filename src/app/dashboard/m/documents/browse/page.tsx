import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { cookies } from "next/headers";
import { FolderBrowser } from "@/modules/documents/components/folder-browser";
import {
  resolveViewMode,
  VIEW_MODE_COOKIE,
} from "@/modules/documents/lib/view-mode";

export const dynamic = "force-dynamic";

export default async function BrowseRootPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string; view?: string }>;
}) {
  const { cursor, view } = await searchParams;
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "documents");

  // Read on the server so the first paint is already the right layout — a
  // client-side preference would render the list and then flip.
  const stored = (await cookies()).get(VIEW_MODE_COOKIE)?.value;

  return (
    <FolderBrowser
      ctx={ctx}
      folderId={null}
      cursor={cursor}
      view={resolveViewMode(view, stored)}
    />
  );
}
