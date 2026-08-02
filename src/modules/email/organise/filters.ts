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

/**
 * The whole vocabulary. Anything not here cannot be expressed or stored.
 *
 * EVERY FIELD WAS VERIFIED AGAINST THE LIVE SERVER before being offered —
 * `npm run mail:probe-search` runs each JMAP condition against a message built
 * to match and a decoy built not to. That double check exists because the
 * dangerous outcome is not a rejected condition, it is an ACCEPTED AND IGNORED
 * one: a `from` filter that is silently dropped turns "find mail from Dan" into
 * "here is everything", which reads as a bad search rather than a bug, and
 * nobody reports it.
 *
 * `header` is deliberately absent — it is the one condition the probe could not
 * make work, so it is not offered rather than offered and unreliable.
 */
export const mailViewSchema = z.object({
  /** A JMAP mailbox id — opaque, server-issued, meaningless in another account. */
  mailbox: z.string().min(1).max(255).optional().catch(undefined),
  q: z.string().min(1).max(200).optional().catch(undefined),
  unread: z.boolean().optional().catch(undefined),
  flagged: z.boolean().optional().catch(undefined),
  attach: z.boolean().optional().catch(undefined),
  /* -- the builder's fields ---------------------------------------------- */
  from: z.string().min(1).max(200).optional().catch(undefined),
  to: z.string().min(1).max(200).optional().catch(undefined),
  subject: z.string().min(1).max(200).optional().catch(undefined),
  body: z.string().min(1).max(200).optional().catch(undefined),
  /** `YYYY-MM-DD`, from a date input. Converted to an instant in the filter. */
  after: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined),
  before: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined),
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
    ...text(params.from, "from"),
    ...text(params.to, "to"),
    ...text(params.subject, "subject"),
    ...text(params.body, "body"),
    ...date(params.after, "after"),
    ...date(params.before, "before"),
  };
}

/** One of the builder's text fields, trimmed and capped like `q`. */
function text(raw: string | undefined, key: string): Record<string, string> {
  const value = raw?.trim().slice(0, 200);
  return value ? { [key]: value } : {};
}

/** A date field, kept only when it is really `YYYY-MM-DD`. */
function date(raw: string | undefined, key: string): Record<string, string> {
  return raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? { [key]: raw } : {};
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
  return (
    !query.q &&
    !query.unread &&
    !query.flagged &&
    !query.attach &&
    !query.from &&
    !query.to &&
    !query.subject &&
    !query.body &&
    !query.after &&
    !query.before
  );
}

/** True when the builder — rather than the quick search box — is in use. */
export function usesBuilder(query: MailViewQuery): boolean {
  return Boolean(
    query.from || query.to || query.subject || query.body || query.after || query.before,
  );
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

  /**
   * ONE CONDITION OBJECT, NOT AN `AND` OPERATOR.
   *
   * RFC 8621 §4.4.1 already ANDs the properties within a single
   * FilterCondition, so every field the builder offers composes without an
   * operator at all. `npm run mail:probe-search` verified AND, OR and NOT
   * against the live server — they work, and they are still not needed here,
   * which is the better outcome. The builder only ever means "all of these".
   *
   * OR would be needed for an "any of these" mode, and NOT for exclusions.
   * Neither is offered, so neither is generated.
   */

  /**
   * THE FOLDER RULE, and the builder changes it in one direction only.
   *
   * A quick search spans the account: hunting for something you know exists and
   * being told "no results" because you were standing in the wrong folder is the
   * worst failure a mail search has. But when somebody has opened the BUILDER
   * and chosen a folder, they have said where to look, and ignoring that would
   * be its own kind of wrong. So an explicit folder from the builder is
   * honoured; the fallback folder is dropped once any search term exists.
   */
  const searching = Boolean(query.q) || usesBuilder(query);
  if (query.mailbox && usesBuilder(query)) {
    filter.inMailbox = query.mailbox;
  } else if (!searching && (query.mailbox ?? fallbackMailboxId)) {
    filter.inMailbox = (query.mailbox ?? fallbackMailboxId) as string;
  }

  if (query.q) filter.text = query.q;
  if (query.from) filter.from = query.from;
  if (query.to) filter.to = query.to;
  if (query.subject) filter.subject = query.subject;
  if (query.body) filter.body = query.body;

  // A date input gives a local calendar day; JMAP wants an instant. `before` is
  // the start of the NEXT day, so "before 3 August" includes everything sent on
  // the 3rd — which is what the words mean to a person, and not what a naive
  // conversion produces.
  if (query.after) filter.after = new Date(`${query.after}T00:00:00Z`);
  if (query.before) filter.before = new Date(`${nextDay(query.before)}T00:00:00Z`);

  // Unread is the ABSENCE of $seen. JMAP has no "isUnread", and asking for
  // hasKeyword:"$unseen" — which does not exist — would silently match nothing.
  if (query.unread) filter.notKeyword = KEYWORD_SEEN;
  if (query.flagged) filter.hasKeyword = KEYWORD_FLAGGED;
  if (query.attach) filter.hasAttachment = true;

  return filter;
}

/** The calendar day after `YYYY-MM-DD`, in the same form. */
export function nextDay(day: string): string {
  const at = new Date(`${day}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + 1);
  return at.toISOString().slice(0, 10);
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
  if (query.from) parts.push(`from ${query.from}`);
  if (query.to) parts.push(`to ${query.to}`);
  if (query.subject) parts.push(`subject ${query.subject}`);
  if (query.body) parts.push(`body ${query.body}`);
  if (query.after && query.before) parts.push(`${query.after} to ${query.before}`);
  else if (query.after) parts.push(`after ${query.after}`);
  else if (query.before) parts.push(`before ${query.before}`);
  if (query.unread) parts.push("unread");
  if (query.flagged) parts.push("flagged");
  if (query.attach) parts.push("with files");
  /**
   * The folder earns a mention only when it is actually applied.
   *
   * A quick search ignores the folder, so naming it would describe a view that
   * is not the one being run — the same trap the original version avoided. The
   * BUILDER honours an explicit folder, so there it is part of the description.
   */
  if (folderName && (!query.q || usesBuilder(query))) parts.push(`in ${folderName}`);
  return parts.length > 0 ? parts.join(", ") : "All mail";
}
