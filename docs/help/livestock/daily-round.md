# The daily round

> One tap per group to say you looked and they are fine, and somewhere to write it down when they are not.
> **Route:** /dashboard/m/livestock/log
> **Order:** 30

Open **Livestock** and click `Daily round`. The heading reads `What you saw today, 2026-09-03. Most days nothing happens — say so in one tap.`

Everyone can walk the round, including your accountant. The round is walked by whoever is in the pens, and the page is built to be used on a phone in a barn.

## Why the record matters

A day with no entry is a day nobody looked, and that is a different fact from a day when nothing happened. Your loss rate is worked out over the days somebody actually walked the pens, so the empty rows are load-bearing.

A group nobody has looked at for two days or more reaches [What needs you](/dashboard/today) and the morning email as `PEN-1 has not been looked at for 3 days`, for everyone in the business. Walking the round clears it. A group checked yesterday is not raised.

## What you see

- **`Tell it what happened`.** A box at the top of the page, above the round. Type one sentence — `Three chicks dead in pen two` — and it works out what to record. See how to tell it, below. Everyone who can walk the round can use it.
- **{button:All normal (6)|primary|check}.** Marks every group and every named animal you have not yet touched today as normal. Only appears while something is left.
- **`Checked`.** How many of today's groups and animals you have looked at, counted together. It turns green when you are done.
- **`Streak`.** How many days in a row the round was walked, across the whole farm.
- **`Lost today`.** Head recorded as lost today, in groups and in named animals alike. It turns red when there are any. Head sold live today are not lost, so they are named underneath instead: `Nothing lost. 2 sold live, already off the count.`
- **The list.** One row per group, with the named animals living in it listed under it. On a wide screen it is a table with the columns `Lot`, `Where`, `Head`, `Lost today`, `Last checked` and `Today`. On a phone it is one card per group with the same facts, the same two buttons, and the animals in a list at the bottom of the card, so nothing sits off the edge of the screen.
- **`Noted today`.** Only appears when something was flagged, listing each group or animal and what was seen.

Only groups with animals in them, loose or named, are listed. A finished group drops off. A named animal living in a group is listed under it, never on her own; an animal living in no group is a row of her own.

## The columns, and the card

- **`Lot`.** The name, its species underneath, and a {badge:Withdrawal · 7 days left|primary} badge when something is holding them back. A group that is clear shows no badge at all. A group with named animals in it also reads `4 loose, 5 named` under its species. Under the group, each named animal is a line of her own with her name, her withdrawal badge if she is not clear, and her own check badge. Her badge counts a treatment given to her group while she lived in it as well as one given to her alone.
- **`Where`.** The paddock, with the pen or barn after it. On a phone it follows the species on the same line, and is left out when they are on no paddock. A named animal's line reads `in Cows`.
- **`Head`.** Everything standing in the group: the loose head plus every named animal in it. A named animal's own line reads `1`. On a phone it reads `99 head` at the top right of the card.
- **`Lost today`.** Head lost today, or a dash. Head sold live today show underneath as `2 sold live`, because a sale is not a loss. On a phone the card reads `3 lost today`, `2 sold live today`, or `3 lost, 2 sold live today` in the same corner, and nothing at all when nothing left. A named animal's own loss shows on her line and is counted in the group's figure too.
- **`Last checked`.** `Never`, `Today`, `Yesterday` or `5 days ago`.
- **`Today`.** Either {button:Mark normal|outline}, or once you have checked it a {badge:Normal|outline} or {badge:Noted|primary} badge. {button:Something's up|outline} sits beside it, and reads {button:Edit|outline} once there is an entry. On a phone both buttons sit along the bottom of the card. A named animal's line has only {button:Something's up|outline}: marking her group normal marks her too.

## How to tell it what happened

Instead of finding the right lot and the right dialog, say it.

1. Type one sentence into `Tell it what happened`, such as `Three chicks dead in pen two, and moved the cows to the creek field`. One sentence can hold more than one thing.
2. Click {button:Read it|primary|sparkles}. It reads `Reading…` while it works.
3. You get a card for each thing it found: `Animals lost`, `Looked at them`, `Moved somewhere` or `Fed them`, with the fields already filled in. Read every one. Change anything that is wrong, and click {icon:x} on a card you do not want.
4. Anything it could not place is left empty with an amber line under it: `It heard “the back pen” — pick or type the right one.` Pick from the list. It never guesses the nearest pen.
5. A card that is not ready says so: `Which animals is missing.` The button stays gray until every card is complete.
6. Click {button:Record 2 things|primary}. You see what was recorded, such as `3 head — died — from Pen 2`.

What it can record, and what it needs:

| Card | What it records | It needs |
| --- | --- | --- |
| `Animals lost` | Head that died, were culled or were sold live, exactly as {button:Something's up|outline} does | Which animals, how many, and what happened |
| `Looked at them` | That you walked the pen, with a note if you saw something | Which animals |
| `Moved somewhere` | Animals moved onto a paddock | Which animals, and where to. Only when you keep Land |
| `Fed them` | Feed or other stock given to animals, taken out of stock | Which animals, what, and how much **in the unit that item is counted in**, shown beside its name. Only when you keep Inventory |

`When` fills itself in with today, because you are usually saying it where it happened on the day it happened. Everything else is left blank unless the sentence says it. It never invents a number, a pen or a date.

Only lots with animals in them are offered, so a finished group cannot be picked by mistake. **Treatments cannot be told this way**, on purpose: a treatment sets the withdrawal clock that decides whether meat may be sold, and that is worth four deliberate answers on its own screen. Weights are the same, since you have the scale in front of you anyway.

If nothing is recorded, either all the cards are recorded or none of them are — two things said in one sentence happened together.

## How to walk the round

1. Go down the list. For every group that is fine, click {button:Mark normal|outline}. That marks the group and every animal living in it. You see `Marked normal`, or `6 marked normal` when animals were marked with it.
2. Or click {button:All normal (6)|primary|check} once to do every untouched group and animal at once. You see `6 lots marked normal`.
3. For a group that is not fine, click {button:Something's up|outline}. For one animal that is not fine, click {button:Something's up|outline} on her own line, under the group.

{button:All normal|primary|check} and {button:Mark normal|outline} never overwrite a group or an animal you have already flagged, and the number they report is what they actually recorded.

## How to record something you saw

1. Click {button:Something's up|outline}. The dialog is headed with the group's name, or the animal's, and reads `What you saw today. Losses go straight to the head count, so the two never disagree.`
2. If animals left, type how many into `Head leaving` and pick `What happened`: `Died`, `Culled` or `Sold live`. On a group, the box takes at most the head that is loose in it. On a named animal it takes `1`.
3. Write what you saw into `Notes`, such as `Lame in the left hind. Water was frozen.`
4. Click {button:Record|primary}. You see `Recorded`.

The help reads `Leave both empty and this records a normal day — which still counts, because "nothing died" and "nobody looked" are different facts.`

On a group whose animals are all named, the dialog has no `Head leaving` box. It reads `Every animal in this lot is named. A loss is recorded on the animal, under it — this records what you saw of the lot.` Record the loss with {button:Something's up|outline} on the animal's own line.

Anything with head leaving or a note shows as {badge:Noted|primary} rather than {badge:Normal|outline}. That is a bookmark for you, not a severity.

Head leaving goes straight onto the head count in the same action, so the two never disagree. `Died` and `Culled` count under `Lost today`; `Sold live` is named beneath it and in the `Noted today` list, and never counts as a loss.

Checking a group or an animal twice in one day updates the first entry rather than adding a second.

## Messages

| Message | What it means |
| --- | --- |
| `3 head — died — from Pen 2` and `Recorded 2 things` | What the box recorded. One line when it was one thing, a count when it was more. |
| `Nothing to record from that.` | The sentence described nothing it can record. Treatments and weights are on their own screens. |
| `It heard “the back pen” — pick or type the right one.` | A word matched no pen, paddock or feed you have. Pick from the list. |
| `Which animals is missing.` and `How many is missing.` | A card is short of something it must have. |
| `Fed them: an issue has to be a positive quantity` | A card was refused, named by its heading, in the words of the part of the app that refused it. Nothing was recorded, including the other cards. |
| `There is nothing here to tell yet.` | You have no lots with animals in them, so there is nothing to say anything about. |
| `It could not read that. Try saying it more plainly.` | The reading came back in a shape it could not use. |
| `Give it a moment, then try again.` | Two readings within a few seconds. |
| `Marked normal` | The group is recorded as looked at and fine. |
| `6 marked normal` | The group and the animals in it were recorded. Ones already done are not counted again. |
| `6 lots marked normal` | Everything untouched was recorded. Ones already done are not counted again. |
| `Recorded` | The check is in, and any head leaving is already off the head count. |
| `Nothing to check yet` | No group has animals in it. Start one and place head. |
| `The whole farm, today.` | Everything has been looked at. |
| `Record today and it starts.` | Your streak is at zero. |
| `Head leaving has to be a number.` | The box had something other than a number in it. |
| `Only 40 head are in this lot.` | You recorded more leaving than are loose in it. |
| `Every animal in this lot is named.` | Nothing is loose in the group, so a loss belongs on the animal's own line. |
| `2 sold live` | Two head were sold live today. They are off the count and are not a loss. |
| `3 lost, no note left.` | The group or animal was flagged with head leaving and nothing written. |
| `Withdrawal · Not looked up` | Somebody treated them and never read the label. Treat them as not clear. |

## Not on this page

- The round cannot be walked for a past day. It is always today.
- A group with no animals in it is not listed, even if you want to note something about it.
- Everything else about a group lives on its own page: weights, treatments, breeding, photos, moving them.
- A named animal cannot be marked normal on her own. Her group's {button:Mark normal|outline} covers her, and {button:All normal|primary|check} covers everything.
- If you need any of this, ask us.

## Who can do what

Everyone. Every control on this page is open to owners, staff and your accountant alike.
