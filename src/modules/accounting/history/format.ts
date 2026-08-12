/**
 * Turning an audit action into a sentence — pure, no `server-only`.
 *
 * DERIVED, NOT ENUMERATED, and that is the whole design. There are already 77
 * distinct accounting actions and the number only goes up; a hand-written map
 * of all of them would be stale within a week, and the failure mode of a stale
 * map is the worst available — a history panel that silently omits the event
 * somebody is looking for, or shows them `bill.returned_to_draft` raw.
 *
 * So: `<domain>.<verb>` is split, the verb is humanised, and a small override
 * table fixes the handful that read badly. A brand-new action nobody has
 * thought about here still renders as a reasonable sentence rather than as a
 * slug or as nothing.
 */

/**
 * The ones derivation gets wrong or reads awkwardly.
 *
 * Kept deliberately short. Adding an entry here is cheap; the moment it starts
 * looking like a complete list of actions, the derivation has stopped earning
 * its place and something is wrong with this file rather than with the map.
 */
const OVERRIDES: Record<string, string> = {
  "invoice.issued": "Issued",
  "invoice.voided": "Voided",
  "invoice.emailed": "Emailed to the customer",
  "invoice.reminder_tested": "Test reminder sent to the owner",
  "invoice.payment_recorded": "Payment recorded",
  "invoice.payment_unapplied": "Payment removed",
  "invoice.draft_created": "Draft created",
  "invoice.draft_updated": "Draft edited",
  "invoice.draft_deleted": "Draft deleted",
  "bill.submitted": "Submitted for approval",
  "bill.approved": "Approved and posted",
  "bill.returned_to_draft": "Sent back to draft",
  "bill.ai_coded": "Coded by the assistant",
  "bill.created_from_document": "Created from a document",
  "bill.voided": "Voided",
  "ledger.entry_posted": "Posted to the ledger",
  "ledger.entry_voided": "Voided",
  "ledger.entry_reversed": "Reversed",
  "ledger.entry_edited": "Edited after posting",
  "ledger.draft_deleted": "Draft deleted",
  "ledger.recurring_created": "Recurring schedule created",
  "documents.attached": "File attached",
  "documents.detached": "File detached",
  "mail.thread_drafted": "Drafted from an email thread",
  "mail.thread_draft_accepted": "Created from an email thread",
};

/** `draft_created` -> `Draft created`. */
function humanizeVerb(verb: string): string {
  const words = verb.split("_").filter(Boolean);
  if (words.length === 0) return "";
  return words.join(" ").replace(/^./, (c) => c.toUpperCase());
}

export function describeAuditAction(action: string): string {
  const override = OVERRIDES[action];
  if (override) return override;

  const dot = action.indexOf(".");
  // No domain prefix at all: humanise the whole thing rather than returning
  // an empty label, because an unreadable row is worse than an odd one.
  const verb = dot === -1 ? action : action.slice(dot + 1);
  const humanized = humanizeVerb(verb);
  return humanized === "" ? action : humanized;
}

/**
 * Who did it, in the order of what a reader can actually use.
 *
 * A resolved name beats the stored label beats "Someone". The system case is
 * real and worth naming: a recurring schedule generating at 3am has no person
 * behind it, and "Someone" would imply there was one.
 */
export function describeActor(
  resolvedName: string | null,
  actorLabel: string | null,
  actorClerkUserId: string | null,
): string {
  if (resolvedName && resolvedName.trim() !== "") return resolvedName;
  if (actorLabel && actorLabel.trim() !== "") return actorLabel;
  return actorClerkUserId ? "A teammate" : "The system";
}

/**
 * The one-line detail under an event, built only from meta a reader can use.
 *
 * DELIBERATELY NOT a jsonb dump. `meta` carries whatever each call site
 * thought worth recording — entry before/after blobs, internal ids, counts —
 * and rendering it wholesale would leak internal shapes into the UI and age
 * badly. Only keys with an agreed meaning are read; everything else is
 * ignored, so adding a key to an audit call can never change this panel by
 * accident.
 */
export function describeAuditMeta(meta: unknown): string {
  if (typeof meta !== "object" || meta === null || Array.isArray(meta)) return "";
  const m = meta as Record<string, unknown>;
  const parts: string[] = [];

  if (typeof m.number === "string" && m.number !== "") parts.push(m.number);
  if (typeof m.name === "string" && m.name !== "") parts.push(m.name);
  if (typeof m.code === "string" && m.code !== "") parts.push(m.code);
  if (typeof m.toDomain === "string" && m.toDomain !== "") {
    parts.push(`to ${m.toDomain}`);
  }
  if (typeof m.lineCount === "number") {
    parts.push(`${m.lineCount} line${m.lineCount === 1 ? "" : "s"}`);
  }
  if (typeof m.duplicate === "boolean" && m.duplicate) {
    parts.push("already sent, not re-sent");
  }
  if (typeof m.offset === "number") {
    parts.push(
      m.offset === 0
        ? "on the due date"
        : m.offset < 0
          ? `${Math.abs(m.offset)} days before due`
          : `${m.offset} days after due`,
    );
  }
  return parts.join(" · ");
}
