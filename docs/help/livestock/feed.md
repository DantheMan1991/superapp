# Feed

> The largest cash cost, what each group carried of it, and how much feed it took to put on a pound.
> **Route:** /dashboard/m/livestock/feed
> **Order:** 40

Open **Livestock** and click `Feed`. The heading reads `The largest cash cost, and what each lot carried of it. Measured where a bag went to a named lot; allocated where a shared feeder did.` To record feed, click {button:Record a draw|primary}.

## The one idea to understand

Feed reaches animals two ways, and the difference is the whole point of this screen.

- **Measured.** A bag issued to one group or one animal by name. The cost is worked out the moment it happens and never moves again. This is a number to act on.
- **Allocated.** Feed drawn for a shared feeder, spread across whichever groups were on it, by head and by days. An estimate, and the honest one, because nobody knows which bird ate which pound.

A badge on every row tells you which you are looking at.

## What you see

- **{button:Record a draw|primary}.** Records feed leaving stock, by name or for a shared feeder. It is there whenever the farm has animals and something to feed them.
- **{button:New feeder|outline}.** Sets up a shared feeder. Owners only.
- **`Last 30 days`, `Last 90 days`, `All time`.** The period the feed figures are worked out over. `All time` is where it starts. Two figures are facts about today rather than about the period, and read the same on every button: `A head now`, and the `still on the lot` line under the cost.
- **`Fed`, `Measured`, `Allocated`.** What the period cost, split by how it is known. Two-up on a phone.
- **`Feed conversion`.** Pounds of feed per pound of gain, with a badge reading {badge:Measured|outline} or {badge:Estimated|primary}.
- **`By lot`.** On a wide screen, a row per group with twelve columns. On a phone, a card per group with the same figures.
- **`Shared feeders`.** One block per feeder, with who is on it and what their share came to.

## The By lot figures

On a wide screen the columns are `Lot`, `Age`, `Head`, `Fed`, `Cost`, `A head now`, `A head placed`, `vs last {{livestockLot|lower}}`, `Weight`, `Gain a day`, `Feed : gain` and `How it is known`. On a phone each card carries the name with species, age and head under it, the cost and what was fed at the top right, then the six figures in a list, then the badge.

Two of those need explaining, and the footnote does it:

- **`A head now`** is the feed still on the group, over the animals standing in it today, whatever period you chose. It rises as animals die, because the same feed is spread over fewer. Once some of the group has been processed and the animals were bought with a price, or had medicine or a cost correction on them, it shows a dash instead: what left carried those as well as feed, and the ledger does not say how much of each. Rest on the dash and it says so.
- **`A head placed`** is over everything ever placed. **That is the comparison figure.**

**`Feed : gain`** is pounds of feed per pound of gain, over the period between each group's own first and last weighing. Feed fed before anything was weighed is left out, because the gain it made was never measured. When there is no ratio the figure shows a dash and tells you why when you rest on it.

A ratio below 1 : 1 means some of what they ate is not recorded here, most likely pasture. Read it as a floor.

When some of a group has been processed, `$200.00 still on the lot` under the cost says what the group is carried at today: everything ever spent on it, less what left with the processed animals. It is a fact about today, worked out over the group's whole life whatever period you chose, so `Last 30 days` reads the same as `All time`. When the animals were bought with a price, or had medicine or a cost correction on them, the line adds `everything they cost, not feed alone`: what left carried those too, and the ledger records the total rather than its parts, so the feed alone cannot be told. The figure can read below zero, as `−$10.20`, only when a cost correction landed after the stock had left.

## How to record feed

1. Click {button:Record a draw|primary}.
2. With a shared feeder on the farm, choose `A shared feeder` or `One by name`. With none, the dialog opens straight on `Feed one` and asks nothing about feeders.
3. Pick who ate it under `Who ate it`, or the `Feeder`. Only groups and animals with head in them are offered. With exactly one feeder the picker is hidden and that feeder is used.
4. Pick `What was drawn`. Animals are not listed, so you cannot draw chicks into a feed bin.
5. Type `How much`, set `When`.
6. Pick `Out of which delivery` and `Where from` if you know them.
7. Add `Notes`. Click {button:Record|primary}. You see `Fed · $84.00` or `Drawn · $84.00`, or `no price on record` when nothing has ever been priced for it.

Stock leaves immediately either way, and the cost is worked out at that moment. Feeding by name is the better record while somebody knows which pen a bag went to. A group's own page has the same dialog behind {button:Feed|outline}, already pointed at that group.

## How to run a shared feeder

1. Click {button:New feeder|outline}. Give it a `Name` such as `Broiler bin`. Owners only.
2. In its block, click {button:Add a lot|outline}. Pick the group and set `Went on`. The help reads `Backdate it if they have been on it a while — the share is worked out day by day, so the date changes the answer.`
3. When they come off, click {button:Take off|ghost} and give the last day. That day still counts as a day on feed. On a phone each group on the feeder is a card with {button:Take off|ghost} on it.
4. When the feeder is finished, click {button:Close|ghost}. You are asked `Close Broiler bin?` with `Nothing more can be drawn for it or put on it, and there is no way to reopen it from here. What was drawn and who ate it still report.` Click {button:Close feeder|primary}. Its history still reports.

{button:Add a lot|outline} greys out when every group with animals is already on the feeder. Rest on it and it says so.

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
| `Fed · $84.00` | The feed left stock, by name, and cost that. |
| `Drawn · $84.00` | The feed left stock, for a feeder, and cost that. |
| `Fed · no price on record` | It left stock, and nothing has ever been priced for it. |
| `Close Broiler bin?` | The question before a feeder closes. {button:Cancel|outline} keeps it open. |
| `Broiler bin closed — its history still reports` | The feeder is finished and nothing is lost. |
| `Nothing to weigh up yet` | No animals to carry a cost yet. |
| `No shared feeders, and at this size that is right.` | Feeding by name is the better record while somebody knows which pen a bag went to. Record a draw above does that. |
| `Nothing has been weighed twice yet.` | Gain needs two weighings. The second turns this into a number. |
| `Every lot with animals in it is already on this feeder` | Why {button:Add a lot|outline} is greyed out. |
| `that lot is already on this feeder` | It is already on. |
| `they went on the feeder on 2026-08-01, so they cannot come off before that` | The last day has to be on or after the first. |
| `Only an owner can change animal records.` | Adding or closing a feeder is owners only. |

## Not on this page

- There is no ration, recipe or mix. Feed is any stock item that is not an animal.
- A closed feeder cannot be reopened here.
- Allocated cost stays with the group when animals are processed out. Only measured cost travels with the meat, and the `still on the lot` line tells you what the group is carried at.
- If you need any of this, ask us.

## Who can do what

Only an owner can add or close a shared feeder. Everyone can record a draw, put groups on a feeder and take them off, and everyone sees every figure.
