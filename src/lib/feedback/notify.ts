import "server-only";
import { and, eq } from "drizzle-orm";
import { schema, withSystem } from "@/db";
import { sendEmail } from "@/lib/email/send";
import { getOperatorTenant } from "@/lib/operator-tenant";
import { screenLabel } from "./core";
import {
  feedbackEmails,
  type FeedbackEvent,
  type Recipient,
  type ReportFacts,
} from "./notify-core";

/**
 * SENDING what `notify-core.ts` decided. The I/O half, and deliberately thin:
 * every judgement about who hears what lives next door where a test can reach
 * it without a mail provider.
 *
 * ── NOTHING HERE MAY THROW ───────────────────────────────────────────────────
 *
 * Every caller is a server action that has ALREADY COMMITTED the report or the
 * message. The record is the thing the user asked for; the email is a courtesy
 * on top of it. An unreachable provider, a missing key, a capped tenant — none
 * of those may turn "your report was filed" into a red toast about a report
 * that is, in fact, filed. So the whole of `notifyFeedback` is wrapped, and
 * failures are logged by REASON only, never with an address or a subject
 * (security.md S9).
 *
 * This is the rule `docs/modules/time.md` wrote down after a credential failure
 * threw out of a clock-in, and it applies with more force here: the feature
 * exists to hear about things being broken.
 */

/** Where links point. Falls back to production, like the digest's. */
function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "https://yosherapp.com";
}

/**
 * WHO AT YOSHER HEARS ABOUT IT.
 *
 * The operator tenant's OWNERS first — data rather than configuration, the
 * route `notifyPlan` established for a health-check lead (ADR 0041). Their
 * addresses come from `profiles`, which is also what the console signs in as.
 *
 * `SUPER_ADMIN_EMAILS` is the fallback, and it is not decoration: a database
 * with no operator tenant flagged — CI's from-zero one, a fresh dev branch, or
 * production before 2026-09-09 — would otherwise silently tell nobody that the
 * product is broken. Of all the channels to let fail quietly, this is the worst
 * one, so it gets a second source.
 *
 * Returns an empty list when neither exists, which the caller treats as "send
 * the client's half anyway" rather than as an error.
 */
async function operatorRecipients(): Promise<Recipient[]> {
  try {
    const operator = await getOperatorTenant();
    if (operator) {
      const owners = await withSystem((tx) =>
        tx
          .select({
            profileId: schema.memberships.profileId,
            email: schema.profiles.email,
          })
          .from(schema.memberships)
          .innerJoin(
            schema.profiles,
            eq(schema.profiles.id, schema.memberships.profileId),
          )
          .where(
            and(
              eq(schema.memberships.tenantId, operator.id),
              eq(schema.memberships.role, "owner"),
            ),
          ),
      );
      const found = owners
        .filter((o) => !!o.email)
        .map((o) => ({ key: o.profileId, email: o.email as string }));
      if (found.length > 0) return found;
    }
  } catch (err) {
    // A missing operator tenant is not an error; a broken query is, and it
    // still must not stop the fallback below.
    console.error("feedback: could not read operator owners", err);
  }
  return (process.env.SUPER_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean)
    .map((email) => ({ key: `env:${email}`, email }));
}

/**
 * The facts an email needs, read from the report under `withSystem`.
 *
 * `withSystem` rather than the caller's transaction, and it is worth saying
 * why: the operator's reply action already runs there, but the CLIENT's does
 * not, and the client's own context cannot read `tenants.name` — which the
 * subject line of OUR copy needs. One indexed read of a row the caller just
 * wrote, after it has committed.
 */
async function factsFor(
  reportId: string,
): Promise<{ facts: ReportFacts; tenantId: string } | null> {
  const [row] = await withSystem((tx) =>
    tx
      .select({
        id: schema.feedbackReports.id,
        kind: schema.feedbackReports.kind,
        status: schema.feedbackReports.status,
        title: schema.feedbackReports.title,
        tenantName: schema.tenants.name,
        reporterName: schema.feedbackReports.reporterName,
        reporterEmail: schema.feedbackReports.reporterEmail,
        route: schema.feedbackReports.route,
        surface: schema.feedbackReports.surface,
        viewport: schema.feedbackReports.viewport,
        tenantId: schema.feedbackReports.tenantId,
      })
      .from(schema.feedbackReports)
      .innerJoin(
        schema.tenants,
        eq(schema.tenants.id, schema.feedbackReports.tenantId),
      )
      .where(eq(schema.feedbackReports.id, reportId))
      .limit(1),
  );
  if (!row) return null;
  const { tenantId, ...facts } = row;
  return { facts: { ...facts, screen: screenLabel(row.route) }, tenantId };
}

/**
 * Tell whoever needs telling. Best-effort, never throws, and the caller does
 * not wait on the outcome beyond the await — there is nothing useful it could
 * do with a failure that the log does not already record.
 */
export async function notifyFeedback(
  reportId: string,
  event: FeedbackEvent,
): Promise<void> {
  try {
    // An internal note reaches nobody, so do not even read the report for it.
    if (event.kind === "operator_replied" && event.internal) return;

    const found = await factsFor(reportId);
    if (!found) return;
    const { facts, tenantId } = found;

    const emails = feedbackEmails({
      report: facts,
      event,
      operatorRecipients:
        event.kind === "operator_replied" ? [] : await operatorRecipients(),
      appUrl: appUrl(),
    });

    for (const email of emails) {
      const sent = await sendEmail({
        tenantId,
        kind: "feedback",
        // THIS IS YOSHER WRITING. Never the tenant's own verified domain —
        // see `senderIdentity` in send.ts.
        senderIdentity: "platform",
        to: email.to,
        subject: email.subject,
        text: email.text,
        idempotencyKey: email.idempotencyKey,
      });
      if (!sent.ok) {
        // Reason only. Never the address, never the subject (S9).
        console.error(`feedback email not sent (${sent.reason})`);
      }
    }
  } catch (err) {
    console.error("feedback notification failed", err);
  }
}
