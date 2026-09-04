# An invoice's page

> One invoice from draft to paid: issuing, the PDF, emailing it, recording and undoing payments, voiding, reminders, attachments and history, and who sees which buttons.
> **Route:** /dashboard/m/accounting/sales/invoices/*
> **Order:** 100
> **Area:** Sales

Open **Sales** in the accounting menu and click an invoice's number. Everything that happens to one invoice happens here: an owner issues it with {button:Issue|outline}, sends it, records payments against it, and voids it if it was wrong.

## What you see

- **The top of the page.** The title is the invoice number. The line under it reads `[customer] · issued [date]`, then `· due [date]` and `· [memo]` when they exist. A badge shows the invoice's stage: {badge:draft|secondary}, {badge:issued|primary}, {badge:partial|primary}, {badge:paid|outline} or {badge:void|outline}. Partial means some of it has been paid.
- **The buttons.** Owners see the full set. Staff and accountants see {button:PDF|outline} and {button:Print|outline|printer} only. {button:PDF|outline} opens the invoice as a PDF in a new tab. The PDF carries your logo, the name customers know you by, your primary color and your tagline once an owner has set them on [Marketing](/dashboard/m/marketing); until then it shows the business name in black. {button:Send|outline|send}, or {button:Send again|outline|send}, once the invoice is issued. {button:Issue|outline} on a draft. {button:Edit|outline} on a draft, which opens the invoice form on this page. {button:Delete|outline} on a draft. {button:Record payment|outline} once the invoice is issued and until it is paid. {button:Void|outline} on an issued invoice with no payments. {button:Print|outline|printer} prints the page with a header carrying your business name, the number and dates, and `Bill to:` the customer.
- **The lines.** Each with its `Description`, `Qty`, `Unit price`, `Account` and `Amount`. A small `T` after a description marks a line that carried sales tax. `Subtotal` and the tax line appear when tax was charged, then `Total`, and `Paid` and `Balance due` once anything has been paid.
- **`Payments`.** Each payment: its date, the method, the account it went into, `· received by Oak Row LLC` when another company's account received it, and the memo, with the amount at the right. Owners see {button:Unapply|outline} on each.
- **`Reminders`.** Appears once the business has automatic reminders, or once one has been sent for this invoice, with {badge:muted|outline} when this invoice is muted. Its line says where things stand: `Next reminder on [date].`, `The schedule has finished for this invoice.`, `Automatic reminders are off for the business.`, `This customer is never chased automatically.` or `This invoice is not chased automatically.` Each reminder that has gone out is listed with when it was due, the address, the date, and what happened to it, such as `sent` or `bounced`. Owners see {button:Mute|outline} or {button:Resume|outline}. See [Reminders](reminders.md).
- **`Attachments`.** The documents attached to this invoice, each opening the document in the Inbox, with an {icon:x} to detach, and {button:Attach|outline|paperclip}.
- **`History`.** What has happened, newest first, with who did it: `Draft created`, `Draft edited`, `Issued`, `Emailed to the customer`, `Payment recorded`, `Payment removed`, `Reminders muted`, `Voided`, `File attached`, and so on. It appears once something has happened.
- **`Email`.** When the Mail module is on and an email has been attached: the filed copies.

## How to issue an invoice

1. Click {button:Issue|outline}. The dialog is `Issue INV-0009?` and reads `This posts it to the books and starts the clock on getting paid. Its lines are frozen from then on.`
2. Click {button:Issue invoice|primary}. You see `Invoice issued`, the badge changes to {badge:issued|primary}, and the total posts to Accounts Receivable, with any tax to Sales Tax Payable.

## How to send it to the customer

1. Click {button:Send|outline|send}. The dialog is `Email this invoice` and reads `The invoice goes out as a PDF attachment.` After the first send the button reads {button:Send again|outline|send} and the dialog adds `Last sent [date].`
2. Check `To`, filled with the customer's email address. Under it: `Sending the same invoice to the same address twice is a no-op, not a second email.`
3. Click {button:Send|primary}. You see `Invoice sent to [address]`, or `Already sent to [address] — not sent twice`.

The customer receives an email from your business's sending address with the subject `Invoice INV-0009 from [your business]`, a short body naming the invoice, the amount owed, its due date and your memo if there is one, and the invoice attached as `invoice-INV-0009.pdf`. The PDF is headed `INVOICE`, or `DRAFT INVOICE` for a draft, and a void invoice carries a large `VOID` watermark. It shows your business name, the number, the dates, a `BILL TO` block, the lines with `DESCRIPTION`, `QTY`, `RATE` and `AMOUNT`, then `Subtotal`, the tax line, `Total`, `Paid` and `Balance due`, and your memo under `NOTES`. There is no public link to it.

## How to record a payment

1. Click {button:Record payment|outline}. The dialog is `Record payment — INV-0009` and reads `Balance due 640.00. Recording is bookkeeping only — no money moves through Yosher.`
2. Set `Date`, today to begin with. Leave `Amount` as the full balance, or change it for a part payment.
3. Pick `Deposit to`: the bank account the money went into, or `Undeposited Funds` for a check or cash you have not banked yet. It starts on the first account belonging to this invoice's company. If your books hold more than one company, the other companies' accounts are listed with the company's name, and choosing one shows a sentence first: `The money is going into Oak Row LLC's account. It will be recorded on both sides: Oak Row LLC owes this company the amount until it is settled.`
4. Pick `Method`, one of your payment methods from the catalogue, and add a `Memo (optional)`.
5. Click {button:Record payment|primary}. You see `Payment recorded`. The stage changes on its own to {badge:partial|primary} while something is still owed, or {badge:paid|outline}.

## How to undo a payment

1. Click {button:Unapply|outline} on the payment. The dialog is `Unapply this payment?` and reads `The deposit entry is voided and the invoice goes back to owing this much. A reconciled deposit cannot be unapplied at all.`
2. Click {button:Unapply payment|destructive}. You see `Payment unapplied`.

## How to void or delete an invoice

1. On an issued invoice with no payments, click {button:Void|outline}. The dialog is `Void INV-0009?` and reads `Its ledger effect is removed and the invoice stops counting towards what you are owed. The record stays, so the number is never reused.` Click {button:Void invoice|destructive}. You see `Invoice voided`.
2. On a draft, click {button:Delete|outline}. The dialog is `Delete this draft?` and reads `Nothing was posted, so nothing is reversed — but the draft and its lines are gone for good.` Click {button:Delete draft|destructive}. You see `Draft deleted` and land on the list.

## How to stop reminders for this invoice

1. Click {button:Mute|outline} on the `Reminders` card. You see `Reminders muted` and the card shows {badge:muted|outline}.
2. Click {button:Resume|outline} to start them again. You see `Reminders resumed`.

## Messages

| Message | What it means |
| --- | --- |
| `An invoice needs at least one line and a total above zero.` | The invoice is empty or adds up to nothing. |
| `That date falls in a closed period. Use a reversal, or reopen the period first.` | The issue or payment date is in a month that has been closed for this company. |
| `Only an issued invoice can be emailed — a draft would go out saying DRAFT, and a void one should not go out at all.` | Issue the invoice first. |
| `This customer has no email address. Add one, or type an address to send to.` | The customer record has no email. Type one in `To`, or add it on the Customers page. |
| `That's more than the remaining balance.` | The payment is larger than what is owed. |
| `That invoice isn't open for payments.` | The invoice is a draft, void or paid. |
| `That payment method is not on this business's list.` | The method was deactivated in the catalogue. |
| `This entry is locked (closed period, reconciled, or strict mode). Create a reversal instead.` | The payment's deposit has been reconciled in Banking, so it cannot be unapplied. |
| `Remove the payments first, then void.` | An invoice with payments on it cannot be voided. |

## Not on this page

An issued invoice cannot be edited; void it and write another. There is no public link to the PDF; it reaches the customer only as an attachment. An invoice drafted from an email conversation in Mail arrives here as a draft with each line quoting the message it came from; a line whose quote could not be found arrives unchecked and marked `not found in that message`, and the lines land on your first income account until you change them.

## Who can do what

Owners issue, send, edit and delete drafts, record and undo payments, void, and mute reminders. Staff and accountants see {button:PDF|outline} and {button:Print|outline|printer} only.
