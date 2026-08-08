import { describe, expect, it } from "vitest";
import {
  resolveProposal,
  validateExtraction,
  type Extraction,
} from "../src/modules/crm/ai/note-shape";

/**
 * The note extractor's judgement layer. Pure — the model is never called, so
 * this runs without an API key and costs nothing.
 *
 * Every case below is a way the extractor could put work on the wrong person's
 * morning digest, or chase somebody on a day they never agreed to.
 */

function extraction(over: Partial<Extraction> = {}): Extraction {
  return { activities: [], tasks: [], ...over };
}

const TEAM = [
  { clerkUserId: "user_dave", label: "Dave Okafor" },
  { clerkUserId: "user_sam", label: "Sam Rivera" },
];

describe("validateExtraction", () => {
  it("accepts a well-formed extraction", () => {
    const result = validateExtraction({
      activities: [{ kind: "call", summary: "Discussed the quote" }],
      tasks: [{ title: "Send revised figures", dueInDays: 2, assigneeHint: null }],
    });
    expect(result).not.toBeNull();
    expect(result!.tasks[0].dueInDays).toBe(2);
  });

  it("accepts empty arrays — 'the note commits to nothing' is a real answer", () => {
    const result = validateExtraction({ activities: [], tasks: [] });
    expect(result).toEqual({ activities: [], tasks: [] });
  });

  it("REFUSES a malformed payload rather than salvaging half of it", () => {
    // A partly-parsed proposal shown as if it were the answer is worse than
    // saying it failed — the reviewer cannot tell which half is missing.
    expect(validateExtraction({ activities: "nope", tasks: [] })).toBeNull();
    expect(validateExtraction({})).toBeNull();
    expect(validateExtraction(null)).toBeNull();
  });

  it("rejects an unknown activity kind", () => {
    expect(
      validateExtraction({
        activities: [{ kind: "telepathy", summary: "x" }],
        tasks: [],
      }),
    ).toBeNull();
  });

  it("rejects a negative or absurd day offset", () => {
    expect(
      validateExtraction({
        activities: [],
        tasks: [{ title: "x", dueInDays: -3, assigneeHint: null }],
      }),
    ).toBeNull();
    expect(
      validateExtraction({
        activities: [],
        tasks: [{ title: "x", dueInDays: 10_000, assigneeHint: null }],
      }),
    ).toBeNull();
  });

  it("caps how much one note can produce", () => {
    const many = Array.from({ length: 11 }, () => ({
      title: "x",
      dueInDays: null,
      assigneeHint: null,
    }));
    expect(validateExtraction({ activities: [], tasks: many })).toBeNull();
  });
});

describe("resolveProposal — dates", () => {
  it("resolves day offsets against the TENANT's today", () => {
    // Not the server's. The whole point of 0086 — 'follow up in 2 days' has to
    // mean the business's calendar or the digest chases on the wrong morning.
    const r = resolveProposal(
      extraction({
        tasks: [{ title: "Call back", dueInDays: 2, assigneeHint: null }],
      }),
      "2026-08-07",
      TEAM,
    );
    expect(r.tasks[0].dueOn).toBe("2026-08-09");
  });

  it("0 means today", () => {
    const r = resolveProposal(
      extraction({ tasks: [{ title: "x", dueInDays: 0, assigneeHint: null }] }),
      "2026-08-07",
      TEAM,
    );
    expect(r.tasks[0].dueOn).toBe("2026-08-07");
  });

  it("keeps a null date null — an undated follow-up beats an invented one", () => {
    const r = resolveProposal(
      extraction({
        tasks: [{ title: "x", dueInDays: null, assigneeHint: null }],
      }),
      "2026-08-07",
      TEAM,
    );
    expect(r.tasks[0].dueOn).toBeNull();
  });

  it("crosses a month boundary correctly", () => {
    const r = resolveProposal(
      extraction({ tasks: [{ title: "x", dueInDays: 5, assigneeHint: null }] }),
      "2026-08-30",
      TEAM,
    );
    expect(r.tasks[0].dueOn).toBe("2026-09-04");
  });
});

describe("resolveProposal — assignees", () => {
  it("matches a full name", () => {
    const r = resolveProposal(
      extraction({
        tasks: [{ title: "x", dueInDays: null, assigneeHint: "Sam Rivera" }],
      }),
      "2026-08-07",
      TEAM,
    );
    expect(r.tasks[0].assigneeClerkUserId).toBe("user_sam");
    expect(r.tasks[0].assigneeHint).toBeNull();
  });

  it("matches case-insensitively", () => {
    const r = resolveProposal(
      extraction({
        tasks: [{ title: "x", dueInDays: null, assigneeHint: "sam rivera" }],
      }),
      "2026-08-07",
      TEAM,
    );
    expect(r.tasks[0].assigneeClerkUserId).toBe("user_sam");
  });

  it("matches a first name, because that is how notes are written", () => {
    const r = resolveProposal(
      extraction({
        tasks: [{ title: "x", dueInDays: null, assigneeHint: "Dave" }],
      }),
      "2026-08-07",
      TEAM,
    );
    expect(r.tasks[0].assigneeClerkUserId).toBe("user_dave");
  });

  it("REFUSES an ambiguous first name rather than picking one", () => {
    // Two Daves means we do not know which. Guessing puts the work on the
    // wrong person's digest and looks authoritative doing it.
    const twoDaves = [
      { clerkUserId: "user_dave1", label: "Dave Okafor" },
      { clerkUserId: "user_dave2", label: "Dave Lindqvist" },
    ];
    const r = resolveProposal(
      extraction({
        tasks: [{ title: "x", dueInDays: null, assigneeHint: "Dave" }],
      }),
      "2026-08-07",
      twoDaves,
    );
    expect(r.tasks[0].assigneeClerkUserId).toBeNull();
    // And it keeps the hint, so the reviewer sees WHY it is unassigned.
    expect(r.tasks[0].assigneeHint).toBe("Dave");
  });

  it("keeps an unmatched hint visible rather than silently unassigning", () => {
    const r = resolveProposal(
      extraction({
        tasks: [{ title: "x", dueInDays: null, assigneeHint: "Priya" }],
      }),
      "2026-08-07",
      TEAM,
    );
    expect(r.tasks[0].assigneeClerkUserId).toBeNull();
    expect(r.tasks[0].assigneeHint).toBe("Priya");
  });

  it("no hint means unassigned, with nothing to explain", () => {
    const r = resolveProposal(
      extraction({
        tasks: [{ title: "x", dueInDays: null, assigneeHint: null }],
      }),
      "2026-08-07",
      TEAM,
    );
    expect(r.tasks[0].assigneeClerkUserId).toBeNull();
    expect(r.tasks[0].assigneeHint).toBeNull();
  });

  it("an empty roster never throws and never matches", () => {
    const r = resolveProposal(
      extraction({
        tasks: [{ title: "x", dueInDays: null, assigneeHint: "Dave" }],
      }),
      "2026-08-07",
      [],
    );
    expect(r.tasks[0].assigneeClerkUserId).toBeNull();
    expect(r.tasks[0].assigneeHint).toBe("Dave");
  });

  it("passes activities through untouched", () => {
    const r = resolveProposal(
      extraction({
        activities: [{ kind: "meeting", summary: "Site visit at the depot" }],
      }),
      "2026-08-07",
      TEAM,
    );
    expect(r.activities).toEqual([
      { kind: "meeting", summary: "Site visit at the depot" },
    ]);
  });
});
