import Link from "next/link";
import { listBuildDocs } from "@/lib/build-docs";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/app/page-header";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function AdminDocsPage() {
  const sections = await listBuildDocs();

  return (
    <div className="space-y-8">
      <PageHeader
        title="Build docs"
        description={
          <>
            The build record: what each part of the platform is, how it got that
            way, and the decisions behind it. Source of truth lives in the repo
            (<code>docs/</code>); the PR that changes a thing updates the doc
            that describes it.
          </>
        }
      />

      {sections.map((section) => (
        <section key={section.key || "platform"} className="space-y-3">
          <div>
            <h2 className="text-sm font-semibold tracking-tight">
              {section.label}
            </h2>
            {section.blurb && (
              <p className="text-xs text-muted-foreground">{section.blurb}</p>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {section.docs.map((doc) => (
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
                    {doc.readBefore && (
                      <p className="line-clamp-2 text-xs text-muted-foreground">
                        <span className="font-medium">Read before:</span>{" "}
                        {doc.readBefore}
                      </p>
                    )}
                  </CardHeader>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      ))}

      {sections.length === 0 && (
        <Card>
          <CardHeader>
            <CardDescription className="py-6 text-center">
              No build docs yet — add one under <code>docs/</code> (module
              dossiers go in <code>docs/modules/</code>, see{" "}
              <code>_TEMPLATE.md</code>).
            </CardDescription>
          </CardHeader>
        </Card>
      )}
    </div>
  );
}
