# One {{channel|lower}}

> One place you sell: what you charge there, what you used to charge, and every day of selling at it.
> **Route:** /dashboard/m/retail/*
> **Order:** 20

Open **Retail** and click a name. {button:Retail|ghost|chevron-left} at the top takes you back. Under the name sits its kind and where it is, and a badge reading {badge:Selling|primary} or {badge:Closed|outline}.

## What you see

- **{button:Start a market day|outline}.** Opens the stall here so you can sell. Anyone can.
- **{button:Close|outline}.** Stops this place being offered. It reads {button:Reopen|outline} once closed. Owners only.
- **`Before you can sell here`.** A three-step checklist. It disappears entirely once all three are done.
- **`Prices`.** Every thing you hold, priced or not, with what you charge here. The heading counts how many of them are priced.
- **`What it used to cost`.** Every price this place has ever had. It only appears once something has had more than one.
- **`Market days here`.** Every day of selling at this place, newest first, with no limit.
- **`Notes`.** Only when you wrote some.

## The checklist

Three steps, each ticked off as you do it.

1. **Price what you sell at this {{channel|lower}}.** Set a price on the list below.
2. **Somewhere to sell out of.** A market truck is an asset with `Things are kept here` ticked. Add one under [Assets](../assets/overview.md) and the till can draw stock from it. If Assets is not switched on for you, the step says so instead of offering a link.
3. **Start a {{marketDay|lower}}.** The till, the truck and the cash tin all live on the day's own page.

Loading the truck is deliberately not a step here. It happens on the day.

## The Prices table

`Item`, `Price`, `Since` and `Next`.

- **`Item`** shows what the price is per, underneath the name: `per package`, `per pound`, `per head`, `per dozen`.
- **`Price`** shows a dash when you have not priced it here. That is not the same as `$0.00`, which is a real price for a sample or a giveaway.
- **`Since`** is the day the current price started.
- **`Next`** shows a price you have already set for a future date, as `$8.50 on 2026-03-01`. A price set ahead and then forgotten is what this column exists to prevent.

Everything you hold appears here, priced or not, because most businesses sell a few of the many things they hold.

## How to set a price

1. Click {button:Set a price|ghost} on the row, or {button:Change|ghost} if it already has one.
2. Type the `Price`. Zero is allowed. Blank is not a price.
3. Set `From`. The help reads `A date in the future sets the price ahead without changing what you are charging today.`
4. For something that can be weighed, pick `Charged`: `Per package — one price whatever it weighs`, or `Per pound — weighed at the till`. The help reads `Per pound means the till asks for a weight and works the money out.`
5. Add `Notes` if you want.
6. Click {button:Set|primary}. You see `Price set`.

**A change is a new price from a day, never an edit.** Nothing overwrites what you charged before, which is what lets a margin report ask what you charged in June rather than only what you charge now.

Setting a price for a day that already has one replaces that day's price, because two prices starting the same morning is a question rather than a change.

Something already counted by weight cannot be priced per pound, and the choice is simply not offered.

## How to see and undo past prices

`What it used to cost` lists every price newest first, with {badge:now|outline} on the one in force.

Click {button:Remove|ghost} on a row to take it out. There is no confirmation. You see `Removed — whatever ran before applies again`.

Removing the price a past sale was made at does not change that sale. What was charged is stamped on the sale itself.

## How to close a place

1. Click {button:Close|outline}. There is no confirmation.
2. You see `Channel closed — its prices and history stay`.
3. To undo it, click {button:Reopen|outline}. You see `Channel open again`.

A closed place stops being offered when you start a day. If you start one from this page while it is closed, the `Where` box looks empty but the day is still created here. Reopen it first.

## The days table

`When`, `Stall fee`, `Getting there`, `Person-hours`, `Cost an hour` and `Weather`. A day's notes sit under its date. Click a date to open it.

{button:Remove|ghost} deletes a day. There is no confirmation, and anyone can do it. **A day that has sales on it cannot be deleted**, and you get `Something went wrong saving that.` rather than an explanation.

## Messages

| Message | What it means |
| --- | --- |
| `Price set` | The new price is in force from the day you gave. |
| `Removed — whatever ran before applies again` | The price row is gone and the one before it applies. |
| `Channel closed — its prices and history stay` | Nothing is lost. It just stops being offered. |
| `Enter a price. Zero is allowed; blank is not a price.` | The price box was empty. |
| `Nothing to price yet` | Nothing is held. Add something in Inventory and it appears here. |
| `No market day recorded here yet` | Nobody has sold here. |
| `Only an owner can change channels or prices.` | You are signed in as staff. Ask an owner. |
| `A price cannot be negative.` | Sometimes this really means per-pound pricing was refused for something already counted by weight. The wording is wrong and we are fixing it. |
| `Something went wrong saving that.` | Something unexpected. Most often removing a day that has sales on it. |

## Not on this page

- A price cannot be edited. Setting a new one from a day is how you change it.
- Nothing stops you removing a price a past sale used, though the sale keeps what it was charged at.
- Nothing compares this place's prices against another's.
- Removing a day asks for no confirmation and is open to everyone.
- If you need any of this, ask us.

## Who can do what

Only an owner can set a price, remove one, or close and reopen this place. Anyone can start a day of selling and remove a day. Everyone sees the checklist, both price tables and every day.
