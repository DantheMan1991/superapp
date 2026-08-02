import type { JmapEmail } from "@/lib/email/jmap/types";
import { devDeliveryNotice } from "../compose/guard";
import {
  forwardSubject,
  replyRecipients,
  replySubject,
  selfAddresses,
  threadHeaders,
  type ReplyMode,
} from "../compose/reply";
import {
  forwardHtml,
  openingBodyHtml,
  quoteHtml,
  textSignatureToHtml,
} from "../compose/quote";
import { sanitizeOutboundHtml } from "../compose/html";
import { ComposeForm, type ComposeDraft } from "./compose-form";

/**
 * The composer, prefilled on the server.
 *
 * Reply, reply-all and forward differ only in what they start with — recipients,
 * subject, threading headers and quoted body — and all four are pure functions
 * of the message being answered. Computing them here rather than in the browser
 * means the client component holds text somebody typed and nothing else, and
 * that the rules are the ones the test suite covers.
 *
 * `mode` comes from the URL like every other piece of state in this module, so a
 * half-written reply survives a refresh of the page around it.
 *
 * ONE BODY IS BUILT HERE, not two. The composer edits an HTML document and the
 * text alternative is DERIVED from it at send time (`compose-actions.ts`), so
 * there is a single source of truth for the words in a message. Building a
 * parallel plain-text draft would produce two, and they would disagree the
 * moment somebody edited or deleted the quote in the editor — which is a normal
 * thing to do and would have silently sent one message to clients that render
 * HTML and a different one to clients that do not.
 */

export type ComposeMode = "new" | "reply" | "reply_all" | "forward";

export function Composer({
  mailboxId,
  accountId,
  selfAddress,
  mode,
  parent,
  signature,
  htmlSignature,
  closeHref,
}: {
  mailboxId: string;
  accountId: string;
  /** The address this mailbox sends as, so a reply does not include you. */
  selfAddress: string;
  mode: ComposeMode;
  /** The message being answered. Absent for a new message. */
  parent: JmapEmail | null;
  signature: string;
  /** The identity's own HTML signature, still unsanitized. */
  htmlSignature: string;
  closeHref: string;
}) {
  const draft = buildDraft(mode, parent, selfAddress, signature, htmlSignature);
  return (
    <ComposeForm
      mailboxId={mailboxId}
      accountId={accountId}
      draft={draft}
      // Rendered by the PARENT and read from the environment, never from
      // anything the message supplied — the same rule the "images blocked" bar
      // follows. Somebody has to be able to trust this line.
      devNotice={devDeliveryNotice()}
      closeHref={closeHref}
      title={TITLES[mode]}
    />
  );
}

/** What the person pressed, echoed back so the pane says what it is. */
const TITLES: Record<ComposeMode, string> = {
  new: "New message",
  reply: "Reply",
  reply_all: "Reply all",
  forward: "Forward",
};

/**
 * The signature, as markup the composer can start from.
 *
 * Prefers the identity's `htmlSignature` — somebody who built one in another
 * client has links and layout in it, and rebuilding it from the text version
 * would throw both away. It is sanitized on the way in, because it is markup
 * from the mail server heading into a message we are about to send under this
 * person's name: exactly the input `sanitizeOutboundHtml` exists for.
 */
function signatureMarkup(signature: string, htmlSignature: string): string {
  const rich = sanitizeOutboundHtml(htmlSignature);
  // Tags with no text are not a signature — an empty `<div>` from a server that
  // stores one for every identity would push the quote down for no reason.
  if (rich.replace(/<[^>]*>/g, "").trim().length > 0) return rich;
  return textSignatureToHtml(signature);
}

function buildDraft(
  mode: ComposeMode,
  parent: JmapEmail | null,
  selfAddress: string,
  signature: string,
  htmlSignature: string,
): ComposeDraft {
  const sigHtml = signatureMarkup(signature, htmlSignature);

  if (mode === "new" || !parent) {
    return {
      to: "",
      cc: "",
      subject: "",
      bodyHtml: openingBodyHtml(sigHtml, ""),
      inReplyTo: [],
      references: [],
      showCc: false,
    };
  }

  const self = selfAddresses(selfAddress);

  if (mode === "forward") {
    return {
      // A forward starts with nobody: the whole point is choosing someone new,
      // and prefilling the original recipients is how a private thread gets
      // sent back to the people it was about.
      to: "",
      cc: "",
      subject: forwardSubject(parent.subject),
      bodyHtml: openingBodyHtml(sigHtml, forwardHtml(parent)),
      // A forward is a NEW message, not a reply — no threading headers, or it
      // lands inside the original conversation in the recipient's client.
      inReplyTo: [],
      references: [],
      showCc: false,
    };
  }

  const replyMode: ReplyMode = mode === "reply_all" ? "reply_all" : "reply";
  const recipients = replyRecipients(parent, replyMode, self);
  const headers = threadHeaders(parent);

  return {
    to: recipients.to.map(formatAddress).join(", "),
    cc: recipients.cc.map(formatAddress).join(", "),
    subject: replySubject(parent.subject),
    bodyHtml: openingBodyHtml(sigHtml, quoteHtml(parent)),
    inReplyTo: headers.inReplyTo,
    references: headers.references,
    showCc: recipients.cc.length > 0,
  };
}

function formatAddress(a: { name: string | null; email: string }): string {
  // Quoted when the display name carries a comma, or the recipient parser on
  // the way back would split one person into two.
  if (!a.name) return a.email;
  const name = a.name.includes(",") ? `"${a.name.replace(/"/g, "")}"` : a.name;
  return `${name} <${a.email}>`;
}
