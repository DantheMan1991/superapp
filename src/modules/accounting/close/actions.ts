"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { logAuditInTx } from "@/lib/audit";
import {
  LedgerError,
  addCloseNote,
  completeClose,
  friendlyMessage,
  reopenClose,
  signOffClose,
  type LedgerCtx,
} from "../core";
import { isValidIsoDate } from "../lib/money";
import { tryGenerateCloseNarrative, generateCloseNarrativeForClose } from "../ai/narrative";

/**
 * Server actions for the month-end close workflow. Same canonical shape
 * as the rest of the module: gate → Zod → withTenant(core + audit).
 * Sign-off, notes, and the narrative are open to the expert (accountant)
 * role; completing and reopening closes stay owner-only (enforced in core).
 */

const BASE = "/dashboard/m/accounting";

type ActionResult<T = undefined> = { ok: true; data?: T } | { error: string };

async function gate(opts?: { allowExpert?: boolean }): Promise<LedgerCtx> {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "accounting");
  // Fail closed for the expert (accountant) role: read-only actions must opt
  // in via allowExpert — a forgotten opt-in denies a read, never grants a write.
  if (ctx.role === "expert" && !opts?.allowExpert) {
    throw new LedgerError("FORBIDDEN_EXPERT", "accountant access is read-only");
  }
  return { tenantId: ctx.tenant.id, userId: ctx.userId, role: ctx.role };
}

function fail(err: unknown): { error: string } {
  if (!(err instanceof LedgerError)) console.error("close action failed", err);
  const msg = err instanceof Error ? err.message : "";
  if (msg.includes("ANTHROPIC_API_KEY")) {
    return { error: "The Claude API key isn't configured yet — see SETUP.md." };
  }
  return { error: friendlyMessage(err) };
}

function revalidate(closeId?: string): void {
  revalidatePath(BASE);
  revalidatePath(`${BASE}/close`);
  revalidatePath(`${BASE}/trial-balance`);
  if (closeId) revalidatePath(`${BASE}/close/${closeId}`);
}

const dateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isValidIsoDate, "Not a real calendar date");

const completeSchema = z.object({ periodEnd: dateStr });

export async function completeCloseAction(
  input: z.infer<typeof completeSchema>,
): Promise<ActionResult<{ closeId: string; blockerCount: number }>> {
  const ctx = await gate();
  const parsed = completeSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    const { close, checklist } = await withTenant(ctx.tenantId, async (tx) => {
      const r = await completeClose(tx, ctx, parsed.data);
      await logAuditInTx(tx, {
        action: "close.completed",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "period_close",
        targetId: r.close.id,
        meta: {
          periodEnd: parsed.data.periodEnd,
          blockerCount: r.checklist.blockerCount,
          before: r.close.previousClosedThrough,
        },
      });
      return r;
    });
    // Auto-run the narrative after the close commits (session 5/6 culture):
    // cooldown-aware, silent failure — the manual button remains.
    await tryGenerateCloseNarrative(ctx, close.id);
    revalidate(close.id);
    return {
      ok: true,
      data: { closeId: close.id, blockerCount: checklist.blockerCount },
    };
  } catch (err) {
    return fail(err);
  }
}

const casSchema = z.object({
  closeId: z.string().uuid(),
  expectedVersion: z.number().int().min(1),
});

export async function reopenCloseAction(
  input: z.infer<typeof casSchema>,
): Promise<ActionResult> {
  const ctx = await gate();
  const parsed = casSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    await withTenant(ctx.tenantId, async (tx) => {
      const close = await reopenClose(tx, ctx, parsed.data);
      await logAuditInTx(tx, {
        action: "close.reopened",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "period_close",
        targetId: close.id,
        meta: {
          periodEnd: close.periodEnd,
          restoredClosedThrough: close.previousClosedThrough,
        },
      });
    });
    revalidate(parsed.data.closeId);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function signOffCloseAction(
  input: z.infer<typeof casSchema>,
): Promise<ActionResult> {
  const ctx = await gate({ allowExpert: true }); // the accountant's whole job
  const parsed = casSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    await withTenant(ctx.tenantId, async (tx) => {
      const close = await signOffClose(tx, ctx, parsed.data);
      await logAuditInTx(tx, {
        action: "close.signed_off",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "period_close",
        targetId: close.id,
        meta: { periodEnd: close.periodEnd },
      });
    });
    revalidate(parsed.data.closeId);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

const noteSchema = z.object({
  closeId: z.string().uuid(),
  body: z.string().trim().min(1).max(2000),
});

export async function addCloseNoteAction(
  input: z.infer<typeof noteSchema>,
): Promise<ActionResult> {
  const ctx = await gate({ allowExpert: true });
  const parsed = noteSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    await withTenant(ctx.tenantId, async (tx) => {
      const note = await addCloseNote(tx, ctx, parsed.data);
      // Identifiers only — never the note body.
      await logAuditInTx(tx, {
        action: "close.note_added",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "close_note",
        targetId: note.id,
        meta: { closeId: parsed.data.closeId },
      });
    });
    revalidate(parsed.data.closeId);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

const narrativeSchema = z.object({ closeId: z.string().uuid() });

export async function generateCloseNarrativeAction(
  input: z.infer<typeof narrativeSchema>,
): Promise<ActionResult> {
  const ctx = await gate({ allowExpert: true }); // review aid, suggest-only
  const parsed = narrativeSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    await generateCloseNarrativeForClose(ctx, parsed.data.closeId);
    revalidate(parsed.data.closeId);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
