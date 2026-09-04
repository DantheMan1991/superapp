import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { roleMayWrite } from "@/modules/documents/core/errors";
import { requireModuleEnabled } from "@/lib/modules";
import { Badge } from "@/components/ui/badge";
import {
  listTemplateVersions,
  loadCurrentPublished,
  loadDraft,
  parseFields,
} from "@/modules/documents/doc-templates/template-ops";
import { schema } from "@/db";
import { and, eq } from "drizzle-orm";
import { listGenerations } from "@/modules/documents/doc-templates/generate";
import { listFolders } from "@/modules/documents/folders";
import { folderOptions } from "@/modules/documents/lib/folder-labels";
import { GenerateButton } from "@/modules/documents/components/generate-controls";
import { DocumentsNav } from "@/modules/documents/components/documents-nav";
import { TemplateEditor } from "@/modules/documents/components/template-editor";
import { ArchiveTemplateButton } from "@/modules/documents/components/template-controls";

export const dynamic = "force-dynamic";

const BASE = "/dashboard/m/documents/templates";

/**
 * The template editor.
 *
 * The draft is what you edit. A published version is frozen — saving here never
 * touches it, it opens or updates the draft that will become the next version.
 */
export default async function TemplateEditorPage({
  params,
}: {
  params: Promise<{ templateId: string }>;
}) {
  const { templateId } = await params;
  const ctx = await requireTenant();
  /** The same question `gate()` asks. */
  const canWrite = roleMayWrite(ctx.role);
  await requireModuleEnabled(ctx.tenant.id, "documents");

  const data = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const template = await tx.query.documentTemplates.findFirst({
        where: and(
          eq(schema.documentTemplates.tenantId, ctx.tenant.id),
          eq(schema.documentTemplates.id, templateId),
        ),
      });
      if (!template) return null;
      const [draft, published, versions, folders, generations] =
        await Promise.all([
          loadDraft(tx, ctx.tenant.id, templateId),
          loadCurrentPublished(tx, ctx.tenant.id, templateId),
          listTemplateVersions(tx, ctx.tenant.id, templateId),
          listFolders(tx, ctx.tenant.id),
          listGenerations(tx, ctx.tenant.id, templateId),
        ]);
      return { template, draft, published, versions, folders, generations };
    },
    { role: ctx.role },
  );

  if (data === null) notFound();
  const { template, draft, published, versions, folders, generations } = data;

  // With nothing unpublished, the editor starts from the published body — so
  // "edit" means "carry on from what is live", and saving opens the next draft.
  const startingBody = draft?.body ?? published?.body ?? "";
  const startingFields = parseFields(draft?.fields ?? published?.fields);

  return (
    <div className="space-y-6">
      <Link
        href={BASE}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" />
        All templates
      </Link>

      <DocumentsNav />

      {!canWrite && (
        <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          Accountant access is read-only. You can read this template, its fields
          and its history, and nothing here can be changed.
        </p>
      )}

      {template.archivedAt && (
        <p className="rounded-md border px-4 py-3 text-sm text-muted-foreground">
          This template is archived. It is kept so documents generated from it
          still name something real.
        </p>
      )}

      {published && !template.archivedAt && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-4 py-3">
          <p className="text-sm text-muted-foreground">
            Published v{published.versionNo} is ready to use.
            {generations.length > 0 &&
              ` ${generations.length} document${generations.length === 1 ? "" : "s"} made so far.`}
          </p>
          {/* Generating MAKES a document, so it is a write like any other. */}
          {canWrite && (
          <GenerateButton
            templateId={template.id}
            templateName={template.name}
            publishedVersionNo={published.versionNo}
            fields={parseFields(published.fields)}
            folders={folderOptions(folders)}
          />
          )}
        </div>
      )}

      <TemplateEditor
        canWrite={canWrite}
        templateId={template.id}
        templateName={template.name}
        initialBody={startingBody}
        initialFields={startingFields}
        publishedVersionNo={published?.versionNo ?? null}
        draftVersionNo={draft?.versionNo ?? null}
      />

      <div className="space-y-2">
        <h2 className="text-lg font-medium">History</h2>
        <div className="divide-y rounded-md border">
          {versions.map((version) => (
            <div
              key={version.id}
              className="flex flex-wrap items-center gap-3 px-4 py-3"
            >
              <span className="text-sm font-medium">v{version.versionNo}</span>
              {version.publishedAt ? (
                <Badge variant="secondary">
                  Published {version.publishedAt.toLocaleDateString()}
                </Badge>
              ) : (
                <Badge variant="outline">Draft</Badge>
              )}
              <span className="ml-auto text-xs text-muted-foreground">
                {parseFields(version.fields).length} field
                {parseFields(version.fields).length === 1 ? "" : "s"}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div>
        {canWrite && (
        <ArchiveTemplateButton
          templateId={template.id}
          version={template.version}
          archived={template.archivedAt !== null}
        />
        )}
      </div>
    </div>
  );
}
