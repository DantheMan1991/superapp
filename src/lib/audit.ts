import "server-only";
import { withSystem, schema } from "@/db";

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
