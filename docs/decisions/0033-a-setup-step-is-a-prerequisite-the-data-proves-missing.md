# 0033 — A setup step is a prerequisite the data proves missing

- **Date:** 2026-09-08
- **Status:** Accepted
- **Affects:** the Overview (`src/app/dashboard/`), `src/lib/setup-sources/`, and every module or pack that contributes a `setup/source.ts`

## Context

An existing business arriving on the platform has to load a lot before any
tool does anything: a register, kinds of stock and places to keep them,
animals, ground, somewhere to sell, people. The founder's brief for the
onboarding work ([docs/modules/onboarding.md](../modules/onboarding.md)) opens
with the sentence *"someone new to the program is going to feel overwhelmed"*,
and the first thing that reduces overwhelm is a list of what is actually
missing, in the order to do it, that gets shorter as you go.

The obvious design — the one every SaaS ships — is a stored checklist: a table
of steps per tenant with a done flag and a dismiss button. It fails in three
ways that are each worse than having no list:

1. **It says done when the thing is not there.** A step ticked by a click stays
   ticked when the bank account is later deleted, or was never really added.
   The list becomes a second source of truth about whether the business has a
   register, beside the `bank_accounts` table that actually knows.
2. **It needs a dismiss, and dismissed steps accumulate.** Some steps do not
   apply to some businesses, so the design grows a "not for us" button, and
   within a month the list is a graveyard of dismissed rows nobody reads.
3. **It cannot be trusted when it is empty.** Nothing distinguishes "every
   step done" from "the code that computes steps broke".

The platform already settled the same question for obligations on 2026-08-06
([notifications.md](../modules/notifications.md)): *derived, never stored*.
What that decision does not settle is **what qualifies as a step**, because
"derived" alone does not survive contact with a real list. A derived "invite
your team" would be shown to a solo operator forever, with no way out, and the
way out somebody would reach for is the dismiss button — the stored state the
design exists to avoid.

## Decision

A setup step is a **prerequisite**: a thing the enabled module is built around
and this business has none of. It is derived at read time from the module's
own tables, asked as **"has this ever existed here"** rather than "does it
exist now", and it disappears the moment the thing does. Nothing is stored,
nothing can be dismissed, and an ask that cannot be phrased as a prerequisite
is not a step — it is advice, and advice belongs in a guide or in the setup
interview, never on this card.

Each module contributes its own steps through a declared slot
(`src/lib/setup-sources/`, the shape of `attention-sources` with the dates and
the person taken out); the shell knows none of them. A source that fails is
reported, never folded to an empty list. The card is shown to owners on the
Overview and is not rendered at all once nothing remains.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| A stored checklist with done and dismissed flags | A second source of truth that can say done about a thing that is not there; the dismiss pile; an empty state that cannot be told from a broken one |
| Steps as attention items, on What needs you and in the morning digest | An obligation has a date and a person; a step has neither. The digest would email "add your bank account" every morning, to staff who cannot do it, until it was muted — which is the nag the derived design exists to prevent |
| Prerequisites plus nudges ("invite your team", "record your first sale"), with a dismiss for the nudges | The dismiss is the stored state, and a solo operator's dismissed nudge is the same forever-list. Nudges have a home: the setup interview, and the guides |
| "Now" semantics — does a row exist today | A farm that batches broilers through the season has no animals standing all winter and would be told to add some every December. A retired register would bring the first step back |
| Resolving each step's guide link from `docs/help` at request time | The Overview is not traced to include `docs/help` (next.config.ts), so this would add a tracing entry and a directory walk to every load of the first page. A slug declared by the source, checked by a test, costs nothing at runtime |
| One `src/lib` file with every module's query in it | The shell would know what Livestock needs. Each module owns its own definition of "started", the way it owns its own attention source |

## Consequences

What it buys:

- **No migration, no drift, no false "done".** The card is a fold over tables
  the modules already own, and it cannot disagree with them.
- **Its absence can be trusted.** Because a failed source is stated in the
  card's place rather than swallowed, a missing card means set up and nothing
  else.
- **A module adds a step in one file**, `<module>/setup/source.ts`, and the
  eslint rules that keep modules apart apply to it unchanged.
- **The order is a decision, recorded once**, in the registry: money first,
  then the physical world in dependency order, then people, then mail.

What it costs, honestly:

- **A business that retires its only bank account is not asked again.**
  Accepted: the alternative is the December problem above, and Banking's own
  empty state still says `Connect a bank`.
- **There is no room for advice.** "Talk to your accountant before turning
  inventory posting on" is true and important and cannot be a step, because no
  row proves it was done. It belongs in the guide for that screen, where it
  already is.
- **A step must be provable from rows.** A prerequisite that lives outside the
  database — a decision, a conversation — cannot be represented, by design.
- **A dozen `LIMIT 1` queries on every Overview load** for a tenant with every
  pack on, until the card clears. Each is a probe on the tenant index and the
  sources run concurrently behind a four-second guard; measured against the
  page's existing three queries this is not what makes it slow.

## Notes

What would make us revisit: a prerequisite that is genuinely optional for some
legitimate configuration of the same module — an accounting tenant that keeps
books by journal alone and never wants a register, say. If one appears, the
answer is a module **config** the source reads (the tenant declared "no
registers"), not a dismiss flag on the step. The step stays derived; what it
is derived from grows by one column that means something on its own.

The rule that made this survivable was found by asking what a solo farmer
would see forever. Every nudge failed that test and every prerequisite passed
it, which is how "prerequisite, not nudge" became the line rather than a
matter of taste.
