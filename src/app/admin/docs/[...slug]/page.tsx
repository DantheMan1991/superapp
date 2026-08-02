import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowLeft } from "lucide-react";
import { getBuildDoc, sectionLabel } from "@/lib/build-docs";

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

      <div className="prose prose-sm dark:prose-invert max-w-3xl [&_table]:text-sm">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{doc.content}</ReactMarkdown>
      </div>
    </div>
  );
}
