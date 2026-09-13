"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { currentUser } from "@clerk/nextjs/server";
import { z } from "zod";
import { schema, withSystem } from "@/db";
import { requireSuperAdmin } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { isClosedStatus } from "@/lib/feedback/core";
import {
  FEEDBACK_BODY_MAX,
  FEEDBACK_KINDS,
  FEEDBACK_STATUSES,
} from "@/lib/feedback/vocabulary";

/**
 * THE OPERATOR'S SIDE of a feedback thread. Every function here runs
 * `withSystem` and writes into somebody else's workspace, so every one of them
 * opens with `requireSuperAdmin()` — which REDIRECTS rather than throwing, so
 * the check has to be the first await and its result has to be used.
 *
 * Separate from `src/lib/feedback/actions.ts` on purpose. One file that could
 * write both sides is one bug away from letting a client mark their own report
 * `done`, and the two sides do not share a single line of authority.
 *
 * ── WHY THESE ARE THE ONLY WRITES ────────────────────────────────────────────
 *
 * Reply, note, status, kind. There is no "edit a message" and no "delete a
 * report": a conversation is not a thing either side may rewrite, which the
 * migration enforces by giving `feedback_messages` no UPDATE or DELETE policy
 * at all. Withdrawing a report is `declined`, said out loud.
 */

export type ConsoleResult = { ok: true } | { ok: false; error: string };

const ReplyInput = z.object({
  reportId: z.string().uuid(),
  body: z.string().trim().min(1).max(FEEDBACK_BODY_MAX),
  /** An operator-only note. The client never sees one — see the RLS migration. */
  internal: z.boolean().default(false),
  /**
   * Moved in the same submit, so "here is a question" and "waiting on them" are
   * one action rather than two the operator has to remember to pair.
   */
  status: z.enum(FEEDBACK_STATUSES).optional(),
});

/** "Sam Rivera", or the address — whoever is signed into the console. */
async function operatorLabel(): Promise<string> {
  const me = await currentUser();
  const name = [me?.firstName, me?.lastName].filter(Boolean).join(" ").trim();
  return name || me?.emailAddresses[0]?.emailAddress || "Yosher";
}

/**
 * REPLY, or leave a note. Marks the thread read by us in the same transaction,
 * because answering is the strongest possible evidence of having read it and a
 * console that needed a separate "mark read" would grow a queue of threads
 * somebody answered and forgot to clear.
 */
export async function replyFromConsoleAction(
  input: unknown,
): Promise<ConsoleResult> {
  const parsed = ReplyInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That message is empty." };
  const { userId } = await requireSuperAdmin();
  const { reportId, body, internal, status } = parsed.data;
  const author = await operatorLabel();
  const now = new Date();

  const ok = await withSystem(async (tx) => {
    const [report] = await tx
      .select({
        id: schema.feedbackReports.id,
        tenantId: schema.feedbackReports.tenantId,
        status: schema.feedbackReports.status,
      })
      .from(schema.feedbackReports)
      .where(eq(schema.feedbackReports.id, reportId))
      .limit(1);
    if (!report) return null;

    await tx.insert(schema.feedbackMessages).values({
      tenantId: report.tenantId,
      reportId,
      side: "operator",
      clerkUserId: userId,
      authorName: internal ? author : "Yosher",
      body,
      internal,
    });

    const nextStatus = status ?? report.status;
    await tx
      .update(schema.feedbackReports)
      .set({
        operatorReadAt: now,
        updatedAt: now,
        status: nextStatus,
        // `closed_at` and `status` move together and nowhere else, so "closed"
        // stays one indexable predicate. Clearing it on reopen matters as much
        // as setting it: a report answered again after `done` is open work.
        closedAt: isClosedStatus(nextStatus)
          ? (isClosedStatus(report.status) ? undefined : now)
          : null,
      })
      .where(eq(schema.feedbackReports.id, reportId));
    return report;
  });
  if (!ok) return { ok: false, error: "That report is gone." };

  await logAudit({
    action: internal ? "feedback.note_added" : "feedback.replied",
    tenantId: ok.tenantId,
    actorClerkUserId: userId,
    actorLabel: "god-view",
    targetType: "feedback_report",
    targetId: reportId,
    meta: status ? { status } : {},
  });

  revalidatePath("/admin/feedback");
  revalidatePath(`/admin/feedback/${reportId}`);
  return { ok: true };
}

const TriageInput = z.object({
  reportId: z.string().uuid(),
  status: z.enum(FEEDBACK_STATUSES).optional(),
  kind: z.enum(FEEDBACK_KINDS).optional(),
});

/**
 * MOVE IT — status, kind, or both, with nothing said.
 *
 * NOTHING IS WRITTEN INTO THE THREAD BY THIS. A status change the client can
 * see is already visible as a chip on their own page, and a machine-written
 * "status changed to planned" line in a conversation between two people is
 * noise pretending to be an answer. If it is worth telling them, it is worth
 * typing — which is what `replyFromConsoleAction`'s optional `status` is for.
 */
export async function triageReportAction(
  input: unknown,
): Promise<ConsoleResult> {
  const parsed = TriageInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That is not a valid move." };
  const { userId } = await requireSuperAdmin();
  const { reportId, status, kind } = parsed.data;
  if (!status && !kind) return { ok: true };
  const now = new Date();

  const report = await withSystem(async (tx) => {
    const [found] = await tx
      .select({
        tenantId: schema.feedbackReports.tenantId,
        status: schema.feedbackReports.status,
      })
      .from(schema.feedbackReports)
      .where(eq(schema.feedbackReports.id, reportId))
      .limit(1);
    if (!found) return null;
    const nextStatus = status ?? found.status;
    await tx
      .update(schema.feedbackReports)
      .set({
        ...(status ? { status: nextStatus } : {}),
        ...(kind ? { kind } : {}),
        ...(status
          ? {
              closedAt: isClosedStatus(nextStatus)
                ? (isClosedStatus(found.status) ? undefined : now)
                : null,
            }
          : {}),
        operatorReadAt: now,
        updatedAt: now,
      })
      .where(eq(schema.feedbackReports.id, reportId));
    return found;
  });
  if (!report) return { ok: false, error: "That report is gone." };

  await logAudit({
    action: "feedback.triaged",
    tenantId: report.tenantId,
    actorClerkUserId: userId,
    actorLabel: "god-view",
    targetType: "feedback_report",
    targetId: reportId,
    meta: { ...(status ? { status } : {}), ...(kind ? { kind } : {}) },
  });

  revalidatePath("/admin/feedback");
  revalidatePath(`/admin/feedback/${reportId}`);
  return { ok: true };
}

/**
 * MARK IT SEEN without answering — what clears a thread off the queue when the
 * right response is "noted, nothing to say". Separate from `triage` because
 * doing nothing deliberately is a different act from moving it, and because a
 * console whose only way to clear a row is to change its status would grow a
 * pile of reports filed as `planned` that nobody plans to do.
 */
export async function markSeenAction(input: unknown): Promise<ConsoleResult> {
  const parsed = z.string().uuid().safeParse(input);
  if (!parsed.success) return { ok: false, error: "That report is gone." };
  await requireSuperAdmin();
  await withSystem((tx) =>
    tx
      .update(schema.feedbackReports)
      .set({ operatorReadAt: new Date() })
      .where(eq(schema.feedbackReports.id, parsed.data)),
  );
  revalidatePath("/admin/feedback");
  revalidatePath(`/admin/feedback/${parsed.data}`);
  return { ok: true };
}
