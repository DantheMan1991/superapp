# Inventory at a glance

> Everything the business holds in quantity, what it cost, where it is, and which batch it came from. This guide is the map of the Inventory pages. Each page has its own guide.
> **Route:** /dashboard/m/inventory/**
> **Order:** 0

Open **Inventory** in the sidebar. This is where what you hold is recorded: how much there is, where it sits, what it cost, and when it goes off. Five pages sit along the top of every screen in it.

## What you see

- **An {{item|lower}}.** A kind of thing you hold a quantity of. Feed, cartons, ground beef. It is not one bag or one box, it is the kind.
- **A batch.** A particular lot of an {{item|lower}}, with a history. One delivery, one hatch, one pen. A batch is what a cost attaches to, so `what did this pen cost` has an answer.
- **Counted in.** Every {{item|lower}} is counted in one unit, and that never changes once anything has moved. Buy feed in bags and count it in pounds. Count meat in packages, because a package is what gets handed over.
- **`Items`.** Everything you hold, what is on hand, what it is worth, and what is going off soon. See [Everything you hold](items.md).
- **One {{item|lower}}'s page.** Its batches, where the stock is, every entry ever recorded against it, and the buttons that record more. See [One {{item|lower}}](item.md).
- **`Counting`.** Walking the shelf and writing down what is really there. See [Counting stock](counting.md) and [One count](count.md).
- **`What it is worth`.** The cost standing in stock on a chosen day, batch by batch. See [What it is worth](what-it-is-worth.md).
- **`Deliveries & invoices`.** What has arrived, what you have been billed for, and the gap. See [Deliveries and invoices](deliveries-and-invoices.md).
- **`When it is deducted`.** Your accountant's decision about when each category's cost is deducted. Owners only. See [When stock is deducted](when-it-is-deducted.md).
- **Places.** Stock sits in an asset: a freezer, a barn, a garage. You make one by turning on `Things are kept here` when you add it under [Assets](/dashboard/m/assets).
- **Blanks.** A dash means nothing was ever recorded. That is not the same as zero, and the screens keep them apart everywhere.

## How to get started

1. Add each {{item|lower}} you hold under `Items`. Give it a name, a kind, and the unit you count it in.
2. Add somewhere to keep it under [Assets](/dashboard/m/assets), with `Things are kept here` turned on.
3. Open an {{item|lower}} and start a batch for the first delivery.
4. Record the delivery with {button:Record stock|primary}, including what it cost if you know it.
5. Record stock going out the same way, and say what it was fed to if it went to another batch.
6. Count a shelf now and then, and post the count to put the record right.

## How the money works

Nothing reaches your accounts until an owner turns it on, under `Deliveries & invoices`. Until then Yosher still tracks what everything cost, it just does not appear in your financial statements.

Once it is on, a delivery becomes an asset when it arrives, and its cost moves to cost of goods when it is used. What a supplier charged you is matched to what actually turned up, on the same page.

Ask your accountant before turning it on. It changes your balance sheet.

## Not on this page

- Stock is allowed to go below zero, on purpose. Nothing stops you using something before the delivery that covered it was entered. The screens say so where it happens.
- Nothing refuses a batch that has gone off. The page tells you which one to use first and leaves the choice to you, because you can see which bag is already open and it cannot.
- A batch cannot be edited after it is started, and it cannot be closed or merged.
- A posted count cannot be reopened or corrected. Count again instead.
- Nothing here values stock at what it would sell for. Every figure is what it cost.
- There is no import, no export, and no way to add things in bulk.
- If you need any of this, ask us.

## Who can do what

Most of Inventory is owner work. Only an owner can add or change an {{item|lower}}, retire one, start a batch, split one, correct what a batch cost, record stock in or out, adjust a quantity, match a bill, or record a tax decision.

Counting is open to everyone. Any member can start a count, record what they found, remove a line and post it, including the accountant.

Everyone can read every page, including what everything is worth.
