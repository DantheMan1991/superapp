import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getBuildDoc, sectionLabel } from "@/lib/build-docs";
import { Markdown } from "@/components/app/markdown";

export const dynamic = "force-dynamic";

export default async function BuildDocPage({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}) {
  const { slug } = await params;
  const requested = slug.join("/");
  const doc = await getBuildDoc(requested);

  if (!doc) {
    // Dossiers used to live at `/admin/docs/<module>`; keep those links (and
    // anyone's bookmarks) working now that the path carries the section.
    if (slug.length === 1 && (await getBuildDoc(`modules/${requested}`))) {
      redirect(`/admin/docs/modules/${requested}`);
    }
    notFound();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <Link
          href="/admin/docs"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Build docs
          {doc.section && (
            <span className="text-muted-foreground">
              {" "}
              / {sectionLabel(doc.section)}
            </span>
          )}
        </Link>
        <span className="shrink-0 text-xs text-muted-foreground">
          {doc.file}
        </span>
      </div>

      {/* `linkBase` is what makes `[ADR 0013](../decisions/0013-….md)` in a
          brief navigate instead of requesting a .md file that 404s. */}
      <Markdown
        source={doc.content}
        linkBase={{ root: "/admin/docs", slug: doc.slug }}
        className="max-w-3xl"
      />
    </div>
  );
}
