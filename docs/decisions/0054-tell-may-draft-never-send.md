# 0054 — Tell may record money, and may never spend it

- **Date:** 2026-09-13
- **Status:** Accepted
- **Amends:** [0039](0039-a-pack-declares-what-it-can-be-told-in-one-sentence.md) — which stands entirely; this adds a rule about what a source may DECLARE, where 0039 governs what the platform does with it. Restates [0050](0050-a-safe-verb-records-itself.md)'s third test rather than changing it.
- **Affects:** every `tell/source.ts`, `TellAction.preview`, `tests/tell-forbidden-verbs.test.ts`

## Context

The founder asked for the box to work with every tool — *"I really want the
talk-to-command feature to be exceptional and used all the time"* — and said he
was comfortable with it doing financial things **given good feedback
verification**, inviting a firm objection if there was one.

Three sources of a possible sixteen are filled ([registry.ts](../../src/lib/tell-sources/registry.ts)
names the queue). Before that queue starts moving, two questions need answering
and **only one of them is about money**.

**The first is where the real line is.** It is tempting to draw it around
"financial", and that is the wrong shape. Recording that $240 of feed was bought
is a claim about the past: wrong, it is corrected, and double-entry is *designed*
for that — a reversing entry is a first-class thing, not an embarrassment.
Sending an invoice to a customer is not a claim about anything. It is an event in
somebody else's inbox, and no confirmation card recalls it.

**The second is what "good feedback verification" actually means.** Today a card
shows the FIELDS the model parsed. For money that is not the thing needing
verification. The most common accounting error is not a mistyped amount, it is
the wrong account — and a card reading `Feed store · $240 · today` looks exactly
as correct whether it is about to hit `5010 Feed` or `6200 Supplies`. The
existing `summary` composes AFTER the write. A receipt is not a verification.

## Decision

### 1. A tell action may RECORD money. It may never MOVE it, and it may never reach a third party.

The test is not "is this financial". It is **can the confirm card undo what this
does**. A card verifies intent before a write; it cannot un-send an email or
un-charge a card. Such a verb fails [0050](0050-a-safe-verb-records-itself.md)'s
second test (*undoable in one step, by them*) so completely that it must not be
**proposable**, never mind recordable.

Permanently out of bounds for any tell source:

- **Sending a message on the tenant's behalf** — `sendInvoiceEmail`,
  `issueAndSendInvoiceAction`, `sendTestReminderAction`, `sendMessageAction`,
  `sendComposedMessage`, `sendDiscoveryMessageAction`, and anything that joins
  them.
- **Moving funds through a payment provider** — any Stripe or Square charge,
  refund, payout or transfer.

**The rule for every ambiguous case: tell it to DRAFT, never to send.** *"Invoice
Acme for twelve hours"* creates a draft invoice and says so on the card. Issuing
and sending stay buttons on a screen, where the person is looking at the document
that is about to leave the building. Almost nothing is lost — the tedious part
was building the invoice, not pressing Send.

**Enforced by a test, not by memory.** `tests/tell-forbidden-verbs.test.ts` reads
every `**/tell/source.ts` and fails on an import from the denied seams. A rule
that lives only in an ADR is a rule that survives exactly as long as the next
person's recollection of it.

### 2. An action that touches the ledger must read back its CONSEQUENCE before it records

`TellAction.preview(tx, ctx, values)` — optional on the contract, **required in
practice for anything that posts** — returns the lines the card shows above
**Record**. For an expense that is the double entry it is about to write:

```
Dr 5010 Feed expense      $240.00
Cr 1010 Checking          $240.00
```

Money is also read back in figures with cents, never bare (`$240.00`, not `240`).
*"Two forty"* is the classic speech-to-text failure and it must be impossible to
misread on the card.

The contract cannot decide for itself whether an action is financial — that is a
fact about what the verb does, which only the module knows, exactly as
[0050](0050-a-safe-verb-records-itself.md) found for safety. So the rule is
written here and checked by the same scan test: a source importing a ledger seam
must declare `preview`.

### 3. Money is never `unattended`

[0050](0050-a-safe-verb-records-itself.md) already says it — *"it moves no
quantity. No head, no stock, no money."* Restated because THIS is the ADR
somebody will be reading when they add an accounting source, and a rule found in
the wrong file is a rule found late.

### 4. The sentence stays the person's own

Everything the model reads here is spoken or typed by the person holding the
phone. The moment a source takes its text from a document, an inbox or a
supplier's PDF, the model is reading **untrusted content**, and a crafted invoice
can propose a payment to a person who is only half-looking. That is a different
feature with a different threat model. It may well be worth building; it must
never be built by quietly widening this one.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| Allow sending, behind a confirm card | The card is exactly as convincing for a wrong answer as a right one, and the failure lands in somebody else's inbox. Confirmation is a control on *intent*, not on *reach*. |
| Keep money out of the box entirely | The product is "the outsourced business office", and *"paid the feed store two hundred forty cash"* is precisely the daily habit it exists to capture. Refusing it would concede the most valuable half of the feature to avoid a risk that a posting preview actually answers. |
| Judge financial-ness centrally, from an action's fields | [0050](0050-a-safe-verb-records-itself.md) rejected the same move for safety and the reasoning is unchanged: inferring it from a schema is how a module quietly acquires a property it never agreed to. |
| A `danger` level per action with a heavier confirm | Confirmation fatigue is real and a second tap makes an email no more recallable. A rule that says *no* is worth more than a rule that says *are you sure*. |
| An Undo window on the toast instead of a preview | Undo is the wrong primitive for a posting, as [0050](0050-a-safe-verb-records-itself.md) found for head and stock: undoing a wrong account means noticing it first, and a plausible-looking wrong account is the one thing nobody notices. |

## Consequences

- **`preview` is a contract addition** — `types.ts`, `shape.ts` and the box.
  Optional, so every existing filler keeps working by saying nothing.
- **The denied list will drift.** It names functions today; as modules grow it
  should name the SEAM (a module path) rather than chase function names, and the
  test should be the thing that is updated, not this file.
- **A person cannot invoice by voice, end to end.** They can build the invoice by
  voice and press one button. That is the cost, stated plainly, and it is the
  cost we chose.
- **An accounting source is now more work than a livestock one** — it owes a
  preview, and the preview has to be right, which means the posting has to be
  resolvable before the write. Some verbs will not be able to do that cheaply,
  and those verbs stay off the list until they can.

## Notes

The generalisable lesson is the shape of the line, not its location:
**reversibility and reach, never subject matter.** A sentence about money that
stays inside the books is safer than a sentence about a note that leaves the
building. Anything added to this box later should be sorted by that question
first and by what it is *about* second.

What would make us revisit: a verb that reaches a third party but is genuinely
recallable within a window the product controls — a queued send that has not
gone out yet is not the same object as a sent one, and if the product ever grows
a real outbox, this ADR should be read again with that in mind.
