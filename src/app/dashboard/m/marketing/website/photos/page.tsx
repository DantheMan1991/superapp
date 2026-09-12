import Link from "next/link";
import { redirect } from "next/navigation";
import { Camera, ChevronLeft } from "lucide-react";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { templateFor } from "@/lib/site-templates/resolve";
import { chooseSite } from "@/lib/sites/choose";
import { loadSiteDrafts } from "@/lib/sites/read";
import { listSites } from "@/modules/marketing/site-ops";
import { isStarterPhoto, pageSpots, readShotNotes, shotNotesFor, withStoredNotes } from "@/lib/sites/shots";
import { PageHeader } from "@/components/app/page-header";
import { assistantOn } from "@/modules/marketing/assistant";
import { ShotList, type ShotPageView } from "@/modules/marketing/components/shot-list";

export const dynamic = "force-dynamic";

/**
 * The shot list (slice 18): every place on the site's pages where a photo
 * belongs, read from the drafts as they are now, with what to take there
 * in the template's own terms. Staff read it; owners fill it, from a
 * phone as readily as a desk. No site yet means nothing to list.
 */
export default async function ShotListRoute({
  searchParams,
}: {
  searchParams: Promise<{ site?: string }>;
}) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "marketing");
  const asked = (await searchParams).site ?? "";
  // The same rule the Website screen uses (`chooseSite`): one site needs no
  // asking, several are told apart by `?site=`. Nothing chosen sends the
  // reader back to the screen that CAN draw the list.
  const drafts = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const chosen = chooseSite(await listSites(tx, ctx.tenant.id), asked).site;
      return chosen ? loadSiteDrafts(tx, ctx.tenant.id, chosen.id) : null;
    },
    { role: ctx.role },
  );
  if (!drafts) redirect("/dashboard/m/marketing/website");
  // The platform's drawn stand-ins are known by the name their file carries.
  const starters = new Set(drafts.images.filter((i) => isStarterPhoto(i.pathname)).map((i) => i.id));
  const notes = shotNotesFor(templateFor(ctx.tenant.industry));
  const pages: ShotPageView[] = drafts.view.pages.map((page) => {
    const row = drafts.pages.find((p) => p.path === page.path);
    return {
      id: row?.id ?? page.path,
      path: page.path,
      title: page.title,
      // The written notes, where they still describe the words they were
      // written from (slice 19); a spot whose section changed reads the
      // standing line again.
      spots: withStoredNotes(
        pageSpots({ path: page.path, content: page.content }, starters, notes),
        readShotNotes(row?.shotNotes),
      ),
    };
  });
  return (
    <div className="space-y-4">
      <Link
        href={`/dashboard/m/marketing/website?site=${drafts.site.id}`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" /> Back to the website
      </Link>
      <PageHeader
        icon={<Camera />}
        title="Photos to take"
        description="Every place on your pages where a photo belongs, what to take there, and a way to put it in from your phone."
      />
      <ShotList
        siteId={drafts.site.id}
        tenantId={ctx.tenant.id}
        canWrite={ctx.role === "owner"}
        assistantOn={assistantOn()}
        library={drafts.images.map((i) => ({
          id: i.id,
          width: i.width,
          height: i.height,
          bytes: i.bytes,
          mimeType: i.mimeType,
          createdAt: i.createdAt.toISOString(),
        }))}
        starters={[...starters]}
        pages={pages}
      />
    </div>
  );
}
