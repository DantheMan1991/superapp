# 0085. A client link is a tokenised copy of the proposal, and accepting on it records a signature rather than accepting the estimate

- **Status:** Accepted
- **Date:** 2026-09-17
- **Deciders:** founder — the fourth of his four decisions on the estimate review, "the client gets a link with Accept"

## Context

[ADR 0083](0083-a-proposal-is-an-ordered-list-of-sections-a-brochure-is-a-page-order-over-facts-the-pack-already-holds-and-the-document-is-html.md)
made the proposal an HTML document served from a GET route and said the route
was deliberately the one a client link would serve;
[ADR 0084](0084-the-brochures-pdf-is-a-headless-print-of-the-document-itself-and-the-format-picks-the-engine.md)
made its PDF a print of that same string. This is the third door: the client's,
with no session behind it.

The open question was never the document. It was **what pressing Accept
does** — and the code had already answered it. `acceptEstimate` takes
`requireWrite(ctx, "owner")` and a `contractId`, checks that contract is on
the job, and rewrites its value to the estimate's total. A client is not an
owner and does not know which of a job's several agreements their proposal
priced. **A client therefore cannot accept an estimate, and any design where
pressing a button in an email does is wrong on its own terms.**

## Decision

**A CLIENT LINK IS A TOKENISED, READ-ONLY COPY OF THE DOCUMENT THE PACK
ALREADY RENDERS**, at `/proposal/<token>` — the brochure or the letter,
whichever `format` names, with the same sections, stylesheet and page order.

**THE CREDENTIALS ARE `document_shares`', VERBATIM.** That table is the
platform's existing answer to "let a stranger read one tenant's thing", and a
second answer would be a second thing to get wrong. A 256-bit token minted by
`mintToken`, stored only as a keyed HMAC (`token_hash`, globally unique,
because the public lookup has no tenant to scope by) and as AES-GCM ciphertext
so the builder can copy the link again to re-send it. Both keys are in the
environment: a database-only compromise yields nothing. Fail closed — no
`SHARE_SECRET`, no links.

**`withSystem` DOES THE TOKEN → TENANT HOP AND NOTHING ELSE.** The inbound
webhook's trust model, kept. `resolveProposalShare` lives in a file of its own
so it can be read in one sitting; its only input is 43 characters of
base64url, it never takes a tenant, estimate or project id from the caller, and
every read after it — and the one write — runs under `withTenant` at role
**staff**, where the pack's RLS policy governs it. Widening that lookup is the
most dangerous change anyone can make to this feature, and the RLS migration
says so where a reader will find it.

**EVERY FAILURE IS THE SAME ANSWER.** Unknown, revoked, expired, already
accepted, estimate revised, pack switched off, business churned: one unbranded
page with one sentence. A visitor cannot learn that a token was nearly right,
that a business exists, or that a proposal was withdrawn. The BUILDER is told
which it is, on their own screen, where they are signed in — two audiences,
two amounts of truth.

**ACCEPTING RECORDS A SIGNATURE. IT DOES NOT ACCEPT THE ESTIMATE.** The one
write a stranger may make stores `signed_at`, `signed_name`, `signed_ip_hash`,
`signed_estimate_version` and `signed_total_cents` — all five or none, by
CHECK, because half a signature is not evidence. The business still accepts
the estimate, as an owner, onto the contract it priced; this is the reason to.
Same shape as a lien waiver (ADR 0066) and a back-charge (ADR 0077): **record
the fact, derive the standing.**

**THE VERSION THE CLIENT WAS SHOWN IS CHECKED, NOT TRUSTED.** The form carries
it and a mismatch is refused with "this proposal was updated while you had it
open" — the `STALE_VERSION` discipline every other guarded verb in this pack
keeps, pointed at the person with the most to lose from it. A signature can
never name a document the client did not read.

**AND A LINK IS SIGNED ONCE**: `signed_at is null` in the update's WHERE, so
two people opening one link cannot both sign.

**THE STANDING IS DERIVED, AND `superseded` IS THE INTERESTING ONE.** Revoked
beats everything (the builder saying no); expiry beats a signature (an expired
offer stops opening although its signature stands); and a signature against a
version the estimate has left behind is **superseded**, the only standing that
is a fact about two rows. Such a link is dead — it cannot go on showing a
document that is not the one that was signed, nor offer a second signature
against different content — while the signature itself stays, at the version it
names. Nothing sweeps these rows; nothing can be stale.

**A LINK ENDS WHEN THE OFFER ENDS.** `expires_at` is derived from the
estimate's own `valid_until`, at the end of that day, falling back to thirty
days when there is none, and never in the past. No never-expiring anonymous
links — `document_shares`' rule, and a fact the estimate already held rather
than a date somebody chooses twice.

**THE REPLY CARD IS SCREEN-ONLY, SO THE PAPER IS THE SAME PAPER.** The accept
form and the accepted stamp sit outside the sheet, hidden in print media by the
same rule that hides the Print control. A client who prints their copy gets
byte-for-byte what the builder prints, and with no link the document is
identical to what existed before this slice — which is what keeps "one
document, three doors" true now that the third door exists.

**NO SERVER-PRINTED PDF ON THE PUBLIC LINK.** The PDF route runs a browser
(ADR 0084); an anonymous caller who could trigger that is an unbounded CPU and
egress amplifier for anyone holding one leaked link. The client gets a PDF the
way they already could — the document's own Print control — which costs this
server nothing. That is the second time E5b's small control has paid for
itself.

## Consequences

- One table, `job_estimate_shares`, migrations `0377`/`0378`, **applied to dev
  and prod before the merge; 229 tables verified on each**. Member-wide to
  write, like the estimate it belongs to: a proposal that cannot be sent until
  an owner is free goes out as an email attachment instead.
- `recordAttempt` and the per-IP caps moved from
  `modules/documents/shares/limits.ts` to **`src/lib/public-limits.ts`**, the
  fonts precedent: a pack may not reach into a module for a security control,
  and duplicating a cap is worse than moving it. The byte budget stayed behind,
  because it is about files.
- `/proposal/<token>` and not `/p/<token>`: **`/p/` is already the site preview
  link** (ADR 0046). The longer path is also better in an email, where a client
  deciding whether a link is real can read what it says.
- **The builder is not yet TOLD when a client accepts.** They see it on the
  estimate, with the name, the date and the price. A push or a digest line
  wants `jobs` to become an attention source — the pack's first, and a slice of
  its own, worth more than this signature because it would light up every other
  obligation in the pack at the same time. The client's card therefore does not
  claim anyone was notified.
- Nothing is emailed from here. The link is copied to the clipboard and pasted
  into the builder's own message, as the proposal's PDF already was.
- **A typed name is what is recorded, and it is not identity.** Anyone holding
  the link can type anything. What makes it evidence is everything stored
  around it — when, from which hashed address, against which version, at which
  total — and the fact that the business chose to send the link. If that is not
  enough for a particular agreement, the paper route is still printed on every
  copy, on purpose.

## Alternatives considered

- **Accept sets the estimate to `accepted`.** Rejected, and not on taste:
  `acceptEstimate` needs an owner and the contract the estimate priced. It
  would also mean an anonymous click locking an agreement's words and money and
  rewriting a contract's value, which is a lot to hang on a forwarded email.
- **A passcode on the link**, as document shares have. Rejected for now: the
  token is 256 bits and the link is sent to a named client, so a passcode is
  friction bought with nothing. The column is a small change away if a business
  wants one.
- **A drawn signature.** Rejected: a canvas scribble is no more binding than a
  typed name, needs an image pipeline, and prints worse.
- **Confirming the client's email** before the signature counts. A real
  improvement in evidence and a real cost in abandonment, and the founder
  asked for Accept, not for an identity check. Worth revisiting if a signature
  is ever disputed.
- **Serving the client a stored copy** of the document as it was when the link
  was made. Rejected, as ADR 0070, 0063 and 0083 rejected it: a file drifts
  from the rows it was made from. `superseded` is the answer instead — the live
  document, and a link that dies rather than lie.
- **A React page around the document.** Rejected for ADR 0083's reason and one
  more: there is no app around this, so there is nothing for a page to inherit.
  A form POST to a route handler needs no client JavaScript at all.
