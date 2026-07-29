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
import { forwardText, openingBody, quoteText } from "../compose/quote";
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
 */

export type ComposeMode = "new" | "reply" | "reply_all" | "forward";

export function Composer({
  mailboxId,
  accountId,
  selfAddress,
  mode,
  parent,
  signature,
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
  closeHref: string;
}) {
  const draft = buildDraft(mode, parent, selfAddress, signature);
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

function buildDraft(
  mode: ComposeMode,
  parent: JmapEmail | null,
  selfAddress: string,
  signature: string,
): ComposeDraft {
  if (mode === "new" || !parent) {
    return {
      to: "",
      cc: "",
      subject: "",
      body: signature.trim().length > 0 ? `\n\n${signature.trim()}` : "",
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
      body: openingBody(signature, forwardText(parent)),
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
    body: openingBody(signature, quoteText(parent)),
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
