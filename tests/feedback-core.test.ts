import { describe, expect, it } from "vitest";
import {
  featureFromRoute,
  formatWhen,
  fullRoute,
  hasUnreadReply,
  isClosedStatus,
  isSameOriginPath,
  kindLabel,
  needsOperator,
  queueRank,
  screenLabel,
  statusLabel,
  statusTone,
  KIND_CHOICES,
} from "../src/lib/feedback/core";
import {
  FEEDBACK_KINDS,
  FEEDBACK_STATUSES,
} from "../src/lib/feedback/vocabulary";

/**
 * The pure half of feedback (ADR 0053). No database: everything here renders
 * in a browser on two surfaces, and the reason it is one file is that the
 * client's page and the console show the SAME report to two audiences.
 */

describe("where a report came from", () => {
  it("names the module a dashboard route belongs to", () => {
    expect(featureFromRoute("/dashboard/m/livestock")).toBe("livestock");
    expect(featureFromRoute("/dashboard/m/accounting/purchases/bills")).toBe(
      "accounting",
    );
  });

  it("says nothing for the shell's own screens", () => {
    // "" is the right answer, not a guess. The pathname is stored beside it
    // and is what the console actually reads.
    expect(featureFromRoute("/dashboard")).toBe("");
    expect(featureFromRoute("/dashboard/today")).toBe("");
    expect(featureFromRoute("/dashboard/settings/payments")).toBe("");
    expect(featureFromRoute("")).toBe("");
  });

  it("is not fooled by a route that merely starts the same way", () => {
    expect(featureFromRoute("/dashboard/matters")).toBe("");
    expect(featureFromRoute("/dashboard/m/")).toBe("");
  });

  it("labels the shell's screens the way the rail does", () => {
    expect(screenLabel("/dashboard")).toBe("Overview");
    expect(screenLabel("/dashboard/today")).toBe("What needs you");
    expect(screenLabel("/dashboard/settings/enterprises")).toBe("Settings");
    // Prettied, not raw: the sheet says this word back to the CLIENT, and
    // "You are on land" is our spelling of the module rather than theirs.
    expect(screenLabel("/dashboard/m/land/paddocks")).toBe("Land");
    expect(screenLabel("/dashboard/m/professional-services")).toBe(
      "Professional services",
    );
    // A trailing slash is the same screen.
    expect(screenLabel("/dashboard/team/")).toBe("Team");
  });

  it("refuses to call anything but a same-origin path a link", () => {
    expect(isSameOriginPath("/dashboard/m/work")).toBe(true);
    expect(isSameOriginPath("/dashboard/m/work?item=1")).toBe(true);
    // The one that matters: protocol-relative navigates OFF SITE, and this
    // string came out of a browser form.
    expect(isSameOriginPath("//evil.example.com")).toBe(false);
    expect(isSameOriginPath("https://evil.example.com")).toBe(false);
    expect(isSameOriginPath("javascript:alert(1)")).toBe(false);
    expect(isSameOriginPath("/\\evil.example.com")).toBe(false);
    expect(isSameOriginPath("dashboard/m/work")).toBe(false);
    expect(isSameOriginPath("")).toBe(false);
  });

  it("recombines a route and its query", () => {
    expect(fullRoute("/dashboard/m/work", "?item=7")).toBe(
      "/dashboard/m/work?item=7",
    );
    expect(fullRoute("/dashboard/m/work", "item=7")).toBe(
      "/dashboard/m/work?item=7",
    );
    expect(fullRoute("/dashboard/m/work", "")).toBe("/dashboard/m/work");
  });
});

describe("the words, per audience", () => {
  it("has a label for every kind and status on both sides", () => {
    for (const kind of FEEDBACK_KINDS) {
      expect(kindLabel(kind, "client")).not.toBe(kind);
      expect(kindLabel(kind, "operator")).not.toBe(kind);
    }
    for (const status of FEEDBACK_STATUSES) {
      expect(statusLabel(status, "client")).not.toBe(status);
      expect(statusLabel(status, "operator")).not.toBe(status);
    }
  });

  it("offers exactly the kinds the column allows", () => {
    expect(KIND_CHOICES.map((c) => c.value)).toEqual([...FEEDBACK_KINDS]);
  });

  it("never says 'waiting on client' TO the client", () => {
    // The one place the two vocabularies must differ: the client is not the
    // one who has gone quiet, and telling them they are is rude and wrong.
    expect(statusLabel("needs_info", "operator")).toBe("Waiting on client");
    expect(statusLabel("needs_info", "client")).toBe("Needs your answer");
  });

  it("passes an unknown value straight through rather than crashing", () => {
    // A status written by a future migration this build has not seen.
    expect(statusLabel("teleported", "client")).toBe("teleported");
    expect(kindLabel("teleported", "operator")).toBe("teleported");
    expect(statusTone("teleported")).toBe("neutral");
  });

  it("gives every status a tone", () => {
    for (const status of FEEDBACK_STATUSES) {
      expect(statusTone(status)).toBeTruthy();
    }
  });

  it("closes on done and declined, and nothing else", () => {
    expect(FEEDBACK_STATUSES.filter(isClosedStatus)).toEqual([
      "done",
      "declined",
    ]);
  });
});

describe("whose move is it", () => {
  const t = (iso: string) => new Date(iso);

  it("is ours the moment it arrives", () => {
    expect(
      needsOperator({
        status: "new",
        operatorReadAt: null,
        lastClientMessageAt: t("2026-09-13T10:00:00Z"),
      }),
    ).toBe(true);
  });

  it("is not ours once we have looked and they have said nothing since", () => {
    expect(
      needsOperator({
        status: "planned",
        operatorReadAt: t("2026-09-13T11:00:00Z"),
        lastClientMessageAt: t("2026-09-13T10:00:00Z"),
      }),
    ).toBe(false);
  });

  it("is ours again the moment they answer", () => {
    expect(
      needsOperator({
        status: "needs_info",
        operatorReadAt: t("2026-09-13T11:00:00Z"),
        lastClientMessageAt: t("2026-09-13T12:00:00Z"),
      }),
    ).toBe(true);
  });

  it("is ours when they reply to something we had CLOSED", () => {
    // "It is still happening" on a `done` report. The status says finished and
    // the conversation says otherwise; the conversation wins, and a human
    // decides what to do about the status.
    expect(
      needsOperator({
        status: "done",
        operatorReadAt: t("2026-09-13T11:00:00Z"),
        lastClientMessageAt: t("2026-09-14T09:00:00Z"),
      }),
    ).toBe(true);
    expect(
      queueRank({
        status: "done",
        operatorReadAt: t("2026-09-13T11:00:00Z"),
        lastClientMessageAt: t("2026-09-14T09:00:00Z"),
      }),
    ).toBe(0);
  });

  it("is not ours when a closed report has had no answer at all", () => {
    expect(
      needsOperator({
        status: "done",
        operatorReadAt: t("2026-09-13T11:00:00Z"),
        lastClientMessageAt: null,
      }),
    ).toBe(false);
  });

  it("lights the client's dot only for something they have not read", () => {
    expect(
      hasUnreadReply({
        clientReadAt: null,
        lastOperatorMessageAt: t("2026-09-13T10:00:00Z"),
      }),
    ).toBe(true);
    expect(
      hasUnreadReply({
        clientReadAt: t("2026-09-13T11:00:00Z"),
        lastOperatorMessageAt: t("2026-09-13T10:00:00Z"),
      }),
    ).toBe(false);
    // Their own report, before we have said anything: never a dot.
    expect(
      hasUnreadReply({ clientReadAt: null, lastOperatorMessageAt: null }),
    ).toBe(false);
  });
});

describe("when", () => {
  it("stamps a message in the business's own clock", () => {
    const at = new Date("2026-09-13T23:30:00Z");
    // Same instant, two businesses: the one in New York is still on the 13th.
    expect(formatWhen(at, "America/New_York")).toContain("13 Sep");
    expect(formatWhen(at, "Australia/Sydney")).toContain("14 Sep");
  });

  it("renders something rather than throwing on a zone it does not know", () => {
    // A bad zone is a data problem elsewhere; a thread that will not render is
    // a worse symptom than a timestamp in UTC.
    expect(formatWhen(new Date("2026-09-13T23:30:00Z"), "Mars/Olympus")).toBe(
      "2026-09-13 23:30",
    );
  });
});
