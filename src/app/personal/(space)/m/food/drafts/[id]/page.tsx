import Link from "next/link";
import { notFound } from "next/navigation";
import { Loader2, TriangleAlert } from "lucide-react";
import { withTenant } from "@/db";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { requirePersonalSpace } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { hostOf } from "@/modules/food/core/recipe";
import { getImport, importDraft } from "@/modules/food/import-ops";
import { draftPhotoUrl, knownTags } from "@/modules/food/recipe-ops";
import { DiscardDraftButton } from "@/modules/food/components/discard-draft-button";
import { RecipeEditor } from "@/modules/food/components/recipe-editor";
import { RefreshWhileReading } from "@/modules/food/components/refresh-while-reading";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * CHECK A DRAFT (docs/help/food/editor.md): the editor, opened on what was
 * read from a link, a paste or photos of a page. Nothing is saved until Save
 * recipe. A draft still being read says so and looks again by itself; one
 * that failed says why.
 */
export default async function DraftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const ctx = await requirePersonalSpace();
  await requireModuleEnabled(ctx.tenant.id, "food");
  const [row, tags] = await withTenant(
    ctx.tenant.id,
    (tx) => Promise.all([getImport(tx, ctx.tenant.id, id), knownTags(tx, ctx.tenant.id)]),
    { role: ctx.role },
  );
  if (!row) notFound();

  const from =
    row.kind === "link" ? (hostOf(row.sourceUrl) ?? "the link") : row.kind === "photo" ? "your photos" : "your text";
  const draft = row.status === "draft" ? importDraft(row) : null;
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <PageHeader title="Check the recipe" description={`Read from ${from}.`} />
      {draft ? (
        <RecipeEditor
          initial={draft}
          mode={{
            kind: "draft",
            importId: row.id,
            from,
            photoUrl: row.photoPathname ? draftPhotoUrl(row.id, row.photoPathname) : null,
          }}
          tags={tags}
        />
      ) : row.status === "reading" ? (
        <>
          <p className="flex items-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin text-module-accent" aria-hidden />
            Still reading. This page looks again by itself.
          </p>
          <RefreshWhileReading />
        </>
      ) : (
        <div className="space-y-3 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
          <p className="flex items-start gap-2 text-destructive">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            {row.error ?? "This draft could not be read. Add the recipe again."}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/personal/m/food/add">Try again</Link>
            </Button>
            <DiscardDraftButton importId={row.id} variant="outline" size="sm" />
          </div>
        </div>
      )}
    </div>
  );
}
