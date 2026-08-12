import "dotenv/config";
import { describe, expect, it } from "vitest";
import type { DraftableThread } from "../src/lib/mail-extensions/types";
import { callThreadDraftModel } from "../src/modules/accounting/ai/thread-draft";
import {
  buildThreadDraftUserTurn,
  threadDraftSystemPrompt,
  threadDraftTool,
} from "../src/modules/accounting/ai/thread-draft-prompt";
import { validateThreadDraft } from "../src/modules/accounting/ai/thread-draft-validate";

/**
 * MANUAL live verification of the thread drafter against the real Claude API
 * (a few small calls). Skipped unless requested:
 *
 *   RUN_LIVE_THREAD_DRAFT=1 npx vitest run tests/live-thread-draft.test.ts
 *
 * WHY THIS EXISTS WHEN THE FIXTURE TESTS PASS. `thread-draft.test.ts` proves
 * the validator REJECTS bad output — hallucinated quotes, unknown party ids,
 * malformed payloads. It cannot prove that good output ever arrives, because
 * its fixtures were written by the same hand as the validator. The question
 * only a live run answers is whether a real conversation produces lines whose
 * citations actually verify. If the prompt were weak the symptom would be
 * every line arriving unticked, and no fixture test in the repo would notice.
 *
 * THE NEGATIVE CASE MATTERS MORE THAN THE POSITIVE ONE. Missing a line costs
 * somebody a minute of typing; inventing an invoice nobody agreed to is the
 * failure that would make this feature untrustworthy, so it gets its own test
 * and its own conversation.
 */

const RUN =
  process.env.RUN_LIVE_THREAD_DRAFT === "1" && !!process.env.ANTHROPIC_API_KEY;
const d = RUN ? describe : describe.skip;

const CUSTOMER_ID = "8f1c0a2e-2b7a-4c1d-9a3e-6d5b4c3a2f10";

const PARTIES = [
  { id: CUSTOMER_ID, name: "Acme Joinery Ltd", emails: ["ops@acmejoinery.test"] },
];

/** An agreement, with the price stated once and confirmed once. */
const AGREED: DraftableThread = {
  subject: "Workshop extension - second fix",
  messages: [
    {
      from: "ops@acmejoinery.test",
      date: "2026-07-02",
      text: "Morning. Can you price up the second fix on the workshop extension? Skirting, architrave and hanging the four internal doors.",
    },
    {
      from: "dan@upward.test",
      date: "2026-07-03",
      text: "Had a look this morning. Second fix carpentry comes to $3,450.00 for labour, plus $780.00 for materials. That's four days on site, could start the 20th.",
    },
    {
      from: "ops@acmejoinery.test",
      date: "2026-07-04",
      text: "That all looks fine, please go ahead and book the 20th. Invoice us on completion, our usual 30 days.",
    },
  ],
};

/** A conversation about the same job where NO price is ever settled. */
const UNSETTLED: DraftableThread = {
  subject: "Workshop extension - second fix",
  messages: [
    {
      from: "ops@acmejoinery.test",
      date: "2026-07-02",
      text: "Can you give us a rough idea what second fix might run to? No rush.",
    },
    {
      from: "dan@upward.test",
      date: "2026-07-03",
      text: "Hard to say without measuring up. Similar jobs have landed somewhere between three and five thousand depending on the doors. I'll get you a proper number once I've been round.",
    },
    {
      from: "ops@acmejoinery.test",
      date: "2026-07-04",
      text: "Understood, let us know when you've had a look.",
    },
  ],
};

async function draft(thread: DraftableThread) {
  const tool = threadDraftTool("invoice");
  const raw = await callThreadDraftModel({
    system: threadDraftSystemPrompt("invoice"),
    user: buildThreadDraftUserTurn(thread, PARTIES, "2026-07-06"),
    tool,
  });
  return validateThreadDraft(
    raw,
    "invoice",
    thread,
    new Set(PARTIES.map((p) => p.id)),
    "2026-07-06",
  );
}

d("live thread drafting (real Claude API)", () => {
  it("drafts an agreed job with citations that VERIFY against the thread", async () => {
    const { record } = await draft(AGREED);
    console.log(JSON.stringify(record, null, 2));

    expect(record.lines.length).toBeGreaterThan(0);

    // THE PROPERTY THE WHOLE FEATURE RESTS ON. `verified` is set by the
    // validator, which re-finds each quote in the message it claims to come
    // from — so this is real output being checked against the real source,
    // not the model marking its own work.
    for (const line of record.lines) {
      expect(line.citation).not.toBeNull();
      expect(line.citation!.verified).toBe(true);
      expect(line.citation!.messageIndex).toBeGreaterThanOrEqual(0);
    }

    // The figures that were actually agreed, in cents.
    const total = record.lines.reduce((s, l) => s + l.unitPriceCents, 0);
    expect(total).toBe(345_000 + 78_000);

    // Matched to the party it was offered, not invented.
    expect(record.partyId).toBe(CUSTOMER_ID);

    // Nothing arrives unticked, so nothing needs a second look.
    expect(record.caveats.filter((c) => /could not be matched/i.test(c))).toEqual([]);
  }, 180_000);

  it("REFUSES to invent an invoice from a conversation that settled nothing", async () => {
    const { record } = await draft(UNSETTLED);
    console.log(JSON.stringify(record, null, 2));

    // A range discussed is not a price agreed. Proposing $4,000 here would be
    // the failure that makes the feature untrustworthy, and it is worse than
    // proposing nothing.
    expect(record.lines).toEqual([]);
    // ...and it says why, rather than rendering an empty panel that looks
    // like a bug.
    expect(record.caveats.length).toBeGreaterThan(0);
    console.log("caveats:", record.caveats);
  }, 180_000);

  it("never returns a line whose quote it made up", async () => {
    // Belt and braces across both conversations: whatever the model returns,
    // an unverifiable citation must be FLAGGED rather than silently trusted.
    for (const thread of [AGREED, UNSETTLED]) {
      const { record } = await draft(thread);
      for (const line of record.lines) {
        if (line.citation && !line.citation.verified) {
          throw new Error(
            `unverified citation survived as trusted: ${JSON.stringify(line)}`,
          );
        }
      }
    }
  }, 300_000);
});
