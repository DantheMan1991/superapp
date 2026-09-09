# One {{item|lower}}

> Everything about one kind of thing you hold: how much there is, where it sits, its batches, what each cost, and every entry ever recorded against it.
> **Route:** /dashboard/m/inventory/*
> **Order:** 20

Open **Inventory** and tap a name in the list. Every number on this page is added up from the entries below it. Nothing stores a running total, so a correction is just another entry. On a phone the batches, the corrections and the entries are cards. On a wide screen they are tables.

## What you see

The heading is the name. Under it sits the kind, then `counted in pounds` or whatever unit you chose. A badge shows if it has to be kept `Frozen`, `Refrigerated`, `Dry` or `Ambient`, and another reads `retired` once you have retired it.

- **{button:New batch|outline}.** Starts a batch on its own, with a line of business and notes. Owners only, and gone once the {{item|lower}} is retired. A delivery can also start its batch from inside {button:Record stock|primary}.
- **{button:Record stock|primary}.** Records a delivery, stock going out, or a correction. Anyone can, including an accountant, and gone once retired.
- **{button:Edit|outline|pencil}.** Changes what it is and how it is bought. Owners only, and it stays available on a retired {{item|lower}}.
- **{button:Retire|ghost}.** Takes it out of lists without changing anything else. Once retired the button reads {button:Put back|outline}.
- **`On hand`.** The total, in the counted unit. A dash means nothing has ever been recorded. Underneath, how many entries it was added up from, and the average paid across everything that came in with a price. For something counted in packages, `about 55 lb` when deliveries were weighed.
- **`Where it is`.** The total split by place, biggest first. Stock nobody said a place for shows as `Not recorded`. A place you have since retired shows as `Unknown place`.
- **`Batches`.** Every batch, newest first. See below.
- **`Cost corrections`.** Every time somebody re-stated what a batch cost. Only appears when there has been one.
- **`Weight corrections`.** Every time somebody re-stated what a batch weighs. Only appears when there has been one.
- **`Recent entries`.** The last twenty five things that happened. See below.

When the total is below zero you also see `That is below zero, which usually means something was used before the delivery that covered it was entered.` That is allowed on purpose. Nothing stops you recording stock out before the delivery that covered it.

## The batches

On a phone, one card per batch: the code with its badges, where it came from and when it started, what is on hand on the right with `about … lb` under it when it was weighed, then `Good until` and `Carrying`, and the owner's buttons along the bottom. On a wide screen the same as a table: `Batch`, `From`, `Started`, `Good until`, `On hand` and `Carrying`.

- **`From`** is `Bought`, `Raised here` or `Made here`.
- **`Good until`** turns red once the date is past and there is still something on hand, and a line under the date says `past its date`, `goes off today`, `goes off in 5 days` or `good until 2026-11-01`. Blank covers both "nobody dated it" and "it does not go off".
- **`Carrying`** is what that batch cost and has not yet released. `No cost recorded` means nobody ever costed it, which is different from `$0.00`, meaning it was costed and has all been used.
- **{badge:closed|outline}** and **{badge:split|outline}** mark a batch that has been closed elsewhere, or one cut off another.
- **{button:Correct cost|ghost}**, **{button:Correct weight|ghost}** and **{button:Split|ghost}** sit under each card, or at the end of each row, for owners. `Correct weight` only appears on a batch that has a weight recorded. `Split` only while the batch is open and has something on hand.

## The recent entries

On a phone, one card per entry: what happened, then the date, the place and the batch under it, the reason of a correction, any note, and the amount on the right with its cost under it. On a wide screen: `When`, `What happened`, `Where`, `Amount` and `Cost`.

Read an entry as: on this day, this much went in or out at this place, and this much money went with it. A `+` means it came in.

`What happened` is one of `Received`, `Used`, `Moved in`, `Moved out`, `Split out`, `Split in`, `Adjusted`, and for animals `Placed` or `Died`. An adjustment also shows its reason.

Cost is shown without a sign in both directions. An entry reading `Used · -20 pounds · $57.00` means $57 of cost left stock.

**Only the last twenty five entries are shown, and nothing on the screen says so.** The line under `On hand` counts every entry there has ever been, so `From 300 entries.` over twenty five cards is normal.

## How to start a batch

1. Tap {button:New batch|outline}. The dialog reads `A batch is what traceability follows — one delivery, one hatch, one pen. It becomes a cost object, so what it cost is answerable later.`
2. Type a `Batch code`, up to 120 characters. Anything you will recognize: `B-2026-04-15`, `Pen 3`, `#47`.
3. Pick `Where from`: `Bought`, `Raised here` or `Made here`.
4. Set `Started`. It begins on today.
5. Set `Good until` if it goes off. The help reads `Optional. When it is set, this batch shows up under what is going off soon and gets used first.`
6. Pick a line of business if you keep them. It starts from the {{item|lower}}'s own.
7. Add `Notes` if you want.
8. Tap {button:Start batch|primary}. You see `Batch started`.

For a delivery that arrives as its own batch, skip this and start the batch inside {button:Record stock|primary} instead. See the next section.

## How to record a delivery

1. Tap {button:Record stock|primary} and leave the door on `In`. The dialog reads `Every figure on this page is the sum of these entries, so a correction is just another entry.`
2. Type the amount into `How much`. The label names the unit.
3. Set `When`. It begins on today.
4. Say how you are reading your figures. Beside `Cost and weight are for`, `Each package` means you are typing the price and the weight of one, and the app multiplies both by `How much`; `All together` means you are typing the invoice total and the whole delivery's weight, the way paperwork reads. `Each package` is picked to start, and the button names your unit, so for something counted in head it reads `Each head`. For something counted by weight the line reads `The cost is for`, because there is no weight box.
5. Type `What it cost` if you know it. Once `How much` and the cost are both typed, a line under the box reads back the figure you did not type: `5 packages, $25.00 in all.` under `Each package`, or `5 packages, $1.00 each.` under `All together`. The help reads `The price of one package.` or `The whole delivery, as the invoice reads.`, then `Blank if the invoice has not come — the stock still counts.`
6. Type `What it weighed (lb)` if somebody weighed it. The same kind of line reads back under it: `5 packages, 5 lb in all.` or `5 packages, 0.2 lb each.` If either read-back looks wrong, the entry is wrong. The help reads `One package on the scale.` or `Everything in this entry on the scale together, as a plant's ticket reads.`, then `Blank if nobody weighed it.` This box is not there for something already counted by weight.
7. Pick a `Batch`. It starts on the only open batch when there is exactly one, and on `No batch` otherwise. An owner also sees `New batch…` at the bottom of the list: pick it and two boxes appear, `Batch code` and `Good until`. Type the code, set the date if the delivery has one, and the batch is started with this delivery in it. The help reads `Starts the batch and puts this delivery in it. Good until is optional.`
8. Pick `Where` it went. It starts on the place this {{item|lower}} went last time, or on your only place, and can be set back to `Not recorded`. Add `Notes`.
9. Tap {button:Record|primary}. You see `Stock recorded in`, or `Stock recorded in · batch B-2026-09-09 started` when you started one.

Leaving the cost blank is fine and normal. The batch then shows `No cost recorded` until you supply one under {button:Correct cost|ghost} or match a bill to it.

## How to record stock going out

1. Tap {button:Record stock|primary} and choose `Out`.
2. Type how much and set the date.
3. If it went into something else you are tracking, tap `Fed to`, type part of the batch or {{item|lower}} name, and pick it. The list narrows as you type. Leave it on `Nothing — waste or sold` otherwise. The help reads `The batch that ate it carries the cost, at today's average, and it does not move when the next delivery arrives.`
4. Check `Batch` and `Where`. They start on the only open batch and the last place used, as for a delivery.
5. Tap {button:Record|primary}. You see `Stock recorded out`, followed by what it cost.

You cannot type the cost. It is worked out at the average paid at that moment, and it does not move when the next delivery arrives.

Nothing stops you recording more out than there is. The balance simply goes below zero and the page says so.

## How to correct a quantity

1. Tap {button:Record stock|primary} and choose `Adjust`.
2. Pick `Less than the record says` or `More`. Type the difference as a positive number.
3. Pick a `Why`. This is required, and it is the point of an adjustment. The choices are `Went off`, `Shrinkage`, `Damaged`, `Found`, `Thrown away`, `Taken for the house`, `Missing`, `Correcting an entry`, or `Something else…`.
4. Read the note under your choice. Each one says what it is really for.
5. Check `Batch` and `Where`, then tap {button:Record|primary}. You see `Adjusted up` or `Adjusted down`.

Adjusting down releases cost at the average paid. Adjusting up carries none, because nobody paid for stock that turned up.

If you are putting the record right after walking the shelf, use [Counting](counting.md) instead. It does the arithmetic and keeps a record of the walk.

## How to split a batch

1. Tap {button:Split|ghost} on the batch. It only appears while the batch is open and has something on hand.
2. Type how much to move out, a `New batch code`, and the date.
3. Pick `Where it goes` if the new one lives somewhere else.
4. Tap {button:Split|primary}. You see `Split — the total is unchanged`.

The new batch remembers which one it came from and carries a {badge:split|outline} badge. Nothing is created or destroyed, so the {{item|lower}}'s total does not move.

## How to correct what a batch cost

1. Tap {button:Correct cost|ghost} on the batch. It is offered on every batch, including empty and closed ones, because the invoice often arrives after the feed is eaten.
2. Pick `It cost more` or `It cost less`.
3. Type the amount. It cannot be zero.
4. Pick a `Why`: `The ticket was wrong`, `Freight was left out`, `The ticket had no price`, `Priced in the wrong unit`, `A discount came off`, or `Correcting an entry`.
5. Read `Where this lands`. It shows you exactly how the money splits between the batch and cost of goods before you commit.
6. Set `When`, add `Notes`, and tap {button:Correct cost|primary}.

This changes what it cost, never how much of it there is. The split follows how much of the batch is still on hand, and it is worked out once and kept, so a later entry never re-states it.

One of the notes under `Why` says to use a negative amount for a discount. Ignore that. Pick `It cost less` instead.

## How to correct what a batch weighs

1. Tap {button:Correct weight|ghost} on the batch. It is only there on a batch that has a weight recorded; a batch nobody weighed gets its first weight when you record a delivery. It is offered on empty and closed batches too, because what the packages weighed stays true after they are sold.
2. The dialog opens with what the batch reads now, for example `This batch reads 2 lb across the 6 packages that came in weighed — about 0.3333 lb a package. This changes what it weighs, never how much of it there is.`
3. Say how you are reading the scale. `Each package` means you are typing what one weighs; `All together` means the whole batch. `Each package` is picked to start, and the button names your unit.
4. Type `What it actually weighs (lb)`. A line under the box reads back exactly what will be recorded: `6 packages, 6 lb in all — 1 lb each. +4 lb on what is recorded.` If the figure is what the batch already reads, the line says `That is what it already reads.` and the button stays off.
5. Pick a `Why`: `Typed the wrong figure`, `Put it back on the scale`, `The ticket was wrong` or `Correcting an entry`. Or pick `Something else…` and type your own.
6. Set `When`, add `Notes`, and tap {button:Correct weight|primary}. You see `Weight corrected — Baxter now reads 6 lb.`

The delivery entries are left exactly as they were recorded. The correction is a record of its own, dated and with your name on it, and every figure in pounds on this page reads through it: the batch's `about … lb`, the `On hand` card, and the truck load in Retail all move together. A wrong correction is put right with another one.

Once a batch has a correction, a `Weight corrections` list appears above `Recent entries`: when, which batch, why with your note and what the batch read at the time, the correction with its sign, and what it read once that correction landed.

## How to retire something

1. Tap {button:Retire|ghost}. You are asked to confirm.
2. The dialog tells you the stock stays on hand, in every balance and every valuation. Nothing in your accounts changes.
3. Tap {button:Retire it|primary}. You see `Retired`.
4. To undo it, tap {button:Put back|outline}. You see `Back in the list`.

## Messages

| Message | What it means |
| --- | --- |
| `Batch started` | The batch exists and can be recorded against. |
| `Stock recorded in` / `Stock recorded out` | The entry is in. Out also tells you the cost. |
| `Stock recorded in · batch B-2026-09-09 started` | The delivery is in and its batch was started with it. |
| `Adjusted up` / `Adjusted down` | The correction is in. |
| `Split — the total is unchanged` | Part of the batch is now a batch of its own. |
| `Cost corrected.` | The batch is carried at a different figure. |
| `Weight corrected — Baxter now reads 6 lb.` | The correction is in, and every figure in pounds reads through it. |
| `nothing in this batch has been weighed yet — record a weight on a delivery first` | The batch has no weight to correct. Record a delivery with a weight instead. |
| `this batch already reads 6 lb` | The figure you typed is what the batch already reads. Nothing was recorded. |
| `Saved` | Your changes to the {{item|lower}} are in. |
| `Retired` / `Back in the list` | It is out of, or back in, the lists. |
| `No batches yet` | Nothing has been started. An owner starts the first. |
| `Nothing on hand anywhere.` | Every place nets to zero. |
| `Enter a quantity other than zero.` | The amount box was left at zero. |
| `Name the new batch, or pick one.` | You chose `New batch…` and left `Batch code` empty. |
| `this item already has movements recorded in its current unit, so changing it would restate every one of them` | The counted unit is locked. Start a new {{item|lower}} instead. |
| `give either an existing batch or a name for a new one` | You picked a batch and typed a new code. Choose one. |
| `that lot belongs to a different item` | The batch you picked is not this {{item|lower}}'s. Reload and pick again. |
| `Use lowercase letters, numbers and underscores.` | Your own reason has a capital, a symbol, or starts with a digit. |
| `Only an owner can change stock records.` | You are signed in as staff and pressed something an owner keeps — starting a batch, including with `New batch…`, splitting one, correcting a cost or weight, or editing the {{item|lower}}. Recording stock into an existing batch is not one of those. |
| `Something went wrong saving that.` | Something unexpected. It also covers a date that falls in a closed accounting period, which the message does not say. Tell us if you see it. |

## Not on this page

- A batch cannot be edited once it is started. A wrong code, date or line of business is stuck.
- A batch cannot be closed or merged from here.
- Stock in a closed batch cannot be moved. You can see it and correct its cost, and nothing else.
- Only the last twenty five entries are listed, and there is no way to see the rest.
- The counted unit is locked the moment anything moves, even if the balance is back to zero.
- Nothing traces a batch back through its splits, although the record is kept.
- A cost correction cannot be undone. The remedy is an equal and opposite one. A weight correction cannot be undone either; state the right figure again.
- Stock cannot be moved from one place to another here. Record it out of one place and in at the other.
- If you need any of this, ask us.

## Who can do what

Only an owner can start a batch, from either dialog, split one, correct what one cost or weighs, edit the {{item|lower}}, or retire it. Each of those either creates something the accounts group by, or changes what it costs or what the till sells it by.

Recording stock in, out or adjusted is open to everyone, an accountant included. It is what the person unloading the pallet does, and it has to be recorded then rather than reported to somebody who can.
