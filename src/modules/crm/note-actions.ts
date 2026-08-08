"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { logAuditInTx } from "@/lib/audit";
import { listAssignableMembers, memberLabel } from "@/lib/team";
import { todayInTimezone } from "@/lib/timezone";
import { CrmError, friendlyMessage } from "./core/errors";
import { logActivity, createTask } from "./timeline-ops";
import type { CrmCtx } from "./core/types";
import { callExtractNoteModel, gatherNoteInput, type NoteGathered } from "./ai/extract-note";
import {
  resolveProposal,
  validateExtraction,
  type ResolvedProposal,
} from "./ai/note-shape";

/**
 * Paste a note, get a proposal; review it, then save.
 *
 * TWO ACTIONS ON PURPOSE, and the split is the safety property. `extractNote`
 * writes NOTHING — it returns a proposal for a person to look at.
 * `saveReviewedNote` writes what that person confirmed, and it never sees the
 * model's output: its input is the reviewed list, validated on its own terms.
 *
 * So a hallucinated follow-up cannot reach the database by any path that does
 * not pass through somebody reading it. That matters more here than it would
 * have a week ago — a task written blind now routes into its assignee's
 * morning digest, which is a channel whose whole value is that it only
 * contains real obligations.
 */

async function gate(): Promise<CrmCtx & { timezone: string }> {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "crm");
  if (ctx.role === "expert") {
    throw new CrmError("FORBIDDEN_EXPERT", "accountant access is read-only");
  }
  return {
    tenantId: ctx.tenant.id,
    userId: ctx.userId,
    role: ctx.role,
    timezone: ctx.tenant.timezone,
  };
}

function fail(err: unknown): { error: string } {
  if (err instanceof CrmError) return { error: friendlyMessage(err) };
  console.error("crm note action failed", err);
  return { error: friendlyMessage(err) };
}

/* -- Propose -------------------------------------------------------------- */

const extractSchema = z.object({
  partyId: z.string().uuid(),
  note: z.string(),
});

export type ExtractResult =
  | { ok: true; proposal: ResolvedProposal }
  | { error: string };

export async function extractNoteAction(
  input: z.infer<typeof extractSchema>,
): Promise<ExtractResult> {
  try {
    const ctx = await gate();
    const parsed = extractSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    const today = todayInTimezone(ctx.timezone);

    // Gate + claim the cooldown, then leave the transaction before the network
    // call. Holding a tx open across model latency is how a pool dies.
    const gathered: NoteGathered = await gatherNoteInput(ctx, {
      partyId: parsed.data.partyId,
      note: parsed.data.note,
      today,
    });

    const raw = await callExtractNoteModel(gathered);
    const extraction = validateExtraction(raw);
    if (!extraction) throw new CrmError("AI_NO_RESULT", "schema mismatch");

    // The roster read runs under the caller's RLS, so an assignee hint can only
    // ever resolve to somebody they could already have picked by hand.
    const members = await withTenant(
      ctx.tenantId,
      (tx) => listAssignableMembers(tx, ctx.tenantId),
      { role: ctx.role, userId: ctx.userId },
    );

    return {
      ok: true,
      proposal: resolveProposal(
        extraction,
        today,
        members.map((m) => ({
          clerkUserId: m.clerkUserId,
          label: memberLabel(m),
        })),
      ),
    };
  } catch (err) {
    return fail(err);
  }
}

/* -- Save what was reviewed ----------------------------------------------- */

/**
 * Validated on its own terms, NOT trusted because it came from the extractor.
 * By the time this runs the person has edited it, and this action has no way
 * to know which parts are theirs and which are the model's — so it treats all
 * of it as ordinary user input, exactly like the manual forms do.
 */
const saveSchema = z.object({
  partyId: z.string().uuid(),
  activities: z
    .array(
      z.object({
        kind: z.enum(["call", "meeting", "note"]),
        summary: z.string().min(1).max(2_000),
      }),
    )
    .max(10),
  tasks: z
    .array(
      z.object({
        title: z.string().min(1).max(200),
        dueOn: z.string().date().nullable(),
        assigneeClerkUserId: z.string().max(120).nullable(),
      }),
    )
    .max(10),
});

export async function saveReviewedNoteAction(
  input: z.infer<typeof saveSchema>,
): Promise<{ ok: true; activities: number; tasks: number } | { error: string }> {
  try {
    const ctx = await gate();
    const parsed = saveSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };
    const { partyId, activities, tasks } = parsed.data;

    if (activities.length === 0 && tasks.length === 0) {
      return { ok: true, activities: 0, tasks: 0 };
    }

    await withTenant(
      ctx.tenantId,
      async (tx) => {
        for (const a of activities) {
          await logActivity(tx, ctx, {
            partyId,
            kind: a.kind,
            subject: a.summary.slice(0, 200),
            body: a.summary,
          });
        }
        for (const t of tasks) {
          await createTask(tx, ctx, {
            partyId,
            title: t.title,
            dueOn: t.dueOn,
            assigneeClerkUserId: t.assigneeClerkUserId,
          });
        }
        // Audited as AI-ASSISTED, with counts only. Somebody asking "where did
        // this follow-up come from?" gets a truthful answer, and the row
        // carries no note text — the note is the tenant's, not the log's (S9).
        await logAuditInTx(tx, {
          action: "crm.note_extracted_saved",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "party",
          targetId: partyId,
          meta: { activities: activities.length, tasks: tasks.length },
        });
      },
      { role: ctx.role, userId: ctx.userId },
    );

    revalidatePath(`/dashboard/m/crm/records/${partyId}`);
    return { ok: true, activities: activities.length, tasks: tasks.length };
  } catch (err) {
    return fail(err);
  }
}
