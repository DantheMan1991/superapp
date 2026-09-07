# Deposits

> Payments you recorded into Undeposited Funds, banked as one deposit at a time: the list, recording a deposit, a deposit's page, and voiding one.
> **Route:** /dashboard/m/accounting/banking/deposits/**
> **Order:** 25
> **Area:** Banking

Open **Banking** in the accounting menu and click {button:Deposits|outline|piggy-bank}. When a customer pays and you record the payment into `Undeposited Funds` rather than a bank account, the money is in the drawer, not the bank. When the cheques go to the bank together, the statement shows one line for their total. A deposit is that line: it moves the payments' sum from Undeposited Funds into the account in one entry, and the bank's line matches that entry.

## What you see

- **The top of the page.** The title is `Deposits` and the line under it reads `Payments held in Undeposited Funds, banked as one line at a time.` Owners see {button:New deposit|primary}.
- **What is waiting.** When anything is in Undeposited Funds, a line above the list reads `1,240.00 waiting in Undeposited Funds · 3 payments not yet banked.` with {button:Record deposit|outline} for owners. The same line is on the Banking page.
- **The list.** Newest first, fifty to a page. Click anywhere on a row to open the deposit. `Date`. `Account`, the bank account the money went into. `Company`, only when you keep more than one. `Memo`. `Payments`, how many the deposit banked. `Total`. `Status`: {badge:posted|primary} or {badge:void|outline}.
- **Pages.** When there are more than fifty deposits, `Showing 1–50 of 120 deposits` sits under the list with {button:Newer|outline} and {button:Older|outline}.

## How to record a deposit

1. Click {button:New deposit|primary} here, {button:Record deposit|outline} on the Banking page, or `Record a deposit` under the `Not deposited` tile on the Invoices page. The page is `New deposit` and reads `Pick the payments that went to the bank together, and the account they went into.`
2. If you keep more than one company, pick it in the pills under the menu. A deposit takes one company's payments into that company's account.
3. Pick `Deposit to`: one of the company's open checking or savings accounts. Set `Date`, today to begin with: the day the money reached the bank. Add a `Memo (optional)`; left empty, the entry is named `Deposit — 3 payments`, or `Deposit — [customer]` for a single payment.
4. Every payment waiting is listed and already ticked: the customer and invoice number, then the date, the method and the payment's memo, with the amount at the right. Untick any that stayed behind; its amount is struck through. The box on the first row ticks or unticks them all, and reads `All 3 payments` or `2 of 3 payments`.
5. Under the list: `Depositing 1,240.00 into Farm Checking. One entry posts, and the bank's line for it matches that entry.` Click {button:Record deposit|primary}. You see `Deposited 1,240.00 into Farm Checking — match the bank's line when it arrives`, and the deposit's page opens.

The entry is `Dr` the bank account and `Cr` Undeposited Funds, dated the deposit date, in the account's company. On each invoice, the payment now reads `deposited [date]` in place of {button:Unapply|outline}. When the bank feed shows the deposit, open the account's transactions and click {button:Match|outline}: the deposit is offered as `Deposit — 3 payments`. See [An account's transactions](register.md).

## A deposit's page

Click a row on the list. The title is `Deposit` and the line under it reads `1,240.00 into Farm Checking on 2026-09-05`, then the company when you keep more than one, and the memo. Buttons: {button:Journal entry|outline} opens the entry; a button with the account's name opens its transactions; owners see {button:Void|outline} on a posted deposit. {badge:void|outline} marks a voided one, and the line `This deposit was voided. Its entry is void and these payments went back to Undeposited Funds, where they can be deposited again.` The table lists each payment: `Date`, `Customer`, `Invoice`, which opens the invoice, `Method`, `Memo` and `Amount`, with `Total` under them.

## How to void a deposit

1. Open the deposit and click {button:Void|outline}. The dialog is `Void this deposit?` and reads `Its entry is voided and the payments go back to waiting in Undeposited Funds, so they can be deposited again. A deposit whose entry has been reconciled cannot be voided.`
2. Click {button:Void deposit|destructive}. You see `Deposit voided — the payments are back in Undeposited Funds`. A bank transaction that was matched to the deposit goes back to `To review`.

A voided deposit stays on the list and cannot be used again; record a new deposit for the payments. To undo one payment, void the deposit, unapply the payment on its invoice, and deposit the rest again.

## Messages

| Message | What it means |
| --- | --- |
| `No deposits yet` and `When a payment is recorded into Undeposited Funds, bank it here with the others that went in on the same slip.` | Nothing has been deposited. {button:New deposit|primary} sits in the box once something is waiting. |
| `Nothing is waiting to be deposited` and `A payment recorded into Undeposited Funds appears here until it is banked. One recorded straight into a bank account needs no deposit.` | The company has nothing in Undeposited Funds. |
| `No bank account to deposit into` and `This company has no open checking or savings account. Add one on Banking, then come back.` | The company has payments waiting but no account to bank them into. |
| `Owners record deposits` and `Ask the business owner to bank these payments.` | You are staff or an accountant on the New deposit page. |
| `Pick at least one payment to deposit.` | Every box was unticked. |
| `One of those payments is no longer waiting in Undeposited Funds — reload and pick again.` | Somebody else deposited or unapplied one of the ticked payments while you had the page open. |
| `Those payments belong to a different company than that account. Deposit them into one of their own company's accounts.` | The company pill and the account disagree. |
| `That account is closed. Reopen it from the account page to record anything new — everything already in the books stays either way.` | The account was closed while you had the page open. Pick another. |
| `That date falls in a closed period. Use a reversal, or reopen the period first.` | The deposit date is in a month that has been closed for this company. |
| `That deposit has already been voided.` | {button:Void|outline} was pressed on a deposit somebody had just voided. |
| `This entry is locked (closed period, reconciled, or strict mode). Create a reversal instead.` | The deposit's entry has been reconciled, so it cannot be voided. |
| `That payment is in a deposit. Void the deposit first, then unapply the payment.` | {button:Unapply|outline} was pressed on an invoice for a payment a deposit has banked. |

## Not on this page

A deposit cannot be edited; void it and record it again. A payment recorded straight into a bank account never appears here. Money you banked that was not a customer payment, such as an owner's contribution or a refund, is recorded with {button:Quick add|outline} on the Banking page as money in, or matched from the bank feed. Cash back, fees taken at the counter, and depositing one company's payments into another company's account are not supported. Ask us if you need them.

## Who can do what

Everyone sees the list and a deposit's page. Only owners record and void deposits.
