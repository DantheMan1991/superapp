# Notifications

> What each person still owes, answered live rather than stored. A daily email
> is the channel; the in-app page is the reference copy. Read this before adding
> anything that "notifies" — the shape here is deliberately not the one most
> products reach for.
> Status: `available` · Scope: `platform` <!-- keep Status on ONE line — /admin/docs parses it -->


## Build log

Newest first. One entry per session/PR that touched this module. Every PR
that changes this module MUST add an entry here (rule in AGENTS.md).

### 2026-09-08 — Livestock joins the digest, fourth (`claude/the-barn-reaches-what-needs-you`)

The second pack source, `livestock-barn` (`src/packs/livestock/attention/source.ts`),
registered below production and above accounting: it reaches everybody like
production's, and its overdue line is a missed round or a clock that needs a
label read — a daily chore, not dated money. Three items, all derived and
all self-clearing: a lot nobody has looked at for two days or more (one line
for the farm, naming up to four lots; yesterday is not raised, because a 7am
digest would raise every lot every day), a withdrawal recorded `none_stated`
until it is corrected, and a withdrawal clearing today or tomorrow. The
arithmetic is pure in `src/packs/livestock/core/attention.ts`; the source
reads only. No new machinery here — the seam took a fifth source without
changing. Details in [livestock.md](livestock.md).

### 2026-09-07 — A verb beside the row (`claude/approve-from-what-needs-you`)

The first one-tap action on What needs you, and the seam it needed. A bill
waiting for approval carried a link to itself; approving it was open, read,
Approve — three taps for a decision the owner makes from the title and the
amount. Now the row carries {Approve} and the bill posts without leaving the
page.

- **`AttentionItem.action?`** (`types.ts`): `{ kind, label, done, args }`. The
  SOURCE decides which items get a verb, and only obligations that need no
  form qualify — "record this payment" needs a date, an account and a method,
  so an overdue invoice stays a link. `args` carries the record's version, the
  CAS the record page would send, so a bill edited after the list was drawn
  is refused rather than approved on stale lines.
- **`AttentionSource.actions?`**: handlers by kind, kinds namespaced by
  module (`bill.approve`). `collectAttention` merges every ANSWERING source's
  map into `AttentionResult.actions`, and the page renders a button only for
  a kind it finds there — a kind with no handler is a plain row, never a
  button that does nothing.
- **A handler MUST be a server action.** The page hands it to a client
  button, and React refuses a plain function at that boundary. So
  `src/modules/accounting/attention/actions.ts` is `"use server"` and its
  `approveBillFromAttentionAction` is `approveBillAction` — the bill page's
  own button — reached from the feed: same gate (owners only, the expert
  refused), same audit row, same period-lock and uncoded-line refusals. No
  new authority anywhere; the seam only moves an existing button.
- **The button sits beside the link, not inside it** (a button inside an
  anchor is invalid HTML and navigates as well as acts). On success the page
  refreshes and the row is simply gone, because it was derived; on refusal
  the server's sentence is the toast and the row stays, because the
  obligation does.
- **The email never renders a verb.** A link is the only verb an email has,
  and the email must not promise a button it cannot draw; `email.ts` reads
  title, detail and href, as before. The digest's delta compares keys, and a
  new optional field on the item changes nothing it compares.

The eslint rule holds: the module's action file imports only `types.ts`; the
page imports `resolve.ts`. Tests: the resolve suite pins that a failed
source's handlers are not offered; the accounting DB case pins the item's
`action` on a bill awaiting approval. Guide `what-needs-you.md` says what the
button does and what an uncoded bill answers.

### 2026-09-06 — Push: the digest's second channel (`claude/mobile-app-2a-push-web`)

The mobile app (ADR 0032) needs a reason to exist beyond the site in a box,
and reviewers cite notifications first. This is the web side; the shell's
plugin follows in the mobile dossier's next slice.

- **One digest, two channels.** After the email, the same person's digest goes
  to every phone they registered, under the same claimed log row — the title
  is `digestSubject`, the body is the business and the first item, the tap
  opens `/dashboard/today`. Nothing is stored that was not stored before; an
  empty, complete digest sends no push (`shouldPush`), because a notification
  exists to prompt action and "nothing needs you" is not one.
- **`push_devices`** (`drizzle/0261`, RLS in `0262`): a phone, keyed by person
  and not tenant, own-rows-only. Registered by `registerPushDeviceAction`
  when the shell hands the page a token; disabled when a provider says the
  token is dead.
- **Two senders behind lazy env** (`push.ts`): APNs over HTTP/2 with an ES256
  provider token, FCM's HTTP v1 with a service-account OAuth token — both
  signed with nothing but `node:crypto`, both tested against generated keys
  (`tests/push-core.test.ts`). Unset, the run counts the phones it could not
  reach and warns once.
- `DigestRunResult` gains `pushed`, `pushFailed`, `pushDisabled`.

### 2026-09-02 — Accounting's third item: a failing recurring template (branch `claude/a-failing-template-is-somebodys-obligation`)

Accounting now contributes a third obligation, still owners only: an ACTIVE,
DUE recurring template whose run failed (`recurring_entries.last_error <> ''`
and `next_run_date <= today`, the sweep's own predicate), dated the period
that was due and was not written — overdue once that day has passed, "today"
on the day — linking to the row on the recurring list by fragment. Nothing in this module changed —
the source is the module's, and the digest and `/dashboard/today` read the same
`collectAttention` — which is the seam doing its job: a module adds a line to
the morning email by answering the question, not by touching the mailer. The
why and the `is_active` reasoning are in
[accounting.md](accounting.md)'s entry of the same date.

### 2026-08-09 — Work joins the digest, second (branch `claude/work-slice-4`)

A fourth source, registered between scheduling and follow-ups. Nothing in this
module changed — which is the point of the seam, and worth one entry to record
that it held.

- **Section order is now scheduling · work · follow-ups · accounting.** Work
  took the place CRM held, on the reason CRM held it: real assignee, real agreed
  date. It has the stronger claim, because closing the item IS the point of the
  record rather than a side effect, and because it spans the whole business
  instead of the part that happens to be a customer conversation.
- **Work's source is the first to deep-link to a record this module has no page
  for.** `AttentionItem.href` has always asked for the record rather than a
  list; Work could only satisfy it because its slice 3 made a single item
  addressable (`?item=`). Worth noting as the shape a future source should
  copy — if a module cannot produce a URL for one row, that is a gap in the
  module, not a licence to link to its index.
- **A blocked item still counts as an obligation**, which is a judgement this
  contract had not been asked to make before. The reasoning is in
  [work.md](work.md); the part that matters here is that a source must not let a
  record's own state silence it, or the digest becomes something people learn to
  distrust one row at a time.
- **`crm_tasks` is scheduled to merge into Work** (work.md slice 5), at which
  point CRM's source is deleted rather than left running beside it. Until then
  the two report different rows and nothing double-counts.

### 2026-08-07 — First live run: the machinery worked, the provider refused

The digest cron fired for the first time at **07:00 America/New_York** (11:00
UTC), hours after slice 2 deployed. Recording it because the outcome splits
cleanly in two, and only one half is a problem.

**What worked, on the first attempt, unprompted.** The cron authorized against
`CRON_SECRET`, enumerated tenants, matched `localHourInTimezone` to the send
hour, reconciled both rosters against Clerk, built two digests, and claimed both
rows in `notification_digest_log`. Every piece of this session's work ran in
production without a nudge.

**What failed: the send, at the provider.**

```
The mail.yosherapp.com domain is not verified.
Please, add and verify your domain on https://resend.com/domains
```

**This is a known, deliberate gap, not a defect** — `email.md` §Sending has
recorded since 2026-07-25 that nothing sends yet because Resend's free tier
allows one domain and it is spent on `in.yosherapp.com` for inbound.
`EMAIL_FROM_DOMAIN` is already set correctly, `mail.yosherapp.com` is reserved
for exactly this in the mail-server runbook, and **verifying the domain is the
only step — no code or config change.**

`outbound_emails` contained exactly two rows at that point, both these digests:
the digest is simply the first feature in the product to attempt an outbound
send, so it is the first to meet a wall that was always there.

Two observations worth keeping:

- **Both digests were empty** (0 items), so nothing of substance was lost — they
  would have been the "nothing needs you today" all-clear.
- **A 7am failure costs the whole day**, and that is inherent to a once-daily
  send rather than to claiming the log row first. The cron only sends when the
  local hour matches, so there is no second attempt before tomorrow. Claim-then-
  send loses nothing here; see the note below.

### 2026-08-07 — Slice 2: the morning email (branch `claude/digest-email`)

The digest itself. One cron for every timezone, an email that leads with what
changed, and a way to turn it off.

- **`/api/cron/digest`, hourly** (`0 * * * *`). Wakes, asks each tenant what
  time it is *there*, sends where it is 7am. `localHourInTimezone` is what makes
  one job serve every zone without stored offsets — see
  [timezone.md](timezone.md). **Its own cron, not mail-sync's fifth passenger**:
  it must run once per person per day against mail-sync's every-10-minutes, and
  it is the heaviest job in the product. This does NOT settle the job-queue
  question — that arrives with the agent runs.
- **It reconciles the roster before acting as anybody**, and SKIPS a tenant
  whose roster Clerk could not confirm rather than falling back to stored roles.
  Prerequisite 1's whole purpose: a stale `owner` would read owners-only folders
  and mail them to somebody since demoted.
- **`notification_preferences`** (`0089`), a table rather than a column —
  see Decisions. Policy scopes read *and* write to the acting person
  (`0090`), so a colleague cannot change your preference and neither can your
  owner.
- **`notification_digest_log`** (`0089`), superadmin-only. Its unique index on
  (tenant, profile, local date) is the idempotency guarantee, and its stored
  item keys are what the delta compares against.
- **29 new tests** — 22 pure over the delta and the email, 7 in the isolation
  suite over the two new tables.

### 2026-08-06 — Slice 1: the seam, two sources, and the page (branch `claude/attention-sources`)

No migrations, no email, no cron. Deliberately: this slice answers "do these
sources produce obligations a person recognises as their own?" before anything
is mailed to anybody.

- **`src/lib/attention-sources/`** — the contract, the composition root and the
  resolver, mirroring `src/lib/mail-extensions/` exactly. eslint enforces the
  dependency graph; the rule was verified by writing a violation and watching it
  fail, not by assuming.
- **Two sources.** CRM contributes follow-ups due within 7 days, scoped to the
  assignee, with unassigned work rolled up to owners and flagged. Accounting
  contributes overdue invoices, bills awaiting approval, and (2026-09-07) bills
  we owe that fall due within a week or are past due, owners only.
- **`/dashboard/today`** — "What needs you", in nav for everyone.
- 11 unit tests over the resolve layer, all on the failure-reporting behaviour.

Both prerequisites landed first: the role mirror (#75) so a cron can act as the
right person, and the tenant timezone (#76/#77) so "due today" means one thing.

## Data model

No tables yet. That is the design, not an omission — see Decisions.

| Table | Purpose | Notes (RLS, invariants, FKs) |
| --- | --- | --- |
| `notification_preferences` | Whether one person wants the digest, in one workspace | Unique on (tenant, profile). **Read and write scoped to the acting person** via `app_current_user()` (`0090`) — not tenant-wide, so an owner cannot change a staff member's. A MISSING ROW MEANS `daily`; the default lives in the read, never a backfill |
| `notification_digest_log` | One row per person per day sent | **Superadmin-only, no member policy at all.** Unique on (tenant, profile, local_date) — that index IS the idempotency guarantee. `item_keys` holds identifiers only (S9); it exists so the delta has something to compare against |
| `push_devices` | A phone that asked to be told, keyed by PERSON | Not tenant-scoped, like `profiles`. Superadmin all; otherwise **your own rows only** via `app_current_user()` (`0262`). `token` unique globally; `disabled_at` when the provider declares it dead. Registered and sent under `withSystem` — see the mobile dossier for why registration must be |
| *(obligations)* | Derived live from each module's own state | Never stored — see Decisions |

## Key files & seams

- `src/lib/attention-sources/types.ts` — the contract. Imports nothing from
  `src/modules/**` and must not.
- `src/lib/attention-sources/registry.ts` — the ONLY file here that may name
  modules. eslint carves it out.
- `src/lib/attention-sources/resolve.ts` — per-source timeout, concurrent
  fan-out, and the failure reporting that makes this different from mail's.
- `src/modules/crm/attention/source.ts`, `src/modules/accounting/attention/source.ts`
- `src/app/dashboard/today/page.tsx` — the reference copy.
- `src/lib/notifications/push-core.ts` (pure: the message, the provider tokens, what an answer means) and `push.ts` (the loop over a person's phones); `src/app/dashboard/push-actions.ts` (registration); `src/components/app/push-registration.tsx` + `src/lib/native-bridge.ts` (the page's side of the shell's bridge).

## Decisions & gotchas

**Derived obligations, not stored events.** Each source answers "what does this
person still owe?" as a live query over its module's state. Paying the invoice
makes the item disappear; there is nothing to mark read and it can never nag
about work already done. The usual events-table-with-`is_read` design cannot
self-clear, so it accumulates and gets muted — and a muted channel is worse than
no channel. If you want something that can be cleared, you want a discrete
EVENT (a document shared with you, a mention), which is a different feature with
its own table, kept separate so it cannot rot the majority.

**Push is a second channel for the digest, not a second product.** The
obvious mobile feature is "notify me when X happens" — an event stream, the
exact design the first decision here rejects. Instead a phone gets what the
email gets, when the email gets it, under the same log row, and the tap opens
the same page. It inherits every property the digest paid for: one number
everywhere, a list that clears itself, silence over duplication. The one
departure is that an empty, complete digest is emailed but not pushed: the
email is a glance, the push is an interruption, and "nothing needs you" does
not earn one.

**A failing source is REPORTED, never folded to zero.** The one place this
knowingly departs from `mail-extensions/resolve.ts`. There, a broken extension
costs its own chips and the inbox still renders. Here, returning `[]` for a
source that threw would tell somebody they owe nothing when they owe seven
things — in a feature whose entire credibility rests on *one number everywhere*.
So `collectAttention` returns `{ items, failed, complete }` and the type forces
every caller to decide what to say. "Nothing needs you today" and "we could not
ask Accounting" must never render the same way.

**`collect` takes the caller's `tx`.** It does not open its own transaction and
never calls `withSystem`. What a source can find is exactly what the person
asking may see — S12 expressed as a function signature. This is also what makes
the digest safe without any per-notification permission model: the same property
that made saved views, reports and automation safe.

**`today` is passed in, not computed per source.** Two sources calling
`todayInTimezone()` a millisecond apart across midnight would disagree, and
every source in one digest must agree on what day it is.

**Ordering is fixed and stable, on purpose.** Overdue, then date, then key. The
design rejects learned or adaptive ranking outright: an order that changes for
reasons the reader cannot predict destroys the trust the channel runs on. Two
runs over unchanged data produce a byte-identical list, which is what the key
tiebreak is for.

**Unassigned work rolls up to owners, and is flagged.** Per-person delivery has
one load-bearing hole — work assigned to nobody is invisible to everybody, and
the more carefully you scope a digest the more complete that invisibility gets.
Owners get it, in a separate section, because "you owe this" and "nobody owes
this yet" are different asks. Staff do not (an instruction nobody gave them);
experts do not (the accountant role can never write).

**A digest is only as good as the assignment data underneath it, and there
wasn't any.** Slices 1 and 2 shipped a per-person digest into a product where
nothing set a task's assignee — the CRM dialog had no picker, so every
follow-up was unassigned and reached owners through the unassigned roll-up
alone. **A staff member's digest was empty by construction**, and no test could
have caught it: every layer was correct, the data simply never exercised the
path. It surfaced the first time somebody added a follow-up in the real app and
watched where it landed. Fixed 2026-08-07 (see [crm.md](crm.md)); the lesson is
that "each person sees their own work" is a claim about the DATA, and worth
checking against real records before building the delivery mechanism on top.

**Accounting reaches owners only, and that is a real limitation.** Invoices and
bills have no assignee column, so there is no per-record answer to "whose job is
this". Role is the only honest scope available. The consequence is that a staff
member's digest carries no accounting items at all in v1 — stated here rather
than hidden, because the alternative (everyone sees every overdue invoice) would
manufacture exactly the untrustworthy noise this design exists to avoid. A
per-record owner on invoices and bills is the fix, and it should be driven by
somebody actually wanting it.

**The preference is a TABLE, not a column on `memberships`, because of `0085`.**
That migration deliberately made owner rows unwritable from tenant context so a
background job could trust `memberships.role`. A preference living there would
have inherited it, and owners could never have switched their own digest off
without a `withSystem` write inside a user-facing server action. Splitting it
out bought both a simpler action and a *stricter* rule: "your own row and
nobody else's" is expressible as a policy, so Postgres enforces it rather than
whichever action remembers to check. This was found by writing the wart first
and then not shipping it.

**The log row is claimed BEFORE the email is sent.** If the claim wins and the
send fails, somebody misses one morning. If the send wins and the claim fails, a
retry mails them twice. Between occasionally-silent and occasionally-duplicated,
silence is the one that does not teach people to ignore the channel.
`outbound_emails.idempotency_key` is a second net under this, but the log is
what lets the cron skip the *work*, not just the send.

**The delta compares against the last digest SENT, not against yesterday.**
Somebody whose Tuesday was empty, or whose Tuesday send failed, should not have
every item described as "new" on Wednesday because a row is missing. "Since the
last time I told you" is the comparison a reader can actually verify.

**A tenant whose roster cannot be confirmed is skipped entirely.** Not
best-effort, not fall back to stored roles. See the build log — this is the
failure prerequisite 1 exists to prevent, and the safe direction is silence.

## Open items

- **BLOCKED ON ONE THING: `mail.yosherapp.com` is not verified in Resend.**
  Every digest will fail at the provider until it is, and it needs a paid plan
  because the free tier's single domain is spent on inbound. **This is a
  billing decision, not an engineering task** — the day the domain is verified,
  digests start arriving with no code or config change. Do not debug this as if
  it were broken; see the 2026-08-07 build-log entry.
- **NOBODY HAS RECEIVED ONE YET**, and will not until the above is resolved. So
  the questions that actually matter are still unanswered: do the items read as
  *yours*, is the delta sentence true, does the subject survive a lock screen?
  Everything below the send is proven; nothing above it is.
- **No retry within the day.** A send that fails at 7am is not reattempted until
  7am tomorrow, because the cron only acts when the local hour matches. Widening
  that to a window ("7–9, if not yet logged") is the obvious fix and has not
  been done — it trades a missed day for the risk of sending at an odd hour.
- `CRON_SECRET` **is** set in Vercel and the route authorizes. Noted because it
  was wrongly assumed missing: the route returns 404 when the secret is absent,
  which is indistinguishable from the route not existing, so the absence of
  evidence looked like evidence. Check `outbound_emails` and
  `notification_digest_log` for proof of a run before concluding anything.
- **The cron-vs-queue question is deferred, not answered.** A dedicated cron is
  right for the digest. It stops being enough when the agent runs land —
  minutes long, resumable — and that is the moment to build a queue, with two
  real consumers to design against rather than one hypothetical.
- **`TENANT_HOURLY_CAP` is 100.** A tenant with more than 100 members would have
  digests silently capped mid-run. Fine now, wrong later, and the failure is
  quiet — `sendEmail` returns `capped` and the run counts it as failed.
- **No Documents source yet.** Unfiled documents were in the original design and
  were cut from v1 to keep the number of judgement calls down before a real
  digest has been read.
- **No snooze.** The design calls for snooze-never-dismiss, borrowing Mail's
  vocabulary. Nothing here implements it; an obligation you cannot defer is one
  people will learn to ignore on the days they genuinely cannot act.
- **Nothing measures whether the counts agree.** "One number everywhere" is
  currently a convention held by both surfaces calling the same function. When
  the email lands there should be a test that renders both from one fixture and
  asserts the totals match.
