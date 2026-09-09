# 0036 — A pasted list is proposed by the model, reviewed by a person, and written by the module's own verb

- **Date:** 2026-09-09
- **Status:** Accepted
- **Affects:** `src/lib/paste-targets/` (a declared extension point), the accounting, inventory and livestock modules as its first fillers, the pages that host the dialog

## Context

A business moving into Yosher has its standing data on paper: forty suppliers
in a spreadsheet, a herd book in a notebook, a shelf list on the back of an
invoice. The onboarding plan ([docs/modules/onboarding.md](../modules/onboarding.md))
calls this the first of its three problems and says most of it "can be pasted
in from a list". Typing it through one form at a time is the overwhelm the
plan exists to remove.

The product already has one AI feature of exactly this shape: the CRM's "From
a note" ([crm/note-actions.ts](../../src/modules/crm/note-actions.ts)) pastes a
note, proposes activities and follow-ups, and saves what a person reviewed.
Its safety property is that the model never writes — the save action takes the
reviewed list and cannot tell which parts were the model's. That shape is the
right one here, and building it once per module would give four copies of it
that drift.

What differs per module is small: which columns a row has, which of them must
be one of the tenant's own things (a parcel, a unit, an existing item), what
counts as "already here", and which function makes one. What is the same is
everything else: the tool the model is called with, the review, the checks,
the transaction, the audit row.

## Decision

**A paste target is data plus the module's own verb.** A module declares, in
`src/lib/paste-targets/types.ts` terms, the FIELDS of a row — text, number,
date, or a choice among labels read live from the tenant — plus `duplicates`,
which names the existing thing a row looks like, and `save`, which is the same
function the module's form calls. The platform builds the model's tool from the
fields, draws the review from the fields, checks a reviewed row against the
fields, and hands each row to `save` inside one transaction. It never learns
what a vendor or an animal is.

**The model never writes.** Proposing and saving are two actions. The first
returns rows for a person to look at; the second takes the rows that person
ticked, as edited, and treats them as ordinary input. A hallucinated animal
cannot reach the herd by any path that does not pass through somebody reading
its row.

**Choices are resolved by label, never guessed.** The model is shown the labels
of a choice field and asked to copy one exactly when the list clearly means it,
or to write the list's own words when none fits. A label that matches nothing
is kept as a hint beside the empty cell — "the list said Back forty" — for the
person to place. There is no nearest-match.

**Duplicates are advisory.** A row that looks like something already here is
unticked and says so. Two customers called Smith are real; the person may tick
it back.

**All rows or none.** A row the module refuses stops the batch and is named:
"Row 7 (Daisy): its dam “Marigold” is not an animal here or in this list."
The review is the place to fix it.

**The module's refusals are the refusals.** A pack that lets only an owner
create a kind of stock refuses staff here, in its own words, and this dialog
does not argue. There is no second permission model.

## Alternatives considered

- **A wizard per module.** Four dialogs, four prompts, four review tables, four
  places for the safety property to be forgotten. Rejected for the reason the
  setup card and the attention digest were made slots (ADRs 0033 and 0007):
  the shell should not know what any module needs, and a module should write
  the part that is its own and nothing else.
- **The model writes, with an undo.** Faster for a clean list; catastrophic for
  a photographed page read wrong, where "undo" means finding forty animals
  among a hundred. The CRM decided this in slice 11 and nothing has changed.
- **A CSV importer with column mapping.** The right tool for a clean export
  and the wrong one for a herd book, a shelf list, or a photo. The model reads
  all three and the person reviews all three the same way. A tenant with a
  clean CSV pastes its columns and gets the same review.
- **Enum-constrained choices.** A JSON-schema enum would guarantee valid values
  and silently turn "Back forty" into null. Keeping the words costs one line of
  resolution and saves the reviewer a guess.
- **Save what it can, report the rest.** Partial success means a second attempt
  must de-duplicate against the first, and a person deciding whether row 12 was
  the one that failed. A refusal that names the row and writes nothing is
  simpler to act on and impossible to double up.

## Consequences

- A fourth-tier module (places, paddocks, prices) adds a paste target as one
  file of fields and a `save` that calls its own verb; the dialog, the model
  call, the review and the audit come for free. The registry names it and the
  page hosts the button.
- The model sees the pasted text, the photo, and the labels of the choices —
  the names of the tenant's parcels, items or animals. Labels are names and
  nothing more, and a target that put a balance in one would be widening that.
- The per-tenant cooldown is in-process, because the platform has no settings
  row to keep it on. It stops a double submit from two tabs on one server and
  nothing more; the dialog's disabled button is the real guard.
- Rows that reached the review before a module changed its choices are checked
  again at save against the choices as they stand, so a parcel renamed between
  the two actions refuses the row rather than saving a stale id.
