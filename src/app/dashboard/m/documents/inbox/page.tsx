import { FileText, Inbox } from "lucide-react";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { roleMayWrite } from "@/modules/documents/core/errors";
import { requireModuleEnabled } from "@/lib/modules";
import { listFolderContents } from "@/modules/documents/browse";
import { listFolders } from "@/modules/documents/folders";
import { listTags } from "@/modules/documents/tag-ops";
import { TagChips } from "@/modules/documents/components/tag-chips";
import { formatBytes } from "@/modules/documents/lib/format";
import { folderOptions } from "@/modules/documents/lib/folder-labels";
import { PageHeader } from "@/components/app/page-header";
import { DocumentsNav } from "@/modules/documents/components/documents-nav";
import {
  DocumentRowMenu,
  UploadButton,
  type FolderChoice,
} from "@/modules/documents/components/document-controls";

export const dynamic = "force-dynamic";

/**
 * The Inbox: everything captured but not yet filed — `folder_id is null`.
 *
 * It deliberately shows BOTH origins. A receipt that arrived by email and a
 * photo someone uploaded from a job site are the same problem to the person
 * tidying up, and "one cabinet" is the promise. Filing an accounting-origin
 * document into a folder does not take it out of the Receipts inbox; the two
 * surfaces track different things (`status` vs `folder_id`) on purpose.
 */
export default async function DocumentsInboxPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>;
}) {
  const { cursor } = await searchParams;
  const ctx = await requireTenant();
  /** The same question `gate()` asks. */
  const canWrite = roleMayWrite(ctx.role);
  await requireModuleEnabled(ctx.tenant.id, "documents");

  const data = await withTenant(
    ctx.tenant.id,
    async (tx) => ({
      contents: await listFolderContents(tx, ctx.tenant.id, {
        folderId: null,
        cursor,
      }),
      folders: await listFolders(tx, ctx.tenant.id),
      tags: await listTags(tx, ctx.tenant.id),
    }),
    { role: ctx.role },
  );

  const folderChoices: FolderChoice[] = folderOptions(data.folders);
  const tagChoices = data.tags.map((t) => ({
    id: t.id,
    slug: t.slug,
    name: t.name,
    version: t.version,
  }));
  const tagNames = Object.fromEntries(data.tags.map((t) => [t.slug, t.name]));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inbox"
        description="Captured but not filed yet — uploads and emailed attachments land here."
        actions={
          canWrite ? (
            <UploadButton tenantId={ctx.tenant.id} folderId={null} />
          ) : null
        }
      />

      <DocumentsNav />

      {!canWrite && (
        <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          Accountant access is read-only. You can open, preview, download and
          search every unfiled file, and nothing here can be changed.
        </p>
      )}

      {data.contents.documents.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-md border px-4 py-12 text-center">
          <Inbox className="size-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Nothing waiting. Uploads land here until you file them.
          </p>
        </div>
      ) : (
        <div className="divide-y rounded-md border">
          {data.contents.documents.map((doc) => (
            <div key={doc.id} className="flex items-center gap-3 px-4 py-3">
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                {/* Same window, matching Browse. */}
                <a
                  href={`/api/documents/${doc.id}/file`}
                  className="truncate text-sm font-medium hover:underline"
                >
                  {doc.title || doc.fileName}
                </a>
                <p className="text-xs text-muted-foreground">
                  {formatBytes(doc.sizeBytes)}
                  {doc.origin === "accounting" && " · from Receipts"}
                </p>
                <TagChips slugs={doc.tags} names={tagNames} className="mt-1 block" />
              </div>
              <span className="hidden text-xs text-muted-foreground sm:inline">
                {doc.createdAt.toLocaleDateString()}
              </span>
              <DocumentRowMenu
                canWrite={canWrite}
                documentId={doc.id}
                folders={folderChoices}
                version={doc.version}
                title={doc.title}
                fileName={doc.fileName}
                tenantId={ctx.tenant.id}
                origin={doc.origin}
                fileVersionCount={doc.fileVersionCount}
                tags={tagChoices}
                documentTags={doc.tags}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
