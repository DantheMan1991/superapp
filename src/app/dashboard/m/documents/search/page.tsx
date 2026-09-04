import Link from "next/link";
import { FileText, FolderOpen, Search, X } from "lucide-react";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { roleMayWrite } from "@/modules/documents/core/errors";
import { requireModuleEnabled } from "@/lib/modules";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { listFolders } from "@/modules/documents/folders";
import {
  maxSearchPage,
  normalizeSearchQuery,
  searchDocuments,
} from "@/modules/documents/search";
import { listTags } from "@/modules/documents/tag-ops";
import {
  isEmptyQuery,
  listSavedViews,
  savedViewHref,
  type SavedViewQuery,
} from "@/modules/documents/saved-views";
import { normalizeTags } from "@/modules/documents/core/tags";
import { tallyTextExtraction } from "@/modules/documents/text/summary";
import { summarizeUnsearchable } from "@/modules/documents/text/state";
import { buildFolderLabels } from "@/modules/documents/lib/folder-labels";
import { formatBytes } from "@/modules/documents/lib/format";
import { PageHeader } from "@/components/app/page-header";
import { DocumentsNav } from "@/modules/documents/components/documents-nav";
import { DocumentRowMenu } from "@/modules/documents/components/document-controls";
import { TagChips } from "@/modules/documents/components/tag-chips";
import {
  SaveViewButton,
  SavedViewsStrip,
} from "@/modules/documents/components/view-controls";
import { folderOptions } from "@/modules/documents/lib/folder-labels";

export const dynamic = "force-dynamic";

const BASE = "/dashboard/m/documents";

/** searchParams gives a string for one value and an array for several. */
function asArray(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * The filtered list: full-text search, tag and origin facets, folder scope —
 * and the surface a saved view opens.
 *
 * Everything lives in the URL, which is what makes a result set linkable, a
 * saved view a plain href, and the back button work. A saved view is stored as
 * the same parameter set this page already reads, so there is exactly one query
 * implementation rather than a second one interpreting stored jsonb.
 *
 * Owners-only files are absent rather than filtered: RLS removed them before
 * this page saw a row, so a staff member's search cannot even reveal that a
 * matching restricted file exists.
 */
export default async function DocumentsSearchPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    page?: string;
    tag?: string | string[];
    origin?: string;
    folder?: string;
  }>;
}) {
  const sp = await searchParams;
  const ctx = await requireTenant();
  /** The same question `gate()` asks. */
  const canWrite = roleMayWrite(ctx.role);
  await requireModuleEnabled(ctx.tenant.id, "documents");

  const q = normalizeSearchQuery(sp.q);
  // Through the same normalizer as every other tag path, so a hand-typed URL
  // cannot smuggle a malformed slug into the query.
  const tags = normalizeTags(asArray(sp.tag));
  const origin =
    sp.origin === "dms" || sp.origin === "accounting" ? sp.origin : null;
  const folderId = sp.folder ?? null;
  const page = Number.parseInt(sp.page ?? "0", 10);
  const requestedPage = Number.isFinite(page) && page > 0 ? page : 0;

  const query: SavedViewQuery = {
    ...(q ? { q } : {}),
    ...(folderId ? { folderId } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    ...(origin ? { origin } : {}),
  };
  const hasFilters = !isEmptyQuery(query);

  const data = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const [folders, allTags, views, tally] = await Promise.all([
        listFolders(tx, ctx.tenant.id),
        listTags(tx, ctx.tenant.id),
        listSavedViews(tx, ctx.tenant.id, ctx.userId),
        // Counted under the SAME RLS context as the search itself, so the note
        // describes the cabinet this person can see rather than the whole one.
        tallyTextExtraction(tx, ctx.tenant.id),
      ]);
      if (!hasFilters) return { folders, allTags, views, tally, result: null };

      // An unknown or hidden folder id yields no path, which the query treats
      // as "no folder restriction" — so a stale saved view degrades to a wider
      // result set rather than an error page.
      const folderPath =
        folderId === null
          ? null
          : (folders.find((f) => f.id === folderId)?.path ?? null);

      const result = await searchDocuments(tx, ctx.tenant.id, {
        q,
        folderPath,
        tags,
        origin,
        page: requestedPage,
      });
      return { folders, allTags, views, tally, result };
    },
    { role: ctx.role },
  );

  const labels = buildFolderLabels(data.folders);
  const choices = folderOptions(data.folders);
  const tagNames = Object.fromEntries(data.allTags.map((t) => [t.slug, t.name]));
  const tagChoices = data.allTags.map((t) => ({
    id: t.id,
    slug: t.slug,
    name: t.name,
    version: t.version,
  }));
  const hitCount = data.result?.hits.length ?? 0;
  const activeHref = savedViewHref(query);

  /** The current filters minus one of them, for the little × on each chip. */
  const withoutHref = (drop: {
    q?: true;
    folderId?: true;
    origin?: true;
    tag?: string;
  }) => {
    const kept = drop.tag ? tags.filter((t) => t !== drop.tag) : tags;
    return savedViewHref({
      q: drop.q ? undefined : (q ?? undefined),
      folderId: drop.folderId ? undefined : (folderId ?? undefined),
      origin: drop.origin ? undefined : (origin ?? undefined),
      tags: kept.length > 0 ? kept : undefined,
    });
  };

  const pageHref = (n: number) => {
    const base = savedViewHref(query);
    return `${base}${base.includes("?") ? "&" : "?"}page=${n}`;
  };

  const suggestedName =
    [q, ...tags.map((t) => tagNames[t] ?? t)].filter(Boolean).join(" · ") ||
    "Saved view";

  /**
   * The note that explains an ABSENCE.
   *
   * "I searched for a phrase I can plainly see in that permit and got nothing"
   * is a question about a file that is NOT in the results, so no per-result
   * badge can answer it — only a statement about the cabinet as a whole can.
   *
   * Shown only when there is a TEXT query: filtering by tag alone never depends
   * on what we could read out of a file, so the note would be noise there. And
   * only when something is actually unsearchable — `summarizeUnsearchable`
   * returns null otherwise, because a permanent banner announcing the absence
   * of a problem is how a useful warning turns into furniture.
   */
  const unsearchable = q ? summarizeUnsearchable(data.tally) : null;
  const unsearchableNote = unsearchable && (
    <p
      role="note"
      className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground"
    >
      <span className="font-medium text-foreground">
        {unsearchable.total}{" "}
        {unsearchable.total === 1 ? "file is" : "files are"} not searchable by
        content
      </span>{" "}
      — {unsearchable.parts.join(", ")}. Those still match on their name, title,
      description and tags.
    </p>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Search"
        description="Looks inside files as well as at their names, titles, descriptions and tags. Filter by tag with no search text at all."
        actions={
          /* Searching and filtering are the address of the page and stay for
             everybody. KEEPING a search is a write. */
          hasFilters && canWrite ? (
            <SaveViewButton query={query} suggestedName={suggestedName} />
          ) : null
        }
      />

      <DocumentsNav />

      {!canWrite && (
        <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          Accountant access is read-only. You can search everything, open a
          result and download it, and nothing here can be changed.
        </p>
      )}

      <SavedViewsStrip
        /* The rule is still this page's — owner, or the person who saved it —
           but it is evaluated HERE and sent as a boolean. A predicate could not
           cross into the client component and threw on every render. */
        views={data.views.map((v) => ({
          id: v.id,
          name: v.name,
          scope: v.scope,
          href: v.href,
          createdByClerkUserId: v.createdByClerkUserId,
          // `canWrite` first: an accountant can save nothing, so they own no
          // view and may delete none either.
          canDelete:
            canWrite &&
            (ctx.role === "owner" || v.createdByClerkUserId === ctx.userId),
        }))}
        activeHref={activeHref}
      />

      {hasFilters && (
        <div className="flex flex-wrap items-center gap-2">
          {q && (
            <Badge variant="secondary" className="gap-1 font-normal">
              &ldquo;{q}&rdquo;
              <Link href={withoutHref({ q: true })} aria-label="Clear text search">
                <X className="size-3" />
              </Link>
            </Badge>
          )}
          {folderId && (
            <Badge variant="secondary" className="gap-1 font-normal">
              in {labels.get(folderId) ?? "folder"}
              <Link href={withoutHref({ folderId: true })} aria-label="Clear folder">
                <X className="size-3" />
              </Link>
            </Badge>
          )}
          {origin && (
            <Badge variant="secondary" className="gap-1 font-normal">
              {origin === "accounting" ? "from Receipts" : "cabinet files"}
              <Link href={withoutHref({ origin: true })} aria-label="Clear source">
                <X className="size-3" />
              </Link>
            </Badge>
          )}
          {tags.map((tag) => (
            <Badge key={tag} variant="secondary" className="gap-1 font-normal">
              {tagNames[tag] ?? tag}
              <Link href={withoutHref({ tag })} aria-label={`Remove tag ${tag}`}>
                <X className="size-3" />
              </Link>
            </Badge>
          ))}
          <Button asChild variant="ghost" size="sm">
            <Link href={`${BASE}/search`}>Clear all</Link>
          </Button>
        </div>
      )}

      {!hasFilters ? (
        <div className="flex flex-col items-center gap-3 rounded-md border px-4 py-12 text-center">
          <Search className="size-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Type in the box above. Quoted phrases, <code>or</code>, and{" "}
            <code>-word</code> to exclude all work.
          </p>
          {data.allTags.length > 0 && (
            <div className="flex flex-wrap justify-center gap-1.5">
              <span className="text-xs text-muted-foreground">Or browse by tag:</span>
              <TagChips
                slugs={data.allTags.map((t) => t.slug)}
                names={tagNames}
              />
            </div>
          )}
        </div>
      ) : hitCount === 0 ? (
        // The sharpest moment for this note: nothing came back, and the reason
        // may be that the file somebody is picturing has no readable text.
        <div className="space-y-3">
          <div className="flex flex-col items-center gap-2 rounded-md border px-4 py-12 text-center">
            <Search className="size-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Nothing matches those filters.
            </p>
          </div>
          {unsearchableNote}
        </div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {hitCount} {hitCount === 1 ? "result" : "results"}
            {data.result?.page ? ` · page ${data.result.page + 1}` : ""}
          </p>

          {/* Quieter here than on the empty state, but still present: results
              that look complete are exactly when somebody stops wondering
              whether something is missing. */}
          {unsearchableNote}

          <div className="divide-y rounded-md border">
            {data.result?.hits.map((hit) => (
              <div key={hit.id} className="flex items-center gap-3 px-4 py-3">
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  {/* Same window, matching Browse. */}
                  <a
                    href={`/api/documents/${hit.id}/file`}
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
                  <TagChips
                    slugs={hit.tags}
                    names={tagNames}
                    className="mt-1 block"
                  />
                </div>
                <span className="hidden text-xs text-muted-foreground sm:inline">
                  {hit.createdAt.toLocaleDateString()}
                </span>
                <DocumentRowMenu
                  canWrite={canWrite}
                  documentId={hit.id}
                  folders={choices}
                  version={hit.version}
                  title={hit.title}
                  fileName={hit.fileName}
                  tenantId={ctx.tenant.id}
                  origin={hit.origin}
                  tags={tagChoices}
                  documentTags={hit.tags}
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
