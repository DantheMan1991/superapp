import Link from "next/link";
import { listModuleDocs } from "@/lib/module-docs";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function AdminDocsPage() {
  const docs = await listModuleDocs();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Build docs</h1>
        <p className="text-sm text-muted-foreground">
          Module dossiers — what each module is, how it got that way, and the
          decisions behind it. Source of truth lives in the repo
          (<code>docs/modules/</code>); every PR that touches a module updates
          its dossier.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {docs.map((doc) => (
          <Link key={doc.slug} href={`/admin/docs/${doc.slug}`}>
            <Card className="h-full transition-colors hover:bg-muted/50">
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-base">{doc.title}</CardTitle>
                  {doc.lastLogged && (
                    <Badge variant="outline" className="shrink-0">
                      updated {doc.lastLogged}
                    </Badge>
                  )}
                </div>
                <CardDescription className="line-clamp-3">
                  {doc.summary}
                </CardDescription>
                {doc.statusLine && (
                  <p className="text-xs text-muted-foreground">
                    {doc.statusLine}
                  </p>
                )}
              </CardHeader>
            </Card>
          </Link>
        ))}
        {docs.length === 0 && (
          <Card className="md:col-span-2">
            <CardHeader>
              <CardDescription className="py-6 text-center">
                No dossiers yet — add one at <code>docs/modules/&lt;slug&gt;.md</code>{" "}
                (see <code>_TEMPLATE.md</code>).
              </CardDescription>
            </CardHeader>
          </Card>
        )}
      </div>
    </div>
  );
}
