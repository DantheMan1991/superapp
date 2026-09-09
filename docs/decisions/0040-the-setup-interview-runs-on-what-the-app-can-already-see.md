# 0040 — The setup interview runs on what the app can already see, and ends in a written plan

- **Date:** 2026-09-09
- **Status:** Accepted
- **Affects:** `src/lib/setup-interview/`, `setup_interviews` (migrations `0283`–`0284`), `/dashboard/setup`, the Getting set up card

## Context

The onboarding plan's last slice: *"the health-check machinery turned inward
— a conversation that produces the plan for THIS business (which packs, what
to load, the start date), opening on 'Is the farm's money in its own
account?'"*

By the time it came to build, six slices had shipped, and each of them
answered part of the same question in its own place. The Getting set up card
(ADR 0033) derives what is MISSING. The Opening page holds the day the books
begin. The personal register handles commingled money. The paste dialogs load
the standing data. So a seventh screen that asked the same things again would
be a fifth path to the same settings and worth building only if it adds
something none of them can.

What none of them can do is ask about the business. The card knows there is no
bank account; it does not know the money is mixed with the owner's, that
nobody has ever tracked what feed cost, that an accountant holds a
depreciation schedule, or that the books should start in January rather than
today. Those are facts a person has and the database does not, and they change
the ORDER and the CONTENT of the work.

## Decision

**A conversation, in the tenant, that runs on a digest of what the app can
already see.** `buildDigest` reads the business's own rows — which tools are
on, whether the start day is set, how many registers and how many of them are
personal, counts of vendors, customers, stock, animals and assets, and what
the Getting set up card is currently asking for — and the system prompt hands
it over with one instruction: never ask for any of this.

That single rule is the whole difference between this and both its neighbours.
Its public cousin, the health check, is talking to a stranger and must ask
everything. A generic setup wizard asks everybody the same questions in the
same order and cannot skip what it can see. This one opens on the question
that changes the most and skips whatever the rows already answer.

**It ends in a written plan, and the plan is the artefact.** Six to ten steps,
each with an act, one sentence on why it matters for THIS business, and a link
to the screen that does it. It is stored, so it is still there tomorrow.

**A step's screen is chosen from a list, by label.** `PLAN_SCREENS` names
every screen a step may point at, and the model copies one; a label that is
not on the list becomes a step with no link rather than a link to nowhere.
The same rule the setup card's static guide slugs already follow.

**It changes nothing by itself.** Answering the questions writes no settings,
and the plan says so on the page. Every step is a screen the owner goes to,
where the existing refusals and confirmations still apply. A conversation that
silently set the day the books begin would be the one place in the product
where a misheard sentence rewrote the ledger's lower bound.

**Owners only, decided in the page and the actions.** The plan is a set of
decisions about the business — when its books begin, whether its money is
mixed, what its accountant holds. Staff carry them out; the owner answers
them. RLS stays tenant-scoped, as it is for every tenant table: the row-level
question is "whose rows are these", and putting the role there as well would
be a second opinion that could drift from the first (ADR 0033's rule).

## Alternatives considered

- **Not building it.** Genuinely considered, and the reason this ADR opens
  with what the other six slices already do. The case for building it is the
  facts the database cannot hold, and the order they change.
- **A wizard with fixed steps.** Cannot skip what it can see, and its
  "questions" would be the setup card's rows with more clicks.
- **Let it set things as it goes** — the day the books begin, the personal
  register. Faster, and it puts a model's reading of a sentence directly into
  the ledger's lower bound. Refused: the confirm step exists everywhere else
  in this product for the same reason.
- **Reuse `interview_sessions`.** The public table is platform-level with a
  superadmin-only policy because an anonymous visitor has no tenant, and it
  carries an IP hash and a promotion path to an audit. Sharing it would mean
  one table where half the rows have a tenant and half do not.
- **Free-form chat with no cap.** The cap is what makes it end in a plan
  rather than in a conversation somebody abandons. Ten turns, wrap by eight.

## Consequences

- Two migrations: `0283` creates `setup_interviews`, `0284` gives it RLS
  (ENABLE + FORCE, superadmin_all, member_all — the pattern every tenant
  table follows).
- One active conversation per tenant, by partial unique index, so two people
  pressing Start produce one conversation rather than two halves of one.
- The digest is counts and flags only — never a balance, a name or an amount
  (S9). What the model needs is whether a thing exists.
- The plan is not re-derived. It is what somebody agreed to on a day, and the
  Getting set up card remains the live answer to what is still missing. The
  two disagreeing is the plan being older, which is honest.
- The interview does not know what it cannot see: if a tool is switched on
  after the plan is written, the plan does not know. Going through it again
  is one button.
