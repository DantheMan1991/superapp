import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { Audit, AuditMessage } from "@/db/schema";
import { allowsWrite } from "@/lib/packs/authorize";
import { loadParty, PartyError } from "@/lib/parties";
import { packContext } from "@/lib/packs/tenant-context";
import {
  discoveryBusiness,
  discoveryFactsFrom,
  type DiscoveryBusiness,
} from "./core/discovery-prompt";
import { EngagementError, PACK, type EngagementCtx } from "./ops";

/**
 * Discovery, in the tenant's own context (back-office slice 7d).
 *
 * **WHAT MOVED, AND WHAT DID NOT.** `audits` has been the operator tenant's
 * table since back-office slice 2 — ordinary rows under `audits_member_all`,
 * not platform data. What was still true until this slice is that the ONLY
 * way to reach them was `/admin/audits` behind `requireSuperAdmin()`, so the
 * operator's staff could not run discovery without being handed the god view
 * of every client on the platform. Nothing about the data had to change for
 * that to stop being true; the surface moved and the guard became the pack's.
 *
 * So there is no migration in this slice. The rows are where they were.
 *
 * **RUNNING DISCOVERY IS A CHORE, NOT A DECISION** (src/lib/packs/authorize.ts):
 * talking to a prospect and writing down what they said is the work, and the
 * person doing it is rarely the owner — which is the whole point of taking it
 * out of the console. Deleting a record is the owner's.
 */

export const DISCOVERY_STATUSES = ["open", "report_ready"] as const;
export type DiscoveryStatus = (typeof DISCOVERY_STATUSES)[number];

export interface DiscoveryRow {
  audit: Audit;
  /** The party's current name; the audit's own snapshot when it has none. */
  clientName: string;
}

/** What the copilot is told about the business it works for. */
export async function loadDiscoveryBusiness(
  tx: Tx,
  tenantId: string,
  industry: string,
  tenantName: string,
): Promise<DiscoveryBusiness> {
  const pack = await packContext(tx, tenantId, industry, PACK);
  return discoveryBusiness(tenantName, discoveryFactsFrom(pack.config));
}

export async function listDiscoveries(tx: Tx, tenantId: string): Promise<DiscoveryRow[]> {
  const rows = await tx
    .select({ audit: schema.audits, partyName: schema.parties.displayName })
    .from(schema.audits)
    .leftJoin(
      schema.parties,
      and(
        eq(schema.parties.tenantId, schema.audits.tenantId),
        eq(schema.parties.id, schema.audits.partyId),
      ),
    )
    .where(eq(schema.audits.tenantId, tenantId))
    .orderBy(desc(schema.audits.updatedAt));
  return rows.map((r) => ({
    audit: r.audit,
    clientName: r.partyName ?? r.audit.businessName,
  }));
}

export async function getDiscovery(
  tx: Tx,
  tenantId: string,
  id: string,
): Promise<Audit | null> {
  const row = await tx.query.audits.findFirst({
    where: and(eq(schema.audits.tenantId, tenantId), eq(schema.audits.id, id)),
  });
  return row ?? null;
}

function requireWrite(ctx: EngagementCtx, level: "owner" | "member"): void {
  if (!allowsWrite(ctx.role, level)) {
    throw new EngagementError("FORBIDDEN", "not allowed to change this");
  }
}

/**
 * Start a discovery for a party the workspace already knows.
 *
 * The party's name is SNAPSHOTTED onto the row, so the copilot's context
 * survives the record being renamed or merged later — the same reason the
 * console did it, kept because it is right rather than because it was there.
 */
export async function createDiscovery(
  tx: Tx,
  ctx: EngagementCtx,
  input: { partyId: string; context?: string },
): Promise<Audit> {
  requireWrite(ctx, "member");
  let party;
  try {
    party = await loadParty(tx, ctx.tenantId, input.partyId);
  } catch (err) {
    if (err instanceof PartyError) {
      throw new EngagementError("CLIENT_INVALID", "that business is not in the CRM");
    }
    throw err;
  }
  const [row] = await tx
    .insert(schema.audits)
    .values({
      tenantId: ctx.tenantId,
      partyId: party.id,
      businessName: party.displayName,
      industry: "general",
      contactName: null,
      context: (input.context ?? "").trim(),
    })
    .returning();
  return row;
}

/** The conversation so far. Stored as jsonb; read defensively. */
export function messagesOf(audit: Audit): AuditMessage[] {
  return (audit.messages as AuditMessage[]) ?? [];
}

export async function saveMessages(
  tx: Tx,
  ctx: EngagementCtx,
  id: string,
  messages: AuditMessage[],
): Promise<void> {
  requireWrite(ctx, "member");
  await tx
    .update(schema.audits)
    .set({ messages, updatedAt: new Date() })
    .where(and(eq(schema.audits.tenantId, ctx.tenantId), eq(schema.audits.id, id)));
}

export async function saveReport(
  tx: Tx,
  ctx: EngagementCtx,
  id: string,
  report: string,
): Promise<void> {
  requireWrite(ctx, "member");
  await tx
    .update(schema.audits)
    .set({ report, status: "report_ready", updatedAt: new Date() })
    .where(and(eq(schema.audits.tenantId, ctx.tenantId), eq(schema.audits.id, id)));
}

export async function setDiscoveryStatus(
  tx: Tx,
  ctx: EngagementCtx,
  args: { id: string; status: DiscoveryStatus },
): Promise<void> {
  requireWrite(ctx, "member");
  const [row] = await tx
    .update(schema.audits)
    .set({ status: args.status, updatedAt: new Date() })
    .where(and(eq(schema.audits.tenantId, ctx.tenantId), eq(schema.audits.id, args.id)))
    .returning({ id: schema.audits.id });
  if (!row) throw new EngagementError("NOT_FOUND", "discovery not found");
}

/**
 * Attach a record to the business it is about — for one that arrived from the
 * public health check before that business had a party, and for one whose
 * party was merged away in the CRM.
 */
export async function attachDiscovery(
  tx: Tx,
  ctx: EngagementCtx,
  args: { id: string; partyId: string },
): Promise<void> {
  requireWrite(ctx, "member");
  try {
    await loadParty(tx, ctx.tenantId, args.partyId);
  } catch (err) {
    if (err instanceof PartyError) {
      throw new EngagementError("CLIENT_INVALID", "that business is not in the CRM");
    }
    throw err;
  }
  const [row] = await tx
    .update(schema.audits)
    .set({ partyId: args.partyId, updatedAt: new Date() })
    .where(and(eq(schema.audits.tenantId, ctx.tenantId), eq(schema.audits.id, args.id)))
    .returning({ id: schema.audits.id });
  if (!row) throw new EngagementError("NOT_FOUND", "discovery not found");
}

/**
 * Delete a record — a test transcript, a duplicate. OWNER-level: it destroys
 * a conversation somebody had. The public session that produced it keeps its
 * own copy and simply forgets the audit (`interview_sessions.audit_id` is
 * SET NULL).
 */
export async function deleteDiscovery(
  tx: Tx,
  ctx: EngagementCtx,
  id: string,
): Promise<Audit> {
  requireWrite(ctx, "owner");
  const [row] = await tx
    .delete(schema.audits)
    .where(and(eq(schema.audits.tenantId, ctx.tenantId), eq(schema.audits.id, id)))
    .returning();
  if (!row) throw new EngagementError("NOT_FOUND", "discovery not found");
  return row;
}
