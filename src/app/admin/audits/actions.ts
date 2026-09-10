"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant, schema, type Tx } from "@/db";
import type { AuditMessage } from "@/db/schema";
import { requireSuperAdmin } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { getClaude, CLAUDE_MODEL } from "@/lib/claude";
import {
  DISCOVERY_SYSTEM_PROMPT,
  REPORT_INSTRUCTION,
  auditContextMessage,
} from "@/lib/discovery";
import { getOperatorTenant } from "@/lib/operator-tenant";
import { loadParty, PartyError } from "@/lib/parties";

/**
 * Discovery lives in the OPERATOR tenant (ADR 0041, back-office slice 2): an
 * audit is a row of the business that runs the platform, attached to the
 * party it is about, and every action here runs inside the operator's own
 * context as an owner — `withTenant`, never `withSystem`. The console is
 * still the only place these are reached from, behind `requireSuperAdmin()`;
 * what changed is whose rows they are, and therefore which policy decides.
 */

const NO_OPERATOR =
  "No operator tenant is named yet — run scripts/operator-tenant.ts first.";

/** The operator's context for one superadmin action, or null when none is named. */
async function asOperator(userId: string) {
  const operator = await getOperatorTenant();
  if (!operator) return null;
  return {
    id: operator.id,
    run: <T,>(fn: (tx: Tx) => Promise<T>) =>
      withTenant(operator.id, fn, { role: "owner", userId }),
  };
}

const createAuditSchema = z.object({
  partyId: z.string().uuid("Pick a business from the CRM"),
  context: z.string().trim().max(10000).optional().or(z.literal("")),
});

/**
 * Start a discovery engagement for a party in the operator's CRM. The name is
 * snapshotted onto the audit so the copilot prompt has it even if the record
 * is renamed later.
 */
export async function createAuditEngagement(formData: FormData) {
  const { userId } = await requireSuperAdmin();
  const parsed = createAuditSchema.safeParse({
    partyId: formData.get("partyId"),
    context: formData.get("context"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const op = await asOperator(userId);
  if (!op) return { error: NO_OPERATOR };

  let audit: { id: string; partyId: string | null };
  try {
    audit = await op.run(async (tx) => {
      const party = await loadParty(tx, op.id, parsed.data.partyId);
      const [row] = await tx
        .insert(schema.audits)
        .values({
          tenantId: op.id,
          partyId: party.id,
          businessName: party.displayName,
          industry: "general",
          contactName: null,
          context: parsed.data.context || "",
        })
        .returning({ id: schema.audits.id, partyId: schema.audits.partyId });
      return row;
    });
  } catch (err) {
    if (err instanceof PartyError && err.code === "PARTY_NOT_FOUND") {
      return { error: "That business is not in the operator's CRM." };
    }
    throw err;
  }

  await logAudit({
    action: "audit.created",
    tenantId: op.id,
    actorClerkUserId: userId,
    targetType: "audit",
    targetId: audit.id,
    meta: { partyId: audit.partyId },
  });

  revalidatePath("/admin/audits");
  return { ok: true, auditId: audit.id };
}

const sendMessageSchema = z.object({
  auditId: z.string().uuid(),
  message: z.string().trim().min(1).max(20000),
});

/**
 * One turn with the discovery copilot: append the founder's note, get
 * Claude's analysis, persist both. Streaming keeps long analyses inside
 * HTTP timeouts; the full reply is stored and rendered at once.
 */
export async function sendAuditMessage(input: {
  auditId: string;
  message: string;
}): Promise<{ ok?: boolean; error?: string }> {
  const { userId } = await requireSuperAdmin();
  const parsed = sendMessageSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  const op = await asOperator(userId);
  if (!op) return { error: NO_OPERATOR };

  const audit = await op.run((tx) =>
    tx.query.audits.findFirst({
      where: and(
        eq(schema.audits.tenantId, op.id),
        eq(schema.audits.id, parsed.data.auditId),
      ),
    }),
  );
  if (!audit) return { error: "Audit not found" };

  const history = (audit.messages as AuditMessage[]) ?? [];
  const conversation: AuditMessage[] = [
    { role: "user", content: auditContextMessage(audit) },
    ...history,
    { role: "user", content: parsed.data.message },
  ];

  let replyText: string;
  try {
    const stream = getClaude().messages.stream({
      model: CLAUDE_MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      system: [
        {
          type: "text",
          text: DISCOVERY_SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: conversation,
    });
    const response = await stream.finalMessage();
    replyText = response.content
      .filter((b): b is { type: "text"; text: string } & typeof b =>
        b.type === "text",
      )
      .map((b) => b.text)
      .join("\n");
    if (!replyText) return { error: "Claude returned no text — try again." };
  } catch (err) {
    console.error("discovery copilot call failed", err);
    return {
      error:
        err instanceof Error && err.message.includes("ANTHROPIC_API_KEY")
          ? "The Claude API key isn't configured yet — see SETUP.md."
          : "The Claude API call failed. Check the server logs and try again.",
    };
  }

  const updatedMessages: AuditMessage[] = [
    ...history,
    { role: "user", content: parsed.data.message },
    { role: "assistant", content: replyText },
  ];

  await op.run((tx) =>
    tx
      .update(schema.audits)
      .set({ messages: updatedMessages, updatedAt: new Date() })
      .where(and(eq(schema.audits.tenantId, op.id), eq(schema.audits.id, audit.id))),
  );

  revalidatePath(`/admin/audits/${audit.id}`);
  return { ok: true };
}

const reportSchema = z.object({ auditId: z.string().uuid() });

/** Turn the whole conversation into the health check + build spec. */
export async function generateAuditReport(input: {
  auditId: string;
}): Promise<{ ok?: boolean; error?: string }> {
  const { userId } = await requireSuperAdmin();
  const parsed = reportSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  const op = await asOperator(userId);
  if (!op) return { error: NO_OPERATOR };

  const audit = await op.run((tx) =>
    tx.query.audits.findFirst({
      where: and(
        eq(schema.audits.tenantId, op.id),
        eq(schema.audits.id, parsed.data.auditId),
      ),
    }),
  );
  if (!audit) return { error: "Audit not found" };

  const history = (audit.messages as AuditMessage[]) ?? [];
  if (history.length === 0) {
    return { error: "Have at least one exchange with the copilot first." };
  }

  try {
    const stream = getClaude().messages.stream({
      model: CLAUDE_MODEL,
      max_tokens: 64000,
      thinking: { type: "adaptive" },
      system: [
        {
          type: "text",
          text: DISCOVERY_SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        { role: "user", content: auditContextMessage(audit) },
        ...history,
        { role: "user", content: REPORT_INSTRUCTION },
      ],
    });
    const response = await stream.finalMessage();
    const report = response.content
      .filter((b): b is { type: "text"; text: string } & typeof b =>
        b.type === "text",
      )
      .map((b) => b.text)
      .join("\n");
    if (!report) return { error: "Claude returned no text — try again." };

    await op.run((tx) =>
      tx
        .update(schema.audits)
        .set({ report, status: "report_ready", updatedAt: new Date() })
        .where(and(eq(schema.audits.tenantId, op.id), eq(schema.audits.id, audit.id))),
    );
  } catch (err) {
    console.error("report generation failed", err);
    return { error: "Report generation failed. Check server logs." };
  }

  await logAudit({
    action: "audit.report_generated",
    tenantId: op.id,
    actorClerkUserId: userId,
    targetType: "audit",
    targetId: audit.id,
  });

  revalidatePath(`/admin/audits/${audit.id}`);
  return { ok: true };
}

/**
 * `won` and `lost` are no longer written: an outcome belongs to the DEAL in
 * the operator's CRM, which the lead opened. The enum keeps both values
 * because Postgres cannot drop one; the schema here refuses them.
 */
const statusSchema = z.object({
  auditId: z.string().uuid(),
  status: z.enum(["open", "report_ready"]),
});

export async function setAuditStatus(input: {
  auditId: string;
  status: "open" | "report_ready";
}) {
  const { userId } = await requireSuperAdmin();
  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  const op = await asOperator(userId);
  if (!op) return { error: NO_OPERATOR };

  await op.run((tx) =>
    tx
      .update(schema.audits)
      .set({ status: parsed.data.status, updatedAt: new Date() })
      .where(and(eq(schema.audits.tenantId, op.id), eq(schema.audits.id, parsed.data.auditId))),
  );

  revalidatePath(`/admin/audits/${parsed.data.auditId}`);
  revalidatePath("/admin/audits");
  return { ok: true };
}

const attachSchema = z.object({
  auditId: z.string().uuid(),
  partyId: z.string().uuid("Pick a business from the CRM"),
});

/**
 * Attach a discovery record to the party it is about. For records that moved
 * home (slice 2's migration) before their business had a party, and for a
 * record whose party was merged away in the CRM.
 */
export async function attachAuditToPartyAction(input: {
  auditId: string;
  partyId: string;
}) {
  const { userId } = await requireSuperAdmin();
  const parsed = attachSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const op = await asOperator(userId);
  if (!op) return { error: NO_OPERATOR };

  let previous: string | null = null;
  try {
    const found = await op.run(async (tx) => {
      await loadParty(tx, op.id, parsed.data.partyId);
      const [row] = await tx
        .update(schema.audits)
        .set({ partyId: parsed.data.partyId, updatedAt: new Date() })
        .where(and(eq(schema.audits.tenantId, op.id), eq(schema.audits.id, parsed.data.auditId)))
        .returning({ id: schema.audits.id });
      return !!row;
    });
    if (!found) return { error: "Audit not found" };
  } catch (err) {
    if (err instanceof PartyError && err.code === "PARTY_NOT_FOUND") {
      return { error: "That business is not in the operator's CRM." };
    }
    throw err;
  }
  previous = null;

  await logAudit({
    action: "audit.attached",
    tenantId: op.id,
    actorClerkUserId: userId,
    targetType: "audit",
    targetId: parsed.data.auditId,
    meta: { partyId: parsed.data.partyId, previous },
  });

  revalidatePath(`/admin/audits/${parsed.data.auditId}`);
  revalidatePath("/admin/audits");
  return { ok: true };
}

const deleteSchema = z.object({ auditId: z.string().uuid() });

/**
 * Delete a discovery record — a test transcript, a duplicate. The public
 * session that produced it keeps its own copy of the conversation and simply
 * forgets the audit (`interview_sessions.audit_id` is SET NULL).
 */
export async function deleteAuditAction(input: { auditId: string }) {
  const { userId } = await requireSuperAdmin();
  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  const op = await asOperator(userId);
  if (!op) return { error: NO_OPERATOR };

  const deleted = await op.run(async (tx) => {
    const [row] = await tx
      .delete(schema.audits)
      .where(and(eq(schema.audits.tenantId, op.id), eq(schema.audits.id, parsed.data.auditId)))
      .returning({ id: schema.audits.id, businessName: schema.audits.businessName });
    return row ?? null;
  });
  if (!deleted) return { error: "Audit not found" };

  await logAudit({
    action: "audit.deleted",
    tenantId: op.id,
    actorClerkUserId: userId,
    targetType: "audit",
    targetId: deleted.id,
  });

  revalidatePath("/admin/audits");
  return { ok: true };
}
