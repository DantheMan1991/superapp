import { describe, expect, it } from "vitest";
import {
  feedbackEmails,
  QUOTE_MAX,
  type FeedbackEvent,
  type ReportFacts,
} from "../src/lib/feedback/notify-core";

/**
 * Which feedback emails exist, who gets them, and what they say (ADR 0053,
 * slice 1).
 *
 * THE FIRST BLOCK IS THE ONLY ONE THAT MATTERS. An operator's internal note
 * lives in a thread the client can open, and the email path is the second way
 * it could reach them — the first being RLS, which
 * `tests/isolation/feedback.test.ts` covers. This file covers the other. A
 * note that emails the client is not a bug you get to take back.
 */

const REPORT: ReportFacts = {
  id: "r-1",
  kind: "bug",
  status: "needs_info",
  title: "Ledger health card has no link",
  tenantName: "Hilltop Farm",
  reporterName: "Sam Rivera",
  reporterEmail: "sam@hilltop.example",
  screen: "Accounting",
  route: "/dashboard/m/accounting",
  surface: "browser",
  viewport: "959x910",
};

const OPERATORS = [
  { key: "p-1", email: "founder@yosher.example" },
  { key: "p-2", email: "second@yosher.example" },
];

const send = (event: FeedbackEvent, report: ReportFacts = REPORT) =>
  feedbackEmails({
    report,
    event,
    operatorRecipients: OPERATORS,
    appUrl: "https://yosherapp.com",
  });

describe("an internal note reaches nobody", () => {
  it("sends no email at all", () => {
    expect(
      send({
        kind: "operator_replied",
        messageId: "m-9",
        body: "SECRET: same as the Hilltop one, their books are a mess.",
        internal: true,
      }),
    ).toEqual([]);
  });

  it("does not leak the note's words even to us", () => {
    // Not an oversight that we get nothing either: we WROTE it, we are looking
    // at the console, and an email carrying that sentence is one forward away
    // from the person it is about.
    const sent = send({
      kind: "operator_replied",
      messageId: "m-9",
      body: "SECRET: their books are a mess.",
      internal: true,
    });
    expect(JSON.stringify(sent)).not.toContain("SECRET");
  });

  it("still sends when the same reply is NOT internal", () => {
    const sent = send({
      kind: "operator_replied",
      messageId: "m-9",
      body: "Should it open the trial balance, or the journal?",
      internal: false,
    });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("sam@hilltop.example");
  });
});

describe("a new report", () => {
  const filed: FeedbackEvent = {
    kind: "filed",
    messageId: "m-1",
    body: "The card looks clickable and does nothing.",
  };

  it("goes to every operator address, and not to the reporter", () => {
    const sent = send(filed);
    expect(sent.map((e) => e.to)).toEqual([
      "founder@yosher.example",
      "second@yosher.example",
    ]);
    expect(sent.map((e) => e.to)).not.toContain(REPORT.reporterEmail);
  });

  it("names the business and the thing in the subject", () => {
    // The subject is the only part that survives a notification shade.
    expect(send(filed)[0].subject).toBe(
      "Bug from Hilltop Farm: Ledger health card has no link",
    );
  });

  it("carries the screen and the shell, so the mail is worth reading alone", () => {
    const text = send(filed)[0].text;
    expect(text).toContain("Sam Rivera (sam@hilltop.example)");
    expect(text).toContain("Screen: Accounting (/dashboard/m/accounting)");
    expect(text).toContain("From: a browser, 959x910");
    expect(text).toContain("The card looks clickable and does nothing.");
    expect(text).toContain("https://yosherapp.com/admin/feedback/r-1");
  });

  it("says the mobile app when it came from the app", () => {
    const text = send(filed, { ...REPORT, surface: "app" })[0].text;
    expect(text).toContain("From: the mobile app");
  });

  it("gives each recipient their own idempotency key", () => {
    const keys = send(filed).map((e) => e.idempotencyKey);
    expect(keys).toEqual([
      "feedback:filed:m-1:p-1",
      "feedback:filed:m-1:p-2",
    ]);
    // Two owners must both get one; a retry must give neither a second.
    expect(new Set(keys).size).toBe(2);
  });

  it("sends nothing when we have nobody to tell", () => {
    expect(
      feedbackEmails({
        report: REPORT,
        event: filed,
        operatorRecipients: [],
        appUrl: "https://yosherapp.com",
      }),
    ).toEqual([]);
  });
});

describe("our answer, to the client", () => {
  const replied: FeedbackEvent = {
    kind: "operator_replied",
    messageId: "m-2",
    body: "Should it open the trial balance, or the journal?",
    internal: false,
  };

  it("goes to the reporter alone", () => {
    const sent = send(replied);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("sam@hilltop.example");
  });

  it("is keyed on the message, so a retry is not a second email", () => {
    expect(send(replied)[0].idempotencyKey).toBe("feedback:reply:m-2");
  });

  it("greets them by first name, and copes without one", () => {
    expect(send(replied)[0].text.startsWith("Hi Sam,")).toBe(true);
    const anon = send(replied, { ...REPORT, reporterName: "" })[0].text;
    expect(anon.startsWith("Hi,")).toBe(true);
    // Never "Hi ," and never their raw address as a greeting.
    expect(anon).not.toContain("Hi ,");
    expect(anon.split("\n")[0]).not.toContain("@");
  });

  it("tells them the status IN THEIR OWN WORDS", () => {
    // "Waiting on client" is a true thing to write on a console and a rude
    // thing to send to the person who is not the one keeping anybody waiting.
    const text = send(replied)[0].text;
    expect(text).toContain('now marked "Needs your answer"');
    expect(text).not.toContain("Waiting on client");
  });

  it("links them to their own copy, never to the console", () => {
    const text = send(replied)[0].text;
    expect(text).toContain("https://yosherapp.com/dashboard/feedback/r-1");
    expect(text).not.toContain("/admin/");
  });

  it("reads like a person wrote it", () => {
    // The founder's rule for anything that leaves the building: plain short
    // sentences, and no dashes standing in for a pause.
    const text = send(replied)[0].text;
    expect(text).not.toContain("—");
    expect(text).not.toContain(" -- ");
    for (const line of text.split("\n").filter(Boolean)) {
      expect(line.split(/\s+/).length, line).toBeLessThan(22);
    }
  });

  it("sends nothing when we have no address for them", () => {
    expect(send(replied, { ...REPORT, reporterEmail: "" })).toEqual([]);
  });
});

describe("their answer, back to us", () => {
  const replied: FeedbackEvent = {
    kind: "client_replied",
    messageId: "m-3",
    body: "Still happening on my phone.",
  };

  it("goes to us and not back to them", () => {
    const sent = send(replied);
    expect(sent.map((e) => e.to)).toEqual([
      "founder@yosher.example",
      "second@yosher.example",
    ]);
  });

  it("names the business in the subject", () => {
    expect(send(replied)[0].subject).toBe(
      "Hilltop Farm replied: Ledger health card has no link",
    );
  });

  it("quotes them and links to the console", () => {
    const text = send(replied)[0].text;
    expect(text).toContain("Still happening on my phone.");
    expect(text).toContain("https://yosherapp.com/admin/feedback/r-1");
  });
});

describe("quoting", () => {
  it("trims a long message rather than mailing the whole essay", () => {
    const long = "x".repeat(QUOTE_MAX + 500);
    const text = send({ kind: "filed", messageId: "m-1", body: long })[0].text;
    expect(text).toContain("…");
    expect(text.length).toBeLessThan(QUOTE_MAX + 400);
  });

  it("leaves a short message exactly as written", () => {
    const text = send({
      kind: "filed",
      messageId: "m-1",
      body: "  Totals are wrong.  ",
    })[0].text;
    expect(text).toContain("Totals are wrong.");
    expect(text).not.toContain("…");
  });
});

describe("the app url", () => {
  it("does not double a slash when one is configured with a trailing one", () => {
    const sent = feedbackEmails({
      report: REPORT,
      event: { kind: "filed", messageId: "m-1", body: "hi" },
      operatorRecipients: OPERATORS,
      appUrl: "https://yosherapp.com/",
    });
    expect(sent[0].text).toContain("https://yosherapp.com/admin/feedback/r-1");
    expect(sent[0].text).not.toContain("com//admin");
  });
});
