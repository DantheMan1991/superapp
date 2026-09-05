import { notFound, redirect } from "next/navigation";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { loadPageEditor } from "@/lib/sites/read";
import { readPageContent } from "@/lib/sites/schema";
import { PageHeader } from "@/components/app/page-header";
import { PageEditor, type VersionView } from "@/modules/marketing/components/page-editor";

export const dynamic = "force-dynamic";

/**
 * One page, open for editing. Owners only — staff have the read-only Website
 * page and the draft preview, and are sent back there rather than shown a
 * form whose every Save would be refused. A page that is not this tenant's
 * is a 404, like everything else.
 *
 * `key` on the editor is the page's last write: after a restore or an
 * outside change the server re-renders with new props, and the editor's
 * local state must start again from them rather than keep what it had.
 */
export default async function PageEditorRoute({
  params,
}: {
  params: Promise<{ pageId: string }>;
}) {
  const { pageId } = await params;
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "marketing");
  if (ctx.role !== "owner") redirect("/dashboard/m/marketing/website");
  if (!/^[0-9a-f-]{36}$/i.test(pageId)) notFound();
  const data = await withTenant(
    ctx.tenant.id,
    (tx) => loadPageEditor(tx, ctx.tenant.id, pageId),
    { role: ctx.role },
  );
  if (!data) notFound();
  const versions: VersionView[] = data.versions.map((v) => ({
    id: v.id,
    kind: v.kind === "publish" || v.kind === "restore" ? v.kind : "save",
    createdAt: v.createdAt.toISOString(),
  }));
  return (
    <div className="space-y-4">
      <PageHeader
        title={data.page.title}
        description={`A page of ${data.site.title || ctx.tenant.name}'s website. Save here; publish from the Website page.`}
      />
      <PageEditor
        key={data.page.updatedAt.getTime()}
        pageId={data.page.id}
        slug={data.site.slug}
        isHome={data.page.path === "/"}
        initial={{
          title: data.page.title,
          path: data.page.path,
          inNav: data.page.inNav,
          content: readPageContent(data.page.draft),
        }}
        versions={versions}
      />
    </div>
  );
}
