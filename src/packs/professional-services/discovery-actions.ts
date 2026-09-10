"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@/db";
import type { AuditMessage } from "@/db/schema";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { logAuditInTx } from "@/lib/audit";
import { getClaude, CLAUDE_MODEL } from "@/lib/claude";
import {
  discoverySystemPrompt,
  engagementContextMessage,
  reportInstruction,
} from "./core/discovery-prompt";
import {
  attachDiscovery,
  createDiscovery,
  deleteDiscovery,
  getDiscovery,
  loadDiscoveryBusiness,
  messagesOf,
  saveMessages,
  saveReport,
  setDiscoveryStatus,
} from "./discovery-ops";
import { EngagementError, PACK, type EngagementCtx } from "./ops";

/**
 * The discovery write surface, in the TENANT's context.
 *
 * The copilot call sits between two transactions and never inside one: a
 * model call can take a minute, and holding a database transaction open
 * across it would pin a connection for the whole answer. Load, call, save —
 * the shape the console used, kept.
 */

const BASE = "/dashboard/m/professional-services/discovery";

interface Gate {
  ctx: EngagementCtx;
  tenantName: string;
  industry: string;
}

async function gate(): Promise<Gate> {
  const tenant = await requireTenant();
  await requireModuleEnabled(tenant.tenant.id, PACK);
  return {
    ctx: { tenantId: tenant.tenant.id, userId: tenant.userId, role: tenant.role },
    tenantName: tenant.tenant.name,
    industry: tenant.tenant.industry,
  };
}

function toResult(err: unknown): { error: string } {
  if (err instanceof EngagementError) {
    switch (err.code) {
      case "FORBIDDEN":
        return { error: "You cannot change this one." };
      case "NOT_FOUND":
        return { error: "That discovery no longer exists." };
      case "CLIENT_INVALID":
        return { error: "That business is not in your CRM. Reload and pick again." };
      default:
        return { error: "That change is not allowed." };
    }
  }
  console.error("discovery action failed", err);
  return { error: "Something went wrong saving that." };
}

/** The copilot's refusals, in words the person reading them can act on. */
function modelError(err: unknown): { error: string } {
  console.error("discovery copilot call failed", err);
  if (err instanceof Error && err.message.includes("ANTHROPIC_API_KEY")) {
    return { error: "The AI copilot is not configured on this workspace yet — ask us." };
  }
  return { error: "The copilot did not answer. Try again in a moment." };
}

export async function createDiscoveryAction(input: unknown) {
  try {
    const { ctx } = await gate();
    const parsed = z
      .object({
        partyId: z.string().uuid("Pick a business from your CRM"),
        context: z.string().trim().max(10000).optional(),
      })
      .safeParse(input);
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Check the details and try again." };
    }

    const audit = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const row = await createDiscovery(tx, ctx, parsed.data);
        await logAuditInTx(tx, {
          action: "discovery.created",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "discovery",
          targetId: row.id,
          meta: { partyId: row.partyId },
        });
        return row;
      },
      { role: ctx.role, userId: ctx.userId },
    );
    revalidatePath(BASE);
    return { ok: true as const, discoveryId: audit.id };
  } catch (err) {
    return toResult(err);
  }
}

/**
 * One turn with the copilot: append what was said, get the analysis back,
 * persist both. Streamed so a long answer stays inside the HTTP timeout; the
 * whole reply is stored and rendered at once.
 */
export async function sendDiscoveryMessageAction(input: unknown) {
  try {
    const { ctx, tenantName, industry } = await gate();
    const parsed = z
      .object({
        discoveryId: z.string().uuid(),
        message: z.string().trim().min(1).max(20000),
      })
      .safeParse(input);
    if (!parsed.success) return { error: "Check the details and try again." };

    const loaded = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const audit = await getDiscovery(tx, ctx.tenantId, parsed.data.discoveryId);
        if (!audit) return null;
        const business = await loadDiscoveryBusiness(tx, ctx.tenantId, industry, tenantName);
        return { audit, business };
      },
      { role: ctx.role, userId: ctx.userId },
    );
    if (!loaded) return { error: "That discovery no longer exists." };

    const history = messagesOf(loaded.audit);
    const conversation: AuditMessage[] = [
      { role: "user", content: engagementContextMessage(loaded.audit) },
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
            text: discoverySystemPrompt(loaded.business),
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: conversation,
      });
      const response = await stream.finalMessage();
      replyText = response.content
        .filter((b): b is { type: "text"; text: string } & typeof b => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      if (!replyText) return { error: "The copilot answered with nothing — try again." };
    } catch (err) {
      return modelError(err);
    }

    await withTenant(
      ctx.tenantId,
      (tx) =>
        saveMessages(tx, ctx, loaded.audit.id, [
          ...history,
          { role: "user", content: parsed.data.message },
          { role: "assistant", content: replyText },
        ]),
      { role: ctx.role, userId: ctx.userId },
    );
    revalidatePath(`${BASE}/${loaded.audit.id}`);
    return { ok: true as const };
  } catch (err) {
    return toResult(err);
  }
}

/** Turn the whole conversation into the health check and the build spec. */
export async function generateDiscoveryReportAction(input: unknown) {
  try {
    const { ctx, tenantName, industry } = await gate();
    const parsed = z.object({ discoveryId: z.string().uuid() }).safeParse(input);
    if (!parsed.success) return { error: "Check the details and try again." };

    const loaded = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const audit = await getDiscovery(tx, ctx.tenantId, parsed.data.discoveryId);
        if (!audit) return null;
        const business = await loadDiscoveryBusiness(tx, ctx.tenantId, industry, tenantName);
        return { audit, business };
      },
      { role: ctx.role, userId: ctx.userId },
    );
    if (!loaded) return { error: "That discovery no longer exists." };

    const history = messagesOf(loaded.audit);
    if (history.length === 0) {
      return { error: "Have at least one exchange with the copilot first." };
    }

    let report: string;
    try {
      const stream = getClaude().messages.stream({
        model: CLAUDE_MODEL,
        max_tokens: 64000,
        thinking: { type: "adaptive" },
        system: [
          {
            type: "text",
            text: discoverySystemPrompt(loaded.business),
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [
          { role: "user", content: engagementContextMessage(loaded.audit) },
          ...history,
          { role: "user", content: reportInstruction(loaded.business) },
        ],
      });
      const response = await stream.finalMessage();
      report = response.content
        .filter((b): b is { type: "text"; text: string } & typeof b => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      if (!report) return { error: "The copilot answered with nothing — try again." };
    } catch (err) {
      return modelError(err);
    }

    await withTenant(
      ctx.tenantId,
      async (tx) => {
        await saveReport(tx, ctx, loaded.audit.id, report);
        await logAuditInTx(tx, {
          action: "discovery.report_generated",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "discovery",
          targetId: loaded.audit.id,
        });
      },
      { role: ctx.role, userId: ctx.userId },
    );
    revalidatePath(`${BASE}/${loaded.audit.id}`);
    return { ok: true as const };
  } catch (err) {
    return toResult(err);
  }
}

export async function setDiscoveryStatusAction(input: unknown) {
  try {
    const { ctx } = await gate();
    const parsed = z
      .object({
        discoveryId: z.string().uuid(),
        status: z.enum(["open", "report_ready"]),
      })
      .safeParse(input);
    if (!parsed.success) return { error: "Check the details and try again." };

    await withTenant(
      ctx.tenantId,
      (tx) => setDiscoveryStatus(tx, ctx, { id: parsed.data.discoveryId, status: parsed.data.status }),
      { role: ctx.role, userId: ctx.userId },
    );
    revalidatePath(BASE);
    revalidatePath(`${BASE}/${parsed.data.discoveryId}`);
    return { ok: true as const };
  } catch (err) {
    return toResult(err);
  }
}

export async function attachDiscoveryAction(input: unknown) {
  try {
    const { ctx } = await gate();
    const parsed = z
      .object({
        discoveryId: z.string().uuid(),
        partyId: z.string().uuid("Pick a business from your CRM"),
      })
      .safeParse(input);
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Check the details and try again." };
    }

    await withTenant(
      ctx.tenantId,
      async (tx) => {
        await attachDiscovery(tx, ctx, {
          id: parsed.data.discoveryId,
          partyId: parsed.data.partyId,
        });
        await logAuditInTx(tx, {
          action: "discovery.attached",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "discovery",
          targetId: parsed.data.discoveryId,
          meta: { partyId: parsed.data.partyId },
        });
      },
      { role: ctx.role, userId: ctx.userId },
    );
    revalidatePath(BASE);
    revalidatePath(`${BASE}/${parsed.data.discoveryId}`);
    return { ok: true as const };
  } catch (err) {
    return toResult(err);
  }
}

export async function deleteDiscoveryAction(input: unknown) {
  try {
    const { ctx } = await gate();
    const parsed = z.object({ discoveryId: z.string().uuid() }).safeParse(input);
    if (!parsed.success) return { error: "Check the details and try again." };

    await withTenant(
      ctx.tenantId,
      async (tx) => {
        const gone = await deleteDiscovery(tx, ctx, parsed.data.discoveryId);
        await logAuditInTx(tx, {
          action: "discovery.deleted",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "discovery",
          targetId: gone.id,
        });
      },
      { role: ctx.role, userId: ctx.userId },
    );
    revalidatePath(BASE);
    return { ok: true as const };
  } catch (err) {
    return toResult(err);
  }
}
