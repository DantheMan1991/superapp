import "server-only";
import { withSystem, schema, type Tx } from "@/db";

interface AuditEvent {
  action: string;
  tenantId?: string | null;
  actorClerkUserId?: string | null;
  actorLabel?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  meta?: Record<string, unknown>;
}

/**
 * Append to the audit log. Never logs sensitive values — callers pass
 * identifiers and coarse metadata only. Failures are swallowed (an audit
 * hiccup must not take down the user action) but reported to the console.
 */
export async function logAudit(event: AuditEvent): Promise<void> {
  try {
    await withSystem((tx) =>
      tx.insert(schema.auditLog).values({
        action: event.action,
        tenantId: event.tenantId ?? null,
        actorClerkUserId: event.actorClerkUserId ?? null,
        actorLabel: event.actorLabel ?? null,
        targetType: event.targetType ?? null,
        targetId: event.targetId ?? null,
        meta: event.meta ?? {},
      }),
    );
  } catch (err) {
    console.error("audit log write failed", err);
  }
}

/**
 * Append to the audit log INSIDE the caller's transaction. For financial
 * mutations (the accounting module): the mutation and its audit record
 * commit together — a ledger change can never commit unaudited, and an
 * audit failure rolls the mutation back. Errors are NOT swallowed.
 *
 * The caller's RLS context must be able to insert the row: tenant
 * transactions (withTenant) pass their own tenantId — the existing
 * audit_log_member_insert policy allows exactly that.
 */
export async function logAuditInTx(tx: Tx, event: AuditEvent): Promise<void> {
  await tx.insert(schema.auditLog).values({
    action: event.action,
    tenantId: event.tenantId ?? null,
    actorClerkUserId: event.actorClerkUserId ?? null,
    actorLabel: event.actorLabel ?? null,
    targetType: event.targetType ?? null,
    targetId: event.targetId ?? null,
    meta: event.meta ?? {},
  });
}
