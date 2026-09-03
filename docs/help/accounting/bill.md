# A bill's page

> One bill from draft to paid: the buttons and who sees them, approving, recording and undoing payments, voiding, the history, and the attachments.
> **Route:** /dashboard/m/accounting/purchases/bills/*
> **Order:** 160
> **Area:** Purchases

Open **Purchases** in the accounting menu and click a vendor's name in the list. Everything that happens to one bill happens here: a staff member submits it, an owner approves it with {button:Approve|primary}, records payments against it, and voids it if it was wrong.

## What you see

- **The top of the page.** `← Bills` takes you back to the list. The title is the vendor's name. The line under it strings together the vendor's invoice number, the bill date, `due` and the due date, the total, and for an approved bill `640.00 remaining`. A badge shows the bill's stage: {badge:draft|outline}, {badge:awaiting approval|secondary}, {badge:approved|primary}, {badge:partial|primary}, {badge:paid|secondary} or {badge:void|outline}. Partial means some of it has been paid.
- **The buttons.** {button:Suggest coding|outline|sparkles} on a draft, for anyone. {button:Submit for approval|primary} on a draft, for staff. {button:Return to draft|outline} on a bill awaiting approval, for anyone. {button:Approve|primary}, owners only, on a draft or a bill awaiting approval. {button:Void|outline}, owners only, on an approved, partially paid or paid bill. {button:View entry|ghost}, which opens the journal entry the bill posted. Owners do not see {button:Submit for approval|primary}, because they approve directly. Someone with accountant access sees the same buttons as staff, and each one answers `Accountant access is read-only — reviews, sign-offs and exports only.`
- **A possible duplicate.** If this vendor has another bill with the same invoice number, or the same total within three days, a notice under the menu reads `Possible duplicate: this vendor also has INV-4471 (2026-08-14, approved).` It is a warning only, and goes away once the bill is paid.
- **The form or the lines.** While a bill is a draft, the whole form sits on this page and can be edited, the same form as [Record a bill](new-bill.md), with {button:Save changes|primary}. On an approved bill the lines are a plain table, `Description`, `Account` and `Amount`, with the total at the bottom. Once a bill is approved there is nothing to edit.
- **`Payments`.** Appears once a bill is approved, with {button:Record payment|outline} in its corner for owners while anything is still owed. Each payment is listed with its date, method, account, memo and amount, and a small {icon:undo} at the end for owners. A payment made from another company's account says `· paid by Oak Row LLC`, the same words its journal entry carries.
- **`History`.** What has happened to the bill, newest first, with who did it: `Draft created`, `Submitted for approval`, `Approved and posted`, `Sent back to draft`, `Coded by the assistant`, `Created from a document`, `Payment recorded`, `Payment unapplied`, `Voided`, `File attached`, `File detached`. It appears once something has happened. `The system` is the name given to entries made by a recurring template.
- **`Attachments`.** The documents attached to this bill, each opening the document in the Inbox, with an {icon:x} to detach. {button:Attach|outline|paperclip} opens `Attach a bill or receipt`, `Pick from the Inbox.`, listing the documents waiting to be filed.
- **`Email`.** When the Mail module is on and an email has been attached to the bill: the filed copies, with the note `Filed copies, captured when each email was attached. Later replies are new messages and have to be attached too.`

## How to approve a bill

1. Check the lines. Every line needs an account. Use {button:Suggest coding|outline|sparkles} if you want the assistant's help, then {button:Save changes|primary}.
2. If you are staff, click {button:Submit for approval|primary}. You see `Submitted for approval.` and an owner takes it from here. {button:Return to draft|outline} sends it back: `Returned to draft.`
3. As an owner, click {button:Approve|primary}. Each line posts to its account and the total to Accounts Payable. You see `Approved and posted.` and the badge changes to {badge:approved|primary}.

## How to record a payment

1. Click {button:Record payment|outline}. The dialog reads `Posts Dr Accounts Payable / Cr the paid-from account. Remaining: $640.00. Record-keeping only — no money moves.`
2. Leave `Amount` as the full remaining balance, or change it for a part payment. Set `Date`, today to begin with.
3. Pick `Paid from`, the bank or card account the money left. It starts on the first account belonging to this bill's company. If your books hold more than one company, the other companies' accounts are listed too, each marked with its company's name, and choosing one shows a sentence first: `Oak Row LLC is paying this. It will be recorded on both sides: this company owes Oak Row LLC the amount until it is settled.`
4. Pick `Method`: `Check` to begin with, or `Bank transfer`, `Card`, `Cash` or `Other`. Add a `Memo` if you want one.
5. Click {button:Record|primary}. You see `Payment recorded.` The bill's stage changes on its own to {badge:partial|primary} while something is still owed, or {badge:paid|secondary}.

## How to undo a payment

1. Click the {icon:undo} at the end of the payment. It asks `Unapply this payment? Its ledger entry will be voided.`
2. Confirm. You see `Payment unapplied.` The payment's entry is voided, both sides if another company paid, the bill's stage is worked out again, and a bank transaction matched to it goes back to review.

## How to void a bill

1. Click {button:Void|outline}. It asks `Void this bill? Its ledger entry will be voided too.`
2. Confirm. You see `Bill voided.` A bank transaction that had been matched to the bill goes back to review.

## How to attach a document

1. Click {button:Attach|outline|paperclip} on the `Attachments` card.
2. Click a document in the list. You see `Document attached.` and the document is filed.

## Messages

| Message | What it means |
| --- | --- |
| `Every line needs an account before approval.` | A line is still uncoded. |
| `A bill needs at least one line and a total above zero.` | The bill is empty or adds up to nothing. |
| `That vendor is inactive — reactivate them first.` | The vendor was deactivated on the Vendors page. |
| `That date falls in a closed period. Use a reversal, or reopen the period first.` | The bill or payment date is in a month that has been closed for this company. |
| `That's more than the remaining balance.` | The payment is larger than what is owed. |
| `That bill isn't open for payments.` | The bill is not approved, or is void or paid. |
| `That account is closed. Reopen it from the account page to record anything new — everything already in the books stays either way.` | The paid-from account was closed in Banking. |
| `This entry is locked (closed period, reconciled, or strict mode). Create a reversal instead.` | The payment's bank line has been reconciled, so it cannot be unapplied. |
| `Remove the payments first, then void.` | A bill with payments on it cannot be voided. |
| `Suggestions were just requested — try again in a moment.` | You asked the assistant twice within a few seconds. |

## Not on this page

A draft cannot be deleted, only left as a draft or voided later once approved. An approved bill cannot be edited. There is no reverse; void is the undo. Matching a line to a stock delivery is done from Inventory, and shows here as a grayed line on the draft.

## Who can do what

Owners approve, record and undo payments, and void. Staff edit drafts, submit for approval, and return a bill to draft. Accountants see the buttons and every one answers with the read-only message.
