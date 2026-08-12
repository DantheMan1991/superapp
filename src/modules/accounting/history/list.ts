import "server-only";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { describeActor, describeAuditAction, describeAuditMeta } from "./format";

/**
 * "What has happened to this record" — read from `audit_log`.
 *
 * No new table and no new writes. Every financial mutation in this module
 * already writes an audit row in the SAME TRANSACTION as the change
 * (`logAuditInTx`), so the history is a consequence of a rule that already
 * existed rather than a second record that could disagree with the first.
 *
 * `audit_log` is member-READABLE by policy (`drizzle/0001`), which is what
 * makes this a plain read under the caller's own RLS context rather than
 * something needing `withSystem`.
 */

export interface HistoryTarget {
  type: string;
  id: string;
}

export interface HistoryEvent {
  id: string;
  at: Date;
  action: string;
  /** Human sentence; the raw `action` is kept for anyone who needs precision. */
  label: string;
  detail: string;
  actor: string;
  targetType: string | null;
}

/** Enough for any real record; a longer list is a report, not a panel. */
export const HISTORY_LIMIT = 50;

/**
 * TAKES SEVERAL TARGETS, not one, and that is the point of the signature.
 *
 * An invoice's most interesting events are not audited against the invoice. A
 * payment is recorded against `invoice_payment`, and the posting is recorded
 * against `journal_entry` — so a panel that filtered on the invoice alone
 * would show "draft created, issued" and silently omit the money. The caller
 * knows its own related ids and passes them; nothing here guesses.
 */
export async function listRecordHistory(
  tx: Tx,
  tenantId: string,
  targets: readonly HistoryTarget[],
  limit = HISTORY_LIMIT,
): Promise<HistoryEvent[]> {
  const usable = targets.filter((t) => t.type !== "" && t.id !== "");
  if (usable.length === 0) return [];

  const rows = await tx
    .select({
      id: schema.auditLog.id,
      at: schema.auditLog.createdAt,
      action: schema.auditLog.action,
      meta: schema.auditLog.meta,
      actorClerkUserId: schema.auditLog.actorClerkUserId,
      actorLabel: schema.auditLog.actorLabel,
      targetType: schema.auditLog.targetType,
    })
    .from(schema.auditLog)
    .where(
      and(
        eq(schema.auditLog.tenantId, tenantId),
        or(
          ...usable.map((t) =>
            and(
              eq(schema.auditLog.targetType, t.type),
              eq(schema.auditLog.targetId, t.id),
            ),
          ),
        ),
      ),
    )
    .orderBy(desc(schema.auditLog.createdAt))
    .limit(limit);

  if (rows.length === 0) return [];

  // One batched lookup for every actor on the page, rather than one per row.
  const actorIds = [
    ...new Set(
      rows.map((r) => r.actorClerkUserId).filter((id): id is string => !!id),
    ),
  ];
  const nameByClerkId = new Map<string, string>();
  if (actorIds.length > 0) {
    const profiles = await tx
      .select({
        clerkUserId: schema.profiles.clerkUserId,
        name: schema.profiles.name,
        email: schema.profiles.email,
      })
      .from(schema.profiles)
      .where(inArray(schema.profiles.clerkUserId, actorIds));
    for (const p of profiles) {
      // The name if they have one, else the address they signed up with —
      // which is at least a person somebody can identify.
      nameByClerkId.set(p.clerkUserId, p.name?.trim() || p.email);
    }
  }

  return rows.map((r) => ({
    id: r.id,
    at: r.at,
    action: r.action,
    label: describeAuditAction(r.action),
    detail: describeAuditMeta(r.meta),
    actor: describeActor(
      nameByClerkId.get(r.actorClerkUserId ?? "") ?? null,
      r.actorLabel,
      r.actorClerkUserId,
    ),
    targetType: r.targetType,
  }));
}
