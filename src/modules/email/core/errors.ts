/**
 * The Mail module's own failure type.
 *
 * Deliberately NOT a re-export of DocsError or LedgerError: mail must work for
 * a tenant that has never enabled Documents or Accounting, so nothing under
 * src/modules/email/ may import from another module. Codes and copy that
 * overlap (FORBIDDEN, FORBIDDEN_EXPERT) are kept word-for-word identical so the
 * modules read as one product.
 *
 * The house rule from the JMAP layer carries up to here: nothing throws at a
 * user. Protocol failures already arrive as `JmapResult.message` — a sentence
 * the mail server's error type was translated into — so this type is for the
 * things *we* refuse or cannot find, not for re-wrapping the network.
 */
export type MailErrorCode =
  | "FORBIDDEN"
  | "FORBIDDEN_EXPERT"
  | "NOT_CONFIGURED"
  | "NO_MAILBOX"
  | "ACCOUNT_NOT_FOUND"
  | "ACCOUNT_NEEDS_REAUTH"
  | "MAILBOX_NOT_FOUND"
  | "THREAD_NOT_FOUND"
  | "MESSAGE_NOT_FOUND"
  | "ATTACHMENT_NOT_FOUND"
  | "ATTACHMENT_TOO_LARGE"
  | "MESSAGE_TOO_LARGE"
  | "SEARCH_QUERY_INVALID"
  | "MAIL_SERVER_UNREACHABLE"
  | "LINK_TYPE_UNKNOWN"
  | "LINK_TARGET_NOT_FOUND"
  | "FILING_UNAVAILABLE"
  | "LINK_NOT_FOUND"
  | "SEND_UNSUPPORTED"
  | "SEND_BLOCKED"
  | "SEND_FAILED"
  | "NO_DRAFTS_FOLDER"
  | "RECIPIENT_INVALID"
  | "ATTACHMENT_REJECTED"
  | "SEARCH_NAME_INVALID"
  | "SEARCH_NAME_TAKEN"
  | "SEARCH_QUERY_EMPTY"
  | "SEARCH_LIMIT"
  | "SEARCH_NOT_FOUND"
  | "FOLDER_NAME_INVALID"
  | "FOLDER_PROTECTED"
  | "NOTHING_SELECTED";

export class MailError extends Error {
  constructor(
    readonly code: MailErrorCode,
    message: string,
    readonly meta?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "MailError";
  }
}

/**
 * Note what is NOT in here, for the same reason Documents has no
 * FOLDER_RESTRICTED: there is no ACCOUNT_NOT_YOURS. A connection belonging to a
 * colleague and a connection that does not exist are the same answer — the row
 * is invisible, and saying "that's someone else's mailbox" would confirm it
 * exists and who has one. Other people's mailboxes return NOT_FOUND, on purpose.
 *
 * Nor is there a code for "the mail server said no". Those messages come from
 * describeMethodError() in the JMAP layer, which knows what actually happened;
 * flattening them here would replace a specific sentence with a vague one.
 */
const FRIENDLY: Record<MailErrorCode, string> = {
  FORBIDDEN: "Only the business owner can do that.",
  FORBIDDEN_EXPERT:
    "Accountant access is read-only — reviews, sign-offs and exports only.",
  NOT_CONFIGURED:
    "Reading mail isn't set up on this server yet. Ask your administrator.",
  NO_MAILBOX:
    "You don't have a mailbox on this business's domain yet — the owner creates those in Email setup.",
  ACCOUNT_NOT_FOUND: "That mailbox isn't connected.",
  ACCOUNT_NEEDS_REAUTH:
    "This mailbox needs to be reconnected before it can be read again.",
  MAILBOX_NOT_FOUND: "That folder no longer exists.",
  THREAD_NOT_FOUND: "That conversation no longer exists.",
  MESSAGE_NOT_FOUND: "That message no longer exists.",
  ATTACHMENT_NOT_FOUND: "That attachment is no longer on the mail server.",
  ATTACHMENT_TOO_LARGE:
    "That attachment is too large to open here — use your phone or Outlook for this one.",
  MESSAGE_TOO_LARGE:
    "That message is too large to file a copy of — download it and attach it by hand.",
  SEARCH_QUERY_INVALID: "That search couldn't be read — try simpler terms.",
  MAIL_SERVER_UNREACHABLE:
    "Couldn't reach the mail server. Your mail is safe — try again shortly.",
  // Both of the "not found" answers below are also the RESTRICTED answer, on
  // purpose and for the reason at the top of this file: a record hidden from
  // this person by RLS must be indistinguishable from one that never existed.
  LINK_TYPE_UNKNOWN: "That isn't something a conversation can be attached to.",
  LINK_TARGET_NOT_FOUND: "That record no longer exists.",
  FILING_UNAVAILABLE:
    "Attaching needs the Documents module — a copy of the email has to go somewhere the whole business can read it.",
  LINK_NOT_FOUND: "That attachment has already been removed.",
  SEND_UNSUPPORTED:
    "This mailbox can't send from inside Yosher — the mail server didn't grant permission to. Reconnect it, or send from your phone or Outlook.",
  // Deliberately vague to the USER and specific in the log: the reason is
  // usually EMAIL_DEV_REDIRECT being unset, which is an operator problem, and
  // spelling out an environment variable to a client is noise.
  SEND_BLOCKED: "Sending is switched off in this environment.",
  SEND_FAILED:
    "The mail server wouldn't send that message. Nothing was delivered — check Drafts.",
  NO_DRAFTS_FOLDER:
    "This mailbox has no Drafts folder, so there's nowhere to compose from.",
  RECIPIENT_INVALID: "That doesn't look like an email address.",
  ATTACHMENT_REJECTED: "That file couldn't be attached.",
  SEARCH_NAME_INVALID: "Give the saved search a name.",
  SEARCH_NAME_TAKEN: "You already have a saved search with that name.",
  SEARCH_QUERY_EMPTY:
    "There's nothing to save — add a search term or a filter first.",
  SEARCH_LIMIT: "That's as many saved searches as one mailbox can hold.",
  SEARCH_NOT_FOUND: "That saved search has already been removed.",
  FOLDER_NAME_INVALID: "Give the folder a name.",
  // Roles are how archive, trash, sent and drafts are resolved — renaming one
  // does not break the NAME, it breaks the lookup everything else depends on.
  FOLDER_PROTECTED:
    "That's a standard folder and can't be renamed — Inbox, Sent, Drafts, Archive, Junk and Trash are how the rest of the app finds them.",
  NOTHING_SELECTED: "Nothing is selected.",
};

export function friendlyMessage(err: unknown): string {
  if (err instanceof MailError) return FRIENDLY[err.code];
  return "Something went wrong. Please try again.";
}
