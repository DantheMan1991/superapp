# Feed

> The largest cash cost, what each group carried of it, and how much feed it took to put on a pound.
> **Route:** /dashboard/m/livestock/feed
> **Order:** 40

Open **Livestock** and click `Feed`. The heading reads `The largest cash cost, and what each lot carried of it. Measured where a bag went to a named lot; allocated where a shared feeder did.`

## The one idea to understand

Feed reaches animals two ways, and the difference is the whole point of this screen.

- **Measured.** A bag issued to one group by name. The cost is worked out the moment it happens and never moves again. This is a number to act on.
- **Allocated.** Feed drawn for a shared feeder, spread across whichever groups were on it, by head and by days. An estimate, and the honest one, because nobody knows which bird ate which pound.

A badge on every row tells you which you are looking at.

## What you see

- **{button:Record a draw|primary}.** Records feed leaving stock. See below, because there is a catch.
- **{button:New feeder|outline}.** Sets up a shared feeder. Owners only.
- **`Last 30 days`, `Last 90 days`, `All time`.** The period every figure on the page is worked out over. `All time` is where it starts.
- **`Fed`, `Measured`, `Allocated`.** What the period cost, split by how it is known.
- **`Feed conversion`.** Pounds of feed per pound of gain, with a badge reading {badge:Measured|outline} or {badge:Estimated|primary}.
- **`By lot`.** A row per group, with twelve columns.
- **`Shared feeders`.** One block per feeder, with who is on it and what their share came to.

## The By lot columns

`Lot`, `Age`, `Head`, `Fed`, `Cost`, `A head now`, `A head placed`, `vs last {{livestockLot|lower}}`, `Weight`, `Gain a day`, `Feed : gain`, and `How it is known`.

Two of those need explaining, and the footnote does it:

- **`A head now`** is the cost over what the group still carries. It falls as birds die, which makes a bad group look cheaper the worse it goes.
- **`A head placed`** is over everything ever placed. **That is the comparison figure.**

**`Feed : gain`** is pounds of feed per pound of gain, over the period between each group's own first and last weighing. Feed fed before anything was weighed is left out, because the gain it made was never measured. When there is no ratio the cell shows a dash and tells you why when you rest on it.

A ratio below 1 : 1 means some of what they ate is not recorded here, most likely pasture. Read it as a floor.

## How to record feed

**There is a catch, and you should know it before you look for the button.** {button:Record a draw|primary} only appears once you have at least one shared feeder. If your farm feeds every group by name, which is right at a small size, the button is not there and there is nothing on this screen you can use.

Record feed by name from the group's own page instead, with {button:Feed|outline}. That records it as measured, which is what you want.

If you do have a feeder:

1. Click {button:Record a draw|primary}.
2. Choose `A shared feeder` or `One by name`.
3. Pick the `Feeder`, or who ate it. With exactly one feeder the picker is hidden and that feeder is used.
4. Pick `What was drawn`. Animals are not listed, so you cannot draw chicks into a feed bin.
5. Type `How much`, set `When`.
6. Pick `Out of which delivery` and `Where from` if you know them.
7. Add `Notes`. Click {button:Record|primary}. You see `Drawn · $84.00`, or `Drawn · no price on record`.

Stock leaves immediately either way, and the cost is worked out at that moment.

## How to run a shared feeder

1. Click {button:New feeder|outline}. Give it a `Name` such as `Broiler bin`. Owners only.
2. In its block, click {button:Add a lot|outline}. Pick the group and set `Went on`. The help reads `Backdate it if they have been on it a while — the share is worked out day by day, so the date changes the answer.`
3. When they come off, click {button:Take off|ghost} and give the last day. That day still counts as a day on feed.
4. When the feeder is finished, click {button:Close|ghost}. Its history still reports. There is no confirmation, and no way to reopen it from here.

{button:Add a lot|outline} greys out when every group with animals is already on the feeder, and does not say so.

## What the caveat panel tells you

When something did not land cleanly you see a dashed panel:

- `$120.00 could not be allocated.` means feed was drawn for a feeder no group was on. Put the groups on it, backdated, and it lands.
- `3 entries carried no price` means spent grain, surplus milk and windfalls. Real feed with no invoice, so it counts as fed and not as spent.
- `40 older draws were not read into this report.` means you have passed the limit this report reads.

## Messages

| Message | What it means |
| --- | --- |
| `Feeder added` | The shared feeder exists. Put groups on it next. |
| `On the feeder` / `Off the feeder` | The membership is recorded from that day. |
| `Drawn · $84.00` | The feed left stock and cost that. |
| `Fed · no price on record` | It left stock, and nothing has ever been priced for it. |
| `Broiler bin closed — its history still reports` | The feeder is finished and nothing is lost. |
| `Nothing to weigh up yet` | No animals to carry a cost yet. |
| `No shared feeders, and at this size that is right.` | Feeding by name is the better record while somebody knows which pen a bag went to. |
| `Nothing has been weighed twice yet.` | Gain needs two weighings. The second turns this into a number. |
| `that lot is already on this feeder` | It is already on. |
| `they went on the feeder on 2026-08-01, so they cannot come off before that` | The last day has to be on or after the first. |
| `Only an owner can change animal records.` | Adding or closing a feeder is owners only. |

## Not on this page

- There is no ration, recipe or mix. Feed is any stock item that is not an animal.
- You cannot record feed from this screen unless you have a shared feeder. Use the group's own page.
- `Who ate it` lists groups that have no animals left in them, so check before you pick.
- Closing a feeder cannot be undone here.
- Allocated cost stays with the group when animals are processed out. Only measured cost travels with the meat, and the `left on the lot` line tells you how much stayed.
- If you need any of this, ask us.

## Who can do what

Only an owner can add or close a shared feeder. Everyone can record a draw, put groups on a feeder and take them off, and everyone sees every figure.
