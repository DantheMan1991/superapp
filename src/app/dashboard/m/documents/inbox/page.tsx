import { FileText, Inbox } from "lucide-react";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { listFolderContents } from "@/modules/documents/browse";
import { listFolders } from "@/modules/documents/folders";
import { formatBytes } from "@/modules/documents/lib/format";
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
  await requireModuleEnabled(ctx.tenant.id, "documents");

  const data = await withTenant(
    ctx.tenant.id,
    async (tx) => ({
      contents: await listFolderContents(tx, ctx.tenant.id, {
        folderId: null,
        cursor,
      }),
      folders: await listFolders(tx, ctx.tenant.id),
    }),
    { role: ctx.role },
  );

  const pathById = new Map(data.folders.map((f) => [f.path, f]));
  const folderChoices: FolderChoice[] = data.folders
    .map((folder) => {
      const parts: string[] = [];
      let prefix = "";
      for (const segment of folder.path.split("/").filter(Boolean)) {
        prefix += `/${segment}/`;
        const node = pathById.get(prefix);
        if (node) parts.push(node.name);
      }
      return { id: folder.id, label: parts.join(" / ") };
    })
    .sort((a, b) => a.label.localeCompare(b.label));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Inbox</h1>
          <p className="text-sm text-muted-foreground">
            Captured but not filed yet — uploads and emailed attachments land
            here.
          </p>
        </div>
        <UploadButton tenantId={ctx.tenant.id} folderId={null} />
      </div>

      <DocumentsNav />

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
                  {doc.origin === "accounting" && " · from Receipts"}
                </p>
              </div>
              <span className="hidden text-xs text-muted-foreground sm:inline">
                {doc.createdAt.toLocaleDateString()}
              </span>
              <DocumentRowMenu documentId={doc.id} folders={folderChoices} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
