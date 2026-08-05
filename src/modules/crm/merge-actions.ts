"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { logAuditInTx } from "@/lib/audit";
import { CrmError, friendlyMessage } from "./core/errors";
import type { CrmCtx } from "./core/types";
import type { MergeCandidate, MergePlan } from "./core/merge";
import { applyMerge, findMergeCandidates, previewMerge } from "./merge-ops";

/**
 * Server actions for finding and merging duplicates.
 *
 * OWNER-ONLY, ALL THREE, and this is the strictest gate in the module. Every
 * other CRM write is staff-manageable because every other CRM write is
 * reversible — a wrong lifecycle stage is retyped, an archived field keeps its
 * values, an activity is the one deletable thing and nothing references it. A
 * merge deletes an identity, moves posted invoices onto a different customer
 * row, and cannot be undone by this product. The listing is gated too rather
 * than only the commit: a duplicates page is a page about a job only an owner
 * can finish, and showing staff a list of buttons they are refused is a worse
 * answer than not showing the list.
 *
 * The gate is duplicated in RLS for the tables that carry a visibility term,
 * as everywhere else here — the policy makes an unauthorized write affect zero
 * rows, and "nothing happened" is a worse thing to tell somebody than "you need
 * to be an owner".
 */

const BASE = "/dashboard/m/crm";

type ActionResult<T = undefined> = { ok: true; data?: T } | { error: string };

async function gate(): Promise<CrmCtx> {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "crm");
  if (ctx.role === "expert") {
    throw new CrmError("FORBIDDEN_EXPERT", "accountant access is read-only");
  }
  if (ctx.role !== "owner") {
    throw new CrmError("FORBIDDEN", "owner role required");
  }
  return { tenantId: ctx.tenant.id, userId: ctx.userId, role: ctx.role };
}

function fail(err: unknown): { error: string } {
  if (err instanceof CrmError) return { error: friendlyMessage(err) };
  console.error("crm merge action failed", err);
  return { error: friendlyMessage(err) };
}

const pairSchema = z.object({
  survivorPartyId: z.string().uuid(),
  loserPartyId: z.string().uuid(),
});

export async function findMergeCandidatesAction(): Promise<
  ActionResult<{ candidates: MergeCandidate[] }>
> {
  try {
    const ctx = await gate();
    const candidates = await withTenant(
      ctx.tenantId,
      (tx) => findMergeCandidates(tx, ctx.tenantId),
      { role: ctx.role },
    );
    return { ok: true, data: { candidates } };
  } catch (err) {
    return fail(err);
  }
}

/**
 * What the merge would do, for the confirmation screen.
 *
 * Read-only, and deliberately returns the SAME plan shape the executor
 * recomputes — the preview is not a summary written separately from the
 * operation, it is the operation described.
 */
export async function previewMergeAction(
  input: z.infer<typeof pairSchema>,
): Promise<
  ActionResult<{ plan: MergePlan; survivorName: string; loserName: string }>
> {
  try {
    const ctx = await gate();
    const parsed = pairSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    const preview = await withTenant(
      ctx.tenantId,
      (tx) =>
        previewMerge(
          tx,
          ctx.tenantId,
          parsed.data.survivorPartyId,
          parsed.data.loserPartyId,
        ),
      { role: ctx.role },
    );

    return {
      ok: true,
      data: {
        plan: preview.plan,
        survivorName: preview.survivor.displayName,
        loserName: preview.loser.displayName,
      },
    };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Commit the merge.
 *
 * THE AUDIT ROW IS THE ONLY RECORD THAT SURVIVES. Nothing in this product can
 * undo a merge, so the meta below is what somebody investigating "where did
 * that customer go?" has to work with: both ids, both names as they read at the
 * time, and the counts of what moved. Names are the tenant's own business
 * names, the same class of identifier `invoice.customer_created` already
 * records — not PII belonging to a third party.
 */
export async function mergeRecordsAction(
  input: z.infer<typeof pairSchema>,
): Promise<ActionResult<{ survivorPartyId: string }>> {
  try {
    const ctx = await gate();
    const parsed = pairSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    await withTenant(
      ctx.tenantId,
      async (tx) => {
        // Read the names BEFORE the merge, because one of these rows is about
        // to stop existing and the audit entry is what it leaves behind.
        const preview = await previewMerge(
          tx,
          ctx.tenantId,
          parsed.data.survivorPartyId,
          parsed.data.loserPartyId,
        );
        const plan = await applyMerge(
          tx,
          ctx.tenantId,
          parsed.data.survivorPartyId,
          parsed.data.loserPartyId,
        );
        await logAuditInTx(tx, {
          action: "crm.records_merged",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "party",
          targetId: parsed.data.survivorPartyId,
          meta: {
            survivorName: preview.survivor.displayName,
            mergedPartyId: parsed.data.loserPartyId,
            mergedName: preview.loser.displayName,
            customer: plan.customer.action,
            vendor: plan.vendor.action,
            moved: plan.moves,
            contactPointsMoved: plan.contactPoints.move.length,
            contactPointsDropped: plan.contactPoints.dropDuplicate.length,
            affiliationsMoved: plan.affiliations.move.length,
            affiliationsDropped:
              plan.affiliations.dropSelf.length +
              plan.affiliations.dropDuplicate.length,
          },
        });
      },
      { role: ctx.role },
    );

    // The whole module: a merge changes the records list, the record page that
    // no longer exists, every deal and follow-up that moved, and the duplicates
    // page itself.
    revalidatePath(BASE, "layout");
    return { ok: true, data: { survivorPartyId: parsed.data.survivorPartyId } };
  } catch (err) {
    return fail(err);
  }
}
