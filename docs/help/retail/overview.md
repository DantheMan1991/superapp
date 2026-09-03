# Retail at a glance

> Where the business sells, what it charges there, and what a day of selling took and cost. This guide is the map of the Retail pages. Each page has its own guide.
> **Route:** /dashboard/m/retail/**
> **Order:** 0

Open **Retail** in the sidebar. Three pages make up the whole tool: the list of places you sell, one of those places, and one day of selling at it.

## What you see

- **A {{channel|lower}}.** Somewhere the business sells. A market stall, the farm gate, a shop, a wholesale account.
- **A {{marketDay|lower}}.** One day of selling at one of those places. It holds the till, the truck, the cash tin, and what the day cost you.
- **A price.** What you charge for one thing at one place. The same pound is one price at a stall and another at the gate, so a price belongs to the place and not to the thing.
- **The Retail list.** Every {{channel|lower}}, how many things are priced there, and the last twenty days of selling with what each took and cost. See [Where you sell](channels.md).
- **A {{channel|lower}}'s page.** Its price list, what every price used to be, and every day of selling there. See [One {{channel|lower}}](channel.md).
- **A {{marketDay|lower}}'s page.** The till, the truck, the cash tin, and what sold. See [A day of selling](market-day.md).
- **The truck.** Whatever you sell out of. It is an asset with `Things are kept here` turned on, so loading it is a real stock move rather than a guess. See [Assets](../assets/overview.md).

## How a day of selling works

1. Add somewhere to sell, once.
2. Set a price for each thing you sell there.
3. Add a truck under [Assets](../assets/overview.md), with `Things are kept here` turned on.
4. Start a {{marketDay|lower}} and load the truck. The stock really moves onto it.
5. Sell from the till. Every sale takes the stock off the truck and stamps the price you actually charged.
6. Tap `Ran out` on anything you sell out of before closing time.
7. Bring back what did not sell, and close the day with what it cost and how long you stood there.

## What the money means

`Took` is what came in. `Margin` is that less what it cost to stand there, which is the stall fee and getting there. **It is not profit.** What the goods cost to produce is not in it, and no screen joins the two yet.

Hours are kept beside the money rather than inside it. If your own time counts as nothing, every market looks worth going to.

Only cash is checked against the tin. Counting card takings as a shortfall is the fastest way to teach somebody to ignore the number.

## Not on this page

- A price change is a new price from a day, never an edit. Nothing overwrites what you charged before, because that is what makes a margin report worth reading.
- Voiding a sale drops the takings and leaves the stock off the truck, because it did go over the table. Put it back with a stock correction if it did not.
- Nothing compares the same thing's price across two places, though both prices are kept.
- Nothing joins what a day took to what the goods cost to produce.
- There is no receipt to print and no customer record. A sale is a time, a total and how it was paid.
- If you need any of this, ask us.

## Who can do what

Selling is open to everyone. Any member can start a day, load and unload the truck, ring up a sale, void one, note that something ran out, and close the day.

The decisions belong to the owner. Only an owner can add a {{channel|lower}}, close or reopen one, set a price, or remove one.

That split has one sharp edge. A staff member at a stall who finds an unpriced thing cannot price it, and the screen does not explain why. Call an owner.
