# Deliveries and invoices

> What has arrived, what you have been billed for it, and the gap between the two. Also the switch that decides whether stock appears in your financial statements.
> **Route:** /dashboard/m/inventory/matching
> **Order:** 60

Open **Inventory** and click `Deliveries & invoices`. The heading reads `What has arrived, what has been billed for it, and the gap between the two.`

This is where a supplier's invoice gets tied to the delivery it is paying for.

## What you see

- **The posting panel at the top.** It reads `Stock is on the balance sheet` or `Stock is not on the balance sheet`, with a switch marked `On` or `Off`. Owners only, and see below before you touch it.
- **`Arrived, not yet invoiced`.** What you hold and have not been billed for. It only appears once stock is on the balance sheet. Under it, how many deliveries are waiting and what they are worth. A minus in front of it means you have been billed for more than turned up.
- **`Bills waiting to be matched`.** `Supplier`, `Line`, `Charged` and `Matched`. Click a supplier to open the bill in Accounting.
- **`Matched`** reads `Nothing yet`, or a badge like {badge:2 deliveries · $6,000.00|secondary}.
- **{button:Match|outline}** and **{button:Unpick|ghost}** at the end of each bill row. Owners only, and only when stock is on the balance sheet.
- **`Deliveries with no invoice yet`.** `When`, `What`, `Batch`, `Still open` and `Worth`. These are the priced deliveries waiting for a bill, oldest first. Past fifty there are pages, with a line under the table reading `Showing 1 to 50 of 214, oldest first.` and `Older` and `Newer` beside it. The card above counts every one of them, whatever page you are on.

A delivery recorded without a price never appears here at all. It has no cost for an invoice to settle, and it shows on [what it is worth](what-it-is-worth.md) instead.

## The switch, and what it decides

Off, Yosher still tracks what everything cost. It just does not appear in your financial statements.

On, a delivery becomes an asset when it arrives, and its cost moves to cost of goods when it is used.

**Ask your accountant first.** The screen says so too. Turning it on writes entries from that day forward and does not go back and rewrite anything before it.

**Turning it off again is usually impossible.** Once anything has posted, the switch locks and explains why: the cost already on the books would be left in stock with nothing left to relieve it. Unwinding that is a journal entry somebody makes on purpose, not a setting.

Staff and your accountant see the switch greyed out with no explanation. That is us, not you.

## How to match a bill to a delivery

1. Find the bill line under `Bills waiting to be matched` and click {button:Match|outline}.
2. The dialog is headed with the supplier and the amount. It reads `Say how much of each delivery this bill is paying for.`
3. With more than four deliveries waiting there is a search box at the top. Type part of the {{item|lower}} name, the batch code or the date to narrow the list. Anything you have already typed a quantity against stays visible whatever you search for.
4. For each delivery this bill covers, type how much of it into the box. Click {button:All|ghost} to fill in the whole thing.
5. If the bill charges for more than turned up, put the invoiced amount into `How much is the bill charging for?`. The help then reads `Charged for 2 more than arrived. That stays as owed stock rather than becoming a cost.`
6. Leave that box blank if the bill is for exactly what arrived.
7. Click {button:Match|primary}. You see `Matched`, or `Matched — $500.00 dearer than the ticket`.

There is no confirmation step. **The dialog cannot narrow itself to this supplier's deliveries**, because a delivery does not record who sold it — that is the very thing matching establishes. So read the {{item|lower}} and the date on each line before typing, or use the search box.

**A price difference is a real cost** and goes to your accounts as one. **Being charged for stock that never arrived is not a cost**, so it stays as owed stock for you to chase.

## How to undo a match

1. Click {button:Unpick|ghost} on the bill line.
2. You are asked to confirm: `The deliveries go back to waiting for an invoice, and the bill line goes back to being uncoded — so the bill cannot be approved until somebody says what it was for.`
3. Click {button:Unpick it|destructive}. You see `Unpicked`.

You must then go into Accounting and say what that bill line was for, or the bill cannot be approved.

## Messages

| Message | What it means |
| --- | --- |
| `Matched` | The bill line and the deliveries are tied together. |
| `Matched — $500.00 dearer than the ticket` | The invoice was higher than the delivery was recorded at. The difference is a cost. |
| `$120.00 charged for stock that did not arrive` | You were billed for more than turned up. Chase the supplier. |
| `Unpicked` | The match is undone and the bill line is uncoded. |
| `Stock now posts to the books` / `Stock no longer posts` | The switch moved. |
| `No bills waiting` | No bill is waiting. A bill can be matched while it is a draft or waiting for approval, never after. |
| `Nothing waiting` | Every priced delivery has an invoice against it. |
| `Showing 1 to 50 of 214, oldest first.` | The deliveries run over more than one page. `Older` and `Newer` walk them. |
| `Nothing here matches “feed”. Clear the box to see all 12.` | The search in the match dialog found nothing. |
| `Stock is not on the balance sheet for this business, so there is nothing for a bill to settle. Turn that on first.` | Turn the switch on before matching. |
| `that bill is already approved — match the delivery before approving it` | Too late for that bill. Match before approving next time. |
| `that delivery only has 40 lb left to invoice` | You typed more than is left on that delivery. |
| `That delivery belongs to a different company from this bill.` | The delivery is on another company's books. |
| `that delivery is already fully invoiced, or carries no cost to settle` | The delivery you typed against cannot take this bill. Reload the page to see what is still open. |
| `That no longer exists.` | The bill line or the delivery was removed while you were looking at it. Reload the page. |
| `Only an owner can change stock records.` | You are signed in as staff. Ask an owner. |

## Not on this page

- The dialog does not narrow the deliveries to the supplier on the bill, so you scroll all of them.
- Nothing groups the deliveries by supplier, because a delivery does not record one.
- If you need any of this, ask us.

## Who can do what

Only an owner can move the switch, match a bill, or unpick a match. Everyone else sees both tables, the card and all the figures, with no buttons and a greyed switch.
