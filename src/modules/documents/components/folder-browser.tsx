import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, FileText, FolderOpen, Lock } from "lucide-react";
import { withTenant } from "@/db";
import type { TenantContext } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  listFolderContents,
  loadAncestors,
  loadFolderById,
} from "../browse";
import { listFolders } from "../folders";
import { formatBytes } from "../lib/format";
import { folderOptions } from "../lib/folder-labels";
import { wouldCreateCycle } from "../core/tree";
import { DocumentsNav } from "./documents-nav";
import { DocumentRowMenu, UploadButton } from "./document-controls";
import {
  FolderRowMenu,
  NewFolderButton,
  type FolderOption,
} from "@/app/dashboard/m/documents/browse/folder-controls";

const BASE = "/dashboard/m/documents/browse";

/**
 * One folder's contents. Shared by the browse root and /browse/[folderId] so
 * both views cannot drift apart.
 *
 * Every read passes ctx.role, so an owners-only folder is not "filtered out"
 * for staff — RLS never returns it, and a staff member who types its id gets
 * the same 404 as for a folder that does not exist.
 */
export async function FolderBrowser({
  ctx,
  folderId,
  cursor,
}: {
  ctx: TenantContext;
  folderId: string | null;
  cursor?: string;
}) {
  const isOwner = ctx.role === "owner";

  const data = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const folder =
        folderId === null ? null : await loadFolderById(tx, ctx.tenant.id, folderId);
      if (folderId !== null && folder === null) return null;

      const [contents, ancestors, allFolders] = await Promise.all([
        listFolderContents(tx, ctx.tenant.id, { folderId, cursor }),
        folder ? loadAncestors(tx, ctx.tenant.id, folder) : Promise.resolve([]),
        listFolders(tx, ctx.tenant.id),
      ]);
      return { folder, contents, ancestors, allFolders };
    },
    { role: ctx.role },
  );

  if (data === null) notFound();
  const { folder, contents, ancestors, allFolders } = data;

  // Drop the move targets that would create a cycle — the same rule the server
  // enforces, applied in the UI so an impossible move is never offered.
  const moveTargetsFor = (movingPath: string): FolderOption[] =>
    folderOptions(allFolders.filter((f) => !wouldCreateCycle(movingPath, f.path)));

  // Documents have no subtree, so every visible folder is a valid destination.
  const folderChoices: FolderOption[] = folderOptions(allFolders);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {folder ? folder.name : "Documents"}
          </h1>
          <nav className="mt-1 flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
            <Link href={BASE} className="hover:text-foreground">
              All folders
            </Link>
            {ancestors.map((crumb) => (
              <span key={crumb.id} className="flex items-center gap-1">
                <ChevronRight className="size-3" />
                <Link
                  href={`${BASE}/${crumb.id}`}
                  className="hover:text-foreground"
                >
                  {crumb.name}
                </Link>
              </span>
            ))}
            {folder && (
              <span className="flex items-center gap-1">
                <ChevronRight className="size-3" />
                <span className="text-foreground">{folder.name}</span>
              </span>
            )}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          {folder?.effectiveVisibility === "owners" && (
            <Badge variant="secondary" className="gap-1">
              <Lock className="size-3" />
              {folder.visibility === "owners" ? "Owners only" : "Inherited"}
            </Badge>
          )}
          <UploadButton
            tenantId={ctx.tenant.id}
            folderId={folder?.id ?? null}
          />
          <NewFolderButton parentId={folder?.id ?? null} isOwner={isOwner} />
        </div>
      </div>

      <DocumentsNav />

      {contents.subfolders.length === 0 && contents.documents.length === 0 ? (
        <p className="rounded-md border px-4 py-10 text-center text-sm text-muted-foreground">
          This folder is empty.
        </p>
      ) : (
        <div className="divide-y rounded-md border">
          {contents.subfolders.map((sub) => (
            <div key={sub.id} className="flex items-center gap-3 px-4 py-3">
              <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
              <Link
                href={`${BASE}/${sub.id}`}
                className="min-w-0 flex-1 truncate text-sm font-medium hover:underline"
              >
                {sub.name}
              </Link>
              {sub.effectiveVisibility === "owners" && (
                <Badge variant="secondary" className="gap-1">
                  <Lock className="size-3" />
                  {sub.visibility === "owners" ? "Owners" : "Inherited"}
                </Badge>
              )}
              <FolderRowMenu
                folder={{
                  id: sub.id,
                  name: sub.name,
                  version: sub.version,
                  visibility: sub.visibility,
                  effectiveVisibility: sub.effectiveVisibility,
                  inherited:
                    sub.effectiveVisibility === "owners" &&
                    sub.visibility !== "owners",
                }}
                isOwner={isOwner}
                moveTargets={moveTargetsFor(sub.path)}
              />
            </div>
          ))}

          {contents.documents.map((doc) => (
            <div key={doc.id} className="flex items-center gap-3 px-4 py-3">
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <a
                  href={`/api/documents/${doc.id}/file`}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate text-sm font-medium hover:underline"
                >
                  {doc.title || doc.fileName}
                </a>
                <p className="text-xs text-muted-foreground">
                  {formatBytes(doc.sizeBytes)}
                  {doc.fileVersionCount > 1 && ` · v${doc.fileVersionNo}`}
                  {doc.origin === "accounting" && " · from Receipts"}
                </p>
              </div>
              <span className="hidden text-xs text-muted-foreground sm:inline">
                {doc.createdAt.toLocaleDateString()}
              </span>
              <DocumentRowMenu
                documentId={doc.id}
                folders={folderChoices}
                version={doc.version}
                title={doc.title}
                fileName={doc.fileName}
              />
            </div>
          ))}
        </div>
      )}

      {contents.nextCursor && (
        <div className="flex justify-center">
          <Button asChild variant="outline">
            <Link
              href={`${folder ? `${BASE}/${folder.id}` : BASE}?cursor=${encodeURIComponent(contents.nextCursor)}`}
            >
              Load more
            </Link>
          </Button>
        </div>
      )}
    </div>
  );
}
