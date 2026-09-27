import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Loader2, TriangleAlert } from "lucide-react";
import { withTenant } from "@/db";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { requirePersonalSpace } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { countOf } from "@/modules/fitness/core/program";
import { getImport, importDraft } from "@/modules/fitness/import-ops";
import { ProgramEditor } from "@/modules/fitness/components/program-editor";
import { DiscardImportButton } from "@/modules/fitness/components/discard-import-button";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * REVIEW A DRAFT (docs/help/fitness/editor.md): the editor, opened on what
 * Claude drafted from the PDF. Nothing is saved until Save program. A draft
 * still being written, or one that failed, says so; one already saved goes to
 * its program.
 */
export default async function ReviewDraftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const ctx = await requirePersonalSpace();
  await requireModuleEnabled(ctx.tenant.id, "fitness");
  const row = await withTenant(ctx.tenant.id, (tx) => getImport(tx, ctx.tenant.id, id), {
    role: ctx.role,
  });
  if (!row || row.status === "discarded") notFound();
  if (row.status === "saved" && row.programId) redirect(`/personal/m/fitness/programs/${row.programId}`);

  const draft = row.status === "draft" ? importDraft(row) : null;
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <PageHeader
        title="Review the draft"
        description={`From ${row.fileName} · ${countOf(row.pageCount, "page", "pages")}`}
      />
      {draft ? (
        <ProgramEditor initial={draft} mode={{ kind: "import", importId: row.id }} />
      ) : row.status === "drafting" ? (
        <p className="flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin text-module-accent" aria-hidden />
          Still drafting. Reload this page in a minute.
        </p>
      ) : (
        <div className="space-y-3 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
          <p className="flex items-start gap-2 text-destructive">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            {row.error ?? "This draft could not be read. Import the PDF again."}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/personal/m/fitness/import">Import again</Link>
            </Button>
            <DiscardImportButton importId={row.id} variant="outline" size="sm" />
          </div>
        </div>
      )}
    </div>
  );
}
