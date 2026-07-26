import Link from "next/link";
import { FileType2 } from "lucide-react";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { Badge } from "@/components/ui/badge";
import { listTemplates } from "@/modules/documents/doc-templates/template-ops";
import { DocumentsNav } from "@/modules/documents/components/documents-nav";
import { NewTemplateButton } from "@/modules/documents/components/template-controls";

export const dynamic = "force-dynamic";

const BASE = "/dashboard/m/documents/templates";

/**
 * Document templates — the blank forms a business fills in over and over: a
 * lien waiver, a change order, a subcontract.
 *
 * NOT the folder templates a tenant is provisioned with; those live in
 * `src/modules/documents/templates/` and are unrelated.
 */
export default async function DocumentTemplatesPage() {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "documents");

  const templates = await withTenant(
    ctx.tenant.id,
    (tx) => listTemplates(tx, ctx.tenant.id),
    { role: ctx.role },
  );

  const live = templates.filter((t) => t.archivedAt === null);
  const archived = templates.filter((t) => t.archivedAt !== null);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Templates</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Write a document once, fill in the blanks every time after. A
            published version is frozen, so you can always tell what a document
            said on the day it went out.
          </p>
        </div>
        <NewTemplateButton />
      </div>

      <DocumentsNav />

      {live.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-md border px-4 py-12 text-center">
          <FileType2 className="size-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No templates yet.
          </p>
        </div>
      ) : (
        <div className="divide-y rounded-md border">
          {live.map((template) => (
            <Link
              key={template.id}
              href={`${BASE}/${template.id}`}
              className="flex items-center gap-3 px-4 py-3 hover:bg-secondary/40"
            >
              <FileType2 className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{template.name}</p>
                {template.description && (
                  <p className="truncate text-xs text-muted-foreground">
                    {template.description}
                  </p>
                )}
              </div>
              {template.docKind && (
                <Badge variant="outline" className="font-normal">
                  {template.docKind}
                </Badge>
              )}
            </Link>
          ))}
        </div>
      )}

      {archived.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">
            Archived
          </h2>
          <div className="divide-y rounded-md border">
            {archived.map((template) => (
              <Link
                key={template.id}
                href={`${BASE}/${template.id}`}
                className="flex items-center gap-3 px-4 py-3 text-muted-foreground hover:bg-secondary/40"
              >
                <FileType2 className="size-4 shrink-0" />
                <span className="truncate text-sm">{template.name}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
