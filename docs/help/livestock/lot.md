# One {{livestockLot|lower}}

> Everything about one group or one named animal: head, losses, feed, weight, withdrawal, where they are, breeding, tags, checks and treatments.
> **Route:** /dashboard/m/livestock/*
> **Order:** 20

Open **Livestock** and click a name. The heading is the name, with the species, the breeding, the paddock it is inside, its sex and its preferred tag beneath.

A named animal and a group share this page. Where they differ, the page says so.

## What you can do from the top

- **{button:Place head|primary}.** Records animals arriving. Hatched, bought in, or born.
- **{button:Record loss|outline}.** Records animals leaving. The dialog is headed `Head leaving`.
- **{button:Treat|outline}.** Records a treatment and its withdrawal. Only when there are head.
- **{button:Weigh|outline}.** Records a weighing. Only when there are head.
- **{button:Feed|outline}.** Issues feed to this one by name.
- **{button:Move to a paddock|outline}.** Moves them, and starts the old paddock's rest clock.
- **{button:Split|outline}.** Cuts head into a new group inside this one. Owners only.
- **{button:Record as individuals|outline}.** Names animals out of a group. Owners only.
- **{button:Close this lot|outline}.** Finishes a group. Owners only, and only when it is empty.

Everyone can use the first six. Only an owner sees the last three.

## The panels

- **`Head`.** The count, with `{n} in, {n} out` underneath. **This is the group's own head and does not include named animals inside it**, which the list on the previous page does count. A group whose head are all named members reads zero here, and that hides `Treat`, `Weigh` and the daily check. Tell us if you hit that.
- **`Lost`.** The share that died, over everything placed.
- **`Age`.** From the birth date, or `Birth date not recorded.`
- **`Fed`.** What feed has cost, with a badge saying how it is known: {badge:Measured|outline} for feed issued to this one by name, {badge:Allocated|primary} for a share of a shared feeder. Rest on the badge to see what that means.
- **`Weight`.** The latest weighing with a badge for how it was taken: {badge:Scale|outline}, {badge:Sampled|outline}, {badge:Tape|primary} or {badge:Eye|primary}. Underneath, the daily gain once there are two weighings.
- **`Withdrawal`.** `Clear`, a date, or `Not looked up`. Milk is shown separately when its clock differs.
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
3. Set `When`, the `Dose`, and `How` it was given.
4. **Fill in `Meat withdrawal (days)` and `Milk withdrawal (days)` from the label.** Both start empty.
5. Set `Where those came from`: `From the label`, `From the vet`, or `Not looked up`. Each choice shows a note. `Not looked up` warns you these will read as not clear.
6. Set `How many treated`, and `Given by`.
7. If the medicine came out of your own stock, pick it under `Out of stock` and say how much.
8. Add `Notes`. Click {button:Record|primary}.

You see `Recorded`, or `Recorded — look the withdrawal up before these go anywhere` when you left the period blank.

**The withdrawal applies to the whole group however many were treated.** Nothing can tell the three that were injected from the thirty-seven that were not.

To fix a wrong figure, click {button:Correct|ghost} on the row. Use {button:Remove|ghost} only for a treatment that never happened. Removing one does not put the medicine back on the shelf.

A treatment inherited from a group this was split out of cannot be changed here. The row tells you which one to correct it on.

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

**They stay in this group** and keep eating from the same feeders. Fifty at a time is the limit.

To put an existing animal in, or start a new one inside, use {button:Add animals|outline} in the `In this {{livestockLot|lower}}` section. {button:Take out|ghost} takes one back out, and it stays on the farm. Both are open to everyone: which pen an animal is in tonight is a record of where she is, not a decision about the herd.

## How to record breeding and births

- {button:Set breeding|outline} records what an animal is made of, in parts. `Two parts Angus beside one Hereford and one Simmental is ½, ¼ and ¼`.
- {button:Set parents|outline} records the dam and the sire. Either one alone is worth recording, because a parent nobody knows is half the animal.
- {button:Record a birth|outline} starts a record with both parents on it, places the head, and puts it in the same group as its mother.

All three are owners only, and the last two are for named animals.

Breeding you enter beats breeding worked out from parents, and the panel says which you are looking at.

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
| `that lot is already inside another one, and lots only nest one deep` | Groups nest one level, not two. |
| `Only an owner can change animal records.` | You are signed in as staff. Ask an owner. |

## Not on this page

- Nothing tracks individual animals inside a group unless you name them.
- `Head events`, `Fed in by name` and `Daily checks` stop at 25, 10 and 14 rows without saying so.
- A treatment inherited from a parent group cannot be corrected here.
- `Record loss` is offered even on an empty or closed group, and then fails.
- Nothing here gives you a dose or a withdrawal period. Read the label.
- If you need any of this, ask us.

## Who can do what

Everyone can place head, record a loss, treat, weigh, feed, move to a paddock, add a tag, record a daily check, and correct or remove a treatment or weighing.

Putting an animal into a {{livestockLot|lower}} and taking it out are open to everyone too.

Only an owner can split, name animals out, close or reopen, set breeding or parents, record a birth, or move an animal to and from breeding stock.

Your accountant can do everything a staff member can, except add or remove photos. A photo is a file, and files belong to Documents, where an accountant reads and never writes.
