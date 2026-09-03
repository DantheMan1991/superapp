# Your {{productionRun|plural|lower}}

> Every {{productionRun|lower}} with what went in, what came out, the yield between them, and how much of your on-farm allowance is left.
> **Route:** /dashboard/m/production
> **Order:** 10

Open **Production** in the sidebar. The heading reads `What went in, what came out, and the yield between them. Every {{productionRun|lower}} lands its outputs in Inventory carrying the cost of what it consumed.` To record one, click {button:Start a run|primary}.

## What you see

- **{button:Start a run|primary}.** Records a {{productionRun|lower}} on the day it happens. Owners only.
- **The five tabs.** `Overview` is this page.
- **The allowance cards.** Only when your business has an on-farm limit set up. See below.
- **The table.** `{{productionRun}}`, `Kind`, `Started`, `In`, `Out`, `Yield`, `Cost in` and `State`. A `Condemned` column appears only once some {{productionRun|lower}} has a {{killSheet|lower}}.

## The allowance cards

If your profile sets a limit on what may be done on the farm, a card counts what you have used this year: `847 of 1000`. It turns red at the limit.

Only work with no outside business named counts against it, and only on finished {{productionRun|plural|lower}}.

The footnote changes as you approach it. At four fifths it reads `Worth booking a {{processor|lower}} now rather than when it runs out — good ones are booked six to twelve months ahead.` Over the limit it says plainly that what is already processed cannot be undone, and what changes is where that meat may legally be sold.

## The columns

- **`In` and `Out`.** Pounds, to one decimal. A dash means a weight is missing somewhere.
- **`Yield`.** Pounds out over pounds in. A dash is not a failure to calculate, it is a refusal, and resting on it tells you which one: nothing weighed on the way in, nothing weighed on the way out, or **some** of either. A ratio over part of the animals would read far better than the {{productionRun|lower}} actually had, so none is given.
- **`Condemned`.** `3 of 97` in red when a {{killSheet|lower}} records any, `None` when the sheet is clean, a dash when there is no sheet.
- **`Cost in`.** What the batches that went in had accumulated, plus what the plant charged once you record it.
- **`State`.** {badge:Open|primary} or {badge:Finished|outline}. There is no third.

## How to start one

1. Click {button:Start a run|primary}. The dialog reads `Record it on the day it happens. What goes in leaves stock and takes its cost with it; what comes out lands in Inventory when you finish.`
2. Type a `Name`, such as `Kill day 2026-08-22`.
3. Pick a `Kind`, or `Something else…` to type your own.
4. Set `Started`. It begins on today.
5. Pick `Where` it happened.
6. **Pick `Who did it`.** Leave it on `Done here` for work you did yourself. Naming an outside business is what lets this {{productionRun|lower}} carry a {{cutSheet|lower}} and what they charged, **and it decides what the meat may be sold as**. The field is missing entirely until you have added one.
7. Pick a line of business only if this one mixes more than one.
8. Fill in `Who`, `Crew` and `Hours` if you want them on the record.
9. Add `Notes`. Click {button:Start|primary}.

You see `Run started` and land straight on its page.

Crew and hours are recorded per day rather than per bird, and nothing turns them into money.

## Messages

| Message | What it means |
| --- | --- |
| `Run started` | It exists and its page is open. |
| `Nothing made here yet` | None recorded. An owner starts the first. |
| `Nothing has gone in yet, so there is nothing to measure against.` | No yield, because nothing has gone in. |
| `Some of what went in was not weighed.` | No yield on purpose. Weigh everything or none is given. |
| `847 left of 1000 this year.` | Your on-farm allowance, and what is left of it. |
| `Only an owner can change this.` | You are signed in as staff. Ask an owner. |
| `Check the details and try again.` | Something in the dialog is not right. |
| `Something went wrong saving that.` | Something unexpected. Tell us if it keeps happening. |

## Not on this page

- The list cannot be searched, sorted or filtered.
- Nothing can be edited from a row. Open it first.
- A {{productionRun|lower}} cannot be deleted or cancelled.
- The `Yield` refusals show only when you rest on the dash. The {{productionRun|lower}}'s own page prints them in full.
- If you need any of this, ask us.

## Who can do what

Only an owner can start one. Everyone else sees the same table, the same yields and the same allowance cards, with no button in the corner.
