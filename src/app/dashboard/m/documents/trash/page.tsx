import { FileText, Trash2 } from "lucide-react";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { listTrashedDocuments } from "@/modules/documents/trash";
import { formatBytes } from "@/modules/documents/lib/format";
import { DocumentsNav } from "@/modules/documents/components/documents-nav";
import { DocumentRowMenu } from "@/modules/documents/components/document-controls";

export const dynamic = "force-dynamic";

/**
 * The trash. Restore was already implemented and reachable from a row menu —
 * there was simply no view that listed trashed files, so nothing could be
 * restored once it left the browser.
 */
export default async function DocumentsTrashPage() {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "documents");

  const documents = await withTenant(
    ctx.tenant.id,
    (tx) => listTrashedDocuments(tx, ctx.tenant.id),
    { role: ctx.role },
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Trash</h1>
        <p className="text-sm text-muted-foreground">
          Restoring puts a file back where it was filed. Nothing here is ever
          permanently deleted.
        </p>
      </div>

      <DocumentsNav />

      {documents.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-md border px-4 py-12 text-center">
          <Trash2 className="size-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">The trash is empty.</p>
        </div>
      ) : (
        <div className="divide-y rounded-md border">
          {documents.map((doc) => (
            <div key={doc.id} className="flex items-center gap-3 px-4 py-3">
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {doc.title || doc.fileName}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatBytes(doc.sizeBytes)}
                  {doc.trashedAt &&
                    ` · trashed ${doc.trashedAt.toLocaleDateString()}`}
                </p>
              </div>
              <DocumentRowMenu documentId={doc.id} folders={[]} trashed />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
