# An invoice's page

> One invoice from draft to paid: issuing, the PDF, emailing it, recording and undoing payments, voiding, reminders, attachments and history, and who sees which buttons.
> **Route:** /dashboard/m/accounting/sales/invoices/*
> **Order:** 90

## The top of the page

The title is the invoice number. The line under it reads `[customer] · issued [date]`, then `· due [date]` and `· [memo]` when they exist.

A badge shows the invoice's stage: `draft`, `issued`, `partial`, `paid` or `void`. **Partial** means some of it has been paid.

## The buttons and who sees them

Owners see the full set. Staff and accountants see **PDF** and **Print** only; the other buttons are not shown.

- **PDF.** Opens the invoice as a PDF in a new tab. Anyone can use it.
- **Send** or **Send again.** Owners, once the invoice is issued. See below.
- **Issue.** Owners, on a draft. See below.
- **Edit.** Owners, on a draft. Opens the invoice form on this page. See **Write an invoice**.
- **Delete.** Owners, on a draft. It asks `Delete this draft?`: `Nothing was posted, so nothing is reversed — but the draft and its lines are gone for good.` Click **Delete draft**. You see `Draft deleted` and land on the list.
- **Record payment.** Owners, once the invoice is issued and until it is paid. See below.
- **Void.** Owners, on an issued invoice with no payments. See below.
- **Print.** Prints the page. A print header carries your business name, the number and dates, and `Bill to:` the customer.

## Issuing

**Issue** asks `Issue INV-0009?`: `This posts it to the books and starts the clock on getting paid. Its lines are frozen from then on.` Click **Issue invoice**. You see `Invoice issued`, the badge changes to `issued`, and the total posts to Accounts Receivable, with any tax to Sales Tax Payable.

Issuing is refused when the invoice has no lines or a total of zero, `An invoice needs at least one line and a total above zero.`, or when the issue date is in a closed month for this company, `That date falls in a closed period. Use a reversal, or reopen the period first.`

## Sending it

**Send** opens **Email this invoice**: `The invoice goes out as a PDF attachment.` After the first send, the button reads **Send again** and the dialog adds `Last sent [date].`

One field, **To**, filled with the customer's email address. Under it: `Sending the same invoice to the same address twice is a no-op, not a second email.` Click **Send**. You see `Invoice sent to [address]`, or `Already sent to [address] — not sent twice`.

What the customer receives: an email from your business's sending address with the subject `Invoice INV-0009 from [your business]`, a short body that names the invoice and the amount owed, its due date, and your memo if there is one, and the invoice attached as `invoice-INV-0009.pdf`. A draft cannot be sent: `Only an issued invoice can be emailed — a draft would go out saying DRAFT, and a void one should not go out at all.` A customer with no email gives `This customer has no email address. Add one, or type an address to send to.`

## The PDF

The PDF is headed **INVOICE**, or **DRAFT INVOICE** for a draft, and a void invoice carries a large **VOID** watermark. It shows your business name, the number, the issue and due dates, a **BILL TO** block with the customer's name, address and email, the lines with **DESCRIPTION**, **QTY**, **RATE** and **AMOUNT**, then **Subtotal** and the tax line when tax is charged, **Total**, **Paid** when anything has been paid, and **Balance due**. Your memo appears under **NOTES**. There is no public link to it; it reaches the customer only as an attachment.

## Recording a payment

**Record payment** opens `Record payment — INV-0009`: `Balance due 640.00. Recording is bookkeeping only — no money moves through Yosher.`

- **Date.** Today to begin with.
- **Amount.** Starts as the full balance. Change it for a part payment.
- **Deposit to.** The bank account the money went into, or **Undeposited Funds** for a cheque or cash you have not banked yet. It starts on the first account belonging to this invoice's company. If your books hold more than one company, the other companies' accounts are listed with the company's name, and choosing one shows a sentence first: `The money is going into Oak Row LLC's account. It will be recorded on both sides: Oak Row LLC owes this company the amount until it is settled.`
- **Method.** One of your payment methods from the catalogue.
- **Memo (optional).** A reference or a note.

Click **Record payment**. You see `Payment recorded`. The stage changes on its own to `partial` while something is still owed, or `paid`.

Refusals: `That's more than the remaining balance.`; `That invoice isn't open for payments.`; `That date falls in a closed period. Use a reversal, or reopen the period first.`; `That payment method is not on this business's list.`

## The payments list

A **Payments** card lists each payment: its date, the method, the account it went into, `· received by Oak Row LLC` when another company's account received it, and the memo, with the amount at the right.

Owners see **Unapply** on each. It asks `Unapply this payment?`: `The deposit entry is voided and the invoice goes back to owing this much. A reconciled deposit cannot be unapplied at all.` Click **Unapply payment**. You see `Payment unapplied`. A payment whose deposit has been reconciled in Banking answers `This entry is locked (closed period, reconciled, or strict mode). Create a reversal instead.`

## Voiding

**Void** is offered on an issued invoice that has no payments. It asks `Void INV-0009?`: `Its ledger effect is removed and the invoice stops counting towards what you are owed. The record stays, so the number is never reused.` Click **Void invoice**. You see `Invoice voided`. An invoice with payments answers `Remove the payments first, then void.`

## The lines

The card lists each line with its **Description**, **Qty**, **Unit price**, **Account** and **Amount**. A small `T` after a description marks a line that carried sales tax. **Subtotal** and the tax line appear when tax was charged, then **Total**, and **Paid** and **Balance due** once anything has been paid.

## Reminders

A **Reminders** card appears once the business has automatic reminders, or once one has been sent for this invoice. Its line says where things stand: `Next reminder on [date].`, `The schedule has finished for this invoice.`, `Automatic reminders are off for the business.`, `This customer is never chased automatically.` or `This invoice is not chased automatically.` Owners can **Mute** this one invoice, and **Resume** it. Each reminder that has gone out is listed with when it was due, the address, the date, and what happened to it, such as `sent` or `bounced`. See the guide **Reminders**.

## Attachments

The **Attachments** card lists the documents attached to this invoice, each opening the document in the Inbox, with an X to detach. **Attach** opens `Attach a bill or receipt`, `Pick from the Inbox.`, listing the documents waiting to be filed. Click one to attach it.

## History

The **History** card lists what has happened, newest first, with who did it: `Draft created`, `Draft edited`, `Issued`, `Emailed to the customer`, `Payment recorded`, `Payment removed`, `Reminders muted`, `Voided`, `File attached`, and so on. It appears once something has happened.

An **Email** card appears when the Mail module is on and an email has been attached, listing the filed copies.

## Drafted from an email

In Mail, **Draft an invoice** on a conversation reads the agreed amounts out of it and opens a draft here, with each line quoting the message it came from. A line whose quote could not be found in the conversation arrives unticked and marked `not found in that message`, so nothing reaches the invoice without someone deciding it should. The lines land on your first income account; change it on the draft.
