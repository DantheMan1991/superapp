import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { countDocumentsByTag, listTags } from "@/modules/documents/tag-ops";
import { DocumentsNav } from "@/modules/documents/components/documents-nav";
import { TagManager } from "@/modules/documents/components/tag-controls";

export const dynamic = "force-dynamic";

/**
 * The tag registry.
 *
 * Tags are a business-wide vocabulary rather than a per-person one, which is
 * why this is a managed list instead of free text on each file: two people
 * typing "as built" and "as-built" would otherwise create two things that look
 * identical and never match each other.
 */
export default async function DocumentsTagsPage() {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "documents");

  const data = await withTenant(
    ctx.tenant.id,
    async (tx) => ({
      tags: await listTags(tx, ctx.tenant.id),
      counts: await countDocumentsByTag(tx, ctx.tenant.id),
    }),
    { role: ctx.role },
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Tags</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          A shared vocabulary for the whole business. Renaming a tag updates it
          everywhere; only an owner can delete one.
        </p>
      </div>

      <DocumentsNav />

      <TagManager
        tags={data.tags.map((t) => ({
          id: t.id,
          slug: t.slug,
          name: t.name,
          version: t.version,
        }))}
        counts={data.counts}
        isOwner={ctx.role === "owner"}
      />
    </div>
  );
}
