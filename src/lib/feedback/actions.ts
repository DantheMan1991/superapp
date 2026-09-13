"use server";

import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { schema, withTenant, type Tx } from "@/db";
import { requireTenant, type TenantContext } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { nativeAppInfo } from "@/lib/native-app-core";
import { notifyFeedback } from "./notify";
import { attachToMessage, FeedbackAttachError } from "./attach";
import { MAX_ATTACHMENTS_PER_MESSAGE } from "./attachments";
import { featureFromRoute } from "./core";
import {
  FEEDBACK_BODY_MAX,
  FEEDBACK_KINDS,
  FEEDBACK_TITLE_MAX,
} from "./vocabulary";

/**
 * THE CLIENT'S SIDE of a feedback thread: file one, reply to one, mark one
 * read. The console's writes are `src/app/admin/feedback/actions.ts` and share
 * nothing with these on purpose — the two sides of this conversation have
 * different authority, and one file that could do both is one bug away from
 * letting a client set their own report to `done`.
 *
 * A SUPPORT VIEW CANNOT FILE ANYTHING, and nothing here checks for it:
 * `requireTenant()` refuses a non-GET while a support session is live
 * (back-office slice 4, security.md S14), and a server action is a POST. A
 * superadmin filing a bug in a client's name would be the worst possible row
 * in this table.
 */

export type FeedbackActionResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

/**
 * WHAT THE BROWSER IS ALLOWED TO TELL US ABOUT ITSELF. Two fields, both
 * cosmetic, both capped — and NEITHER of `surface` nor `appVersion` is among
 * them, because the user agent already carries both and a value the client
 * supplies is a value the client can get wrong.
 */
const Context = z.object({
  /**
   * Capped and checked for shape, then stored whatever it says. It is not
   * trusted as a link: `isSameOriginPath` decides that at render time, on the
   * console, where the consequence of getting it wrong would be.
   */
  route: z.string().max(512).default(""),
  routeQuery: z.string().max(512).default(""),
  /** "375x812". A measurement, so a regex is the whole validation. */
  viewport: z
    .string()
    .max(20)
    .regex(/^$|^\d{1,5}x\d{1,5}$/)
    .default(""),
});

/**
 * PATHNAMES ONLY. Not the type, not the size, not the display name — every one
 * of those is read back off the stored blob by `attachToMessage`, so a forged
 * field here buys nothing. See its header.
 */
const Attachments = z
  .array(z.string().min(1).max(500))
  .max(MAX_ATTACHMENTS_PER_MESSAGE)
  .default([]);

const FileInput = Context.extend({
  kind: z.enum(FEEDBACK_KINDS),
  title: z.string().trim().min(3).max(FEEDBACK_TITLE_MAX),
  body: z.string().trim().min(1).max(FEEDBACK_BODY_MAX),
  attachments: Attachments,
});

const ReplyInput = z.object({
  reportId: z.string().uuid(),
  body: z.string().trim().min(1).max(FEEDBACK_BODY_MAX),
  attachments: Attachments,
});

/** Run as the signed-in person — `app_current_user()` is half the policy. */
function asReporter<T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>) {
  return withTenant(ctx.tenant.id, fn, { role: ctx.role, userId: ctx.userId });
}

/**
 * Who they are, read from `profiles` INSIDE THEIR OWN TRANSACTION rather than
 * fetched from Clerk. It is one indexed join against a row they can already
 * see, it costs no network call on the path that has to feel instant, and it
 * gives the same answer the Team page gives — which is what the console will
 * render back at them.
 */
async function reporterIdentity(
  tx: Tx,
  ctx: TenantContext,
): Promise<{ name: string; email: string }> {
  const [me] = await tx
    .select({
      name: schema.profiles.name,
      email: schema.profiles.email,
    })
    .from(schema.memberships)
    .innerJoin(
      schema.profiles,
      eq(schema.profiles.id, schema.memberships.profileId),
    )
    .where(
      and(
        eq(schema.memberships.tenantId, ctx.tenant.id),
        eq(schema.profiles.clerkUserId, ctx.userId),
      ),
    )
    .limit(1);
  return { name: me?.name?.trim() ?? "", email: me?.email ?? "" };
}

/** The shell, from the user agent. Never asked, never taken from the client. */
async function shellFacts(): Promise<{ surface: string; appVersion: string; userAgent: string }> {
  const userAgent = (await headers()).get("user-agent") ?? "";
  const native = nativeAppInfo(userAgent);
  return {
    surface: native ? "app" : "browser",
    appVersion: native?.version ?? "",
    // Capped: a user agent is short, but this is a header and headers are
    // whatever the client sends.
    userAgent: userAgent.slice(0, 500),
  };
}

/**
 * FILE ONE. The report and its opening message commit together, in one
 * transaction — a report with no first message would render as an empty
 * thread and there is no state in which that is correct.
 */
export async function fileReportAction(
  input: unknown,
): Promise<FeedbackActionResult> {
  const parsed = FileInput.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error:
        "That needs a short title and a description before it can be sent.",
    };
  }
  const ctx = await requireTenant();
  const { kind, title, body, route, routeQuery, viewport, attachments } =
    parsed.data;
  const shell = await shellFacts();

  /*
    A REFUSED FILE MUST NOT LOOK LIKE A CRASH. `attachToMessage` throws, and it
    throws INSIDE the transaction on purpose so the whole message rolls back
    with it — but what the person sees has to be a sentence, not a red box
    about an unhandled error. Only our own error is caught: anything else is a
    real fault and belongs in the logs uncaught.
  */
  let filed: { id: string; messageId: string };
  try {
    filed = await asReporter(ctx, async (tx) => {
      const who = await reporterIdentity(tx, ctx);
      const [report] = await tx
        .insert(schema.feedbackReports)
        .values({
          tenantId: ctx.tenant.id,
          clerkUserId: ctx.userId,
          reporterName: who.name,
          reporterEmail: who.email,
          kind,
          title,
          route,
          routeQuery,
          featureSlug: featureFromRoute(route),
          surface: shell.surface,
          appVersion: shell.appVersion,
          viewport,
          userAgent: shell.userAgent,
          // Their own words are read by definition. Without this the dot on
          // their own button would light up for the thing they just sent.
          clientReadAt: new Date(),
        })
        .returning({ id: schema.feedbackReports.id });
      const [first] = await tx
        .insert(schema.feedbackMessages)
        .values({
          tenantId: ctx.tenant.id,
          reportId: report.id,
          side: "client",
          clerkUserId: ctx.userId,
          authorName: who.name,
          body,
        })
        .returning({ id: schema.feedbackMessages.id });
      // In the SAME transaction as the message: a sentence pointing at pictures
      // that are not there is worse than a refusal.
      await attachToMessage(tx, {
        tenantId: ctx.tenant.id,
        reportId: report.id,
        messageId: first.id,
        clerkUserId: ctx.userId,
        pathnames: attachments,
      });
      return { id: report.id, messageId: first.id };
    });
  } catch (err) {
    if (err instanceof FeedbackAttachError) {
      return { ok: false, error: err.message };
    }
    throw err;
  }
  const id = filed.id;

  // Identifiers and coarse metadata only — never the text of the report,
  // which is the user's own words and belongs in its own table (AGENTS.md).
  await logAudit({
    action: "feedback.filed",
    tenantId: ctx.tenant.id,
    actorClerkUserId: ctx.userId,
    targetType: "feedback_report",
    targetId: id,
    meta: { kind, route, surface: shell.surface },
  });

  /*
    TELL US. After the commit and awaited, never inside the transaction: a mail
    provider has no business holding a database transaction open, and a send
    that fails must leave a filed report behind rather than rolling one back.
    `notifyFeedback` swallows everything — see its header.
  */
  await notifyFeedback(id, {
    kind: "filed",
    messageId: filed.messageId,
    body,
  });

  revalidatePath("/dashboard/feedback");
  return { ok: true, id };
}

/**
 * REPLY TO ONE. Appends, and touches `updated_at` so the console's list moves.
 * It does NOT change `status` — answering a question is not the same as saying
 * the question is settled, and only the console may say that.
 */
export async function replyToReportAction(
  input: unknown,
): Promise<FeedbackActionResult> {
  const parsed = ReplyInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That message is empty." };
  const ctx = await requireTenant();
  const { reportId, body, attachments } = parsed.data;

  let messageId: string | null;
  try {
    messageId = await asReporter(ctx, async (tx) => {
      // RLS would refuse the insert anyway; asking first turns a database error
      // into a sentence the person can read.
      const [report] = await tx
        .select({ id: schema.feedbackReports.id })
        .from(schema.feedbackReports)
        .where(
          and(
            eq(schema.feedbackReports.id, reportId),
            eq(schema.feedbackReports.clerkUserId, ctx.userId),
          ),
        )
        .limit(1);
      if (!report) return null;
      const who = await reporterIdentity(tx, ctx);
      const [written] = await tx
        .insert(schema.feedbackMessages)
        .values({
          tenantId: ctx.tenant.id,
          reportId,
          side: "client",
          clerkUserId: ctx.userId,
          authorName: who.name,
          body,
        })
        .returning({ id: schema.feedbackMessages.id });
      await attachToMessage(tx, {
        tenantId: ctx.tenant.id,
        reportId,
        messageId: written.id,
        clerkUserId: ctx.userId,
        pathnames: attachments,
      });
      await tx
        .update(schema.feedbackReports)
        .set({ updatedAt: new Date(), clientReadAt: new Date() })
        .where(eq(schema.feedbackReports.id, reportId));
      return written.id;
    });
  } catch (err) {
    if (err instanceof FeedbackAttachError) {
      return { ok: false, error: err.message };
    }
    throw err;
  }
  if (!messageId) {
    return { ok: false, error: "That report is not yours to answer." };
  }

  await logAudit({
    action: "feedback.client_replied",
    tenantId: ctx.tenant.id,
    actorClerkUserId: ctx.userId,
    targetType: "feedback_report",
    targetId: reportId,
  });

  // Their answer is the thing most likely to unblock a report we asked about,
  // so it reaches us the same way their first message did.
  await notifyFeedback(reportId, {
    kind: "client_replied",
    messageId,
    body,
  });

  revalidatePath("/dashboard/feedback");
  revalidatePath(`/dashboard/feedback/${reportId}`);
  return { ok: true, id: reportId };
}

/**
 * MARK IT READ — what clears the dot. Not audited: opening a page one owns is
 * not a sensitive action, and a row per page view would bury the log.
 */
export async function markReportReadAction(
  reportId: unknown,
): Promise<{ ok: boolean }> {
  const parsed = z.string().uuid().safeParse(reportId);
  if (!parsed.success) return { ok: false };
  const ctx = await requireTenant();
  await asReporter(ctx, (tx) =>
    tx
      .update(schema.feedbackReports)
      .set({ clientReadAt: new Date() })
      .where(
        and(
          eq(schema.feedbackReports.id, parsed.data),
          eq(schema.feedbackReports.clerkUserId, ctx.userId),
        ),
      ),
  );
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}
