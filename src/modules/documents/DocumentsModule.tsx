import Link from "next/link";
import { ChevronRight, FolderOpen, Inbox, Lock } from "lucide-react";
import { withTenant } from "@/db";
import type { TenantContext } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/app/page-header";
import { SectionRow } from "@/components/app/section-row";
import { EmptyState } from "@/components/app/empty-state";
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
      <PageHeader
        title="Documents"
        description="Every file the business runs on — office, field and shop floor."
        icon={<FolderOpen />}
        actions={
          <>
            <UploadButton tenantId={ctx.tenant.id} folderId={null} />
            <NewFolderButton parentId={null} isOwner={ctx.role === "owner"} />
          </>
        }
      />

      <DocumentsNav />

      {/* The Inbox is a destination, not a statistic, so it stays a full-width
          row rather than joining the folder grid. */}
      <Link
        href={`${BASE}/inbox`}
        className="flex items-center gap-3 rounded-2xl bg-card px-4 py-4 shadow-elevation-1 transition-shadow hover:shadow-elevation-3 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-module-accent/10 text-module-accent">
          <Inbox className="size-[18px]" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-heading font-medium tracking-heading">Inbox</p>
          <p className="text-sm text-muted-foreground">
            {counts.inbox === 0
              ? "Nothing waiting to be filed."
              : `${counts.inbox} ${counts.inbox === 1 ? "file" : "files"} waiting to be filed.`}
          </p>
        </div>
        <ChevronRight className="size-4 shrink-0 text-subtle-foreground" />
      </Link>

      <SectionRow title="Folders" href={`${BASE}/browse`}>
        {folders.length === 0 ? (
          <EmptyState
            panel
            icon={<FolderOpen />}
            title="Start your filing cabinet"
            description="Create a folder above, or drop files into the Inbox and file them from there."
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {folders.map((folder) => {
              const n = counts.byFolder.get(folder.id) ?? 0;
              return (
                <Link
                  key={folder.id}
                  href={`${BASE}/browse/${folder.id}`}
                  className="flex items-center gap-3 rounded-2xl bg-card px-4 py-3.5 shadow-elevation-1 transition-shadow hover:shadow-elevation-3 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  <FolderOpen className="size-4 shrink-0 text-module-accent" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {folder.name}
                    </p>
                    <p className="text-xs text-subtle-foreground">
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
      </SectionRow>
    </div>
  );
}
