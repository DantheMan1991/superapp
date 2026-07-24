import Link from "next/link";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowLeft } from "lucide-react";
import { getModuleDoc } from "@/lib/module-docs";

export const dynamic = "force-dynamic";

export default async function ModuleDocPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const doc = await getModuleDoc(slug);
  if (!doc) notFound();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Link
          href="/admin/docs"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Build docs
        </Link>
        <span className="text-xs text-muted-foreground">
          docs/modules/{doc.slug}.md
        </span>
      </div>

      <div className="prose prose-sm dark:prose-invert max-w-3xl [&_table]:text-sm">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{doc.content}</ReactMarkdown>
      </div>
    </div>
  );
}
