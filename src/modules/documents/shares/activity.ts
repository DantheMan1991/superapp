import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { ShareEventKind } from "@/db/schema";

/**
 * The per-link activity feed.
 *
 * `document_share_events` has been written since share links shipped and read
 * only in aggregate (an open count and a last-accessed date on the list page).
 * This is the detail view: what happened, when, and — as far as is honest —
 * whether it was the same visitor twice or two different ones.
 *
 * The table is `member_read` by policy: the log is the tenant's evidence in a
 * dispute, so members consult it and only `recordShareEvent` (withSystem)
 * writes it. Nothing here writes.
 */

/**
 * A stable pseudonym for one visitor, derived from the stored IP HASH.
 *
 * The raw address is never stored — `hashIp` is a keyed HMAC — so this cannot
 * be reversed into an IP, and the UI must never imply otherwise. What it CAN
 * honestly support is "these two opens came from the same place" versus "these
 * came from two different places", which is the question an owner actually
 * asks. Six hex characters is plenty to separate the handful of visitors one
 * link sees, and deliberately too few to be treated as an identifier.
 *
 * Empty hash (an event recorded without one) returns null rather than a
 * misleading constant pseudonym that would merge unrelated visitors.
 */
export function visitorLabel(ipHash: string): string | null {
  const trimmed = ipHash.trim();
  if (trimmed.length < 6) return null;
  return trimmed.slice(0, 6).toLowerCase();
}

/**
 * True for events that are evidence somebody was REFUSED, not served.
 * Worth separating in the UI: a run of these is the signal that a link leaked
 * or is being guessed at.
 */
export function isDeniedKind(kind: string): boolean {
  return (
    kind === "denied_passcode" || kind === "denied_scope" || kind === "budget_hit"
  );
}

export interface ShareActivityEntry {
  id: string;
  kind: ShareEventKind;
  /** Null when the event was not about one specific file. */
  documentName: string | null;
  visitor: string | null;
  bytesSent: number;
  denied: boolean;
  createdAt: Date;
}

export interface ShareActivity {
  entries: ShareActivityEntry[];
  /** Distinct visitors seen, as far as the hashes can tell. */
  distinctVisitors: number;
  /** True when the feed was truncated, so the UI does not imply completeness. */
  truncated: boolean;
}

/**
 * One link's recent activity, newest first.
 *
 * The document name is joined through RLS like everything else, so a file that
 * has since been moved somewhere restricted shows as null rather than leaking
 * its name into a feed the whole team can read.
 */
export async function loadShareActivity(
  tx: Tx,
  tenantId: string,
  shareId: string,
  limit = 100,
): Promise<ShareActivity> {
  const rows = await tx
    .select({
      id: schema.documentShareEvents.id,
      kind: schema.documentShareEvents.kind,
      ipHash: schema.documentShareEvents.ipHash,
      bytesSent: schema.documentShareEvents.bytesSent,
      createdAt: schema.documentShareEvents.createdAt,
      documentName: schema.documents.fileName,
      documentTitle: schema.documents.title,
    })
    .from(schema.documentShareEvents)
    .leftJoin(
      schema.documents,
      and(
        eq(schema.documents.tenantId, schema.documentShareEvents.tenantId),
        eq(schema.documents.id, schema.documentShareEvents.documentId),
      ),
    )
    .where(
      and(
        eq(schema.documentShareEvents.tenantId, tenantId),
        eq(schema.documentShareEvents.shareId, shareId),
      ),
    )
    .orderBy(desc(schema.documentShareEvents.createdAt))
    .limit(limit + 1);

  const truncated = rows.length > limit;
  const page = truncated ? rows.slice(0, limit) : rows;

  const visitors = new Set<string>();
  const entries = page.map((row): ShareActivityEntry => {
    const visitor = visitorLabel(row.ipHash);
    if (visitor) visitors.add(visitor);
    return {
      id: row.id,
      kind: row.kind as ShareEventKind,
      documentName: row.documentTitle || row.documentName || null,
      visitor,
      bytesSent: row.bytesSent,
      denied: isDeniedKind(row.kind),
      createdAt: row.createdAt,
    };
  });

  return { entries, distinctVisitors: visitors.size, truncated };
}
