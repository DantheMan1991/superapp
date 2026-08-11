import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, FileText, FolderOpen, Lock } from "lucide-react";
import { withTenant } from "@/db";
import type { TenantContext } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import {
  listFolderContents,
  loadAncestors,
  loadFolderById,
} from "../browse";
import { listFolders, loadDocumentSettings } from "../folders";
import { listTags } from "../tag-ops";
import { TagChips } from "./tag-chips";
import { formatBytes } from "../lib/format";
import { folderOptions } from "../lib/folder-labels";
import { folderInboundAddress } from "../inbound";
import { wouldCreateCycle } from "../core/tree";
import { DocumentsNav } from "./documents-nav";
import { DocumentRowMenu, UploadButton } from "./document-controls";
import {
  BreadcrumbDropTarget,
  DraggableRow,
  FolderDropTarget,
  UploadDropZone,
} from "./drag-drop";
import { ViewSwitch } from "./view-switch";
import { FileOpenTrigger } from "./file-viewer";
import { FileTile, FolderTile, TileGrid } from "./file-tiles";
import { DEFAULT_VIEW_MODE, type ViewMode } from "../lib/view-mode";
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
  view = DEFAULT_VIEW_MODE,
}: {
  ctx: TenantContext;
  folderId: string | null;
  cursor?: string;
  view?: ViewMode;
}) {
  const isOwner = ctx.role === "owner";
  const isGrid = view !== "list";

  const data = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const folder =
        folderId === null ? null : await loadFolderById(tx, ctx.tenant.id, folderId);
      if (folderId !== null && folder === null) return null;

      const [contents, ancestors, allFolders, settings, allTags] =
        await Promise.all([
          listFolderContents(tx, ctx.tenant.id, { folderId, cursor }),
          folder ? loadAncestors(tx, ctx.tenant.id, folder) : Promise.resolve([]),
          listFolders(tx, ctx.tenant.id),
          loadDocumentSettings(tx, ctx.tenant.id),
          // Once per page, not once per row — the picker and the chips share it.
          listTags(tx, ctx.tenant.id),
        ]);
      return { folder, contents, ancestors, allFolders, settings, allTags };
    },
    { role: ctx.role },
  );

  if (data === null) notFound();
  const { folder, contents, ancestors, allFolders, settings, allTags } = data;
  const tagChoices = allTags.map((t) => ({
    id: t.id,
    slug: t.slug,
    name: t.name,
    version: t.version,
  }));
  const tagNames = Object.fromEntries(allTags.map((t) => [t.slug, t.name]));
  // Undefined disables the share option entirely — an unprovisioned or
  // sharing-disabled tenant should not be offered it at all.
  const shareMaxTtlDays =
    settings && settings.sharingEnabled ? settings.shareMaxTtlDays : undefined;
  // Undefined disables the folder-address option entirely — without a
  // receiving domain there is no address to hand out.
  const inboundDomain = process.env.INBOUND_EMAIL_DOMAIN ?? null;

  // Drop the move targets that would create a cycle — the same rule the server
  // enforces, applied in the UI so an impossible move is never offered.
  const moveTargetsFor = (movingPath: string): FolderOption[] =>
    folderOptions(allFolders.filter((f) => !wouldCreateCycle(movingPath, f.path)));

  // Documents have no subtree, so every visible folder is a valid destination.
  const folderChoices: FolderOption[] = folderOptions(allFolders);

  return (
    <div className="space-y-6">
      {/* The breadcrumb goes in `description`, which takes a node — the crumbs
          are drop targets, so this is interactive chrome rather than a caption
          and it has to stay inside the header's own block. */}
      <PageHeader
        title={folder ? folder.name : "Documents"}
        description={
          <span className="flex flex-wrap items-center gap-1">
            {/* Crumbs are drop targets so things can be dragged UP a level.
                Without this the only direction you can drag is deeper. */}
            <BreadcrumbDropTarget folderId={null}>
              <Link href={BASE} className="hover:text-foreground">
                All folders
              </Link>
            </BreadcrumbDropTarget>
            {ancestors.map((crumb) => (
              <span key={crumb.id} className="flex items-center gap-1">
                <ChevronRight className="size-3" />
                <BreadcrumbDropTarget folderId={crumb.id}>
                  <Link
                    href={`${BASE}/${crumb.id}`}
                    className="hover:text-foreground"
                  >
                    {crumb.name}
                  </Link>
                </BreadcrumbDropTarget>
              </span>
            ))}
            {folder && (
              <span className="flex items-center gap-1">
                <ChevronRight className="size-3" />
                <span className="text-foreground">{folder.name}</span>
              </span>
            )}
          </span>
        }
        actions={
          <>
            {folder?.effectiveVisibility === "owners" && (
              <Badge variant="secondary" className="gap-1">
                <Lock className="size-3" />
                {folder.visibility === "owners" ? "Owners only" : "Inherited"}
              </Badge>
            )}
            <ViewSwitch current={view} />
            <UploadButton
              tenantId={ctx.tenant.id}
              folderId={folder?.id ?? null}
            />
            <NewFolderButton parentId={folder?.id ?? null} isOwner={isOwner} />
          </>
        }
      />

      <DocumentsNav />

      {/* Files dropped from the desktop anywhere that is not a folder row land
          in the folder being viewed. */}
      <UploadDropZone tenantId={ctx.tenant.id} folderId={folder?.id ?? null}>
      {contents.subfolders.length === 0 && contents.documents.length === 0 ? (
        <p className="rounded-md border px-4 py-10 text-center text-sm text-muted-foreground">
          This folder is empty. Drop files here to upload them.
        </p>
      ) : isGrid ? (
        <TileGrid>
          {contents.subfolders.map((sub) => (
            <FolderDropTarget
              key={sub.id}
              tenantId={ctx.tenant.id}
              folderId={sub.id}
              folderPath={sub.path}
              className="relative rounded-md"
            >
              <DraggableRow
                payload={{
                  kind: "folder",
                  id: sub.id,
                  path: sub.path,
                  version: sub.version,
                }}
                disabled={!isOwner}
                className="h-full"
              >
                <FolderTile
                  id={sub.id}
                  name={sub.name}
                  restricted={sub.effectiveVisibility === "owners"}
                />
              </DraggableRow>
              {/* Outside the tile's anchor — a menu nested in a link is
                  invalid HTML and swallows its own clicks. */}
              <div className="absolute right-1 top-1">
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
                    inboundAddress:
                      sub.inboundToken && inboundDomain
                        ? folderInboundAddress(sub.inboundToken, inboundDomain)
                        : null,
                  }}
                  isOwner={isOwner}
                  moveTargets={moveTargetsFor(sub.path)}
                  shareMaxTtlDays={shareMaxTtlDays}
                />
              </div>
            </FolderDropTarget>
          ))}

          {contents.documents.map((doc) => (
            <DraggableRow
              key={doc.id}
              payload={{ kind: "document", id: doc.id }}
              className="relative h-full"
            >
              <FileOpenTrigger
                file={{
                  id: doc.id,
                  title: doc.title,
                  fileName: doc.fileName,
                  mimeType: doc.mimeType,
                  sizeBytes: doc.sizeBytes,
                  textExtraction: doc.textExtraction,
                }}
                className="h-full"
              >
                <FileTile
                  id={doc.id}
                  title={doc.title}
                  fileName={doc.fileName}
                  mimeType={doc.mimeType}
                  sizeBytes={doc.sizeBytes}
                  showPreview={view === "thumbs"}
                />
              </FileOpenTrigger>
              <div data-no-viewer className="absolute right-1 top-1">
                <DocumentRowMenu
                  documentId={doc.id}
                  folders={folderChoices}
                  version={doc.version}
                  title={doc.title}
                  fileName={doc.fileName}
                  shareMaxTtlDays={shareMaxTtlDays}
                  tenantId={ctx.tenant.id}
                  origin={doc.origin}
                  fileVersionCount={doc.fileVersionCount}
                  tags={tagChoices}
                  documentTags={doc.tags}
                />
              </div>
            </DraggableRow>
          ))}
        </TileGrid>
      ) : (
        <div className="divide-y rounded-md border">
          {contents.subfolders.map((sub) => (
            <FolderDropTarget
              key={sub.id}
              tenantId={ctx.tenant.id}
              folderId={sub.id}
              folderPath={sub.path}
              className="flex items-center gap-3 px-4 py-3"
            >
              {/* Only owners can move a folder — it rewrites a subtree, and a
                  staff-run rewrite would skip the rows RLS hid from it. Not
                  draggable for staff rather than draggable-then-refused. */}
              <DraggableRow
                payload={{
                  kind: "folder",
                  id: sub.id,
                  path: sub.path,
                  version: sub.version,
                }}
                disabled={!isOwner}
                className="flex min-w-0 flex-1 items-center gap-3"
              >
                <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
                {/* draggable={false}: anchors drag natively as a URL, which
                    would compete with the row's own drag gesture. */}
                <Link
                  draggable={false}
                  href={`${BASE}/${sub.id}`}
                  className="min-w-0 flex-1 truncate text-sm font-medium hover:underline"
                >
                  {sub.name}
                </Link>
              </DraggableRow>
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
                  inboundAddress:
                    sub.inboundToken && inboundDomain
                      ? folderInboundAddress(sub.inboundToken, inboundDomain)
                      : null,
                }}
                isOwner={isOwner}
                moveTargets={moveTargetsFor(sub.path)}
                shareMaxTtlDays={shareMaxTtlDays}
              />
            </FolderDropTarget>
          ))}

          {contents.documents.map((doc) => (
            <DraggableRow
              key={doc.id}
              payload={{ kind: "document", id: doc.id }}
              className="flex items-center gap-3 px-4 py-3"
            >
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                {/* Opens the in-app viewer. The href stays real so
                    middle-click and "open in new tab" still work, and the file
                    is reachable if JavaScript has not loaded. */}
                <FileOpenTrigger
                  file={{
                    id: doc.id,
                    title: doc.title,
                    fileName: doc.fileName,
                    mimeType: doc.mimeType,
                    sizeBytes: doc.sizeBytes,
                    textExtraction: doc.textExtraction,
                  }}
                >
                  <a
                    draggable={false}
                    href={`/api/documents/${doc.id}/file`}
                    className="truncate text-sm font-medium hover:underline"
                  >
                    {doc.title || doc.fileName}
                  </a>
                </FileOpenTrigger>
                <p className="text-xs text-muted-foreground">
                  {formatBytes(doc.sizeBytes)}
                  {doc.fileVersionCount > 1 && ` · v${doc.fileVersionNo}`}
                  {doc.origin === "accounting" && " · from Receipts"}
                </p>
                <TagChips
                  slugs={doc.tags}
                  names={tagNames}
                  className="mt-1 block"
                />
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
                shareMaxTtlDays={shareMaxTtlDays}
                tenantId={ctx.tenant.id}
                origin={doc.origin}
                fileVersionCount={doc.fileVersionCount}
                tags={tagChoices}
                documentTags={doc.tags}
              />
            </DraggableRow>
          ))}
        </div>
      )}
      </UploadDropZone>

      {contents.nextCursor && (
        <div className="flex justify-center">
          <Button asChild variant="outline">
            {/* Carries the view forward — paging must not silently drop you
                back into the list layout. */}
            <Link
              href={`${folder ? `${BASE}/${folder.id}` : BASE}?cursor=${encodeURIComponent(contents.nextCursor)}&view=${view}`}
            >
              Load more
            </Link>
          </Button>
        </div>
      )}
    </div>
  );
}
