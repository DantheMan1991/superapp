import { FileText, Trash2 } from "lucide-react";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { listTrashedDocuments } from "@/modules/documents/trash";
import { formatBytes } from "@/modules/documents/lib/format";
import { PageHeader } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";
import { EmptyState } from "@/components/app/empty-state";
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
      <PageHeader
        title="Trash"
        description="Restoring puts a file back where it was filed. Nothing here is ever permanently deleted."
      />

      <DocumentsNav />

      {documents.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<Trash2 />}
            title="The trash is empty"
            description="Anything you delete lands here first, and can be put back where it was filed."
          />
        </Panel>
      ) : (
        <Panel>
          <div className="divide-y divide-divider">
          {documents.map((doc) => (
            <div
              key={doc.id}
              className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/60"
            >
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
        </Panel>
      )}
    </div>
  );
}
