import { z } from "zod";
import type { JmapEmailFilter } from "@/lib/email/jmap/types";
import { KEYWORD_FLAGGED, KEYWORD_SEEN } from "@/lib/email/jmap/types";

/**
 * What the person is looking at: a folder, a search term, and up to three
 * filters.
 *
 * Pure and free of `server-only`, because this one shape is used three ways and
 * they must not be allowed to drift:
 *
 *   1. the URL the list view reads,
 *   2. the JMAP filter sent to the mail server,
 *   3. the blob a saved search stores.
 *
 * A saved search is therefore not a second query language. It is these
 * parameters, written down — the same decision Documents made when its saved
 * views shipped ("the stored jsonb never becomes a WHERE clause on its own
 * terms — it becomes a URL"), and it lands even harder here: mail search runs on
 * the MAIL SERVER, so a stored blob could not reach SQL even if somebody tried.
 */

/** The whole vocabulary. Anything not here cannot be expressed or stored. */
export const mailViewSchema = z.object({
  /** A JMAP mailbox id — opaque, server-issued, meaningless in another account. */
  mailbox: z.string().min(1).max(255).optional().catch(undefined),
  q: z.string().min(1).max(200).optional().catch(undefined),
  unread: z.boolean().optional().catch(undefined),
  flagged: z.boolean().optional().catch(undefined),
  attach: z.boolean().optional().catch(undefined),
});

export type MailViewQuery = z.infer<typeof mailViewSchema>;

/** `?unread=1` and friends. Only "1" is on — an absent param is not a filter. */
function flag(raw: string | undefined): boolean | undefined {
  return raw === "1" ? true : undefined;
}

/** Read the current view out of the URL. */
export function readMailView(
  params: Record<string, string | undefined>,
): MailViewQuery {
  return {
    ...(params.mailbox ? { mailbox: params.mailbox } : {}),
    ...(params.q?.trim() ? { q: params.q.trim().slice(0, 200) } : {}),
    ...(flag(params.unread) ? { unread: true } : {}),
    ...(flag(params.flagged) ? { flagged: true } : {}),
    ...(flag(params.attach) ? { attach: true } : {}),
  };
}

/**
 * Re-parse a stored blob, every time, including rows this code wrote.
 *
 * A value that was valid when stored is still untrusted by the time it comes
 * back, and a database somebody has edited by hand is exactly the case worth
 * surviving. `.catch()` on every field means an unreadable one degrades to
 * absent rather than throwing during a page render; Zod's default `strip` drops
 * unknown keys, so a hand-edited row cannot smuggle a field into the filter.
 */
export function parseMailView(raw: unknown): MailViewQuery {
  const parsed = mailViewSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : {};
}

/** True when a view selects everything — not worth saving as a search. */
export function isEmptyView(query: MailViewQuery): boolean {
  return !query.q && !query.unread && !query.flagged && !query.attach;
}

/**
 * The view as a JMAP filter.
 *
 * `inMailbox` is dropped when there is a text term, and that is deliberate
 * rather than an oversight: hunting for something you know exists and being told
 * "no results" because you were standing in the wrong folder is the worst
 * failure a mail search has. A search spans the account; a filter narrows the
 * folder you are already in.
 */
export function toJmapFilter(
  query: MailViewQuery,
  fallbackMailboxId: string | null,
): JmapEmailFilter {
  const filter: JmapEmailFilter = {};

  if (query.q) {
    filter.text = query.q;
  } else if (query.mailbox ?? fallbackMailboxId) {
    filter.inMailbox = (query.mailbox ?? fallbackMailboxId) as string;
  }

  // Unread is the ABSENCE of $seen. JMAP has no "isUnread", and asking for
  // hasKeyword:"$unseen" — which does not exist — would silently match nothing.
  if (query.unread) filter.notKeyword = KEYWORD_SEEN;
  if (query.flagged) filter.hasKeyword = KEYWORD_FLAGGED;
  if (query.attach) filter.hasAttachment = true;

  return filter;
}

export interface FilterChip {
  key: "unread" | "flagged" | "attach";
  label: string;
  active: boolean;
}

/** The three chips, in a fixed order so the bar does not reshuffle. */
export function filterChips(query: MailViewQuery): FilterChip[] {
  return [
    { key: "unread", label: "Unread", active: Boolean(query.unread) },
    { key: "flagged", label: "Flagged", active: Boolean(query.flagged) },
    { key: "attach", label: "Has files", active: Boolean(query.attach) },
  ];
}

/**
 * A human name for a view, used when saving one so nobody has to invent a name
 * for "unread, flagged, in Inbox".
 */
export function describeView(
  query: MailViewQuery,
  folderName: string | null,
): string {
  const parts: string[] = [];
  if (query.q) parts.push(`“${query.q}”`);
  if (query.unread) parts.push("unread");
  if (query.flagged) parts.push("flagged");
  if (query.attach) parts.push("with files");
  // The folder only earns a mention when there is no text term, because a text
  // search ignores the folder — saying otherwise would describe a view that is
  // not the one being run.
  if (!query.q && folderName) parts.push(`in ${folderName}`);
  return parts.length > 0 ? parts.join(", ") : "All mail";
}
