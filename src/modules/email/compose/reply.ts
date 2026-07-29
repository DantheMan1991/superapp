import type { JmapEmail, JmapEmailAddress } from "@/lib/email/jmap/types";

/**
 * How to answer a message: who it goes to, what it is called, and how it joins
 * the conversation.
 *
 * All pure, all free of `server-only`, for the same reason `jmap/parse.ts` and
 * `render/transcript.ts` are — this is the layer where a small mistake is
 * expensive and invisible. Sending a reply to the wrong set of people is not a
 * rendering bug you notice on the next page load; it is correspondence that has
 * already left the building. So it is testable without a mail server, and it is
 * tested hard.
 */

/* -- Recipients ---------------------------------------------------------- */

export type ReplyMode = "reply" | "reply_all";

export interface ReplyRecipients {
  to: JmapEmailAddress[];
  cc: JmapEmailAddress[];
}

function key(address: JmapEmailAddress): string {
  return address.email.trim().toLowerCase();
}

/**
 * Case-insensitive dedupe, first occurrence wins, but a later entry that
 * carries a display name upgrades an earlier bare address.
 *
 * Local-parts are technically case-sensitive per RFC 5321, and in practice no
 * mail system anybody uses treats them that way. Matching case-sensitively here
 * would put the same person on a reply twice.
 */
function dedupe(addresses: readonly JmapEmailAddress[]): JmapEmailAddress[] {
  const seen = new Map<string, JmapEmailAddress>();
  for (const address of addresses) {
    if (address.email.trim().length === 0) continue;
    const k = key(address);
    const prior = seen.get(k);
    if (!prior) seen.set(k, address);
    else if (!prior.name && address.name) seen.set(k, address);
  }
  return [...seen.values()];
}

function without(
  addresses: readonly JmapEmailAddress[],
  exclude: ReadonlySet<string>,
): JmapEmailAddress[] {
  return addresses.filter((a) => !exclude.has(key(a)));
}

/**
 * Every address that means "me", so a reply does not include the sender.
 *
 * Takes the identity's address AND any alias the caller knows about, because a
 * shared mailbox is reached under more than one name and a reply-all that CCs
 * the mailbox you are sending from is the most common way this feature annoys
 * people.
 */
export function selfAddresses(
  ...addresses: readonly (string | null | undefined)[]
): Set<string> {
  const out = new Set<string>();
  for (const address of addresses) {
    const trimmed = address?.trim().toLowerCase();
    if (trimmed) out.add(trimmed);
  }
  return out;
}

/**
 * Who a reply goes to.
 *
 * Three rules, in order of how often they are got wrong:
 *
 *  1. **`Reply-To` beats `From`.** A sender who sets it has explicitly said
 *     where answers belong — a `no-reply@` From with a real `Reply-To` is the
 *     everyday case, and ignoring it sends the answer into a void.
 *  2. **Self is excluded**, but never to the point of leaving nobody. See below.
 *  3. **Reply-all keeps the original To in To**, not in Cc. The people the
 *     sender addressed directly are still being addressed directly; demoting
 *     them to Cc quietly changes who the message is aimed at.
 */
export function replyRecipients(
  message: Pick<JmapEmail, "from" | "to" | "cc" | "replyTo">,
  mode: ReplyMode,
  self: ReadonlySet<string>,
): ReplyRecipients {
  const author = message.replyTo.length > 0 ? message.replyTo : message.from;

  // Replying to your OWN sent message is the case that breaks the naive rule:
  // the author is you, so excluding self would leave an empty To and a reply
  // addressed to nobody. What somebody means by "reply" on their own message is
  // "write to the people I wrote to", which is what mail clients do.
  const authorIsSelf =
    author.length > 0 && author.every((a) => self.has(key(a)));

  const primary = authorIsSelf ? message.to : author;

  if (mode === "reply") {
    const to = dedupe(without(primary, self));
    // If excluding self emptied it — a message from you to only you — answer to
    // the author anyway rather than producing a draft that cannot be sent.
    return { to: to.length > 0 ? to : dedupe(primary), cc: [] };
  }

  const toPool = authorIsSelf ? message.to : [...author, ...message.to];
  const to = dedupe(without(toPool, self));
  // Cc excludes anybody already in To, or a reply-all puts the author in both.
  const inTo = new Set(to.map(key));
  const cc = dedupe(without(message.cc, self)).filter((a) => !inTo.has(key(a)));

  return {
    to: to.length > 0 ? to : dedupe(primary),
    cc,
  };
}

/** Everyone a forward starts with: nobody. Stated so the intent is explicit. */
export const FORWARD_RECIPIENTS: ReplyRecipients = { to: [], cc: [] };

/* -- Subjects ------------------------------------------------------------ */

/**
 * Leading reply/forward markers, matched repeatedly so they do not stack.
 *
 * Handles the `Re[2]:` and `Re(2):` counter forms some clients emit, and the
 * common non-English markers that would otherwise accumulate when a thread
 * crosses a language boundary — `Aw:` (German), `Sv:` (Scandinavian), `Vs:`
 * (Finnish), `Rif:` (Italian), `Antw:` (Dutch).
 *
 * The `:` is required, which is what keeps "Review: Q3 numbers" and
 * "Reference: 4471" intact — both start with "Re" and neither is a reply.
 */
const MARKER =
  /^\s*(?:re|aw|sv|vs|rif|antw|fwd?|tr|wg)\s*(?:[[(]\d+[\])])?\s*:\s*/i;

/**
 * RFC 5322 §2.1.1 — the maximum length of a header line. A "subject" longer
 * than this is not one, and clamping first is what keeps the loop below cheap
 * on hostile input.
 */
const MAX_SUBJECT = 998;

/**
 * Strip every leading marker, to a fixed point.
 *
 * Loops until nothing changes rather than a fixed number of times. That looks
 * unbounded and is not: the regex always consumes at least one character when
 * it matches, so each pass strictly shortens the string and the loop can run at
 * most `subject.length` times. An earlier version capped it at 20 and left
 * `Re: Re: Re: …` behind on absurd input — a guard against a hazard that was
 * never there, which quietly became a correctness bug.
 */
export function stripMarkers(subject: string): string {
  let out = subject;
  for (;;) {
    const next = out.replace(MARKER, "");
    if (next === out) break;
    out = next;
  }
  // Clamped AFTER stripping, not before. Clamping first cuts mid-marker on a
  // pathological subject and leaves the fragment behind as though it were the
  // real subject — `Re: Re: Re: …` truncating to a trailing bare `Re`. The
  // limit is about the header we emit, not about bounding the loop, which is
  // bounded already.
  return out.trim().slice(0, MAX_SUBJECT).trim();
}

export function replySubject(subject: string): string {
  const bare = stripMarkers(subject);
  return bare.length > 0 ? `Re: ${bare}` : "Re:";
}

export function forwardSubject(subject: string): string {
  const bare = stripMarkers(subject);
  return bare.length > 0 ? `Fwd: ${bare}` : "Fwd:";
}

/* -- Threading ----------------------------------------------------------- */

/**
 * How many References to carry. RFC 5322 recommends clients not truncate, and
 * real servers reject absurd headers — so this keeps the FIRST (the thread's
 * root, which is what most threading algorithms key on) and the most recent
 * ones, dropping the middle. Well above any human conversation.
 */
export const MAX_REFERENCES = 24;

export interface ThreadHeaders {
  /** RFC 5322 In-Reply-To — the parent's Message-Id. */
  inReplyTo: string[];
  references: string[];
}

/**
 * Build the chain that makes a reply land inside the conversation rather than
 * starting a new one.
 *
 * `References` = the parent's References plus the parent's own Message-Id.
 * Getting this wrong does not error — it silently splits the thread in every
 * recipient's mail client, which is the kind of bug that gets reported as
 * "your emails are weird" months later.
 */
export function threadHeaders(
  parent: Pick<JmapEmail, "messageId" | "references">,
): ThreadHeaders {
  const parentId = parent.messageId?.[0];
  if (!parentId) {
    // No Message-Id on the parent means no chain can be built. Better an
    // unthreaded reply than a fabricated identifier.
    return { inReplyTo: [], references: [] };
  }

  const chain = [...(parent.references ?? []), parentId];
  const seen = new Set<string>();
  const unique = chain.filter((id) => {
    if (id.length === 0 || seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  const references =
    unique.length <= MAX_REFERENCES
      ? unique
      : // Root first, then the tail. The parent must always survive, or the
        // reply detaches from the message it is answering.
        [unique[0], ...unique.slice(unique.length - (MAX_REFERENCES - 1))];

  return { inReplyTo: [parentId], references };
}
