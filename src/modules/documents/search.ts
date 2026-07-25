import "server-only";
import { sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { MAX_SEARCH_OFFSET, PAGE_SIZE } from "./core/paging";

/**
 * Full-text search over the cabinet.
 *
 * Written as raw SQL because `search_tsv` is a generated tsvector column that
 * deliberately does not appear in schema.ts (Drizzle has no tsvector type —
 * see drizzle/0026).
 *
 * Two things this query does NOT do, both on purpose:
 *
 *  - No visibility predicate. RLS has already removed owners-only rows for a
 *    staff caller, and adding an app-level term here would create a second
 *    place for that rule to be wrong.
 *  - No keyset cursor. ts_rank_cd is neither unique nor monotonic, so it has
 *    no valid keyset tuple; ranked results page by OFFSET, hard-capped. Deep
 *    paging through relevance is a non-goal — past a few pages the right
 *    product answer is "refine your search", not "keep scrolling".
 */

export interface SearchHit {
  id: string;
  title: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  origin: string;
  folderId: string | null;
  version: number;
  createdAt: Date;
  rank: number;
}

export interface SearchResult {
  hits: SearchHit[];
  page: number;
  hasMore: boolean;
  /** True when the query was refused before touching the database. */
  empty: boolean;
}

/** Longest query we will hand to the parser. */
export const SEARCH_QUERY_MAX = 200;

/**
 * Trim and bound a raw query string. Returns null when there is nothing worth
 * searching for, so callers can render the empty state without a round trip.
 *
 * No escaping or sanitizing beyond length: the query goes to
 * websearch_to_tsquery as a BOUND PARAMETER, and that function is total — it
 * accepts quotes, `or`, `-exclusion` and outright garbage without throwing.
 * That is exactly why it is used here instead of to_tsquery, which raises a
 * syntax error on input a user can easily type.
 */
export function normalizeSearchQuery(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().slice(0, SEARCH_QUERY_MAX);
  return trimmed.length === 0 ? null : trimmed;
}

/** Highest page number reachable given the offset cap. */
export function maxSearchPage(pageSize = PAGE_SIZE): number {
  return Math.floor(MAX_SEARCH_OFFSET / pageSize);
}

export async function searchDocuments(
  tx: Tx,
  tenantId: string,
  input: {
    q: string;
    /** Restrict to a folder and everything beneath it. */
    folderPath?: string | null;
    page?: number;
    pageSize?: number;
  },
): Promise<SearchResult> {
  const pageSize = input.pageSize ?? PAGE_SIZE;
  const page = Math.min(
    Math.max(Math.trunc(input.page ?? 0), 0),
    maxSearchPage(pageSize),
  );
  const offset = page * pageSize;
  const folderPath = input.folderPath ?? null;

  // limit + 1 tells us there is another page without a second count(*).
  const rows = await tx.execute(sql`
    select d.id,
           d.title,
           d.file_name     as "fileName",
           d.mime_type     as "mimeType",
           d.size_bytes    as "sizeBytes",
           d.origin,
           d.folder_id     as "folderId",
           d.version,
           d.created_at    as "createdAt",
           ts_rank_cd(d.search_tsv, q) as rank
      from documents d,
           websearch_to_tsquery('english', ${input.q}) q
     where d.tenant_id = ${tenantId}
       and d.status <> 'trashed'
       and d.search_tsv @@ q
       and (
         ${folderPath}::text is null
         or d.folder_id in (
           select f.id from document_folders f
            where f.tenant_id = ${tenantId}
              and f.path like ${folderPath}::text || '%'
         )
       )
     order by rank desc, d.created_at desc, d.id desc
     limit ${pageSize + 1} offset ${offset}
  `);

  const raw = (rows.rows ?? []) as Array<Record<string, unknown>>;
  const hasMore = raw.length > pageSize;
  const hits = (hasMore ? raw.slice(0, pageSize) : raw).map(
    (r): SearchHit => ({
      id: String(r.id),
      title: String(r.title ?? ""),
      fileName: String(r.fileName ?? ""),
      mimeType: String(r.mimeType ?? ""),
      sizeBytes: Number(r.sizeBytes ?? 0),
      origin: String(r.origin ?? ""),
      folderId: r.folderId === null ? null : String(r.folderId),
      version: Number(r.version ?? 1),
      createdAt: new Date(String(r.createdAt)),
      rank: Number(r.rank ?? 0),
    }),
  );

  return { hits, page, hasMore, empty: false };
}
