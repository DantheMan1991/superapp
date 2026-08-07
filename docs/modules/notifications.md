# Notifications

> What each person still owes, answered live rather than stored. A daily email
> is the channel; the in-app page is the reference copy. Read this before adding
> anything that "notifies" — the shape here is deliberately not the one most
> products reach for.
> Status: `available` · Scope: `platform` <!-- keep Status on ONE line — /admin/docs parses it -->


## Build log

Newest first. One entry per session/PR that touched this module. Every PR
that changes this module MUST add an entry here (rule in AGENTS.md).

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
| *(none in slice 1)* | Obligations are derived from each module's own state | Slice 2 adds a per-person-per-day send log and a `daily`/`off` preference on `memberships` |

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

## Open items

- **Slice 2: the email, the cron, the log, the preference.** A dedicated hourly
  `/api/cron/digest` that asks each tenant what time it is locally and sends
  where it is 7am — `localHourInTimezone` exists for exactly this. Plus a
  per-person-per-day send log (which the delta-led email needs anyway to say "2
  new since yesterday"), and a `daily`/`off` preference on `memberships`,
  because a digest that cannot be turned off gets filtered, which is worse.
- **The cron-vs-queue question is deferred, not answered.** A dedicated cron is
  right for the digest. It stops being enough when the agent runs land —
  minutes long, resumable — and that is the moment to build a queue, with two
  real consumers to design against rather than one hypothetical.
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
