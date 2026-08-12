import type {
  DraftableThread,
  DraftedLine,
  DraftedRecord,
} from "@/lib/mail-extensions/types";
import { MAX_AMOUNT_CENTS, isValidIsoDate } from "../lib/money";
import { parseQuantityHundredths } from "../invoicing/lines";

/**
 * Validation of the thread-drafting tool output — pure, the testable seam.
 *
 * Everything the model returns is untrusted, the same posture
 * `bill-validate.ts` takes. What is different, and what this feature rests on,
 * is CITATION VERIFICATION: a line claims a figure came from a particular
 * message, and we check that the words it quotes are actually in that message.
 *
 * An unverified line is KEPT AND FLAGGED, not dropped. Dropping it silently
 * would hide money somebody may be owed, and the reader is looking at the
 * conversation anyway — the dialog shows unverified lines unticked, so the
 * failure mode is "you must look at this one", not "this quietly vanished".
 * Silently discarding is the failure this module already refuses elsewhere.
 *
 * A malformed payload degrades to a record with no lines, never a throw.
 */

/** Longest quote we will bother matching. Longer is a paraphrase, not a quote. */
export const MAX_QUOTE_CHARS = 300;
/** Shorter than this proves nothing — "the" appears in every email. */
export const MIN_QUOTE_CHARS = 8;
export const MAX_LINES = 40;
export const MAX_CAVEATS = 10;

/**
 * Compare quote to source ignoring only how whitespace fell.
 *
 * Mail bodies arrive re-wrapped: a sentence the model copied faithfully can
 * come back with a newline where the source had a space, purely because of
 * how the message was folded. Collapsing runs of whitespace forgives exactly
 * that and nothing else — punctuation, spelling and word order still have to
 * match, so a paraphrase still fails.
 */
export function normalizeForQuoteMatch(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

export function quoteAppearsIn(quote: string, source: string): boolean {
  const q = normalizeForQuoteMatch(quote);
  if (q.length < MIN_QUOTE_CHARS) return false;
  return normalizeForQuoteMatch(source).includes(q);
}

export interface ThreadDraftValidationResult {
  record: DraftedRecord;
  /** Lines the model returned that were rejected outright, for the log. */
  droppedLines: number;
}

export function validateThreadDraft(
  raw: unknown,
  kind: string,
  thread: DraftableThread,
  partyIds: ReadonlySet<string>,
  todayIso: string,
): ThreadDraftValidationResult {
  const empty = (caveat: string): ThreadDraftValidationResult => ({
    record: {
      kind,
      partyId: null,
      partyName: "",
      issueDate: todayIso,
      dueDate: null,
      lines: [],
      caveats: [caveat],
    },
    droppedLines: 0,
  });

  // An array is `typeof "object"` but is not the tool's shape, so it is
  // checked explicitly — otherwise it falls through to a record with no lines
  // and no caveats, which reads on screen exactly like the model correctly
  // finding nothing. Those two must never look the same.
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return empty("The assistant returned nothing usable.");
  }
  const r = raw as {
    partyId?: unknown;
    partyName?: unknown;
    issueDate?: unknown;
    dueDate?: unknown;
    lines?: unknown;
    caveats?: unknown;
  };

  // A party id that is not one we offered is a hallucination, not a match —
  // fall back to the name, which the human confirms anyway.
  const partyId =
    typeof r.partyId === "string" && partyIds.has(r.partyId) ? r.partyId : null;
  const partyName =
    typeof r.partyName === "string" ? r.partyName.trim().slice(0, 200) : "";

  const issueDate =
    typeof r.issueDate === "string" && isValidIsoDate(r.issueDate)
      ? r.issueDate
      : todayIso;
  const dueDate =
    typeof r.dueDate === "string" && isValidIsoDate(r.dueDate) ? r.dueDate : null;

  // Missing entirely is malformed; present-but-empty is the model saying,
  // correctly, that this conversation settled nothing. Only the first is an
  // error, and the reader is told which they are looking at.
  if (!Array.isArray(r.lines)) {
    return empty("The assistant returned nothing usable.");
  }

  const lines: DraftedLine[] = [];
  let dropped = 0;
  {
    for (const item of r.lines.slice(0, MAX_LINES)) {
      if (typeof item !== "object" || item === null) {
        dropped += 1;
        continue;
      }
      const l = item as {
        description?: unknown;
        quantity?: unknown;
        unitPriceCents?: unknown;
        citationMessageIndex?: unknown;
        citationQuote?: unknown;
      };

      const description =
        typeof l.description === "string" ? l.description.trim().slice(0, 500) : "";
      if (description === "") {
        dropped += 1;
        continue;
      }

      // Quantity goes through the module's own parser, so a line the model
      // proposes cannot be one the invoice builder would reject.
      const quantity =
        typeof l.quantity === "string" && parseQuantityHundredths(l.quantity) !== null
          ? l.quantity.trim()
          : "1";

      const price = l.unitPriceCents;
      if (
        typeof price !== "number" ||
        !Number.isInteger(price) ||
        Math.abs(price) > MAX_AMOUNT_CENTS
      ) {
        dropped += 1;
        continue;
      }

      // ---- the citation
      let citation: DraftedLine["citation"] = null;
      const idx = l.citationMessageIndex;
      const quote =
        typeof l.citationQuote === "string"
          ? l.citationQuote.trim().slice(0, MAX_QUOTE_CHARS)
          : "";
      if (
        typeof idx === "number" &&
        Number.isInteger(idx) &&
        idx >= 0 &&
        idx < thread.messages.length &&
        quote !== ""
      ) {
        citation = {
          messageIndex: idx,
          quote,
          // The check the whole feature rests on.
          verified: quoteAppearsIn(quote, thread.messages[idx].text),
        };
      }

      lines.push({ description, quantity, unitPriceCents: price, citation });
    }
  }

  const caveats: string[] = [];
  if (Array.isArray(r.caveats)) {
    for (const c of r.caveats.slice(0, MAX_CAVEATS)) {
      if (typeof c === "string" && c.trim() !== "") {
        caveats.push(c.trim().slice(0, 500));
      }
    }
  }
  // The reader is told about weakened output rather than left to notice it.
  const unverified = lines.filter((l) => !l.citation?.verified).length;
  if (unverified > 0) {
    caveats.unshift(
      unverified === 1
        ? "1 line could not be matched to the conversation and is unticked below — check it against the email before including it."
        : `${unverified} lines could not be matched to the conversation and are unticked below — check them against the email before including them.`,
    );
  }
  if (dropped > 0) {
    caveats.push(
      `${dropped} proposed ${dropped === 1 ? "line was" : "lines were"} discarded as malformed.`,
    );
  }

  return {
    record: { kind, partyId, partyName, issueDate, dueDate, lines, caveats },
    droppedLines: dropped,
  };
}
