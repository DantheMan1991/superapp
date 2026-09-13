import { kindLabel, statusLabel } from "./core";

/**
 * WHAT GETS EMAILED, TO WHOM, AND WHAT IT SAYS. Pure — no database, no
 * provider, no `server-only`.
 *
 * Split from the sending for one reason above all others: **an internal note
 * must never reach the client**, and that rule is one branch in one function
 * here, asserted directly by `tests/feedback-notify.test.ts` without a
 * database or a mail provider in the way. A rule that can only be tested by
 * watching what arrives in an inbox is a rule nobody tests.
 *
 * The second reason is the client-facing copy. These are the only emails in
 * the feedback module a CLIENT reads, and they are written in the founder's
 * voice for people outside the building: plain short sentences, no dashes for
 * asides, nothing that reads as machine-written. The operator's own copy can
 * be denser, and still is not.
 */

/** Longest quoted extract of somebody's message. The whole thing is in the app. */
export const QUOTE_MAX = 900;

export interface FeedbackEmail {
  to: string;
  subject: string;
  text: string;
  /**
   * Derived from what the message IS, never from a clock — `sendEmail`'s own
   * contract. A retried action is then a no-op rather than a second email.
   */
  idempotencyKey: string;
}

/** One person we might write to. `key` makes the idempotency key unique. */
export interface Recipient {
  key: string;
  email: string;
}

export interface ReportFacts {
  id: string;
  kind: string;
  status: string;
  title: string;
  tenantName: string;
  reporterName: string;
  reporterEmail: string;
  /** Prettied by `screenLabel` before it gets here. */
  screen: string;
  route: string;
  surface: string;
  viewport: string;
}

export type FeedbackEvent =
  | { kind: "filed"; messageId: string; body: string }
  | {
      kind: "operator_replied";
      messageId: string;
      body: string;
      /** THE ONE THAT MATTERS. An internal note emails nobody. */
      internal: boolean;
    }
  | { kind: "client_replied"; messageId: string; body: string };

/** Trimmed, quoted, and never the whole of a long one. */
function quote(body: string): string {
  const text = body.trim();
  if (text.length <= QUOTE_MAX) return text;
  return `${text.slice(0, QUOTE_MAX).trimEnd()}…`;
}

function who(report: ReportFacts): string {
  const name = report.reporterName.trim();
  if (name && report.reporterEmail) return `${name} (${report.reporterEmail})`;
  return name || report.reporterEmail || "Somebody";
}

/** "Hi Sam," or plain "Hi," — never "Hi ," and never a raw address. */
function greeting(report: ReportFacts): string {
  const first = report.reporterName.trim().split(/\s+/)[0] ?? "";
  return first ? `Hi ${first},` : "Hi,";
}

/**
 * THE WHOLE POLICY, in one place: which emails an event produces.
 *
 * Returns a LIST, possibly empty, and an empty list is a real answer rather
 * than a failure — an internal note produces one.
 *
 * `operatorRecipients` is who hears about a client's words; `report`'s own
 * reporter address is who hears about ours. A caller that has no operator
 * address passes an empty list and the client-facing mail still goes out,
 * because the two are independent obligations.
 */
export function feedbackEmails(input: {
  report: ReportFacts;
  event: FeedbackEvent;
  operatorRecipients: readonly Recipient[];
  /** Absolute, no trailing slash — e.g. "https://yosherapp.com". */
  appUrl: string;
}): FeedbackEmail[] {
  const { report, event, operatorRecipients, appUrl } = input;
  const base = appUrl.replace(/\/$/, "");
  const consoleLink = `${base}/admin/feedback/${report.id}`;
  const clientLink = `${base}/dashboard/feedback/${report.id}`;
  const noun = kindLabel(report.kind, "operator").toLowerCase();

  if (event.kind === "operator_replied") {
    // ─────────────────────────────────────────────────────────────────────
    // THE RULE. A note is written for us, in a thread the client can open;
    // the only thing standing between it and their inbox is this line.
    // ─────────────────────────────────────────────────────────────────────
    if (event.internal) return [];
    if (!report.reporterEmail) return [];
    return [
      {
        to: report.reporterEmail,
        subject: `We answered: ${report.title}`,
        text: [
          greeting(report),
          "",
          "You told us about this in Yosher. Here is our answer.",
          "",
          quote(event.body),
          "",
          `Your report is now marked "${statusLabel(report.status, "client")}".`,
          "",
          `Read it and reply here: ${clientLink}`,
          "",
          "Only you can see this report. Nobody else at your business can read it.",
        ].join("\n"),
        idempotencyKey: `feedback:reply:${event.messageId}`,
      },
    ];
  }

  // Both remaining events go to us, one mail each.
  const subject =
    event.kind === "filed"
      ? `${kindLabel(report.kind, "operator")} from ${report.tenantName}: ${report.title}`
      : `${report.tenantName} replied: ${report.title}`;

  const body =
    event.kind === "filed"
      ? [
          `${who(report)} at ${report.tenantName} reported a ${noun}.`,
          "",
          `Screen: ${report.screen}${report.route ? ` (${report.route})` : ""}`,
          `From: ${report.surface === "app" ? "the mobile app" : "a browser"}${
            report.viewport ? `, ${report.viewport}` : ""
          }`,
          "",
          quote(event.body),
          "",
          `Open it: ${consoleLink}`,
        ].join("\n")
      : [
          `${who(report)} replied about "${report.title}".`,
          "",
          quote(event.body),
          "",
          `Open it: ${consoleLink}`,
        ].join("\n");

  return operatorRecipients
    .filter((r) => !!r.email)
    .map((r) => ({
      to: r.email,
      subject,
      text: body,
      // The recipient is IN the key: two owners must both get one, and a
      // retry must give neither of them a second.
      idempotencyKey: `feedback:${event.kind}:${event.messageId}:${r.key}`,
    }));
}
