# A bill's page

> One bill from draft to paid: the buttons and who sees them, approving, recording and undoing payments, voiding, the history, and the attachments.
> **Route:** /dashboard/m/accounting/purchases/bills/*
> **Order:** 30

## The top of the page

`← Bills` at the top takes you back to the list. The title is the vendor's name. The line under it strings together the vendor's invoice number, the bill date, `due` and the due date, the total, and for an approved bill `640.00 remaining`.

A badge at the right shows the bill's stage: `draft`, `awaiting approval`, `approved`, `partial`, `paid` or `void`. **Partial** means some of it has been paid.

## A draft

While a bill is a draft, the whole form sits on this page and can be edited. It is the same form as **Record a bill**; the button reads **Save changes**. Once a bill is approved there is nothing to edit, and no button for it.

## The buttons and who sees them

- **Suggest coding.** On a draft. Asks the assistant for an account on each line; you see `Coding suggested.` and chips appear on the lines. See **Record a bill** for how to use them. If you ask again within a few seconds: `Suggestions were just requested — try again in a moment.`
- **Submit for approval.** Staff see this on a draft. It hands the bill to an owner: `Submitted for approval.` Owners do not see it, because they approve directly.
- **Return to draft.** On a bill awaiting approval, sends it back: `Returned to draft.`
- **Approve.** Owners only, on a draft or a bill awaiting approval. See below.
- **Void.** Owners only, on an approved, partially paid or paid bill. See below.
- **View entry.** Opens the journal entry the bill posted.

Someone with accountant access sees the same buttons as staff, and each one answers `Accountant access is read-only — reviews, sign-offs and exports only.`

## Approving

**Approve** posts the bill to the ledger: each line to its account, and the total to Accounts Payable. You see `Approved and posted.` and the badge changes to `approved`.

It is refused, with the reason, when:

- `Every line needs an account before approval.`
- `A bill needs at least one line and a total above zero.`
- `That vendor is inactive — reactivate them first.`
- `That date falls in a closed period. Use a reversal, or reopen the period first.` The bill date is in a month that has been closed for this company.

## Possible duplicate

If this vendor has another bill with the same invoice number, or the same total within three days, a notice appears under the strip: `Possible duplicate: this vendor also has INV-4471 (2026-08-14, approved).` It is a warning only. It goes away once the bill is paid.

## Lines

On an approved bill the lines are shown as a plain table, **Description**, **Account** and **Amount**, with the total at the bottom.

## Payments

The **Payments** card appears once a bill is approved. Owners see **Record payment** in its corner while anything is still owed.

**Record payment** opens a dialog: `Posts Dr Accounts Payable / Cr the paid-from account. Remaining: $640.00. Record-keeping only — no money moves.`

- **Amount.** Starts as the full remaining balance. Change it for a part payment.
- **Date.** Today to begin with.
- **Paid from.** The bank or card account the money left. It starts on the first account belonging to this bill's company. If your books hold more than one company, the other companies' accounts are listed too, each marked with its company's name, and choosing one shows a sentence before you go on: `Oak Row LLC is paying this. It will be recorded on both sides: this company owes Oak Row LLC the amount until it is settled.`
- **Method.** `Check` to begin with, or `Bank transfer`, `Card`, `Cash` or `Other`.
- **Memo.** Optional.

Click **Record**. You see `Payment recorded.` The bill's stage changes on its own: `partial` while something is still owed, `paid` when nothing is.

Each payment is listed with its date, method, account, memo and amount. A payment made from another company's account says `· paid by Oak Row LLC`, the same words its journal entry carries.

Refusals you may see: `That's more than the remaining balance.`; `That bill isn't open for payments.`; `That date falls in a closed period. Use a reversal, or reopen the period first.`; `That account is closed. Reopen it from the account page to record anything new — everything already in the books stays either way.`

**Undoing a payment.** Owners see a small undo arrow at the end of each payment. It asks `Unapply this payment? Its ledger entry will be voided.` and then shows `Payment unapplied.` The payment's entry is voided, both sides if another company paid, the bill's stage is worked out again, and a bank transaction matched to it goes back to review. A payment whose bank line has been reconciled cannot be unapplied: `This entry is locked (closed period, reconciled, or strict mode). Create a reversal instead.`

## Voiding

**Void** cancels an approved bill and its ledger entry. It asks `Void this bill? Its ledger entry will be voided too.` and shows `Bill voided.` A bill with payments on it is refused: `Remove the payments first, then void.` A bank transaction that had been matched to the bill goes back to review.

## History

The **History** card lists what has happened to the bill, newest first, with who did it: `Draft created`, `Submitted for approval`, `Approved and posted`, `Sent back to draft`, `Coded by the assistant`, `Created from a document`, `Payment recorded`, `Payment unapplied`, `Voided`, `File attached`, `File detached`. It only appears once something has happened. `The system` is the name given to entries made by a recurring template.

## Attachments

The **Attachments** card lists the documents attached to this bill, each opening the document in the Inbox, with an X to detach. **Attach** opens `Attach a bill or receipt`, `Pick from the Inbox.`, listing the documents waiting to be filed. Click one to attach it: `Document attached.` The document is then filed.

An **Email** card appears when the Mail module is on and an email has been attached to the bill, listing the filed copies: `Filed copies, captured when each email was attached. Later replies are new messages and have to be attached too.`

## What you cannot do here

A draft cannot be deleted, only left as a draft or voided later once approved. An approved bill cannot be edited. There is no reverse; void is the undo. Matching a line to a stock delivery is done from Inventory, and shows here as a greyed line on the draft.
