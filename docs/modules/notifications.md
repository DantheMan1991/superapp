# Notifications

> What each person still owes, answered live rather than stored. A daily email
> is the channel; the in-app page is the reference copy. Read this before adding
> anything that "notifies" — the shape here is deliberately not the one most
> products reach for.
> Status: `available` · Scope: `platform` <!-- keep Status on ONE line — /admin/docs parses it -->


## Build log

Newest first. One entry per session/PR that touched this module. Every PR
that changes this module MUST add an entry here (rule in AGENTS.md).

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
  contributes overdue invoices and bills awaiting approval, owners only.
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

## Decisions & gotchas

**Derived obligations, not stored events.** Each source answers "what does this
person still owe?" as a live query over its module's state. Paying the invoice
makes the item disappear; there is nothing to mark read and it can never nag
about work already done. The usual events-table-with-`is_read` design cannot
self-clear, so it accumulates and gets muted — and a muted channel is worse than
no channel. If you want something that can be cleared, you want a discrete
EVENT (a document shared with you, a mention), which is a different feature with
its own table, kept separate so it cannot rot the majority.

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

- **NOBODY HAS RECEIVED ONE YET.** The whole path is tested but no real digest
  has been sent to a real person, and `EMAIL_DEV_REDIRECT` means nothing leaves
  outside production regardless. The first live 7am is the actual test: whether
  the items read as *yours*, whether the delta sentence is true, whether the
  subject survives a lock screen.
- **`CRON_SECRET` must be set** or the route fails closed and returns 404 —
  deliberately, but it means a missing secret looks exactly like a missing
  route. Check it before concluding the cron is broken.
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
