# One {{livestockLot|lower}}

> Everything about one group or one named animal: head, losses, feed, weight, withdrawal, where they are, breeding, tags, checks and treatments.
> **Route:** /dashboard/m/livestock/*
> **Order:** 20

Open **Livestock** and click a name. The heading is the name, with the species, the breeding, the paddock it is inside, its sex and its preferred tag beneath.

A named animal and a group share this page. Where they differ, the page says so.

The page runs in this order: the buttons, the panels, what is on the books, `In this {{livestockLot|lower}}`, `Daily checks`, `Treatments`, `Weighings`, `Breeding`, `Photos`, `Tags`, `Fed in by name` and `Head events`. The working records come before the identity ones, because a check, a dose and a weight are what you came to the page to do.

## Finding your way on a phone

- **`On this page`.** A row of chips under the five tabs, on a phone only: `In this {{livestockLot|lower}}`, `Checks`, `Treatments`, `Weighings`, `Breeding`, `Photos`, `Tags`, `Fed`, `Head events`. Tap one and the page jumps to that section. A chip is only there when its section is, so a group with no weighings has no `Weighings` chip.
- **The panels sit two to a row** on a phone. `Fed` and `Withdrawal` take a whole row each, because they carry a sentence.
- **Treatments, weighings and the animals in a group are cards** on a phone rather than tables, with {button:Correct|ghost}, {button:Remove|ghost} and {button:Take out|ghost} on the card itself. On a wide screen they are tables with the same buttons at the right of each row.

## What you can do from the top

- **{button:Place head|primary}.** Records animals arriving. Hatched, bought in, or born.
- **{button:Record loss|outline}.** Records animals leaving. The dialog is headed `Head leaving`. Only while there is loose head in it: a named animal's loss is recorded on her own page, and a finished or closed group has nothing to lose.
- **{button:Treat|outline}.** Records a treatment and its withdrawal. Only when there are animals in it, loose or named.
- **{button:Weigh|outline}.** Records a weighing. Only when there are animals in it, loose or named.
- **{button:Feed|outline}.** Issues feed to this one by name.
- **{button:Move to a paddock|outline}.** Moves them, and starts the old paddock's rest clock.
- **{button:Split|outline}.** Cuts head into a new group inside this one. Owners only. The dialog asks `How many`, `When` and `Name for the new lot`.
- **{button:Record as individuals|outline}.** Names animals out of a group. Owners only.
- **{button:Close this lot|outline}.** Finishes a group. Owners only, and only when it is empty.

Everyone can use the first six. Only an owner sees the last three.

## The panels

- **`Head`.** Everything standing in it: the loose head plus every named animal living inside. Underneath, `{n} in, {n} out`, or for a group with animals in it `4 loose, 5 named inside · 9 in, 0 out`. Before anything has been placed it reads `—`. It is the same figure the list on the previous page shows.
- **`Lost`.** The share that died, over everything placed, named animals included. A cow named out of this group is never counted twice.
- **`Age`.** From the birth date, or `Birth date not recorded.`
- **`Fed`.** What feed has cost, with a badge saying how it is known: {badge:Measured|outline} for feed issued to this one by name, {badge:Allocated|primary} for a share of a shared feeder. Rest on the badge to see what that means. Underneath, what was fed and `$2.00 a head at today's count`: the feed still on the group, over the animals standing in it. Once some of the group has been processed, a line reads `$43.15 left with what was processed · $98.52 still on this lot.` Both figures are what the group is carried at, everything ever spent on it less what left, and when the animals were bought with a price, or had medicine or a cost correction on them, the line adds `Both count what the animals cost to buy and anything else spent on them, not feed alone.` In that case the a-head figure gives way to `Some of this lot has been processed, and what left carried more than feed`, and the rest of that sentence explains why: the ledger records what left as one total and cannot say how much of it was feed. The second figure can read below zero, as `−$300.00`, only when a cost correction landed after the stock had left. When part of the cost is a share of a shared feeder, another line reads `$85.00 issued by name, $56.67 a share of a shared feeder`, and once something has been processed it adds that a share stays with the pen rather than travelling with the meat.
- **`Weight`.** The latest weighing with a badge for how it was taken: {badge:Scale|outline}, {badge:Sampled|outline}, {badge:Tape|primary} or {badge:Eye|primary}. Underneath, the daily gain once there are two weighings.
- **`Withdrawal`.** `Clear`, a date, or `Not looked up`. Milk is shown separately when its clock differs. A treatment given to the group she lives in counts for her from the day she went in until the day she came out. On a group, a line underneath reads `1 animal living in this lot is not clear on a clock of her own` when an animal inside was treated on her own; the group's own clock stays as it is.
- **`Where`.** The paddock and since when. Off a paddock it reads `Not on a paddock. Moving them off is what starts a paddock's rest clock.`
- **`On the books as`.** Whether they are stock or a capital asset. Only when Assets is switched on.

## How to place and lose head

1. Click {button:Place head|primary}. Type `How many`, set `When`, add `Notes`. Click {button:Place|primary}. You see `Placed`.
2. Click {button:Record loss|outline} for animals leaving. Pick `What happened`: `Died`, `Culled` or `Sold live`.
3. Type `How many`, set `When`, add `Notes`. Click {button:Record|primary}. You see `Recorded`.

`Processed` is deliberately not an option. Head only leave for a processing run through Production.

## How to record a treatment

1. Click {button:Treat|outline}. The dialog says `The withdrawal is the point of this record: until it clears, these cannot be processed and their milk cannot be sold. Read the periods off the label in front of you — this app does not know them and will not guess.`
2. Type `What was given`. Products you have used before are suggested.
3. Set `When`, the first day it was given. For a course, set `Given for (days)`: five days of injections is one record with `5` here, and its withdrawal counts from the last day, as the label says. Leave it at `1` for a single dose.
4. Set the `Dose`, and `How` it was given.
5. **Fill in `Meat withdrawal (days)` and `Milk withdrawal (days)` from the label.** Both start empty.
6. Set `Where those came from`: `From the label`, `From the vet`, or `Not looked up`. Each choice shows a note. `Not looked up` warns you these will read as not clear.
7. Set `How many treated`, and `Given by`.
8. If the medicine came out of your own stock, pick it under `Out of stock` and say how much.
9. Add `Notes`. Click {button:Record|primary}.

A course shows in the list as `5-day course, last dose 2026-08-05` under the product, and `Meat clear` counts from that last day. Correcting the days moves the clock with it.

You see `Recorded`, or `Recorded — look the withdrawal up before these go anywhere` when you left the period blank.

A period left blank reaches [What needs you](/dashboard/today) and the morning email as `PEN-1's withdrawal was never looked up` until you correct the treatment with the period off the label. The day a withdrawal clears, and the day before, reach it too, as `PEN-1 clears withdrawal today` or `tomorrow`.

**The withdrawal applies to the whole group however many were treated.** Nothing can tell the three that were injected from the thirty-seven that were not.

To fix a wrong figure, click {button:Correct|ghost} on the row. Use {button:Remove|ghost} only for a treatment that never happened. Removing one does not put the medicine back on the shelf.

A treatment given to the group this was split out of, or to the group she lives in, shows here too, with `Given to Cows, before this one was split out` or `Given to Cows while she lived in it` under the product. It cannot be changed here. The row tells you which group to correct it on.

## How to weigh

1. Click {button:Weigh|outline}.
2. Pick `How`: `Scale`, `Sampled`, `Tape` or `Eye`. The caveat for each one prints underneath.
3. Set `When`.
4. For a tape, give `Heart girth (in)` and `Length (in)`. Otherwise give `How many` went on the scale and what they read `Together`.
5. Add `Notes`. Click {button:Record|primary}. You see `Weighed`.

Two weighings are what turn feed into a feed-to-gain figure. One is not enough, and the screen says so.

A weighing taken too close to a haul is set aside, and the panel tells you how many.

`The whole lot` in the weighings table multiplies that day's average by **today's** head count, so it changes as animals leave. Read it as a rough total, not a record.

## How to move them to a paddock

1. Click {button:Move to a paddock|outline}.
2. Pick a `Paddock`, or click {button:Use where I am|ghost} to let the phone find it.
3. Set `On`, and `Off` if you already know it.
4. Pick `In a pen or barn` if they are housed. Leave it on `Loose on the paddock` otherwise.
5. Give a `Strip size in acres` if you are strip grazing. Blank means the whole paddock.
6. Click {button:Move|primary}. You see `Moved`, and sometimes `Moved — North paddock is resting from 2026-09-02`.

Moving them off is what starts the old paddock's rest clock. The button is missing entirely when you have no paddocks mapped.

## How to name animals out of a group

1. Click {button:Record as individuals|outline}. Owners only, and only on a group of more than one.
2. Type one name per line. A counter tells you how many you have named and how many stay.
3. Pick what `These are`: `Name`, `Visual tag`, `Official tag`, `EID / RFID` or `Tattoo`.
4. Set `When`. Click {button:Record 4|primary}.

**They stay in this group** and keep eating from the same feeders, and a treatment given to the group afterwards counts for them. Fifty at a time is the limit.

To put an existing animal in, or start a new one inside, use {button:Add animals|outline} in the `In this {{livestockLot|lower}}` section. {button:Take out|ghost} takes one back out, and it stays on the farm. Both are open to everyone: which pen an animal is in tonight is a record of where she is, not a decision about the herd. An animal in the list who is not clear on a clock of her own wears a {badge:7 days left|primary} badge beside her name.

## How to add and take off a tag

1. Click {button:Add a tag|outline} in the `Tags` section. Pick a `Kind`: `Name`, `Visual tag`, `Official tag`, `EID / RFID` or `Tattoo`.
2. Type the `Value` and set `Applied`. Click {button:Add tag|primary}. You see `Tag added`.
3. When a tag comes out or is replaced, click {button:Take off|ghost} beside its {badge:current|outline} badge. You are asked `Take 47 off?` Set `Removed on` and click {button:Take off|primary}. You see `47 taken off — still on the record`.

A tag taken off stays in the list with its removed date, and searching for its number still finds this animal. The `Applied` column is hidden on a phone to make room for the button.

## How to add a photo

Click {button:Add a photo|outline|image-plus} in the `Photos` section and pick one or more files. On a phone, {button:Take photo|outline|camera} sits beside it and opens the camera instead. You see `Photo added`. The first one becomes the picture of this {{livestockLot|lower}}; rest on another photo and click its star to make that one the picture shown on the list. Your accountant cannot add or remove photos.

## How to record breeding and births

- {button:Set breeding|outline} records what an animal is made of, in parts. `Two parts Angus beside one Hereford and one Simmental is ½, ¼ and ¼`.
- {button:Set parents|outline} records the dam and the sire. Either one alone is worth recording, because a parent nobody knows is half the animal.
- {button:Record a birth|outline} starts a record with both parents on it, places the head, and puts it in the same group as its mother. It asks for the `Name`, `How many`, `Born`, `Sex` and `Counted as`.

All three are owners only, and the last two are for named animals.

Breeding you enter beats breeding worked out from parents, and the panel says which you are looking at.

## The due window

The `Due` panel in `Breeding` is the calendar for this animal, or for the loose head of this group. It is not shown for a male. The big line reads where she stands: `Due 2027-02-08 to 2027-05-11 · in 153 days`, `Due about 2027-03-13 · in 179 days` once a check has narrowed it, `Due now`, `12 days past the window · was due by 2027-05-11`, `Gave birth 2027-03-01 · 21 days into the window`, `Found open 2026-10-01` or `Lost the pregnancy 2026-11-05`. Before anything is recorded it reads `—` with `No breeding on record` under it. The badge beside `Due` reads {badge:Exposed|outline}, {badge:Pregnant|outline}, {badge:Due now|primary}, {badge:Past the window|destructive}, {badge:Gave birth|outline}, {badge:Open|outline} or {badge:Lost|outline}. Under the line: who she was bred to, `in with Cows` when the breeding was recorded on the group she lives in, the dates, and the gestation used.

**A breeding recorded on a group reaches every female living in it** from the day the sire went in to the day he came out, the way a treatment in the water does. Record it once on the group; each animal inside reads it on her own page as `recorded on Cows`, and cannot correct it there. The bull himself, and any male living in the group, reads nothing.

- **{button:Record breeding|outline}.** The dialog is headed `Who was in with Rosie?` Pick the `Sire` from the animals of this species that are not recorded as female, or leave `Not recorded` for AI or a bull nobody made a record for. Enter `In`, the day he went in, and `Out`, the day he came out. Leave `Out` blank while he is still in. For AI or a hand service, put the same day in both. `Gestation (days)` is set for the species, 283 for cattle and 114 for swine on a farm profile. Change it if your breed runs long; the figure stays on this record whatever is changed later. Click {button:Record breeding|primary}. You see `Breeding recorded`, or `Breeding recorded — say when he comes out` if `Out` was blank.
- **{button:He’s out|outline}.** On a breeding with no `Out` date. Enter `Came out` and click {button:Record it|primary}. You see `Out date recorded — the due window is set`. Until then the far end of the window grows by a day every day.
- **{button:Preg check|outline}.** The dialog is headed `What did you find with Rosie?` Enter `Checked` and pick what was `Found`: `Pregnant`, `Open` or `Lost the pregnancy`. For `Pregnant`, `Days pregnant` takes the vet's estimate and narrows the window to that date give or take a week. Leave it blank and the window stays as it was. Click {button:Record check|primary}. You see `Pregnancy recorded`, `Open recorded — no due date until she is bred again` or `Loss recorded`.
- **The record under the panel.** One line per breeding: the sire, `in 2026-05-01, out 2026-08-01` or `still in`, and under it the due window with the gestation. One line per check: what was found, when, and the days. {button:Correct|ghost} opens every field of a breeding. {button:Remove|ghost} asks first and takes a breeding or a check off; any birth recorded stays, and the calendar is worked out again without it.
- **`Inside`.** On a group, one line per animal living in it with where she stands, or `Nothing recorded`. A male reads `—`. Click a name to open her page.

A birth recorded with {button:Record a birth|outline} closes the cycle on its own: nothing on the calendar has to be told. A birth more than a month before the window opened is not counted against it, because it came from a breeding nobody recorded.

The [Breeding](breeding.md) page lists everyone who is due across the farm.

## How to move an animal to breeding stock

Owners only, on a single animal, and only when Assets is switched on.

1. Click {button:Move to breeding stock|outline}.
2. Pick the account `Her cost sits in`.
3. Set `From`, and choose whether `She depreciates from here` and over how many months.
4. Click {button:Move to breeding stock|primary}.

She stops being stock and becomes something the business owns. What she cost moves out of inventory and into fixed assets. **A run cannot take her until she comes back**, which you do with {button:Back to the market herd|outline}.

## Messages

| Message | What it means |
| --- | --- |
| `Placed` / `Recorded` / `Weighed` | The entry is in and the count has moved. |
| `Recorded — look the withdrawal up before these go anywhere` | The treatment is recorded with no period. They read as not clear. |
| `Split — the total is unchanged` | Head moved into a new group inside this one. |
| `4 animals recorded on their own` | They have pages of their own and stay in this group. |
| `Moved — North paddock is resting from 2026-09-02` | They moved and the old paddock's rest clock started. |
| `Removed — the stock that went out is still on the pen` | The treatment record is gone. The medicine really did leave the shelf. |
| `Bluebell is breeding stock — $1,450.00 moved to fixed assets` | She is a capital asset now. |
| `You are not inside any mapped paddock. Trace its boundary and this will find it.` | The phone found you, but that ground has no boundary drawn. |
| `{n} head still in it — record what happened to them first` | A group cannot be closed with animals in it. |
| `Every animal in this lot is named. A loss is recorded on the animal, under it` | The daily check on a group with nothing loose has no `Head leaving` box. Open the animal's page, or her line on the round, to record her loss. |
| `that lot is already inside another one, and lots only nest one deep` | Groups nest one level, not two. |
| `Only an owner can change animal records.` | You are signed in as staff. Ask an owner. |
| `A course runs for at least one day.` | `Given for (days)` has to be a whole number of one or more. |
| `Breeding recorded — say when he comes out` | The sire is still in. Click {button:He’s out|outline} when he leaves. |
| `he cannot come out before he went in — check the two dates` | `Out` is before `In`. |
| `that animal is recorded as female and cannot be the sire` | Pick a male, or one whose sex is not recorded. |
| `this animal is recorded as male — record the breeding on the female, or on the pen he was in with` | A male has no due window. |
| `days pregnant only go with an animal found pregnant` | `Days pregnant` was filled in for an animal found open or lost. |
| `47 taken off — still on the record` | The tag is no longer current. It still finds the animal in a search. |
| `Photo added` | The picture is on the record. |

## Not on this page

- Nothing tracks individual animals inside a group unless you name them.
- `Head events`, `Fed in by name` and `Daily checks` show the last 25, 10 and 14 rows, and a line under the list says so when they are full.
- A treatment inherited from a parent group cannot be corrected here.
- A course is one record with a length. It cannot skip days, and each day's dose is not recorded separately.
- A breeding recorded on a group cannot be corrected from an animal's page. Open the group.
- Nothing warns about a heifer being bred to her own sire yet.
- Nothing here gives you a dose or a withdrawal period. Read the label.
- If you need any of this, ask us.

## Who can do what

Everyone can place head, record a loss, treat, weigh, feed, move to a paddock, add a tag, record a daily check, record breeding and a preg check, and correct or remove a treatment, a weighing, a breeding or a check.

Putting an animal into a {{livestockLot|lower}} and taking it out are open to everyone too.

Only an owner can split, name animals out, close or reopen, set breeding or parents, record a birth, or move an animal to and from breeding stock.

Your accountant can do everything a staff member can, except add or remove photos. A photo is a file, and files belong to Documents, where an accountant reads and never writes.
