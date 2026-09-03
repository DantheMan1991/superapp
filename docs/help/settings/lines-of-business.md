# {{enterprise|plural}}

> The parts of the business you want to see a separate profit figure for, how to add and retire them, and what they change in your reports.
> **Route:** /dashboard/settings/enterprises
> **Order:** 40

Open **{{enterprise|plural}}** under `Settings` in the sidebar. Owners only. The page reads `The parts of the business you want to see the money for on their own.` A {{enterprise|lower}} is anything you would want its own figure for. On a farm that might be broilers, beef and the market garden. Most businesses have between three and six. To add one, click {button:Add|primary} in the title row.

## What you see

- **The list.** Three columns: the name, `Kind` and `Notes`. Active ones come first, then retired ones with a {badge:retired|outline} badge, each set in alphabetical order.
- **On each row.** {button:Edit|ghost|pencil}, and then {button:Retire|ghost}, or {button:Put back|outline} on a retired row.
- **The panel at the foot of the page.** The plain statement of what this list changes today. See how to read it, below.

## How to add one

1. Click {button:Add|primary}. The dialog reads `A part of the business you want to see the money for on its own.`
2. Fill in `Name`. Required. Renaming later is safe.
3. Fill in `What kind`. If your industry set supplies kinds, it is a list, for example `Livestock` and `Crop`, plus `Something else` and `Name a new kind…`, which lets you type your own. If not, it is a plain box for a grouping word: `Optional. A word for grouping the list — nothing depends on it.`
4. Add `Notes` if you want them.
5. Click {button:Add|primary}. The button reads `Saving…`, then you see `Added`. A name already in the list, or one with no letters or numbers in it, is refused.

## How to rename one

1. Click {button:Edit|ghost|pencil} on the row. The dialog reads `Renaming is safe — every record already tagged with this {{enterprise|lower}} follows the new name, including in reports.`
2. Change the name, kind or notes, and click {button:Save|primary}.

## How to retire one

1. Click {button:Retire|ghost} on the row. The dialog reads `It stops being offered on new records. Everything already recorded against it keeps reporting, so last year's figures do not move. You can put it back.`
2. Click {button:Retire it|primary}. The row moves to the retired set with its badge.
3. To restore it, click {button:Put back|outline}. There is no confirmation. You see `Back in the list`.

Nothing here can be deleted, only retired.

## How to read the panel at the foot of the page

- Everything here is registered as a reporting dimension, so a {{enterprise|lower}} appears in the grouping picker on the profit and loss report. Items and batches can name one, and a batch inherits its item's.
- What things cost now lands against them. Feed issued to a batch is charged to whatever that batch belongs to, stock sold takes its cost from the batch it came out of, and a fee for processing follows the batches that went in. What you sell does not yet, so the report answers what a {{enterprise|lower}} has cost you, not what it has made you.
- Nothing before the day this was switched on can be counted, and it never will be. Entries already in the books cannot be given a {{enterprise|lower}} without rewriting history, so a report over last year reads Unassigned however much you tag now.
- Retiring one stops it being offered on new records and leaves everything already recorded against it reporting exactly as before.

## Messages

| Message | What it means |
| --- | --- |
| `No {{enterprise|plural|lower}} yet` and `Whatever you would want a separate profit figure for. Most businesses have between three and six, and you can change the list whenever you like.` | The list is empty. Click {button:Add|primary}. |

## Not on this page

A batch is tagged when it is created and cannot be retagged afterwards. The word used for these, {{enterprise|lower}}, comes from your industry set. Ask us if it is the wrong word for your business.

## Who can do what

Only owners see this page.
