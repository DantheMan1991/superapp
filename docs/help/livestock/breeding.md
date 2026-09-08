# Breeding

> Who is due and when, worked out from the day the sire went in, what the vet found, and the birth when it comes.
> **Route:** /dashboard/m/livestock/breeding
> **Order:** 45

Open **Livestock** and click `Breeding`. The heading reads `Who is due, and when. Record breeding on an animal's page, or on the pen the sire was in with.` Nothing is recorded on this page. It reads what you recorded on each animal's page and puts everyone who is due in one list.

## The one idea to understand

A bull running with the cows gives you no service date. What you know is the day he went in and the day he came out. The app pushes that span forward by the gestation and calls it the **due window**: in May 1, out August 1, cattle carry 283 days, so calves from February 8 to May 11.

The window then gets narrower as you learn more.

- **A preg check** that found her pregnant, with the vet's estimate of how far along she is, narrows the window to one date give or take a week.
- **A check that found her open**, or that she lost the pregnancy, closes it. There is no due date until she is bred again.
- **The birth** fixes it. Record the birth on her page as you always have, and her line here reads `Gave birth` with how far into the window she was. Late this year means later next year, which is worth knowing when you decide who stays.

No due date is stored anywhere. Correct the day the sire came out and every date worked out from it moves.

## What you see

- **`Due now`.** How many are inside their window today.
- **`Due in 30 days`.** How many have a window opening within a month.
- **`Past the window`.** How many are past the end of their window with nothing recorded since. In red when there are any.
- **`Pregnant`.** How many a check has confirmed.
- **`Due`.** Every animal with a breeding on record and no birth yet, soonest first. Click a row, or the card on a phone, to open her page.
- **`Finished`.** Cycles that ended, newest first: gave birth, found open, or lost. The last fifty. Each animal's own page has all of hers.

## The Due list

On a wide screen the columns are `Animal`, `Bred to`, `Due` and `Standing`. On a phone each card carries the same facts.

- **`Animal`.** Her name, the species under it, and the group she lives in as `in Cows`. A group with unnamed females in it has a line of its own that reads `Cows · 12 loose`. Once every female in a group is named, the group's own line goes and each animal has hers.
- **`Bred to`.** The sire, or `Not recorded`. `From a check` means nobody recorded the sire going in and the line comes from what the vet found. Under it, `in with Cows` when the breeding was recorded on the group she lives in rather than on her.
- **`Due`.** One of:
  - `Due 2027-02-08 to 2027-05-11 · in 153 days`. The whole window, still to open.
  - `Due about 2027-03-13 · in 179 days`. Narrowed by a check to a week either side.
  - `Due 2027-03-20 · in 12 days`. A single day, from a hand service or AI.
  - `Due now · 2027-02-08 to 2027-05-11`, or `Due today`.
  - `12 days past the window · was due by 2027-05-11`.
  - `Pregnant · due date not known`. A check confirmed her but nothing gives a date.
- **`Standing`.** {badge:Due now|primary}, {badge:Due soon|secondary} within thirty days, {badge:Past the window|destructive}, or {badge:Pregnant|outline} and {badge:Exposed|outline} for a window further off.

While the sire is still in, the far end of the window grows by a day every day he stays. Record the day he came out on the animal's or the group's page and it stops.

## How to get an animal onto this page

1. Open her page, or the page of the group the sire was turned in with.
2. In `Breeding`, click {button:Record breeding|outline}. Pick the sire, enter `In` and `Out`, check the `Gestation (days)` and click {button:Record breeding|primary}.
3. Leave `Out` blank if he is still in. When he comes out, click {button:He’s out|outline} on the record and enter the day.
4. When the vet comes, click {button:Preg check|outline} and record what was found.
5. When she gives birth, click {button:Record a birth|outline} on her page. Her line moves to `Finished`.

The [one animal](lot.md) guide describes each of those dialogs.

## What reaches What needs you

Three lines, and nothing during the window itself: `Rosie is due in 7 days` the week before her window opens, `Rosie is due from today` on the day, and `Rosie is 3 days past the due window` once it has shut with no birth and no check recorded. Click the line to open her page. See [What needs you](../workspace/what-needs-you.md).

## Not on this page

- A male never has a line. Record breeding on the female, or on the group he was in with.
- A group that has never had a female named out of it has one line for all of its loose head. A check recorded on the group counts for all of them.
- Nothing here warns about a heifer being bred to her own sire. That is coming.
- Poultry have no gestation set, so a hatch is not on this calendar.
- If you need any of this, ask us.

## Who can do what

Everyone sees this page. Everyone can record breeding and a preg check, because opening the gate and holding her for the vet are chores. Only an owner can record a birth, because it starts a record and picks the stock line the young are counted in.
