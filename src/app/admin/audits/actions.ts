"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withSystem, schema } from "@/db";
import type { AuditMessage } from "@/db/schema";
import { requireSuperAdmin } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { getClaude, CLAUDE_MODEL } from "@/lib/claude";
import {
  DISCOVERY_SYSTEM_PROMPT,
  REPORT_INSTRUCTION,
  auditContextMessage,
} from "@/lib/discovery";

const createAuditSchema = z.object({
  tenantId: z.string().uuid("Pick a business from the CRM"),
  context: z.string().trim().max(10000).optional().or(z.literal("")),
});

/**
 * Start a discovery engagement for an existing CRM record (prospect or
 * client). Business facts are snapshotted onto the audit so the copilot
 * prompt has them even if the CRM record is edited later.
 */
export async function createAuditEngagement(formData: FormData) {
  const { userId } = await requireSuperAdmin();
  const parsed = createAuditSchema.safeParse({
    tenantId: formData.get("tenantId"),
    context: formData.get("context"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const tenant = await withSystem((tx) =>
    tx.query.tenants.findFirst({
      where: eq(schema.tenants.id, parsed.data.tenantId),
    }),
  );
  if (!tenant) return { error: "Business not found in the CRM" };

  const [audit] = await withSystem((tx) =>
    tx
      .insert(schema.audits)
      .values({
        tenantId: tenant.id,
        businessName: tenant.name,
        industry: tenant.industry,
        contactName: tenant.contactName,
        context: parsed.data.context || "",
      })
      .returning(),
  );

  await logAudit({
    action: "audit.created",
    actorClerkUserId: userId,
    targetType: "audit",
    targetId: audit.id,
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
  await requireSuperAdmin();
  const parsed = sendMessageSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };

  const audit = await withSystem((tx) =>
    tx.query.audits.findFirst({
      where: eq(schema.audits.id, parsed.data.auditId),
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

  await withSystem((tx) =>
    tx
      .update(schema.audits)
      .set({ messages: updatedMessages, updatedAt: new Date() })
      .where(eq(schema.audits.id, audit.id)),
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

  const audit = await withSystem((tx) =>
    tx.query.audits.findFirst({
      where: eq(schema.audits.id, parsed.data.auditId),
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

    await withSystem((tx) =>
      tx
        .update(schema.audits)
        .set({ report, status: "report_ready", updatedAt: new Date() })
        .where(eq(schema.audits.id, audit.id)),
    );
  } catch (err) {
    console.error("report generation failed", err);
    return { error: "Report generation failed. Check server logs." };
  }

  await logAudit({
    action: "audit.report_generated",
    actorClerkUserId: userId,
    targetType: "audit",
    targetId: audit.id,
  });

  revalidatePath(`/admin/audits/${audit.id}`);
  return { ok: true };
}

const statusSchema = z.object({
  auditId: z.string().uuid(),
  status: z.enum(["open", "report_ready", "won", "lost"]),
});

export async function setAuditStatus(input: {
  auditId: string;
  status: "open" | "report_ready" | "won" | "lost";
}) {
  await requireSuperAdmin();
  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };

  await withSystem((tx) =>
    tx
      .update(schema.audits)
      .set({ status: parsed.data.status, updatedAt: new Date() })
      .where(eq(schema.audits.id, parsed.data.auditId)),
  );

  revalidatePath(`/admin/audits/${parsed.data.auditId}`);
  revalidatePath("/admin/audits");
  return { ok: true };
}
