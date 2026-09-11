import Link from "next/link";
import { Globe, Plus } from "lucide-react";
import type { Site } from "@/db/schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";

/**
 * The websites this business has — drawn ONLY when there are two or more
 * (ADR 0045).
 *
 * A tenant with one site never sees this: the Website screen opens straight
 * into it, and the word "websites" plural never appears. That is deliberate
 * and it is the same promise ADR 0010 keeps about companies — the common case
 * must not pay for the rare one. Lifting the one-site limit was supposed to
 * let a business run two brands, not to give every business a filing cabinet.
 */
export function SiteList({
  sites,
  canWrite,
}: {
  sites: Site[];
  canWrite: boolean;
}) {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Websites"
        description="Each one has its own address, its own look and its own messages."
      />
      <Panel>
        <ul className="divide-y divide-divider">
          {sites.map((site) => (
            <li key={site.id}>
              {/* The row is the link (design-system.md, 2026-09-06). */}
              <Link
                href={`/dashboard/m/marketing/website?site=${site.id}`}
                className="flex items-center justify-between gap-4 px-4 py-3.5 transition-colors outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-module-accent/10 text-module-accent">
                    <Globe className="size-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">
                      {site.title || site.slug}
                    </span>
                    <span className="block truncate font-mono text-xs text-subtle-foreground">
                      /sites/{site.slug}
                    </span>
                  </span>
                </span>
                <Badge variant={site.status === "published" ? "default" : "secondary"}>
                  {site.status === "published" ? "Live" : "Draft"}
                </Badge>
              </Link>
            </li>
          ))}
        </ul>
      </Panel>
      {canWrite && (
        <div>
          <Button asChild variant="outline">
            {/* `new` is not a site id, so the screen falls through to the
                build form exactly as it does for a business with none. */}
            <Link href="/dashboard/m/marketing/website?site=new">
              <Plus className="size-4" /> Add a website
            </Link>
          </Button>
        </div>
      )}
    </div>
  );
}
