# One {{item|lower}}

> Everything about one kind of thing you hold: how much there is, where it sits, its batches, what each cost, and every entry ever recorded against it.
> **Route:** /dashboard/m/inventory/*
> **Order:** 20

Open **Inventory** and click a name in the list. Every number on this page is added up from the entries below it. Nothing stores a running total, so a correction is just another entry.

## What you see

The heading is the name. Under it sits the kind, then `counted in pounds` or whatever unit you chose. A badge shows if it has to be kept `Frozen`, `Refrigerated`, `Dry` or `Ambient`, and another reads `archived` once you have retired it.

- **{button:New batch|outline}.** Starts a batch. Owners only, and gone once the {{item|lower}} is retired.
- **{button:Record stock|primary}.** Records a delivery, stock going out, or a correction. Anyone can, including an accountant, and gone once retired.
- **{button:Edit|outline|pencil}.** Changes what it is and how it is bought. Owners only, and it stays available on a retired {{item|lower}}.
- **{button:Retire|ghost}.** Takes it out of lists without changing anything else. Once retired the button reads {button:Put back|outline}.
- **`On hand`.** The total, in the counted unit. A dash means nothing has ever been recorded. Underneath, how many entries it was added up from, and the average paid across everything that came in with a price.
- **`Where it is`.** The total split by place, biggest first. Stock nobody said a place for shows as `Not recorded`. A place you have since retired shows as `Unknown place`.
- **`Batches`.** Every batch, newest first. See below.
- **`Cost corrections`.** Every time somebody re-stated what a batch cost. Only appears when there has been one.
- **`Recent entries`.** The last twenty five things that happened. See below.

When the total is below zero you also see `That is below zero, which usually means something was used before the delivery that covered it was entered.` That is allowed on purpose. Nothing stops you recording stock out before the delivery that covered it.

## The Batches table

`Batch`, `From`, `Started`, `Good until`, `On hand` and `Carrying`.

- **`From`** is `Bought`, `Raised here` or `Made here`.
- **`Good until`** turns red once the date is past and there is still something on hand. Blank covers both "nobody dated it" and "it does not go off".
- **`Carrying`** is what that batch cost and has not yet released. `No cost recorded` means nobody ever costed it, which is different from `$0.00`, meaning it was costed and has all been used.
- **{badge:closed|outline}** and **{badge:split|outline}** mark a batch that has been closed elsewhere, or one cut off another.
- **{button:Correct cost|ghost}** and **{button:Split|ghost}** sit at the end of each row, for owners.

## The Recent entries table

`When`, `What happened`, `Where`, `Amount` and `Cost`.

Read a row as: on this day, this much went in or out at this place, and this much money went with it. A `+` means it came in.

`What happened` is one of `Received`, `Used`, `Moved in`, `Moved out`, `Split out`, `Split in`, `Adjusted`, and for animals `Placed` or `Died`. An adjustment also shows its reason underneath.

Cost is shown without a sign in both directions. A row reading `Used · -20 pounds · $57.00` means $57 of cost left stock.

**Only the last twenty five entries are shown, and nothing on the screen says so.** The line above the table counts every entry there has ever been, so `From 300 entries.` over twenty five rows is normal.

## How to start a batch

1. Click {button:New batch|outline}. The dialog reads `A batch is what traceability follows — one delivery, one hatch, one pen. It becomes a cost object, so what it cost is answerable later.`
2. Type a `Batch code`, up to 120 characters. Anything you will recognize: `B-2026-04-15`, `Pen 3`, `#47`.
3. Pick `Where from`: `Bought`, `Raised here` or `Made here`.
4. Set `Started`. It begins on today.
5. Set `Good until` if it goes off. The help reads `Optional. When it is set, this batch shows up under what is going off soon and gets used first.`
6. Pick a line of business if you keep them. It starts from the {{item|lower}}'s own.
7. Add `Notes` if you want.
8. Click {button:Start batch|primary}. You see `Batch started`.

## How to record a delivery

1. Click {button:Record stock|primary} and leave the door on `In`.
2. Type the amount into `How much`. The label names the unit.
3. Pick a `Batch`, or leave it on `No batch`.
4. Set `When`. It begins on today.
5. Type `What it cost` if you know it. The help reads `The whole delivery, not the price per pound. Leave it empty if the invoice has not arrived — the stock still counts.`
6. Type `What it weighed (lb)` if somebody weighed it. Again the whole delivery, not one package. This box is not there for something already counted by weight.
7. Pick `Where` it went, and add `Notes`.
8. Click {button:Record|primary}. You see `Stock recorded in`.

Leaving the cost blank is fine and normal. The batch then shows `No cost recorded` until you supply one under {button:Correct cost|ghost} or match a bill to it.

## How to record stock going out

1. Click {button:Record stock|primary} and choose `Out`.
2. Type how much, pick the batch it came from, and set the date.
3. If it went into something else you are tracking, pick it under `Fed to`. The help reads `This is what makes "what did this pen cost" a question with an answer.` Otherwise leave it on `Nothing — waste or sold`.
4. Click {button:Record|primary}. You see `Stock recorded out`, followed by what it cost.

You cannot type the cost. It is worked out at the average paid at that moment, and it does not move when the next delivery arrives.

Nothing stops you recording more out than there is. The balance simply goes below zero and the page says so.

## How to correct a quantity

1. Click {button:Record stock|primary} and choose `Adjust`.
2. Pick `Less than the record says` or `More`. Type the difference as a positive number.
3. Pick a `Why`. This is required, and it is the point of an adjustment. The choices are `Went off`, `Shrinkage`, `Damaged`, `Found`, `Thrown away`, `Taken for the house`, `Missing`, `Correcting an entry`, or `Something else…`.
4. Read the note under your choice. Each one says what it is really for.
5. Click {button:Record|primary}. You see `Adjusted up` or `Adjusted down`.

Adjusting down releases cost at the average paid. Adjusting up carries none, because nobody paid for stock that turned up.

If you are putting the record right after walking the shelf, use [Counting](counting.md) instead. It does the arithmetic and keeps a record of the walk.

## How to split a batch

1. Click {button:Split|ghost} on the batch. It only appears while the batch is open and has something on hand.
2. Type how much to move out, a `New batch code`, and the date.
3. Pick `Where it goes` if the new one lives somewhere else.
4. Click {button:Split|primary}. You see `Split — the total is unchanged`.

The new batch remembers which one it came from and carries a {badge:split|outline} badge. Nothing is created or destroyed, so the {{item|lower}}'s total does not move.

## How to correct what a batch cost

1. Click {button:Correct cost|ghost} on the batch. It is offered on every batch, including empty and closed ones, because the invoice often arrives after the feed is eaten.
2. Pick `It cost more` or `It cost less`.
3. Type the amount. It cannot be zero.
4. Pick a `Why`: `The ticket was wrong`, `Freight was left out`, `The ticket had no price`, `Priced in the wrong unit`, `A discount came off`, or `Correcting an entry`.
5. Read `Where this lands`. It shows you exactly how the money splits between the batch and cost of goods before you commit.
6. Set `When`, add `Notes`, and click {button:Correct cost|primary}.

This changes what it cost, never how much of it there is. The split follows how much of the batch is still on hand, and it is worked out once and kept, so a later entry never re-states it.

One of the notes under `Why` says to use a negative amount for a discount. Ignore that. Pick `It cost less` instead.

## How to retire something

1. Click {button:Retire|ghost}. You are asked to confirm.
2. The dialog tells you the stock stays on hand, in every balance and every valuation. Nothing in your accounts changes.
3. Click {button:Retire it|primary}. You see `Retired`.
4. To undo it, click {button:Put back|outline}. You see `Back in the list`.

## Messages

| Message | What it means |
| --- | --- |
| `Batch started` | The batch exists and can be recorded against. |
| `Stock recorded in` / `Stock recorded out` | The entry is in. Out also tells you the cost. |
| `Adjusted up` / `Adjusted down` | The correction is in. |
| `Split — the total is unchanged` | Part of the batch is now a batch of its own. |
| `Cost corrected.` | The batch is carried at a different figure. |
| `Saved` | Your changes to the {{item|lower}} are in. |
| `Retired` / `Back in the list` | It is out of, or back in, the lists. |
| `No batches yet` | Nothing has been started. An owner starts the first. |
| `Nothing on hand anywhere.` | Every place nets to zero. |
| `Enter a quantity other than zero.` | The amount box was left at zero. |
| `this item already has movements recorded in its current unit, so changing it would restate every one of them` | The counted unit is locked. Start a new {{item|lower}} instead. |
| `give either an existing batch or a name for a new one` | You picked a batch and typed a new code. Choose one. |
| `that lot belongs to a different item` | The batch you picked is not this {{item|lower}}'s. Reload and pick again. |
| `Use lowercase letters, numbers and underscores.` | Your own reason has a capital, a symbol, or starts with a digit. |
| `Only an owner can change stock records.` | You are signed in as staff and pressed something an owner keeps — starting a batch, splitting one, correcting a cost, or editing the {{item|lower}}. Recording stock is not one of those. |
| `Something went wrong saving that.` | Something unexpected. It also covers a date that falls in a closed accounting period, which the message does not say. Tell us if you see it. |

## Not on this page

- A batch cannot be edited once it is started. A wrong code, date or line of business is stuck.
- A batch cannot be closed or merged from here.
- Stock in a closed batch cannot be moved. You can see it and correct its cost, and nothing else.
- Only the last twenty five entries are listed, and there is no way to see the rest.
- The counted unit is locked the moment anything moves, even if the balance is back to zero.
- Nothing traces a batch back through its splits, although the record is kept.
- A cost correction cannot be undone. The remedy is an equal and opposite one.
- If you need any of this, ask us.

## Who can do what

Only an owner can start a batch, split one, correct what one cost, edit the {{item|lower}}, or retire it. Each of those either creates something the accounts group by, or changes what it costs.

Recording stock in, out or adjusted is open to everyone, an accountant included. It is what the person unloading the pallet does, and it has to be recorded then rather than reported to somebody who can.
