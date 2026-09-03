# A journal entry

> One entry in the ledger: posting a draft, editing, voiding, reversing, deleting, and the entries that must be undone from the invoice or bill they belong to.
> **Route:** /dashboard/m/accounting/journal/*
> **Order:** 210
> **Area:** Journal

Open **Journal** in the accounting menu and click an entry's date or memo. This page shows the entry's lines and, for owners, the buttons for its stage: {button:Post|primary} on a draft, {button:Void|outline} and {button:Reverse|outline} on a posted entry.

## What you see

- **The top of the page.** The title is `Journal entry`. The line under it gives the company when you keep more than one, the date, where the entry came from, and its memo, for example `Maple Street LLC · 2026-06-14 · bank import · SQ *COFFEE`. Badges: {badge:posted|primary}, {badge:draft|secondary} or {badge:void|outline}, and {badge:closed period|outline} when the entry's month has been closed. Owners see {button:Edit|outline} when the entry can still be changed, and the buttons for its stage: {button:Post|primary} and {button:Delete draft|outline} on a draft; {button:Void|outline} and {button:Reverse|outline} on a posted entry. Staff and accountants see the entry with no buttons.
- **A reversal line.** If the entry reverses another, or has been reversed: `Reversal of this entry.` or `Reversed by this entry.`, where `this entry` opens the other one.
- **The lines.** Each with its `Account`, `Debit` or `Credit`, and `Memo`, with any tags, and a `Total` row.
- **`Attachments`.** The documents attached to the entry, each opening the document in the Inbox, and {button:Attach|outline|paperclip}, which opens `Attach a bill or receipt`, `Pick from the Inbox.`

## How to post a draft

1. Click {button:Post|primary}. The dialog is `Post this entry?` and reads `Posting writes it into the books. It will show in reports immediately.`
2. Click {button:Post entry|primary}. You see `Entry posted`.

To drop a draft instead, click {button:Delete draft|outline}. The dialog is `Delete this draft?` and reads `Drafts are not part of the books yet, so deleting is permanent and safe.`

## How to edit a posted entry

1. Click {button:Edit|outline}. The lines open for changing under a warning: `You are editing a posted entry. The change takes effect immediately and the before/after is recorded in the audit log.`
2. Click {button:Save changes|primary}.

Editing is possible while the entry is in an open month, not reconciled, and not reversed.

## How to undo a posted entry

1. To remove the entry's effect and keep it visible for the record, click {button:Void|outline}. The dialog is `Void this entry?` and reads `Voiding removes its effect from every report. The entry stays visible for the record. For entries in a closed or reconciled period, use Reverse instead.` Click {button:Void entry|destructive}. You see `Entry voided`.
2. To undo an entry that is locked, click {button:Reverse|outline}. The dialog is `Reverse this entry?` and reads `Creates an offsetting entry dated today. Both entries stay in the books and cancel each other — the audit-clean way to undo.` Click {button:Create reversal|primary}. You see `Reversal created`.

{button:Reverse|outline} is always offered on a posted entry. It is the way to undo one in a closed month or cleared in a reconciliation.

## Messages

| Message | What it means |
| --- | --- |
| `This entry belongs to an invoice or bill — manage it from that document instead.` | Void the invoice or bill, or unapply the payment, on its own page. Reverse is still allowed here. |
| `This is one half of a transfer between two of your companies. Undo it from the transfer, so both sides move together.` | Neither half of a transfer can be voided or reversed on its own. There is no undo for a transfer on any page yet; record one the other way, or ask us. |
| `This entry is locked (closed period, reconciled, or strict mode). Create a reversal instead.` | The entry is in a closed month, or cleared in a reconciliation. Use {button:Reverse|outline}. |

## Not on this page

An entry that belongs to an invoice, a bill or a payment is undone from that document. A transfer between companies has no undo yet.

## Who can do what

Owners post, edit, void, reverse, delete drafts and attach. Staff and accountants read the entry.
