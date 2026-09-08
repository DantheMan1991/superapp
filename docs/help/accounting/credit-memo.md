# A credit memo

> Money taken off what a customer owes on one invoice: issuing a credit from the invoice, what it does to the books, the credit memo's own page, and voiding one.
> **Route:** /dashboard/m/accounting/sales/credit-memos/*
> **Order:** 105
> **Area:** Sales

Open an invoice that is still owed and click {button:Credit|outline}. A credit memo is for a returned item, a price you agreed to drop, or a goodwill gesture: it reduces what the customer owes and the income the invoice recorded, and no money moves. Its own page is reached from the credit row on the invoice.

## How to issue a credit

1. On an issued or part-paid invoice, click {button:Credit|outline}. The dialog is `Credit memo — INV-0009` and reads `Balance due 640.00. The credit comes off what the customer owes, and off the income the invoice recorded. No money moves.`
2. Leave `Amount` as the full balance, or type less for a partial credit. More than the balance is refused with `More than the balance. A credit larger than what is owed is a refund.`, and the button stays gray.
3. Set `Date`, today to begin with. Pick `Comes off`, the income account the credit reverses; it starts on the invoice's first line's account, and narrows as you type a code or a name. Add a `Reason (optional)`, such as `Two bags returned`.
4. Click {button:Issue credit memo|primary}. You see `Credit memo CM-0001 issued`, or `Credit memo CM-0001 issued — INV-0009 is settled` when the credit clears the whole balance. The invoice's stage changes to {badge:partial|primary} or {badge:paid|outline} on its own.

Under `Payments` on the invoice, the credit is a row: `2026-09-03 · credit memo CM-0001 · Two bags returned`, with the amount at the right and no {button:Unapply|outline}. The number opens the credit memo. In the books, one entry posts: the income account on one side and Accounts Receivable on the other, dated the credit's date, in the invoice's company. On the customer's statement the line reads `Credit memo · CM-0001 · Two bags returned` under `Payments`.

## What you see on a credit memo's page

- **The top of the page.** The title is the number, `CM-0001`. The line under it reads `Credit memo · [customer] · against INV-0009 · 40.00`, then `· [reason]`. A button with the invoice's number opens the invoice, {button:Journal entry|outline} opens the entry, and owners see {button:Void|outline} while the memo stands. {badge:void|outline} marks a voided one.
- **The details.** `Customer`, `Against`, the invoice, `Date`, `Amount`, `Comes off`, the income account, `Reason`, `Company` when you keep more than one, and `Status`, {badge:issued|primary} or {badge:void|outline}.

## How to void a credit memo

1. Open the credit memo and click {button:Void|outline}. The dialog is `Void this credit memo?` and reads `Its entry is voided and INV-0009 goes back to owing the credited amount. A credit memo whose entry sits in a closed period cannot be voided.`
2. Click {button:Void credit memo|destructive}. You see `Credit memo voided — INV-0009 owes the amount again`. The credit row leaves the invoice, the invoice's stage changes back, and the number is never reused.

A credit memo cannot be edited. Void it and issue another.

## Messages

| Message | What it means |
| --- | --- |
| `That's more than the remaining balance.` | The credit is larger than what the invoice still owes. Type a smaller amount, or record a refund from Banking instead. |
| `A credit needs an amount above zero.` | The amount box is empty or zero. |
| `Pick the income account the credit comes off.` | The account you picked is not an active income account. |
| `That invoice isn't open for payments.` | The invoice is a draft, paid or void, so there is nothing to credit. |
| `This entry changed since you opened it — reload and try again.` | Somebody recorded a payment or another credit on the invoice while the dialog was open. |
| `That date falls in a closed period. Use a reversal, or reopen the period first.` | The credit's date is in a month that has been closed for this company. |
| `That is a credit memo — void it from its own page.` | Something tried to unapply a credit row as a payment. Open the memo and void it there. |
| `That credit memo has already been voided.` | {button:Void|outline} was pressed on a memo somebody had just voided. |

## Not on this page

A credit memo credits one invoice and one income account, and carries no sales tax and no lines of its own. A credit larger than the balance, a credit held against future invoices, and a refund of money already paid are not built; record a refund as money out from Banking and match it there. Ask us if you need any of these.

## Who can do what

Everyone can open a credit memo. Only owners issue and void them.
