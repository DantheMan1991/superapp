"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@/db";
import { requireTenantOwner } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import {
  friendlySetupError,
  runTurn,
  startInterview,
  type SetupCtx,
  type SetupInterviewView,
} from "./session";
import { SETUP_MESSAGE_MAX } from "./prompt";

/**
 * The setup interview's two actions (ADR 0040).
 *
 * OWNERS ONLY, and this is where that is decided — the same division the
 * Getting set up card makes (ADR 0033: "owners only, decided in the card,
 * not in the sources"). The plan is a set of decisions about the business:
 * when its books begin, whether its money is mixed, what its accountant
 * holds. Staff can carry them out; the owner is who answers them.
 */

const BASE = "/dashboard/setup";

type ActionResult<T> = { ok: true; data: T } | { error: string };

async function gate(): Promise<SetupCtx & { name: string; industry: string | null }> {
  const ctx = await requireTenantOwner();
  return {
    tenantId: ctx.tenant.id,
    userId: ctx.userId,
    role: ctx.role,
    name: ctx.tenant.name,
    industry: ctx.tenant.industry ?? null,
  };
}

export async function startSetupInterviewAction(): Promise<
  ActionResult<SetupInterviewView>
> {
  try {
    const ctx = await gate();
    const view = await withTenant(ctx.tenantId, (tx) => startInterview(tx, ctx), {
      role: ctx.role,
      userId: ctx.userId,
    });
    await logAudit({
      action: "setup_interview.started",
      tenantId: ctx.tenantId,
      actorClerkUserId: ctx.userId,
      targetType: "setup_interview",
      targetId: view.id,
      meta: {},
    });
    revalidatePath(BASE);
    return { ok: true, data: view };
  } catch (err) {
    return { error: friendlySetupError(err) };
  }
}

const sendSchema = z.object({
  message: z.string().trim().min(1).max(SETUP_MESSAGE_MAX),
});

export async function sendSetupMessageAction(
  input: z.infer<typeof sendSchema>,
): Promise<ActionResult<SetupInterviewView>> {
  try {
    const ctx = await gate();
    const parsed = sendSchema.safeParse(input);
    if (!parsed.success) {
      return { error: "Say something first, in a sentence or two." };
    }
    const view = await runTurn(
      ctx,
      { name: ctx.name, industry: ctx.industry },
      parsed.data.message,
    );
    if (view.state === "done") {
      // Counts only — never the conversation, which is about how somebody's
      // business is run (S9).
      await logAudit({
        action: "setup_interview.finished",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "setup_interview",
        targetId: view.id,
        meta: { exchanges: view.exchangeCount, steps: view.plan?.steps.length ?? 0 },
      });
    }
    revalidatePath(BASE);
    revalidatePath("/dashboard");
    return { ok: true, data: view };
  } catch (err) {
    return { error: friendlySetupError(err) };
  }
}
