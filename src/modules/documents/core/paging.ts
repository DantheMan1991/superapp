/**
 * Keyset ("cursor") pagination.
 *
 * Nothing else in this codebase paginates — every other list is a hard
 * .limit(200), which is fine for a chart of accounts and wrong for a filing
 * cabinet. Browse lists are unbounded and receive inserts while a user is
 * paging, so an OFFSET would silently duplicate and skip rows. A keyset on
 * (created_at DESC, id DESC) cannot, and it matches documents_tenant_folder_idx
 * exactly.
 *
 * Ranked search is the deliberate exception and uses a capped OFFSET instead:
 * ts_rank_cd is neither unique nor monotonic, so it has no valid keyset tuple.
 */

export const PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;
/** Deep paging through relevance is a non-goal; "refine your search" is right. */
export const MAX_SEARCH_OFFSET = 1000;

export interface Cursor {
  createdAt: Date;
  id: string;
}

export function encodeCursor(row: Cursor): string {
  const payload = JSON.stringify({
    t: row.createdAt.toISOString(),
    i: row.id,
  });
  return Buffer.from(payload, "utf8").toString("base64url");
}

/**
 * Returns null for anything unusable — a truncated cursor, a hand-edited URL,
 * a cursor from an older encoding. Never throws: a bad cursor means "start at
 * the beginning", not a 500.
 */
export function parseCursor(raw: string | undefined | null): Cursor | null {
  if (!raw) return null;
  try {
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    const parsed: unknown = JSON.parse(decoded);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { t, i } = parsed as { t?: unknown; i?: unknown };
    if (typeof t !== "string" || typeof i !== "string") return null;
    const createdAt = new Date(t);
    if (Number.isNaN(createdAt.getTime())) return null;
    if (i.length === 0) return null;
    return { createdAt, id: i };
  } catch {
    return null;
  }
}

export function clampPageSize(requested: number | undefined): number {
  if (!requested || !Number.isFinite(requested)) return PAGE_SIZE;
  return Math.min(Math.max(Math.trunc(requested), 1), MAX_PAGE_SIZE);
}

/**
 * Split a `limit + 1` fetch into the page and a hasMore flag — one query, no
 * second count(*).
 */
export function takePage<T extends Cursor>(
  rows: readonly T[],
  limit: number,
): { items: T[]; nextCursor: string | null } {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : [...rows];
  const last = items[items.length - 1];
  return {
    items,
    nextCursor: hasMore && last ? encodeCursor(last) : null,
  };
}
