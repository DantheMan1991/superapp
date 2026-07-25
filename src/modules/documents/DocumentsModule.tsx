import Link from "next/link";
import { ChevronRight, FolderOpen, Inbox, Lock } from "lucide-react";
import { withTenant } from "@/db";
import type { TenantContext } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { countDocumentsByFolder, listRootFolders } from "./folders";
import { DocumentsNav } from "./components/documents-nav";
import { UploadButton } from "./components/document-controls";
import { NewFolderButton } from "@/app/dashboard/m/documents/browse/folder-controls";

const BASE = "/dashboard/m/documents";

/**
 * The cabinet overview: the top level of the folder tree plus the Inbox.
 *
 * Everything on this page is a way in — folder cards open the browser, the
 * Inbox card opens the Inbox, and the header carries the same Upload and New
 * folder actions as the browse view. An overview that only reports counts is a
 * dead end.
 *
 * The read passes ctx.role through to withTenant, which is what lets RLS
 * decide whether owners-only folders come back at all. A staff member does not
 * see a filtered list — they see a list that never contained those rows.
 */
export async function DocumentsModule({ ctx }: { ctx: TenantContext }) {
  const { folders, counts } = await withTenant(
    ctx.tenant.id,
    async (tx) => ({
      folders: await listRootFolders(tx, ctx.tenant.id),
      counts: await countDocumentsByFolder(tx, ctx.tenant.id),
    }),
    { role: ctx.role },
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-brand/15 text-brand-foreground">
            <FolderOpen className="size-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Documents</h1>
            <p className="text-sm text-muted-foreground">
              Every file the business runs on — office, field and shop floor.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <UploadButton tenantId={ctx.tenant.id} folderId={null} />
          <NewFolderButton parentId={null} isOwner={ctx.role === "owner"} />
        </div>
      </div>

      <DocumentsNav />

      <Link
        href={`${BASE}/inbox`}
        className="flex items-center gap-3 rounded-md border px-4 py-4 transition-colors hover:bg-accent/40"
      >
        <Inbox className="size-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Inbox</p>
          <p className="text-sm text-muted-foreground">
            {counts.inbox === 0
              ? "Nothing waiting to be filed."
              : `${counts.inbox} ${counts.inbox === 1 ? "file" : "files"} waiting to be filed.`}
          </p>
        </div>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      </Link>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted-foreground">Folders</h2>
          <Link
            href={`${BASE}/browse`}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Browse all
          </Link>
        </div>
        {folders.length === 0 ? (
          <p className="rounded-md border px-4 py-10 text-center text-sm text-muted-foreground">
            No folders yet. Create the first one above.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {folders.map((folder) => {
              const n = counts.byFolder.get(folder.id) ?? 0;
              return (
                <Link
                  key={folder.id}
                  href={`${BASE}/browse/${folder.id}`}
                  className="flex items-center gap-3 rounded-md border px-4 py-3 transition-colors hover:bg-accent/40"
                >
                  <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {folder.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {n === 0 ? "Empty" : `${n} ${n === 1 ? "file" : "files"}`}
                    </p>
                  </div>
                  {folder.effectiveVisibility === "owners" && (
                    <Badge variant="secondary" className="gap-1">
                      <Lock className="size-3" />
                      Owners
                    </Badge>
                  )}
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
