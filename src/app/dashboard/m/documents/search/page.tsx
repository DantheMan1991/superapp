import Link from "next/link";
import { FileText, FolderOpen, Search } from "lucide-react";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { Button } from "@/components/ui/button";
import { listFolders } from "@/modules/documents/folders";
import {
  maxSearchPage,
  normalizeSearchQuery,
  searchDocuments,
} from "@/modules/documents/search";
import { buildFolderLabels } from "@/modules/documents/lib/folder-labels";
import { formatBytes } from "@/modules/documents/lib/format";
import { DocumentsNav } from "@/modules/documents/components/documents-nav";
import { DocumentRowMenu } from "@/modules/documents/components/document-controls";
import { folderOptions } from "@/modules/documents/lib/folder-labels";

export const dynamic = "force-dynamic";

const BASE = "/dashboard/m/documents";

/**
 * Search results. The query lives in the URL so a result set is linkable and
 * survives a reload.
 *
 * Owners-only files are absent rather than filtered: RLS removed them before
 * this page saw a row, so a staff member's search cannot even reveal that a
 * matching restricted file exists.
 */
export default async function DocumentsSearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "documents");

  const q = normalizeSearchQuery(sp.q);
  const page = Number.parseInt(sp.page ?? "0", 10);
  const requestedPage = Number.isFinite(page) && page > 0 ? page : 0;

  const data = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const folders = await listFolders(tx, ctx.tenant.id);
      if (q === null) return { folders, result: null };
      const result = await searchDocuments(tx, ctx.tenant.id, {
        q,
        page: requestedPage,
      });
      return { folders, result };
    },
    { role: ctx.role },
  );

  const labels = buildFolderLabels(data.folders);
  const choices = folderOptions(data.folders);
  const hitCount = data.result?.hits.length ?? 0;

  const pageHref = (n: number) =>
    `${BASE}/search?q=${encodeURIComponent(q ?? "")}&page=${n}`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Search</h1>
        <p className="text-sm text-muted-foreground">
          Looks at names, titles, descriptions and what we read from emailed
          documents.
        </p>
      </div>

      <DocumentsNav />

      {q === null ? (
        <div className="flex flex-col items-center gap-2 rounded-md border px-4 py-12 text-center">
          <Search className="size-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Type in the box above. Quoted phrases, <code>or</code>, and{" "}
            <code>-word</code> to exclude all work.
          </p>
        </div>
      ) : hitCount === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-md border px-4 py-12 text-center">
          <Search className="size-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Nothing matches <span className="font-medium">{q}</span>.
          </p>
        </div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {hitCount} {hitCount === 1 ? "result" : "results"} for{" "}
            <span className="font-medium text-foreground">{q}</span>
            {data.result?.page ? ` · page ${data.result.page + 1}` : ""}
          </p>

          <div className="divide-y rounded-md border">
            {data.result?.hits.map((hit) => (
              <div key={hit.id} className="flex items-center gap-3 px-4 py-3">
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <a
                    href={`/api/documents/${hit.id}/file`}
                    target="_blank"
                    rel="noreferrer"
                    className="truncate text-sm font-medium hover:underline"
                  >
                    {hit.title || hit.fileName}
                  </a>
                  <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    {hit.folderId ? (
                      <Link
                        href={`${BASE}/browse/${hit.folderId}`}
                        className="inline-flex items-center gap-1 hover:text-foreground"
                      >
                        <FolderOpen className="size-3" />
                        {labels.get(hit.folderId) ?? "Folder"}
                      </Link>
                    ) : (
                      <Link
                        href={`${BASE}/inbox`}
                        className="hover:text-foreground"
                      >
                        Inbox
                      </Link>
                    )}
                    <span>·</span>
                    <span>{formatBytes(hit.sizeBytes)}</span>
                    {hit.origin === "accounting" && <span>· from Receipts</span>}
                  </p>
                </div>
                <span className="hidden text-xs text-muted-foreground sm:inline">
                  {hit.createdAt.toLocaleDateString()}
                </span>
                <DocumentRowMenu
                  documentId={hit.id}
                  folders={choices}
                  version={hit.version}
                  title={hit.title}
                  fileName={hit.fileName}
                />
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between">
            {data.result && data.result.page > 0 ? (
              <Button asChild variant="outline">
                <Link href={pageHref(data.result.page - 1)}>Previous</Link>
              </Button>
            ) : (
              <span />
            )}
            {data.result?.hasMore ? (
              <Button asChild variant="outline">
                <Link href={pageHref(data.result.page + 1)}>Next</Link>
              </Button>
            ) : (
              <span />
            )}
          </div>

          {data.result && data.result.page >= maxSearchPage() && (
            // Ranked paging is capped on purpose — ts_rank_cd has no keyset.
            <p className="text-center text-xs text-muted-foreground">
              That&apos;s as far as results go — try narrowing the search.
            </p>
          )}
        </>
      )}
    </div>
  );
}
