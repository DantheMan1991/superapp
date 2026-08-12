# Email (outbound spine + hosted mailboxes)

> Everything the platform sends on a client's behalf — share links today,
> invoices and signature requests next — goes through one seam. Its whole
> reason for existing is **which address the mail comes from**: a client's own
> domain wherever possible, never an anonymous third-party address. As of
> 2026-07-26 it also **hosts** mailboxes on that domain.
> Status: `live` · Scope: `platform` <!-- keep Status on ONE line — /admin/docs parses it -->


## Build log

Newest first. One entry per session/PR that touched this module. Every PR
that changes this module MUST add an entry here (rule in AGENTS.md).

> **Older entries live in [`email-build-log.md`](./email-build-log).** This
> section keeps the most recent work only. Add new entries at the top here; when
> it grows past a few screens, sweep the oldest into the archive. The dossier is
> read at the start of every mail session, so its length is a real cost.

### 2026-08-10 — UI: the mail client on the shared tokens (branch `claude/ui-mail`)

Presentation only — no JMAP call, action, schema or policy changed. Vocabulary in
[design-system.md](design-system.md);
[ADR 0008](../decisions/0008-warm-neutrals-and-layered-elevation.md) has the why.

**This module is deliberately treated differently.** It is the only one with
`layout: "full"`, and it is a list-beside-detail-pane client, so the
`PageHeader` + `CategoryStrip` + `DataTable` pattern the other modules took does
not apply. The three-column grid, its height chain (`min-h-0` / `overflow-auto`)
and the `border` weight on the pane separators are **untouched** — pane edges are
structural and correctly `--border`. What changed is colour and the hairlines
*inside* a pane.

- **Fixed: `text-brand` on the Mail glyph** in `MailView.tsx` (2.81:1) and
  **`border-brand`** on the active filter chip. Both now `--module-accent`, which
  for this module is blue and measures **5.41:1** on card in light, 6.66:1 in dark.
- **The module reads blue now**, not brand green: the header glyph, the active
  filter chip and the unread count in the folder rail all take `--accent-email`,
  matching its icon in the rail.
- **In-pane hairlines moved to `--divider`** — the thread list's row dividers, its
  sticky bulk-action bar, the select-all row, and the reading pane's header,
  footer and quoted-text blocks. Pane separators kept `--border`.
- **Six hardcoded amber banners moved onto the warning tokens**, including two
  that carried a hand-written `dark:` palette pair doing the theme's job by hand.

**A mistake worth recording, because it was made twice.** Replacing
`text-amber-600` with `text-warning` on those icons made contrast *worse*:
`--warning` is a fill at oklch(0.75 …) and measures **2.18:1** on the page, below
even the 3:1 bar for a glyph. `--warning-foreground` was added as its dark twin
(the same split `--success` already needed) and everything readable moved onto it
— minimum **6.13:1** across both themes now. `status-badge.tsx` had also been
referencing `text-warning-foreground` for some time with **no such token
defined**, propped up by a hardcoded `text-amber-700 dark:text-amber-300`; that
class now resolves, and the hardcoded pair is gone.

### 2026-08-08 — A probe for granting access to a shared mailbox (branch `claude/mail-grant-probe`)

`npm run mail:probe-grant` (`scripts/jmap-grant-probe.ts`), following the house
pattern: ask the live server before writing any UI.

**It has not been run yet, so this entry records the questions, not answers.**
Whoever runs it should add the findings here — that is how every other probe in
[email-build-log.md](./email-build-log) is documented, and a probe whose results
live only in a terminal scrollback may as well not have been written.

The premise, which is what makes it worth running: the delegation slice proved a
Group principal with members produces a second account in the member's session,
but it created both principals itself. Granting access to an EXISTING mailbox is
harder, because `stalwart.ts` provisions every mailbox as
`accountType: "individual"` — so `info@` on a real server is a User, not a
Group. Five questions:

1. Can a principal be found by ADDRESS? Yosher stores addresses and has no
   column holding a Stalwart id
2. Can a User principal hold members — is any existing mailbox shareable at all?
3. Can a User be converted to a Group in place, keeping its address and mail?
4. Does adding a member take effect immediately in that member's session?
5. **The negative: does REMOVING the membership actually revoke it?** A grant
   that cannot be taken away is not a grant

It writes, so it is loopback-only and destroys everything it made on every exit
path, including a sweep of anything an earlier run left behind.

### 2026-08-08 — The dossier got too big to read (branch `claude/split-oversized-files`)

Nothing about the module changed. This records why the file you are reading is
shorter. It had reached 3,894 lines, 78% of it build log, and AGENTS.md tells
every mail session to read it first — a fixed cost paid at the start of every
change to this module, and the largest single one in the repo.

- Entries older than 2026-08-03 moved to `email-build-log.md`. Nothing was
  edited or dropped: 38 entries before, 6 here and 32 there. build-docs walks the
  whole `docs/` tree, so the archive renders at `/admin/docs` with no code change
- **New entries still go here**, at the top. Sweep the oldest across when this
  section outgrows a few screens
- Archived entries still name `tests/tenant-isolation.test.ts` and
  `src/db/schema.ts`, which no longer exist (now `tests/isolation/<area>.test.ts`
  and `src/db/schema/<domain>.ts`). Left as written — they record what was true

### 2026-08-06 — Off Vercel Hobby: a constraint several designs here were built on is gone (branch `claude/vercel-plan-doc-cleanup`)
- The founder confirmed the account is **no longer on Hobby**. Older entries below justify design choices with "Hobby runs each cron ONCE A DAY" and "Hobby caps a cron at 60s". Those entries are left as written — they record what was true — but are annotated inline where the *reason* no longer holds
- **`vercel.json`'s `*/10 * * * *` is now the real schedule.** If Hobby was previously coercing it to daily, then mail sync, snooze wakes, scheduled sends and auto-filing were landing up to 24h late and are now ~144× more frequent. That is a load change on Stalwart and the database that arrived with no deploy — **verify against real invocation logs before trusting it**
- **Nothing was re-architected in this PR.** The snooze sweep, scheduled send and auto-filing still ride the mail-sync cron. That is now inertia rather than necessity, and splitting them is exactly the decision the notifications digest forces — see `docs/modules/timezone.md` and the cron note in `src/app/api/cron/mail-sync/route.ts`. Doing it here as a drive-by would settle a queue-vs-cron question that deserves its own session
- `maxDuration = 60` unchanged and now documented as **our** choice: every batch cap below it was sized to fit a minute, so raising the ceiling without re-deriving them buys nothing
- ADR 0005 needed no change — it already recorded the move to Pro (2026-08-02) and its decision (polling over push) is unaffected

### 2026-08-03 — Templates, and the first thing that does not travel

Canned responses: save the reply you keep writing, insert it while composing.
The last item from the Gmail compose review, and the only one that needed
storage rather than markup.

**THE PROBE WAS RUN TO TALK ME OUT OF THE TABLE, and it failed — which is the
useful outcome.** Every organising feature in this module lives on the mail
server on purpose: rules are a Sieve script, the auto-reply is a
VacationResponse, the signature is on an Identity, a label IS a mailbox. That is
why they all work on a phone. A table is the one shape that does not travel, so
`npm run mail:probe-templates` asked the server first, and the answer was yes on
every mechanical question:

| | |
| --- | --- |
| a `$draft` message in a mailbox of its own | accepted — literally Gmail's original canned responses |
| does it pollute the Drafts folder? | **no** — the mailbox decides where it shows, not the keyword |
| does the markup round-trip? | intact |
| `FileNode/set` (the advertised, never-used file store) | also works |

**And it is still the wrong home, for a reason no amount of protocol support
fixes: every one of those locations is scoped to ONE ACCOUNT.** The delegation
slice established that naming an account you were not granted returns
`forbidden`. So sharing the company's payment-terms wording with a colleague
would mean granting them the mailbox holding it — and every message in it.
**There is no way to share the wording without sharing the correspondence**, and
a template that dies when its author leaves is not a business asset.

**So `mail_templates` (`0055`/`0056`) is the first mail table scoped to the
BUSINESS rather than to one person.** Five tables before it are per-user, and
every one of those migrations gives the same two reasons — the rows hold
correspondence, or they hold ids the mail server issued inside one account. A
template holds neither. It is boilerplate somebody wrote *so that* it would be
reused, and a copy per employee is the problem it exists to solve. There is no
`clerk_user_id` and no `mail_account_id` either: the same wording is available
from a personal box and from a shared `info@` without being stored twice.

**The accepted cost, stated plainly: a template does NOT appear on a phone or in
Outlook**, and it is the first mail feature since Slice 0 of which that is true.
Usable by the whole company beat usable in another client — the opposite of how
every previous call in this module went, which is why it is worth writing down.

The dossier's own open item predicted "a per-user table". It was wrong on the
scope, and `document_templates` (`0033`/`0034`) had already settled the same
question the same way for the other module that has templates — tenant-scoped,
`member_all`, author recorded rather than enforced. A colleague correcting the
payment terms is somebody doing their job.

**INSERT, NEVER REPLACE**, and it is the one decision a user would notice.
Replacing the body is the obvious reading of "apply a template" and is wrong the
first time somebody uses one in a REPLY: the quoted message and the signature
are already in that editor, and both would vanish. `RichTextEditorHandle` grew
`insertHtml`, which puts the markup at the caret. In plain-text mode the text
rendering goes in instead — via the same `htmlToPlainText` the send path already
derives its text alternative with, rather than a second converter.

**The subject is filled only when empty**, so applying a template to a reply
cannot rewrite "Re: …", and a template with no subject of its own never touches
it either way. The form says so rather than leaving it to be discovered, because
the other reading — "this template sets the subject" — is the one that would
quietly damage a thread.

**Sanitized on WRITE as well as at send.** The send path sanitizes every body
regardless, so this is not the guarantee; it is what stops the editor showing
one thing and the recipient receiving another, which for a template repeats on
every use. Same reasoning the signature slice recorded, and a template is in the
same class — markup written once and sent many times.

**No inline images, and it is the signature's rule rather than a new one.** A
`cid:` is minted per message and lives in that message's MIME, so a stored
template referencing one would show a broken image on every mail it was later
inserted into. No cid allowlist is passed, so the sanitizer's default empty set
drops them, and the editor has no picture button because `accountId`/`mailboxId`
are not passed to it.

**A BUG THE TESTS FOUND, and the fix was to correct the claim rather than the
code.** `prepareTemplateBody` slices its input to the cap and then sanitizes —
and 20,000 characters in came back as 20,004 out, because the slice cut through
a tag and the sanitizer closed it. Truncating the sanitized result instead would
reintroduce exactly the unbalanced markup it had just fixed. So the cap is on the
INPUT, the doc comment says so, and the test asserts the property that actually
matters: a paste twice the size and one ten times the size store the *same*
bounded amount.

**Two isolation tests assert the OPPOSITE of every other mail test**, and that is
deliberate. The rest of the file proves a colleague sees nothing; these prove a
colleague DOES see the business's templates, and that omitting `{ userId }`
still returns them. A suite that only ever asserts "the colleague sees nothing"
would pass just as well if the policy were broken shut — and a template nobody
else can read is the feature not working. A third still asserts they never cross
a tenant, and a fourth pins the folded-name unique index.

Reached from the mail header beside Signature, and it takes the reading pane
like the composer, the rules editor and the auto-reply form. Templates are
loaded when the manager is open OR a composer is — a local indexed SELECT rather
than a protocol call, which is what being in our own database buys.

Verified: 5 probe confirmations and the finding that decided the design, 14 new
unit tests, and 4 new isolation tests — 118 passing against the dev branch.
**Not verified in a browser** — the things to try are inserting a template
mid-sentence in a reply (the quote must survive), applying one in plain-text
mode, and the name collision message.

**Not applied to production**: `0055` and `0056` are on the dev branch only.
`docs/security.md` §8 requires both.

### 2026-08-03 (later) — Automatic filing, and the trigger there was only one of

"Everything from this supplier goes in the Bills folder." This closes the
`attachments → Documents` open item that has been in this dossier since the
hosted-mailbox build.

**NOTHING ABOUT FILING CHANGED — only who decides.** Slice 5 built the path: a
message and its attachments become an `.eml`, a searchable transcript and one
document per attachment, through `MailFilingTarget.fileMessage`. The sweep calls
exactly that. A second implementation would have been two ways for a message to
become a document, and they would have diverged.

**THE TRIGGER COULD ONLY EVER HAVE BEEN OUR OWN CRON, and it is worth writing
down because every other organising feature went the other way.** Rules compile
to Sieve, snooze moves a message, a label IS a mailbox — all pushed down to the
mail server so they work on a phone. None of that is available here: **Sieve runs
inside the mail server and cannot call Yosher.** The one Sieve action that could
reach us is `redirect` to an inbound address, which would send the message back
out over SMTP, duplicate it and break SPF on the way. So this rides the mail-sync
cron and inherits ADR 0005's cadence, which is the cost that ADR already named.

**THE PROBE ANSWERED FIVE QUESTIONS. ONE MADE THE FEATURE AFFORDABLE AND ONE
CAUGHT A BUG THAT WOULD HAVE LOST DOCUMENTS SILENTLY.**
`npm run mail:probe-autofile` builds a real attachment, an inline-logo decoy and
the user's own draft, then asks:

| | |
| --- | --- |
| does `Email/changes.created` include the user's OWN drafts? | **yes** |
| does MOVING a message re-create it? | no — `updated`, never `created` |
| does `Email/query` honour `hasAttachment`? | yes |
| **does an inline `cid:` logo set `hasAttachment`?** | **no** |
| **is `after` inclusive, as RFC 8621 says?** | **NO — it is exclusive** |

The first is a trap: an auto-filer keyed on `created` would file somebody's
outgoing work back into the cabinet, forever, in a loop with itself. Hence
`notKeyword: "$draft"` in the filter **and** a second check on the message
metadata — the same belt-and-braces the search slice earned, because a condition
the server accepts and silently ignores looks exactly like one that works.

The fourth is the one that decides whether this feature is cheap or ruinous.
**Every business signature is made of an inline logo.** Had `hasAttachment`
counted them, the sweep would download the entire mailbox to discover there was
nothing to file — not a wrong answer, a bill, per message, forever. It does not,
so the server's own flag already means "a real file".

**THE FIFTH CONTRADICTS THE RFC, AND IT WAS ASKED ONLY BECAUSE THE WATERMARK
LOOKED TOO SIMPLE TO BE WRONG.** RFC 8621 §4.4.1 says a message matches `after`
when its `receivedAt` "must be the same as or after this". Stalwart excludes the
boundary. Since `receivedAt` has second granularity, **two invoices sent together
land in the same second** — so a cursor stored at the last message would step
over its neighbours, and those documents would never be filed, with nothing
anywhere reporting a problem. That is the unrecoverable direction, and it is
exactly the class of bug the search slice named: a filter that is accepted and
behaves *almost* right.

The fix is one second of overlap: the query starts at `cursor - 1s` and the
filing target's sha256 idempotency absorbs the repeat. The probe confirmed both
halves — that the boundary message is excluded at `cursor`, and that it returns
at `cursor - 1s`. The compensation lives in `autofileFilter` rather than in the
stored value, so the column still means what its name says.

**`mail_autofile_rules` (`0057`/`0058`) is the SIXTH per-user table, and its
reason is the opposite shape to the other five.** Rules, snoozes and scheduled
sends are per-user partly because their rows are *meaningless* elsewhere — they
name JMAP ids issued inside one account. These rows would work perfectly well for
a colleague, and that is exactly why they must not be theirs to create. **Filing
publishes one person's private correspondence to the whole business**, which is
why the manual action audits inside its transaction; an automatic version removes
the human who was deciding each time. So the right to say "everything arriving
here goes into the shared cabinet" belongs to the person whose mailbox it is, and
a policy says so rather than a predicate somebody has to remember.

**ALLOWED ON A DELEGATED MAILBOX, unlike Sieve rules — and by the rule the
delegation slice arrived at rather than as an exception.** A Sieve script is
refused on a shared box because its effect is invisible and its record is
private. This one's effect is a document appearing in a shared folder, visible to
everyone and audited per message. `accounts@` filing its own bills is the case
the feature exists for.

**IT RUNS AS `staff`, AND THAT IS NOT A CHOICE.** `requireTenant()` derives
"owner" from Clerk's organization role, which a cron has no session to obtain,
and AGENTS.md forbids claiming a role that did not come from a real context. So
the least-privileged value is the only honest one, and the consequence is real:
**auto-filing can never reach an owners-only folder.** Rather than write a second
rule about visibility, `loadFilingDestinations` asks the question with the
SWEEP'S OWN credentials — it lists folders as `staff`, so RLS removes the
owners-only ones before they arrive, and mail never has to learn what
"owners-only" means. The action re-checks the chosen id the same way, because a
list is a suggestion and the id that arrives is a claim.

**Three refusals that are the security of the feature.**

- **A rule must constrain something.** With neither a folder nor a sender it
  matches every attachment in the mailbox — which is not a filing rule, it is
  "publish my mailbox to my colleagues" reached by leaving two fields blank.
- **A new rule starts its watermark at NOW.** Null would make the first sweep
  walk the whole mailbox and publish years of attachments into a shared folder.
  A rule is a statement about what arrives next.
- **Deleting a rule leaves what it filed.** "Stop filing" and "destroy these
  records" are different intentions and only one was expressed — the same call
  unlinking makes.

**The watermark is a COST control, not a correctness one**, and saying so keeps
the next person from removing it. `fileMessage` is already idempotent on the
sha256 of the raw message, so a message considered twice is filed once — but
that guarantee costs a full download to compute the hash. The cursor is what
stops every sweep re-fetching everything it has ever filed. It advances only over
the prefix actually finished, and one message that fails stops that rule's page
where it is: filing twice is free and skipping loses a document silently.

**A second hand-written composite FK, for the same reason as the first.**
`destination_folder_id` needs `ON DELETE SET NULL (destination_folder_id)` — the
column-list form drizzle-kit cannot emit — because the plain form nulls every key
column including `tenant_id`, which is NOT NULL. Without it **deleting a
Documents folder would fail outright** for any tenant with a rule pointing at it:
tidying the cabinet would start erroring, and the cause would be a mail feature
nobody was thinking about. `mail_links.mail_account_id` (`0046`) was the first to
take this exception; there is now an isolation test asserting the delete
succeeds and the rule degrades to "the Documents inbox".

**A BUG IN THE PREVIOUS SLICE, found while adding a link beside it: the Templates
header link never existed.** It was added with a scripted string replacement that
silently matched nothing, and the check afterwards counted occurrences of the
word rather than reading the file — so the templates manager shipped reachable
only by typing `?templates=1`. The composer's picker was unaffected, which is why
nothing else caught it. Both links are in place now, and the lesson is the boring
one: verify an edit by reading what it produced, not by counting.

Verified: 5 probe confirmations against a live Stalwart 0.16.15 — one of them a
finding that changed the code — 18 new unit tests including a golden test that
the sweep's copy of `filableAttachments` agrees with the filing path's, and 3 new
isolation tests, 120 passing against the dev branch. **Not verified in a browser** — the things to
try are saving a rule with neither a sender nor a folder (it should refuse), and
whether the destination list is empty for a tenant whose folders are all
owners-only.

**Not applied to production**: `0057` and `0058` are on the dev branch only.
`docs/security.md` §8 requires both.

### 2026-08-03 (later still) — Placeholders, and the token the editor can break

Templates were fixed wording. They now leave blanks —
`Hi {{recipient.first_name}},` — filled from what the composer already knows.

**NO PROBE THIS TIME, AND THAT IS A DECISION RATHER THAN AN OMISSION.** Every
slice since Slice 0 has asked the live server first, because protocol behaviour
is where the surprises are. Placeholders touch no protocol: the mail server
never sees a `{{token}}`, because substitution happens in the browser before a
draft exists. Running a JMAP probe here would have been a ritual, not a check.
What needed proving instead was the editor's behaviour, and that is a test.

**A CLOSED VOCABULARY, the same call `compose/formatting.ts` made for colours
and fonts.** If any `{{word}}` were substitutable then a typo would be
indistinguishable from a feature: `{{cusotmer}}` would save happily and reach a
client verbatim, and nobody would find out until they read the sent copy.
Because the set is closed, the save action refuses the typo and lists what is
available — at the one moment somebody is looking at it. The editor lists the
same table, so the thing you can type and the thing that resolves come from one
file.

**FILLED AT INSERT, NOT AT SEND**, and this is the decision the feature turns
on. Carrying `{{recipient.name}}` through to the server would mean somebody
sends a message they have never read in its final form, and a value that failed
to resolve arrives at a customer as literal braces with no one having had a
chance to see it. Filling in the browser puts the result on screen while there
is still a person there. It is the signature editor's rule restated: what is on
screen is what gets sent.

**AN UNRESOLVED PLACEHOLDER IS LEFT AS ITS TOKEN, never blanked.** "Hi ," with a
hole where a name should be reads as a message somebody wrote carelessly — it
sails past the writer and out to the customer. `{{recipient.name}}` in the
middle of a sentence is unmistakable. The composer also says so in a toast, and
inserting a template before choosing a recipient is a normal order to work in
rather than an error.

**THE FAILURE NOBODY WOULD GUESS: the editor can break a token in half.** The
template body is rich text, so bolding part of `{{recipient.name}}` — or a
browser splitting a text node mid-word — stores
`{{recipient.<b>name}}</b>`. It reads perfectly to a human and no regex over
the HTML can match it, so it would survive substitution untouched and go out as
braces. It is detected by comparing the two renderings: **a token present in the
TEXT, where markup has been flattened, but absent from the HTML can only have
been broken up by tags.** That reuses `htmlToPlainText` rather than parsing a
DOM on the server. Ordering matters — an unknown key is reported before a split
one, because a split token is a *valid* key and checking the HTML first would
have produced a nonsense name like `recipient.` in the error message.

**THE SEND GUARD, and the false positive that shaped it.** A body still carrying
an exact member of the vocabulary is a template nobody finished, so
`sendMessageAction` refuses it. Narrow by construction: somebody writing about
`{{mustache}}` syntax or pasting a config file is unaffected, the same
"exact member of the set" test the style sanitizer applies.

But the first version guarded the whole body, and that would have been
infuriating in a case that really happens: **a customer asks "how do I use
`{{recipient.name}}`?", you hit Reply, and the quoted original carries the token
into your message.** The guard would refuse the reply, every time, about
something the writer never wrote, and the only escape would be deleting the
quote. `stripQuotedRegions` removes `<blockquote>` from the rich body and
`>`-prefixed lines from the plain-text one before checking. Over-stripping is
the safe direction — a placeholder inside a quote is text somebody is
deliberately reproducing.

**Values are escaped on the way in.** A recipient's display name is chosen by
whoever emailed us, so `<img src=x onerror=…>` as a name would otherwise inject
markup that then goes out under our user's signature. The outbound sanitizer
would strip it at send, but relying on that would mean the editor showed one
thing and the recipient received another.

**A latent bug fixed on the way, and it is the third of its family.**
`read.ts` picked the identity by matching `session.username`, which on a
delegated shared mailbox is the DELEGATE's address while the identities all
belong to the shared account — so the match never hit and the code reached
`identities[0]` by accident. It happened to be right and would have stopped the
moment a shared box had two identities. Same class as the `selfAddress` and
`selfAddresses()` bugs the delegation slice fixed; all three came from treating
"the token holder" and "the mailbox being acted on" as the same thing.

**What is deliberately NOT here: business-object fields.** An invoice number or
a job reference cannot resolve from the composer's own state — "which invoice?"
is a question only a person can answer — so they need an entity picker in the
insert flow AND a new capability on `MailExtension` to read fields off the
chosen record. `LinkableEntity` carries `label` and `sublabel` for display and
nothing structured, and parsing a formatted sublabel to recover a number is
exactly what this module refuses to do. It is the next slice, and it needs the
closed vocabulary underneath it to be worth building.

Verified: 30 new unit tests. **Not verified in a browser** — the specific things
to try are bolding half a token and confirming the save is refused, inserting a
template with the To field empty, and replying to a message that quotes a
placeholder.

### 2026-08-03 (later) — Business-object placeholders, and the vocabulary Mail does not own

`{{invoice.number}}`, `{{invoice.total}}`, `{{customer.name}}`. The half that
makes templates better than Gmail's rather than equal to them, and the reason
this module sits next to Accounting.

**THE PROBLEM IS THAT MAIL DOES NOT KNOW WHAT AN INVOICE IS**, and must not
learn. The previous slice's load-bearing decision was a CLOSED vocabulary — a
typo has to be refusable at save time — and a closed vocabulary is exactly what
an extension point makes hard, because the set is no longer known at compile
time in one file.

The answer is that **declaring is separated from resolving**. `MailEntityType`
grew `templateFields` (what this type offers, as data) and `templateValues()`
(the values for one record). The editor and the save action need the first with
no record chosen, which is what keeps the set closed and knowable; only the
composer needs the second. Mail composes statics + contributions and still
refuses anything outside the union.

**RECOGNIZE GLOBALLY, OFFER PER TENANT — and this asymmetry is a hole that was
open for about an hour before the test named it.** The obvious reading is that
the vocabulary is "whatever this tenant's enabled modules contribute", and both
the editor and the save action do use that, correctly: offering
`{{invoice.number}}` to a business without Accounting would produce a template
that inserts nothing.

But the SEND GUARD cannot use it. A template written while Accounting was on,
then Accounting switched off, still contains `{{invoice.number}}` — and judged
against the tenant's now-smaller vocabulary that stops being a known
placeholder, so the guard waves through **exactly the message it exists to
catch** and the customer gets literal braces. So the guard asks
`allTemplateContributors()`, which reads the static registry and deliberately
does not consult the database: recognizing a placeholder is a question about
the code, and making it a question about configuration is what opened the hole.
There is a test asserting both halves against the same body.

`isKnownPlaceholder` therefore takes the vocabulary rather than defaulting to
the statics. A default would have been wrong for both callers and invisible at
the call site — and when the signature changed, the compiler listed every place
that had to make the choice, which is the whole argument for not having one.

**THE PICKER IS A SECOND STEP, SHOWN ONLY WHEN IT IS NEEDED.** A template that
names no business-object placeholder still inserts in one click; one that says
`{{invoice.number}}` asks "which invoice?" first, searching through the same
seam the "Attach to…" picker already uses. The step REPLACES the template list
rather than stacking on it — two popovers open at once is how somebody loses
track of what they are answering — and cancelling **inserts unfilled** rather
than abandoning, leaving the tokens visible with the toast naming them. That is
the same state as inserting before typing a recipient, and better than silently
dropping what was asked for.

**Namespacing happens in Mail, not in the extension.** `templateValues` returns
bare keys (`number`) and `entity-actions.ts` prefixes them with the entity type
and **drops anything the type did not DECLARE**. So an extension cannot
contribute a key outside its own namespace — `invoice` can never fill
`{{customer.email}}` — and the list the editor showed cannot drift from the
values that arrive.

**Values are formatted by the extension**, not by Mail: `amount()` is the same
helper the picker's sublabel uses, so a total quoted in an email and a total
shown while choosing the invoice cannot disagree. Mail renders money and dates
it does not understand, and a number formatted twice is a number formatted
wrong.

**THE ISOLATION TEST IS THE POINT OF THE SLICE, not a formality.** These
placeholders paste a business record's fields into a message going OUTSIDE the
business, so "which records can a template read?" needed certifying rather than
asserting. `templateValues` takes the CALLER'S `tx` like every other hook and
applies no visibility predicate of its own — it filters on tenant and id and
nothing else — so RLS reached through that transaction is the entire guard. The
test proves the positive, then that tenant A naming tenant B's invoice id gets
**null**, then that an invented id gets null too: the two are indistinguishable,
so a template cannot be used to discover whether a record exists.

**Accounting implements it TWICE on purpose.** This dossier's own rule — learned
the day three Migadu assumptions turned out to be baked into supposedly shared
code — is that **a seam with one user is a seam that has never been tested.**
Invoice and customer exercise the two shapes that differ: a joined record whose
values are formatted, and a flat one whose values are not. Bill and vendor are
deliberately left; they are the AP mirror and add no new shape.

**Two things the linter and the compiler caught, both previously-learned
lessons re-arriving.** The record search hit React 19's
`react-hooks/set-state-in-effect` — the same rule the contact autocomplete hit —
and the fix is the same one: store results WITH the query that produced them and
derive the empty state at render, which also drops a stale answer without
needing to cancel. And the isolation fixture used `status: "sent"`, which is not
in the invoice enum; the compiler named it before the database could.

Verified: 39 unit tests over the vocabulary and the required-namespace
detection, plus 1 new isolation test — 121 passing against the dev branch. No
migration. **Not verified in a browser** — worth trying a template mixing
`{{recipient.first_name}}` with `{{invoice.total}}`, cancelling the record step,
and saving a template naming an entity type whose module is switched off.

### 2026-08-03 (later still) — The record step remembers, and the tie it refuses to break

A template naming `{{invoice.number}}` asked which invoice every time. On a
reply it now usually does not, because the conversation has already answered.

**THE ANSWER WAS ALREADY IN THE DATABASE.** A thread attached to invoice
INV-1042 through `mail_links` — which somebody did deliberately, and which the
reading pane has shown in its "Attached to" row since Slice 5 — is a statement
about which invoice this conversation is about. Making somebody find the same
invoice again to chase it a fourth time was the feature being tedious rather
than careful. **No new storage**, no new column, and the loader is the reading
pane's own two-step (`listLinksForThread` then `resolveLinks`) rather than a
second way of asking the same question.

**"EXACTLY ONE, OR ASK" — and the tie is the whole decision.** A thread touching
two invoices is not a tie to break silently. Picking the newest, or the first,
would quote a REAL invoice number into a REAL customer's email with nobody
having chosen it, and the result would look exactly like a correct message —
there is no rendering of "we guessed". So more than one falls back to the
picker, which costs a click in the rarer case and is never wrong. Zero is the
ordinary case for a new message and asks too.

**A record filled in without being chosen has to say so.** The toast names it —
"Filled in from Invoice INV-1042" — because unlike the picker path nobody saw
it happen, and the body is on screen to check against. That is the same call the
composer already makes for an unfilled placeholder: say it once, now, rather
than let the recipient discover it.

**`resolveLinks` does the security work, and reusing it is why.** A link whose
entity fails to resolve — deleted, or hidden from this caller by RLS — comes
back with `entity: null`, and those are dropped. A record somebody cannot see
must never become the silent default that fills an invoice number into an
outgoing email, and "restricted" and "gone" stay indistinguishable here as
everywhere else in this module. Writing a fresh query would have meant
reimplementing that, and probably not noticing it was there to reimplement.

Loaded only when a composer is open on an existing message: a new message has no
thread and therefore no answer to inherit.

Verified: 4 new unit tests over the exactly-one rule (43 in the file), full suite
and lint clean. No migration. **Not verified in a browser** — the things to try
are replying on a thread linked to one invoice (should not ask, and should say
what it used), one linked to two (should ask), and a brand-new message.

## Data model

| Table | Purpose | Notes (RLS, invariants, FKs) |
| --- | --- | --- |
| `email_domains` | A tenant's verified **sending** domain | One per tenant, and a domain can only be claimed once platform-wide. `dns_records` jsonb feeds the wizard. **`member_read` only** — a member who could set `status='verified'` could make the app send as a domain they never proved they own |
| `outbound_emails` | The send log | `(tenant_id, idempotency_key)` unique is what makes a retry a no-op. Recipient addresses stored in the CLEAR (see Decisions). **`member_read` only** — a forgeable "delivered" is worse than no log |
| `mailbox_domains` | A domain whose **MX we host** | One per tenant, unique platform-wide. `previous_mx` is the rollback record (see Decisions) and `mx_cutover_at` is stamped at activation — a CHECK forbids `status='active'` without it. **`member_read` only** — a member who could write `status` could assert a cutover that never happened, or erase `previous_mx` |
| `mailboxes` | One real address on a hosted domain | Composite FK `(tenant_id, mailbox_domain_id)` makes hanging a mailbox off another tenant's domain structurally impossible. Unique on `(mailbox_domain_id, local_part)`. **No credential of any kind is stored.** **`member_read` only** |
| `mail_directory_accounts` | **The only table the mail server can read** | Stalwart authenticates against it as `stalwart_directory`, a role with SELECT here and nothing else. Holds addresses and password hashes — no business data — so a compromised mail server leaks a bounded thing. Login unique platform-wide. **`member_read` + a `current_user`-keyed mail-server policy** |
| `mail_accounts` | A person's OAuth connection to a mailbox | Tokens encrypted with a key held in the environment, never in this database. Separate from `mailboxes` on purpose: that table says an address exists, this says someone authorized us to read it. **`member_read` only** |
| `mail_thread_index` | Thin thread index — subject, participants, dates | **Not a mirror.** No bodies, no search index. Exists so a module can ask "every thread on this invoice" as a SQL join instead of N+1 protocol calls. **`member_read` only** |
| `mail_links` | Thread ↔ business entity | **MEMBER WRITABLE** — the deliberate exception. `entity_type` carries no whitelist so a future layer needs no migration. `mail_account_id` (`0045`) is what makes an opaque thread id unambiguous inside a tenant; its composite FK is hand-written in `0046` because it needs `ON DELETE SET NULL (mail_account_id)` — the link must SURVIVE a disconnected mailbox, and the column list is what stops the same rule nulling `tenant_id`. Unique on `(tenant_id, mail_account_id, thread_id, entity_type, entity_id)`, NULLS DISTINCT on purpose |
| `mail_saved_searches` | A named mail view, per person | **PER-USER** (`0048`), the second table scoped on `app.clerk_user_id` — and for a data-model reason before a privacy one: a mail search names a JMAP mailbox id, which only exists inside one account, so it *cannot* be shared the way `document_saved_views` can. The privacy consequence follows anyway: the NAME of a search is correspondence. **MEMBER WRITABLE**, unlike the other per-user mail tables; `WITH CHECK` pins `clerk_user_id` as well as `tenant_id`. `query` is re-parsed with Zod on read and becomes a JMAP filter, never SQL |
| `mail_scheduled_sends` | A message written and held, waiting to go out | **PER-USER** (`0053`/`0054`), the fifth. A REMINDER, not custody: the message is a draft on the mail server and these rows hold ids, an envelope and a time — no body, no attachment, no recipient name, so the module's founding invariant survives. Exists because `mail:probe-send` found the server REFUSES `sendAt` (`invalidProperties`), so a delay cannot be a future-dated JMAP submission. Its `WITH CHECK` carries more weight than any other per-user table's: the sweep runs under `withSystem`, so this policy is the only thing stopping a member queueing mail as a colleague, from their address |
| `mail_annotations` | Extension-contributed metadata per thread | **MEMBER WRITABLE**. One row per extension per thread, so a layer can be reprocessed or removed without touching another's work. `version` (`0045`) is the optimistic-concurrency counter — a reprocess and a user edit genuinely race here, and last-write-wins on jsonb loses one silently |

## Key files & seams

- `src/lib/email/identity.ts` — pure. Decides From/Reply-To. The highest-value
  tests in this area point here.
- `src/lib/email/send.ts` — the seam every caller uses: dev guard, caps,
  idempotency claim, provider call, log row.
- `src/lib/email/domains.ts` — **sending** domain create/verify/read. All writes
  under `withSystem`.
- `src/app/dashboard/email/` — owner-only wizard, send log, and the hosted
  mailbox admin section.
- `src/app/api/email/events/route.ts` — svix-verified delivery webhook.
- First caller: `emailShareAction` in `src/modules/documents/share-actions.ts`.

Hosted mailboxes (`src/lib/email/mailbox/`):

- `types.ts` — the `MailboxHost` interface. Expressed only in terms every mail
  host has, so a Stalwart implementation can satisfy it unchanged.
- `migadu.ts` — the one implementation. Everything Migadu-shaped is confined
  here: Basic auth, booleans-as-strings, and an activation endpoint that is a
  GET which mutates.
- `migadu-parse.ts` — pure response parsing, free of `server-only` so it is
  testable without a network. `normalizeRecords()` and
  `normalizeDiagnostics()` live here; between them they decide what the DNS
  wizard shows and whether a cutover is allowed, which makes them the
  highest-value functions in this directory. Verified against live payloads,
  which are golden fixtures in `tests/mailbox.test.ts`.
- `guard.ts` — what the mailbox path refuses to do outside production. Pure,
  takes the environment explicitly, tested against the Vercel preview trap.

The inbox (`src/lib/email/jmap/`):

- `types.ts` — JMAP object shapes, modelled from RFC 8620/8621. Only the subset
  the inbox reads; typing unused fields invites drift nobody notices.
- `parse.ts` — pure response parsing, free of `server-only`. Two rules run
  through it: never invent data (a missing subject is `""`, not
  "(no subject)"), and never throw (a malformed message parses to null and gets
  skipped, so one bad row costs one row).
- `client.ts` — the protocol. Batches method calls with `#ids`
  back-references so a list view is **one** round trip that queries and fetches
  together; doing it as two is how a JMAP client ends up as slow as the IMAP
  one it replaced.
The extension seam (`src/lib/mail-extensions/`, neutral ground OUTSIDE
`src/modules/` — everything under `src/modules/<slug>/` is a module and subject
to the isolation rule):

- `types.ts` — the contract, and primitive **P5**. Imports NOTHING from
  `src/modules/**`, and must not. Read the header before adding a hook: it says
  which two rules are security rather than style.
- `registry.ts` — the composition root, and the ONLY file that may import
  modules. Exactly what `src/modules/index.ts` is for module renderers.
- `resolve.ts` — enabled-filter, entity-type index, batch resolve, and the
  `Promise.allSettled` + timeout wrapper that keeps one wedged extension from
  taking the reading pane with it.
- `src/modules/documents/mail/extension.ts` — files and folders, plus the
  **filing** capability: `.eml` snapshot + transcript into the DMS Inbox.
- `src/modules/accounting/mail/extension.ts` — invoices, bills, customers,
  vendors.
- `src/modules/email/links.ts` — `mail_links` reads and writes, including the
  two-hop join behind "emails on this invoice".
- `src/modules/email/filing.ts` — the only place in the linking path that speaks
  JMAP; turns a live message into the neutral payload a filing target takes.
Composing (`src/modules/email/compose/`, all pure and free of `server-only`):

- `html.ts` — **`sanitizeOutboundHtml`, the write path's sanitizer.** Read its
  header before widening anything: it explains why this allowlist is far
  stricter than the reading pane's, which is that the read path has a sandbox
  behind it and this one has nothing. The `<blockquote>` styling is EMITTED by
  `transformTags` rather than allowed through, so no caller-supplied CSS ever
  reaches a recipient.
- `to-text.ts` — `htmlToPlainText`, the alternative a person actually reads. Not
  `render/transcript.ts`'s `htmlToText`, which flattens for a tsvector and drops
  hrefs, list numbering and quote depth. The quote depth is the one that matters:
  it is what makes a plain-text reply chain survive four exchanges.
- `formatting.ts` — **the tables**: fonts, sizes, palette, alignments, indent
  steps, and the `ALLOWED_DECLARATIONS` set generated from them. Read by the
  toolbar to build its menus AND by the sanitizer to build its allowlist, which
  is what makes "the toolbar can only emit what the sanitizer accepts" true by
  construction. Adding a swatch is one edit here; a test walks both directions.
- `emoji.ts` — a hand-written table, not a dependency. Emoji needed no sanitizer
  rule at all because they are characters rather than images.
- `link-url.ts` — `normalizeLinkInput`. Pure and separate from the editor so the
  security-relevant half of a client component is testable without a DOM.
- `organise/filters.ts` — the ONE shape used three ways: the URL, the JMAP
  filter and a saved search. Every field in its vocabulary was verified against
  the live server before being offered; `header` is absent because it never
  behaved. Read the folder rule before changing it.
- `scripts/jmap-search-probe.ts` — `npm run mail:probe-search`. Checks each
  condition against a target AND a decoy, because the dangerous outcome is a
  filter that is accepted and ignored. **It also proved the server's full-text
  index is asynchronous**, which is why it settles before asserting — anything
  that files a message and immediately searches for it will intermittently find
  nothing.
- `organise/labels.ts` — **the whole of labels**, pure and with no table behind
  it. A label IS a mailbox; the difference from a folder is the verb. Read the
  header before adding anything: it records why keywords were rejected, and the
  orphan guard is the one genuinely new failure the feature creates.
- `scripts/jmap-labels-probe.ts` — `npm run mail:probe-labels`. Writes, so
  loopback-only. Run it against any new mail server: whether a message may be in
  two mailboxes at once decides whether labels can exist at all.
- `schedule/times.ts` — pure. The offered times, and the bounds the server
  applies to what the browser computed. Rejects rather than clamps, in both
  directions; the header says why each direction matters.
- `schedule/sweep.ts` — releases due messages on the mail-sync cron. **Read its
  header before changing the ordering**: it deletes the row BEFORE submitting,
  which is the opposite of the snooze sweep, because sending twice is the
  failure that cannot be undone.
- `compose/send.ts` — `holdComposedMessage` / `releaseHeldMessage`. The composer
  no longer sends; it holds, and something else decides. The envelope guard runs
  in both, because a scheduled message is released days later by a cron.
- `scripts/jmap-send-probe.ts` — `npm run mail:probe-send`. **Submits**, so
  loopback-only and self-addressed. Run it against any new mail server: whether
  it honours `sendAt` decides what undo and schedule can even be.
- `contacts/rank.ts` — **the ranking**, pure. One rule decides whether the
  recipient box feels clever or stupid: somebody you have written to beats a
  directory entry. Read it before adding a fourth source.
- `contacts/recent.ts` — correspondents from `mail_thread_index`. Per-user by
  RLS; the caller MUST pass `{ userId }` or it returns nothing, which is the
  fail-closed direction.
- `contacts/actions.ts` — fans out across the three sources with
  `Promise.allSettled`, so a slow directory costs its own rows and nothing else.
- `scripts/jmap-contacts-probe.ts` — `npm run mail:probe-contacts`. Read-only
  except against loopback, where it creates one card to learn the real shape.
  Run it against any new server: contacts is a DRAFT with two incompatible
  object models, and picking the wrong one reports an empty address book rather
  than an error.
- `signature/validate.ts` — `prepareSignature`: sanitize, derive the text half,
  and add the RFC 3676 separator. Pure, and asserted idempotent because the form
  re-saves what it loaded. Read its header before relaxing anything: a signature
  is the most-sent markup in the product.
- `signature/load.ts` — picks the identity by the SAME rule `read.ts` uses, and
  that agreement is the point: editing a signature the composer would not choose
  saves successfully and changes nothing anybody can see.
- `inline.ts` — the inline-image rules: types (no SVG), caps, and the
  server-minted Content-ID. Shared by the upload route, the Documents insert
  action, the send action and the sanitizer's caller, so those four cannot
  disagree about what a picture is.
- `src/lib/email/jmap/draft.ts` — **`draftObject`, the request builder**, moved
  out of `client.ts` and free of `server-only` for the same reason `parse.ts`
  is. It decides whether a message is described with the convenience properties
  or an explicit `bodyStructure`; read its comment before changing either. The
  probe imports it, so what goes on the wire is what ships.
- `bodies.ts` — the sanitize-THEN-derive ordering, in a file of its own so a test
  can assert it. Outside `compose-actions.ts` because a `"use server"` module may
  only export async functions.
- `quote.ts` — attribution, quoting and forwarding in both forms, plus
  `openingBodyHtml`. `quoteText` has no caller in the product any more; it is the
  SPECIFICATION the derived text alternative is asserted against.
- `components/rich-text-editor.tsx` — the only client-side piece. Two rules in it
  are security rather than style (paste-as-plain-text, and never handing
  `createLink` raw input); the header says which and why.
- `scripts/jmap-compose-probe.ts` — `npm run mail:probe-compose`. **Writes**, so
  it is loopback-guarded like `mail:fixture`. Run it whenever the composed
  message shape changes; it is what proves the server builds the
  `multipart/alternative` rather than the spec saying it should.

- `src/modules/email/render/transcript.ts` — pure. HTML → searchable text. The
  header explains why hand-rolling a stripper is fine here when hand-rolling a
  *sanitizer* is not.
- `eslint.config.mjs` — the isolation zones. The only thing actually enforcing
  any of the above.

- `scripts/create-mail-role.ts` — `npm run db:create-mail-role`. Creates the
  mail server's Postgres role and then **proves** the boundary: connects as it,
  confirms it can read the directory, and confirms it cannot read `tenants`,
  `documents`, `invoices` or `mail_accounts`. A grant wider than intended fails
  here rather than in production.
- `scripts/migadu-probe.ts` — `npm run mailbox:probe -- <domain>`. Read-only
  (every request a GET), safe against a live domain. Run it whenever a shape
  here is in doubt; it prints the current truth.
- `mx.ts` — pure. Reads and describes a domain's live MX. Testable without a
  database or a network; `describeMxProvider()` is what turns a hostname into
  "Google Workspace" in the warning copy.
- `provisioning.ts` — the four-step flow and both cutover gates.
- `mailboxes.ts` — per-address create/delete plus `reconcileMailboxes()`.
- `src/app/dashboard/email/mailbox-actions.ts` — owner-only server actions.

## Decisions & gotchas

**You cannot fake the From header.** This is the fact the whole design turns
on. Mail claiming to be from `acmebuilders.com` but signed by our keys fails
SPF/DKIM alignment and DMARC rejects it. Sending as someone requires their DNS
to say you may — hence a verification wizard rather than a text field.

**The fallback is deliberately not anonymous.** Before a tenant verifies
anything, mail goes out as `"Acme Builders" <notifications@…>` with `Reply-To`
pointed at the business. That is a long way from `noreply@sometool.com`, and it
means the feature is useful on day one rather than after a DNS chore.

**A subdomain is strongly preferred** (`mail.acme.com`, not `acme.com`). It
keeps this traffic's sending reputation separate from the owner's everyday
email, so a bad send can never poison their personal mail. The UI says so and
warns — but does not block — when a root domain is used.

**Display names are sanitized before they reach a header.** A tenant named
`Acme" <evil@attacker.com>` must not become a second address. There is a test.

**Recipient addresses are stored in the clear, on purpose.** They are the
tenant's own record of their own correspondence, behind RLS, and a send log
that cannot tell you who you sent to is not a send log. They are kept OUT of
the audit log, which is identifiers-only and superadmin-visible — so
`share.emailed` records a recipient *count*, never the addresses.

**The dev guard is not a nicety.** Outside production every recipient is
rewritten to `EMAIL_DEV_REDIRECT` with the real address moved into the subject,
and if that variable is missing, sending refuses outright. Without it the first
person to exercise the share-email flow against a seeded local database mails a
real client, and that is not recoverable.

**Idempotency keys are derived from what the message IS**
(`share:<id>:<recipient>`), never from a timestamp or a random value — that is
what makes a double-click or an action retry a no-op instead of a second email.

**Network work happens after the transaction commits.** The idempotency claim,
the caps and the queued row are one transaction; the provider call is not
inside it. Same house rule as blob ingestion.

**Passcode-protected share links cannot be emailed at all.** A link and its
passcode in one message is one factor and a longer email.

**Bounces are the point of the webhook.** An unnoticed bounce is the most
common way an email workflow dies silently — the sender believes the invoice
went out and nobody finds out until someone chases payment.

**A mailbox is private to one person; linking a thread is an act of publishing.**
Settled with the founder on 2026-07-27, and it decides what `mail_links` means.

The privacy model has two independent layers. Bodies never enter this database
— they stay on the mail server, reachable only with the token that person
authorized themselves, so a colleague has no credential to leak. `mail_accounts`
is then scoped per user in RLS on top of that. Shared mailboxes (`info@`,
`accounts@` — `mailboxes.clerk_user_id is null`) are the deliberate exception,
and the platform operator holding both the encryption key and the mail server is
the honest caveat that applies to every hosted mail product.

That privacy is what creates the problem linking has to solve.
`mail_thread_index` holds **no bodies** on purpose, so a link on its own would
show a colleague opening an invoice only *"a thread called 'Re: quote revision',
these three people, last Tuesday"* — and not one readable word, because the body
still needs the other person's token. A link that cannot be read is not the
feature.

**So linking COPIES the message into the tenant's space rather than pointing at
the mailbox.** At link time the message and its attachments are filed into
Documents — the same "attachments → Documents" loop this dossier has had open
since the hosted-mailbox build — and the link points at that copy. What this
buys, and what the alternative loses:

- It is an **explicit publish**, not a silent widening of who may read somebody's
  private mail. The person doing it knows they are doing it.
- It **survives** the linking user's token expiring, their disconnecting the
  mailbox, or their leaving the business — which is precisely when the
  correspondence behind an invoice is most wanted.
- It needs **no standing credential**. Serving a linked thread through the
  linker's token would mean the app holding an indefinite loan of one person's
  mailbox, and every such read failing the day they revoke it.
- It inherits Documents' RLS, retention, search and audit instead of inventing a
  second visibility model for mail bodies — which would be a second place to be
  wrong about who may read what.

Consequences to build in when Slice 5 lands: the filed copy is a **point-in-time
snapshot** and the UI must say so (a later reply is a new message, not an edit
of the old one); unlinking should leave the filed copy in place with its own
delete, since removing a link is not the same intent as destroying a record; and
the filing action needs an audit entry naming who published what.

### Hosted mailboxes

**Sending is additive; receiving is a takeover.** This is the asymmetry the
whole mailbox design turns on, and the reason `mailbox_domains` is a separate
table from `email_domains` rather than a few more columns. When a sending
domain breaks, notifications stop going out. When an MX cutover breaks, the
business stops *receiving* — orders, RFIs, remittances — and nobody notices for
hours, because a quiet inbox looks exactly like a quiet day.

**`previous_mx` is captured at domain creation, never at cutover.** The moment
the owner publishes new records at their registrar, the old MX answer is gone
from DNS and unrecoverable. Snapshotting at cutover time would already be too
late. The `onConflictDoUpdate` in `createHostedDomain` deliberately does NOT
overwrite it — re-running setup after records are published would otherwise
capture *our own* MX as the thing to roll back to, which is worse than having
no rollback at all because it looks like one.

**Rollback is information, not a button.** Restoring MX means editing the
tenant's registrar, which we have no access to and should not want. What the
app owes them is the exact previous records, on screen, during an outage —
rather than a person trying to remember Google's MX hostnames while their mail
is down.

**Mailboxes are created BEFORE the MX flips.** If mail arrives for an address
the host has never heard of, it does not queue politely — it bounces, and the
sender is told the address does not exist. `mailboxes.ts` therefore works at
`pending`/`dns_ready`, and the cutover panel refuses to look ready while zero
mailboxes exist.

**Two independent sources must agree before a cutover.** The host's own
diagnostics *and* a public DNS lookup. Activating a domain whose MX still
points at Google does not fail loudly — it creates a split where the host
believes it is authoritative and no mail ever arrives, which is the hardest
class of email fault to diagnose.

**Unparseable diagnostics mean NOT ready.** `normalizeDiagnostics()` defaults
every field to false when it cannot understand the payload. The two possible
mistakes are wildly asymmetric: a false "not ready" costs one more click, while
a false "ready" invites someone to redirect a business's entire mail flow on
the strength of a response shape we failed to parse.

**No mailbox credential exists anywhere in this system.** Provisioning uses
Migadu's invitation flow (`password_method: "invitation"`), so the host mails a
setup link and the person chooses their own password. A mailbox password is
strictly more dangerous than an app password — it reads the mail that resets
every other account the business owns. The invitation address is validated to
be *off* the domain being provisioned, or it would be a locked-room puzzle.

**Cutover and mailbox deletion require typing the name out.** Proportionate,
not decorative: the cutover is the only action in the product that cannot be
undone from inside the product, and deleting a mailbox destroys correspondence
at the host.

**Migadu's API has no domain DELETE, on purpose, and neither do we.**
Disconnecting forgets the domain locally and cascades the mailbox rows; the
actual mailboxes stay reachable at the host while the owner sorts out where
their mail should live. Same reasoning that kept the sending-domain teardown
local.

**The mailbox path shipped without an environment guard, and that was a worse
hole than the one `EMAIL_DEV_REDIRECT` was written for.** The send spine has
refused to mail real people outside production since day one; the mailbox code
had nothing equivalent, so a branch preview with credentials could reach a real
mail host and act on a real domain. `guard.ts` closes it with three different
answers, chosen by how recoverable each mistake is:

- **Cutover — refused outside production, no escape hatch.** Redirecting a
  domain's mail from a preview is never legitimate, and undoing it means
  editing DNS at a registrar while the business's mail goes nowhere.
- **Mailbox deletion — refused.** It destroys correspondence at the host.
- **Mailbox creation — allowed, invitation redirected** to
  `EMAIL_DEV_REDIRECT`, refused if unset. Creating a mailbox is reversible;
  mailing a real person a link to claim an address is not. The flow stays
  testable end to end, and only the message to a human is diverted.

Reuses `isLiveSendEnvironment()` rather than reimplementing it: it encodes the
trap that Vercel builds previews with `NODE_ENV=production`, and two copies of
that logic would drift silently.

**Two DNS records where a duplicate is worse than none.** SPF and DMARC both
fail *closed* when a name carries two records — receivers cannot pick the
stricter, so they treat the check as broken rather than applying either. This
bites during setup because a mail host's instructions describe a greenfield
domain:

- **SPF** — one `v=spf1` TXT per name, ever. A second sender means merging
  `include:` terms into the existing record, never adding another.
- **DMARC** — one record at `_dmarc.<domain>`. Migadu's setup page offers
  `p=quarantine`; `yosherapp.com` already carried `p=none`, so that row was
  deliberately skipped. Keep DMARC permissive while mail infrastructure is
  changing and tighten afterwards as its own step, or the first misconfigured
  sender starts landing in spam with no warning. DMARC at the organizational
  domain also covers subdomains unless `sp=` overrides it, so tightening the
  root would have caught `mail.yosherapp.com` — the not-yet-verified Resend
  sending domain — too.

**A subdomain's MX is not the root's MX, and DNS panels hide that.** Every
record for a domain shows in one flat list, so `in.yosherapp.com`'s MX sits
directly beside the root's. Migadu's "remove any pre-existing MX records"
means on the host being configured (`@`). Deleting the subdomain's row instead
would silently kill inbound document filing — no error anywhere, just
drawings that stop arriving.

**Response shapes are only real once a live call proves them.** Both
normalizers in the first build were written from published docs and both were
wrong: `/records` is a keyed object rather than a list, and `/diagnostics`
nests under `checks`. Neither could have been caught by unit tests, because a
normalizer that returns `[]` for an unfamiliar shape looks perfectly healthy
against invented input. Hence `npm run mailbox:probe` and golden fixtures
copied verbatim from a live response. The `/diagnostics` miss is also the
fail-closed rule paying for itself — the wrong guess produced a cutover button
that never unlocked, rather than a redirect performed on a misread reply.

**drizzle-kit emits all FKs before all indexes.** Fine when the referenced
table already exists, fatal when both tables are created in one migration: the
composite FK on `mailboxes` needs the unique index on
`mailbox_domains(tenant_id, id)` to exist first. `0039` is hand-reordered, with
a comment saying so. Expect this again for any future pair of new tables joined
by a composite tenant FK.

## Current state (2026-07-26)

**`yosherapp.com` is live at Migadu** — verification, MX, DKIM and SPF all
published at Vercel DNS, diagnostics green on every check, and the default
`admin@yosherapp.com` (Postmaster) mailbox exists. DMARC deliberately left at
the pre-existing `p=none`; see Decisions.

`MIGADU_ACCOUNT_EMAIL` and `MIGADU_API_KEY` are set locally in `.env`, and go
on **Production only** in Vercel — the guards below make a preview refuse the
dangerous operations anyway, but there is no reason for a branch deployment to
hold live mail-host credentials in the first place.

The adapter has been reconciled against live responses, but **the app's own
flow has not been walked end to end yet** — nothing has gone through
`/dashboard/email` to create a domain row, run a check, or provision a mailbox
through the UI. The parsing is verified; the round trip is not.

**Reading mail inside Yosher works.** On `claude/email-inbox`, verified against a
local Stalwart 0.16.15 end to end: connect a mailbox over OAuth, list folders,
read a message with its body safely rendered, download attachments, and flag or
archive or trash it — with every change landing on the mail server, confirmed by
querying it directly rather than by trusting the UI.

Remote images work too, blocked by default and shown through an SSRF-guarded
proxy so the sender never learns who opened the message.

Sync, the unread badge and background freshness are in as of Slice 4.

**Entity linking is in as of Slice 5**, and it is the reason this module exists
rather than a tab pointed at Gmail: a message can be attached to an invoice, a
bill, a customer, a vendor, a file or a folder; attaching files a readable copy
into Documents; and the invoice's own page shows what was attached. The seam
other modules build on (`src/lib/mail-extensions/`) is live, and module isolation
is enforced by ESLint rather than by discipline.

**Compose, reply, forward and send are in as of Slice 6**, and the token was
proved to carry the submission scope before any of it was designed. Sending is
refused locally until `EMAIL_DEV_REDIRECT` is set — that is the envelope guard,
not a bug.

**Organising is in as of Slice 7**: multi-select with a bulk bar, unread/flagged/
has-files chips, folder creation, and per-user saved views.

**Out-of-office and rules are in**, both executed by the mail server rather than
by us — `vacationresponse` for the first, a compiled Sieve script for the second
— so they fire while nobody is signed in, which is the only time either matters.

**Composing is rich text**, and as of 2026-08-02 the toolbar is complete bar
inline images: bold, italic, underline, strikethrough, text and highlight colour,
font, size, alignment, indent, lists, links, quoting, emoji, undo/redo and a
plain-text mode. Everything goes out as a `multipart/alternative` whose text part
is derived from the HTML rather than typed alongside it, and the MIME the server
assembles has been read back off a live draft (`npm run mail:probe-compose`)
rather than assumed from RFC 8621.

The `style` attribute is open, narrowly: `compose/formatting.ts` enumerates every
declaration the toolbar can produce and the sanitizer accepts nothing else, so
both sides read one file and cannot drift. That is the property to preserve when
adding any further formatting control.

**Inline images are in.** A picture goes in the body from the laptop or from the
tenant's own Documents, through the `src/lib/mail-extensions/` seam. The MIME is
an explicit `multipart/related` because the convenience properties produce
`multipart/mixed`, where a `cid:` reference does not resolve — found by probing
the live server before the feature was designed.

**Signature editing is in.** Written to the mail server's Identity, so it applies
on a phone and in Outlook too; the text half is derived from the HTML; and the
identity's address was proved immutable before the form was built, which is what
stops a signature form becoming a send-as-anyone form.

**Contact autocomplete is in**, from three sources at once: recent
correspondents (per-user, from `mail_thread_index`), the extension registry
(Accounting's customers and vendors today, a CRM later) and the mail server's own
`ContactCard` address book.

**Undo send and schedule send are in**, both as a draft created on the mail
server plus a decision recorded separately — because `mail:probe-send` found this
server refuses `sendAt` outright. An interrupted undo window therefore leaves a
finished message in Drafts rather than losing it.

**Labels are in**, and they needed no table: JMAP's `mailboxIds` is a map, so a
label is a mailbox and the difference from a folder is whether the old
membership is removed. Chips derive from data the list view already had.

**The advanced search builder is in**: from, to, subject, body, a date range and
a folder, on top of the quick search and the chips. Saved searches picked it up
for free, since a saved search was already these parameters written down.

**Real-time push is closed rather than pending** — see
[ADR 0005](../decisions/0005-polling-over-push-for-mail-freshness.md). A socket
needs a process that outlives a request and serverless has none; the staleness
people would actually feel is the cron cadence, which is a plan question.

Delegation (a shared `info@` through somebody's own credentials) and templates
were both built on 2026-08-02/03 — see the build log. What is NOT built yet:
placeholders in templates, and granting delegation from inside Yosher rather
than in the mail server's admin.

Everything so far has been proven against ONE server, ONE account and ONE
message. That is a real limit: no multi-account switching, no thread expansion
(a conversation shows its most recent message), no bulk selection, and token
refresh has never been exercised because the first token has not expired.

**Migadu stays running throughout.** `yosherapp.com` is live on it and there is
no reason to cut a working domain over to an unproven self-hosted server. The
`MailboxHost` interface already accepted `'stalwart'` in its provider CHECK, so
the pivot costs one new adapter rather than a rewrite.

### Sending (unchanged from 2026-07-25)

**Nothing actually sends yet, on purpose.** The spine, the wizard and the send
log are built and deployed, but `mail.yosherapp.com` has not been added to
Resend — that needs a paid plan (the free tier's one domain is already spent on
`in.yosherapp.com` for inbound), and the founder is deliberately waiting until
there is real business to justify it.

So today: creating, copying, revoking and opening share links all work
normally; only "Email link" fails, and it fails at the provider with the reason
recorded in `outbound_emails.error`. Nothing sends automatically, so nothing
breaks unprompted.

`EMAIL_FROM_DOMAIN` is already set in Vercel to `mail.yosherapp.com`, so when
the domain is eventually verified in Resend, sending starts working with no
code or config change.

*[2026-08-07: **something now sends automatically, so this is no longer only a
share-link inconvenience.** The notifications digest runs daily at 7am local per
tenant and attempts a send per person; the first live run failed for both
recipients with "The mail.yosherapp.com domain is not verified", and
`outbound_emails` gained its first two rows ever. Nothing is broken and no code
is waiting — but "nothing breaks unprompted" above has stopped being true, and
every morning now produces failed rows until the domain is verified. See
[notifications.md](notifications.md).]*

## Open items

- **One transport only.** The seam exists but there is a single implementation
  (provider API, tenant domain or platform domain). The strategic next one is
  **send through the tenant's connected Microsoft 365 mailbox** — the message
  is genuinely from them, lands in their Sent folder, and threads properly.
  Graph needs admin consent and no third-party audit. Google needs CASA or
  domain-wide delegation, which is why Microsoft goes first.
- **No HTML templates yet** — messages are plain text. Fine for a share link,
  thin for an invoice.
- **No per-tenant "from" presets** beyond one local part; invoices and share
  links share an address.
- **Domain disconnection leaves the provider-side domain in place**, on
  purpose: deleting it would invalidate anything already sent and re-adding
  would issue different DKIM keys.
- **No bounce-driven suppression list.** A hard bounce is recorded but nothing
  stops a later send to the same address.
- **Verification is manual** — the owner presses "Check DNS". No background
  poller, so a domain that verifies overnight shows as pending until someone
  looks. Applies to hosted domains too.

### Hosted mailboxes

- **No inbox.** The next build: sync, threading, read and reply. Until then a
  hosted mailbox is used over IMAP from a phone or Outlook, and Yosher only
  administers it. This is also where the module earns its keep — an inbox that
  is just a worse Gmail is not worth a tab switch; one where the thread sits
  next to the job, the customer and the invoice is.
- **Migadu keys are not configured**, so nothing provisions yet.
- **No aliases or identities.** `info@` forwarding to three people, and
  send-as for a shared address, both need the alias and identity endpoints —
  wired in the API docs, not in the adapter.
- **`reconcileMailboxes()` reports drift but never repairs it.** Deliberate:
  auto-deleting local rows hides real mailboxes, and auto-creating remote ones
  resurrects addresses somebody removed on purpose. Nothing surfaces it in the
  UI yet, though — it is callable and unreachable.
- **No password-set flow for a Stalwart mailbox, and it blocks the SQL
  directory.** `stalwartHost.afterMailboxCreated` always writes
  `passwordHash: null`, there is no hashing dependency, and no invitation flow
  was ever built — Migadu's host sent those setup links itself and Stalwart has
  no equivalent. So pointing Stalwart's SQL directory at Neon today would
  authenticate against a table where every `password_hash` is null: an account
  nobody can log into. Needs a token/email/form flow plus a hashing choice
  verified against Stalwart's supported list. Until then use Stalwart's internal
  directory (see `docs/runbooks/mail-server.md`).
- **Password hash format is unconfirmed.** `mail_directory_accounts.password_hash`
  holds a PHC string, but the algorithms Stalwart will actually verify have not
  been checked against a running server. Guessing produces an account nobody
  can log into. Confirm before wiring the invitation flow.
- **`npm run db:create-mail-role` has never been run.** It prints a live
  connection string, so it belongs in the operator's terminal, not a transcript.
  Run it when the server exists; it self-verifies the role cannot read tenant
  tables and aborts if it can.
- **Annotations and reading-pane panels are declared but unused.** The registry
  contributes linkable entity types and filing; `mail_annotations` still has no
  writer, and no extension contributes a panel or an action to the reading pane.
  Both are hooks waiting for a first caller — an industry pack extracting drawing
  numbers is the obvious one — and adding them is a change to `types.ts` plus a
  render site, not a change to the model.
- **The picker searches; it does not browse.** Typing finds a record by number or
  name. There is no "recent invoices" list for somebody who cannot remember what
  the thing is called, and no way to create the record you meant to attach to
  from inside the dialog.
- **Filing lands everything in the DMS Inbox.** Deliberate — choosing a folder
  would be guessing at a visibility decision, since folders carry
  `effective_visibility` and the wrong guess either hides the correspondence or
  publishes it wider than intended. But it does mean somebody has to file it
  afterwards, and a busy inbox is where filed emails will pile up.
- **A filed copy has no deep link.** The DMS has no per-document page, so a chip
  points at the folder (or the Inbox) the file lives in rather than at the file.
  Fine today; worth revisiting when Documents grows a detail route.
- **Filing and linking are two transactions.** Blob writes must happen outside a
  transaction (house rule), so the copy commits before the links do. If the
  second write fails, the copy exists unlinked in the Documents inbox — a real
  artifact, not corruption, and the retry is idempotent by content hash. Narrow
  enough to accept; not zero.
- **Idempotency is by content hash, checked twice rather than arbitrated.**
  `documents.blob_pathname` carries a random suffix by design, so there is no
  unique key to conflict on. A genuine double-submit inside the same moment can
  produce two copies. The cost is a duplicate row in an inbox, not a wrong
  answer.
- **Linking is available to any member, and it publishes.** Attaching a thread
  copies somebody's private correspondence somewhere their colleagues can read
  it. That is the point, it is audited, and the person doing it is the person
  whose mailbox it is — but there is no owner-only mode and no way to un-publish
  except deleting the document. Revisit if a client asks.
- **There is no production Stalwart, and that is now the only thing between the
  inbox and a person using it.** `STALWART_BASE_URL` points at a Docker
  container on one laptop. `yosherapp.com`'s mailboxes are at Migadu, which has
  no OAuth — which is why Stalwart was chosen in the first place — so the app
  cannot read them. Eight slices of mail client are waiting on one box.
  **`docs/runbooks/mail-server.md`** is the procedure, and the two things that
  decide whether it works are port-25 egress and the fact that a fresh IP has no
  sending reputation. The answer to the second is to relay outbound through
  Migadu rather than reversing the original evaluation.
- **`EMAIL_DEV_REDIRECT` must be set wherever compose is used outside
  production.** Locally it is now `admin@yosher.test`, the Stalwart mailbox in
  Docker, so a test send round-trips without leaving the machine. **It is not set
  in Vercel Preview**, so compose on a branch deployment will refuse — which is
  the safe direction, and is also the first thing somebody will report as a bug.
- **No folder rename, move or delete in the UI.** `renameMailbox` is on the
  client and `renameFolderAction` refuses role folders, but nothing calls them
  yet — the rail creates and lists, nothing more. Deleting a folder is the one
  worth thinking hardest about: it destroys mail at the host.
- **Saved views cannot be reordered or renamed.** `sort_order` exists on the
  table and is always 0.
- **"Select all" is page-scoped, with no "select all N matching".** The honest
  limitation: doing it properly means an `Email/query` for ids without bodies,
  and a bulk action over thousands of ids that somebody triggered with one
  click deserves a confirmation step that does not exist yet.
- **No drafts UI.** `saveDraft()` exists on the client and nothing calls it —
  closing the composer discards what you typed. Drafts live on the SERVER by
  design (a local table would desync with the same mailbox open in Outlook), so
  this is a surface, not a schema change.
- **One signature per mailbox, not per identity.** The editor writes to the
  identity the composer sends from. A mailbox with several send addresses shows a
  note saying so; a picker is unbuilt, and needs the composer to grow an identity
  chooser first or the two would disagree.
- **No signature images.** A `cid:` is minted per message, so a stored signature
  referencing one would show a broken image on every mail it was pasted into.
  Doing it properly means re-attaching the picture to each message at send time.
- **No "signature off for this message" toggle**, and no per-reply variant.
- **Nothing WRITES to the address book.** Autocomplete reads `ContactCard`; there
  is no "add to contacts" from a message, so the directory only ever grows
  through another client. Recent correspondents cover the common case, which is
  why this has not bitten.
- **No contact groups.** `AddressBook/get` works but `ContactGroup/get` is
  `unknownMethod` on this server, so "email the whole site team" has nothing to
  resolve against.
- **Recent correspondents include people you only ever RECEIVED from**, since
  `mail_thread_index` participants do not record direction. A newsletter sender
  you have never written to can therefore be suggested. Fixing it means storing
  direction at sync time, which is a schema change for a small win.
- **The rich composer has never run in a browser**, and the surface needing it
  grew with the toolbar slice: nine controls became twenty-odd, six of them
  popovers that save and restore a selection. Every pure part is tested and the
  protocol is probed, but `rich-text-editor.tsx` itself is unexercised. First
  thing to look at on a preview deployment, and specifically: a toolbar click
  with text selected (does the selection survive), Quote versus Indent (do they
  render differently in the received message), and the colour picker over a
  selection spanning two blocks.
- **Pasting into the composer loses formatting**, deliberately — paste is
  inserted as plain text so hostile markup cannot enter the document. Keeping it
  would mean shipping a sanitizer to the browser AND trusting it, and the thing
  being pasted is routinely another email. Revisit only with a sanitize-on-paste
  that runs the same allowlist as the server.
- **Inline images are never resized or re-encoded.** A 9 MB photograph straight
  off a phone is sent at 9 MB, with only a `max-width` to keep it from blowing
  out the layout. Downscaling server-side would be the kind thing to do and
  needs a decision about what the sender is entitled to expect back.
- **A deleted inline image's blob stays on the mail server.** The send path
  attaches only the pictures the body still references, so nothing wrong reaches
  the recipient, but the orphaned upload is not cleaned up. The mail server's
  own blob expiry is what collects it.
- **No drag-and-drop or paste of an image into the composer.** Paste is plain
  text by design, and an image on the clipboard is currently dropped silently
  rather than offered — which is the one place that rule reads as a bug.
- **A template can name only ONE business-object type.** The picker asks for the
  first namespace it finds, so a template mixing `{{invoice.number}}` with
  `{{customer.name}}` fills the invoice and leaves the customer tokens visible.
  Asking twice in sequence is the obvious fix and was left out to keep the
  insert flow one question; the send guard still catches what is unfilled.
- **Bill and vendor contribute no placeholder fields**, only invoice and
  customer. They are the AP mirror and add no new shape — the two implemented
  types already prove the seam works for both a joined record and a flat one.
- **A thread attached to TWO invoices still asks.** Deliberate — see the build
  log — but it means the one case where the memory would help most (a long
  dispute touching several invoices) is the one where it does not.
- **The memory only works on a reply.** A new message has no thread, so a
  template naming `{{invoice.number}}` always asks, even when it is the fourth
  chaser you have written today.
- **A placeholder inside a quote is ignored by the send guard.** Deliberate —
  replying to somebody who asked about `{{recipient.name}}` must not be blocked
  — but it does mean a template inserted *below* a quote in a reply would slip
  past the guard. The composer's toast still names it at insert.
- **A template does not appear on a phone or in Outlook.** The first mail
  feature since Slice 0 of which that is true, and it is the accepted price of
  being shareable across the business — see the build log for why no
  mail-server location can hold one. Anyone who works mostly from another client
  gets no benefit from them.
- **Clicking a thread while a settings pane is open leaves the pane up.** The
  header links clear each other, but a row click only sets `message`, so the
  third column keeps showing Templates/Signature/Rules. Pre-existing — templates
  behave exactly like the signature pane here — and it is a papercut rather than
  a bug, but it is the kind that reads as the app ignoring a click.
- **Any member can edit or delete any template**, matching `document_templates`.
  Fine while a tenant is a handful of people who know each other; a business
  with thirty staff would want the author, or an owner, to be the only one who
  can delete.
- **No `justify` alignment**, deliberately: it produces rivers of whitespace on
  the narrow columns mail is read in and is worse for dyslexic readers.
- **Confidential mode has no equivalent and probably never will.** It is
  Google-proprietary — expiry and SMS passcodes served off their own servers —
  rather than anything JMAP describes.
- **A colour palette makes white-on-white text reachable**, and that is accepted
  rather than fixed. It is the sender's own message, and refusing the white
  swatch would be strange in a product where somebody legitimately writes on a
  coloured background.
- **The editor does not warn when the sanitizer will change what you wrote.**
  With paste-as-text and a fixed toolbar the divergence should be nil, but if it
  ever is not, the message simply arrives as less than it looked like.
- **A scheduled send is only as punctual as the cron.** The sweep rides the
  mail-sync schedule, which `vercel.json` sets to every 10 minutes. The account
  is **confirmed off Hobby as of 2026-08-06**, so that schedule is the real one
  rather than the once-a-day Hobby coerced it to. Still unverified against
  actual invocation logs — check that a scheduled send goes out on time before
  relying on it, because this is the failure a client would notice first.
- **Search is not instant after filing.** The server's full-text index is
  asynchronous (found by `mail:probe-search`), so a message just moved or filed
  can be missing from results for a moment. Nothing in the UI says so, and the
  honest fix is probably to say nothing — but it is why a search that "should"
  match sometimes does not.
- **No `header` search**, and no OR/NOT in the builder. Both are available on the
  server; the builder only ever means "all of these".
- **A label cannot be created from the label menu** — only from the folder rail,
  since a label IS a folder. That is honest but it means "label as something
  new" is two steps.
- **No colours on labels**, and JMAP has nowhere to put one. It would need a
  per-user table mapping mailbox id to colour, which is the drift the current
  design avoids entirely.
- **No nested labels in the menu.** Mailboxes have a `parentId` and the menu
  renders a flat sorted list, so a deep folder tree reads as a long list.
- **No list of what is queued.** A scheduled message can be cancelled only by
  finding its draft; there is no "Scheduled" view showing what is waiting, which
  is the obvious next piece.
- **The undo window is client-side.** Closing the tab inside it leaves the
  message in Drafts unsent — recoverable and honest, but it does mean "Sending…"
  can end in a draft rather than a sent message.
- **Send is not idempotent.** A double-submit is guarded only by the disabled
  button — unlike the outbound spine, which derives an idempotency key from what
  the message IS. A composed message has no such natural key, and inventing one
  from a hash of the body would refuse a legitimate "same message, sent twice".
- **Truncation is carried but not yet surfaced.** `JmapEmail.bodyTruncated` is
  populated; the reading pane still needs to render a "message shortened — view
  original" affordance rather than showing a partial body as whole.
- **`0043`, `0044`, `0045` and `0046` have not been applied to production yet.**
  All four are on the dev branch and the isolation suite passes against it.
  `docs/security.md` §8 requires both databases. Run `npm run db:migrate` (no
  flag) against production before deploying this branch — and note it applies
  every pending migration, so run it as a deploy step rather than mid-build.
- **Rules are refused on a shared mailbox**, and this is the one thing
  delegation takes away rather than adds. A Sieve script is a singleton per
  ACCOUNT while `mail_rules` is per-user, so a rule saved against `info@` would
  be recorded privately and act publicly — and the next colleague to publish
  would overwrite it without ever seeing it. Fixing it means moving `mail_rules`
  from per-user to per-mailbox RLS, which is a policy change with its own
  isolation certification. Auto-reply and signature ARE allowed there, labelled
  as shared, because neither has a per-user table to contradict.
- **A read-only grant is parsed but not acted on.** `isReadOnly` is carried
  through from the session and defaults closed, but nothing branches on it yet,
  so a mailbox somebody may only read would offer Archive and Reply and fail at
  the server. `myRights` already covers the per-folder case; this is the
  per-account one.
- **Nobody can grant delegation from inside Yosher.** The access itself is
  granted on the mail server (a Group principal, with the person as a member),
  and `mail_directory_accounts` already carries `account_type: individual |
  group` but nothing writes the membership. Until there is a UI for it, adding
  somebody to `info@` is a manual step in Stalwart's admin.
- **Token refresh has not been exercised.** The stored token is still inside its
  first expiry window, so `needsRefresh` → `refreshAccessToken` has never run
  against the live server. Worth forcing before relying on it.
- **Real-time will be state polling, not push.** JMAP push needs a long-lived
  server-side connection that serverless cannot hold. Comparing the account's
  state string is one small request; an SSE proxy on Vercel's streaming runtime
  is a later optimization, not a prerequisite.
- ~~**The `attachments → Documents` join is wired, but only on demand.**~~
  **CLOSED 2026-08-03.** Built as `mail_autofile_rules` (`0057`/`0058`), and in
  the shape this item predicted: a per-sender/per-folder rule rather than
  "file everything", because filing every attachment anybody receives would
  publish a mailbox rather than a message. See the build log. What follows are
  the things it leaves open.
- **Auto-filing latency is the cron's.** A rule files on whichever tick follows
  the message arriving, so "it appeared in Documents ten minutes later" is the
  expected behaviour rather than a fault. It could not have been faster: Sieve
  cannot call Yosher, which is recorded in the build log and is the same
  constraint ADR 0005 describes from the other end.
- **A rule matches a sender substring and nothing else.** No subject, no
  attachment type, no "only PDFs over 100 KB". The three conditions the search
  builder already proved against a live server (`from`, `subject`, `body`) would
  extend it cheaply; the filter shape is deliberately one flat object so they
  compose without an operator tree.
- **Auto-filing cannot reach an owners-only folder**, and never will while the
  sweep runs from a cron — it has no session, so it cannot prove ownership. The
  destination list simply omits them. A tenant whose Documents tree is entirely
  owners-only can configure no rules at all, which is correct but reads as an
  empty dropdown with no explanation beyond the hint text.
- **Nothing reports what auto-filing did, in the product.** Each filing writes a
  `mail.message_autofiled` audit row and the rule shows a running count and its
  last error, but there is no "here is what got filed this week" view. That is
  the thing a client would ask for first.
- **One hosted domain per tenant.** A client with two trading names needs two,
  and the unique index on `tenant_id` says no.
- **Deliverability for hosted mailboxes is Migadu's**, not ours — which is the
  point — but outbound from a hosted mailbox does not currently relay through
  the `sendEmail()` spine, so it bypasses the send log, the caps and the dev
  guard. Anything the *platform* sends still goes through the spine; this only
  concerns a human sending from their own mailbox.
