# A journal entry

> One entry in the ledger: posting a draft, editing, voiding, reversing, deleting, and the entries that must be undone from the invoice or bill they belong to.
> **Route:** /dashboard/m/accounting/journal/*
> **Order:** 210

## The top of the page

The title is **Journal entry** and the line under it gives the company when you keep more than one, the date, where the entry came from, and its memo, for example `Maple Street LLC · 2026-06-14 · bank import · SQ *COFFEE`.

A badge shows `posted`, `draft` or `void`, and `closed period` when the entry's month has been closed. Owners see **Edit** when the entry can still be changed, and the buttons for its stage. Staff and accountants see the entry with no buttons.

If the entry reverses another, or has been reversed, a line says so: `Reversal of this entry.` or `Reversed by this entry.`, where `this entry` opens the other one.

## The lines

Each line shows its **Account**, **Debit** or **Credit**, and **Memo**, with any tags, and a **Total** row.

## A draft

**Post** asks `Post this entry?`: `Posting writes it into the books. It will show in reports immediately.` Click **Post entry**. You see `Entry posted`. **Delete draft** asks `Delete this draft?`: `Drafts are not part of the books yet, so deleting is permanent and safe.`

## A posted entry

**Edit** opens the lines for changing, under a warning: `You are editing a posted entry. The change takes effect immediately and the before/after is recorded in the audit log.` Click **Save changes**. Editing is possible while the entry is in an open month, not reconciled, and not reversed.

**Void** removes the entry's effect from every report and keeps it visible for the record. It asks `Void this entry?`: `Voiding removes its effect from every report. The entry stays visible for the record. For entries in a closed or reconciled period, use Reverse instead.` Click **Void entry**. You see `Entry voided`.

**Reverse** creates an opposite entry dated today, so both stay in the books and cancel out. It asks `Reverse this entry?`: `Creates an offsetting entry dated today. Both entries stay in the books and cancel each other — the audit-clean way to undo.` Click **Create reversal**. You see `Reversal created`. Reverse is always offered on a posted entry; it is the way to undo one that is locked.

## Entries you undo somewhere else

An entry that belongs to an invoice, a bill or a payment cannot be voided here: `This entry belongs to an invoice or bill — manage it from that document instead.` Void the invoice or bill, or unapply the payment, on its own page. Reverse is still allowed.

One half of a transfer between two of your companies cannot be voided or reversed on its own: `This is one half of a transfer between two of your companies. Undo it from the transfer, so both sides move together.`

An entry in a closed month, or cleared in a reconciliation, answers `This entry is locked (closed period, reconciled, or strict mode). Create a reversal instead.`

## Attachments

The **Attachments** card lists the documents attached to the entry, each opening the document in the Inbox. **Attach** opens `Attach a bill or receipt`, `Pick from the Inbox.`
