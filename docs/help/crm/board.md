# The deal board

> Every deal you are trying to win, in a column for the stage it has reached. Move a deal along as it progresses, and see what each stage is worth.
> **Route:** /dashboard/m/crm/deals
> **Order:** 70
> **Area:** Board

Open **CRM** in the sidebar, then click `Board` in the row of tabs. Every column is one stage, and every card is one deal. To move a deal along, click {button:Move|ghost|chevron-right} on its card and pick the stage it has reached.

## What you see

- **The title.** The name of the pipeline you are looking at, which is always `Sales`. Nothing in the app renames it. Under it, `Deals by stage, in this business's own words.`
- **The pipeline picker.** An outline button carrying the pipeline's name, at the top right. It appears only when your business has two or more pipelines. Nothing in the app makes a second one today, so you will not see it.
- **{button:Stages|outline}.** At the top right. It opens the list of stages, where an owner renames a stage, adds one and archives one. See [Stages](pipelines.md). It always opens the default pipeline's stages.
- **The columns.** One for every stage that is not archived, left to right in the order the stages are set in. A column with nothing in it is still drawn, so a stage never quietly disappears as deals move. The columns scroll sideways when they do not all fit. The page itself never scrolls sideways.
- **A column heading.** The stage name on the left. On the right, the number of deals in that column. An empty column reads `0`.
- **The money under the heading.** The total of the amounts in that column, such as `$1,234.56`. A column that adds up to nothing reads `—` instead, and so does a column whose deals are all unpriced.
- **`· 3 unpriced`.** Added to that same line when some deals in the column carry no amount. It tells you how many deals the total leaves out, so a small number over a full column still makes sense. One deal reads `· 1 unpriced`.
- **A card.** The deal's name at the top, as a link. Click it to open the deal and change it. See [A deal](deal.md).
- **The record line on a card.** A building mark {icon:building} for an organization, or a person mark for a person, then the name of the record the deal is against. It is not a link.
- **The amount on a card.** Such as `$4,500.00`, at the bottom left. A deal you have not priced yet reads `No amount yet` there instead.
- **`Expected 2026-09-30`.** Under the amount, and only on a deal that has an expected close date. It is written year first.
- **{badge:Won|secondary} or {badge:Lost|secondary}.** At the foot of a card, once the deal has been moved into a stage that closes as won or lost.
- **{button:Move|ghost|chevron-right}.** At the bottom right of every card. It opens a short menu of the other stages on this pipeline.
- **Card order.** Most recently changed first, top to bottom, in every column. Moving a deal counts as a change, so a card you moved a moment ago sits at the top of its new column.

Amounts here always carry a `$`, whatever currency symbol your business is set to.

## How to move a deal to another stage

1. Find the card, then click {button:Move|ghost|chevron-right} on it.
2. The menu lists every other stage on this pipeline, in board order. A stage that ends the deal says `closes as won` or `closes as lost` beside its name.
3. Click the stage the deal has reached. The button spins while it saves.
4. You see `Moved`. The card jumps to its new column, and both column totals redo themselves. You stay where you were on the board.

Moving into a stage that closes as won or lost stamps the deal with the date it closed. Moving it back into an open stage clears that date, so a deal you reopen stops counting as won. A deal that already closed keeps its first closing date, so correcting a won deal to lost does not rewrite when it closed.

Every move is written into the deal's own history, with who moved it and when. Read that on the deal itself. See [A deal](deal.md).

A move is also what sets your rules going. `A deal moves stage`, `A deal is won` and `A deal is lost` all fire from here. See [Rules that run by themselves](automations.md).

{button:Move|ghost|chevron-right} is missing from every card when the pipeline has only one stage, because there is nowhere to send the deal.

## How to raise a new deal

There is no button for a new deal on this board. A deal always belongs to a record, so you start from the record.

1. Open the record the work is for. See [One record](record.md).
2. In its `Deals` section, click {button:Add a deal|outline|plus}.
3. Fill the form in and click {button:Add deal|primary}. See [Add a deal](new-deal.md).
4. The deal starts in the first open stage of the default pipeline. Come back to this board and the new card is at the top of that column.

## How to get the board started

The first time an owner opens this page, the app sets up a pipeline named `Sales` with four stages: `New`, `In progress`, `Won` and `Lost`.

1. Sign in as an owner and open the board. The four columns appear.
2. Click {button:Stages|outline} and rename them into the words your business actually uses. See [Stages](pipelines.md).

Until an owner has opened this page, everybody else sees `No pipeline yet`. Staff cannot set the first one up.

## Messages

| Message | What it means |
| --- | --- |
| `Nothing here.` | No deals are in that stage. The column stays on the board anyway. |
| `No pipeline yet` | Nobody has set up a pipeline. It reads `An owner needs to set up the first pipeline before this board can be used.` An owner only has to open this page. |
| `This pipeline has no stages. Add some under Stages.` | Every stage has been archived. Click {button:Stages|outline} and restore one. |
| `Showing the first 1000 deals on this pipeline.` | The board draws 1000 deals at most and this pipeline holds more. The rest are not shown and there is no next page. Close the deals you have finished with, or ask us. |
| `Moved` | The move worked. |
| `2 fields need attention.` | A stage that closes as won or lost needs some of your own fields filled in first. The field names follow the message, such as `2 fields need attention. PO number, Job number`. One field reads `1 field need attention.` Open the deal, fill them in, then move it again. See [A deal](deal.md). |
| `That deal could not be found.` | The deal was moved or hidden while your page was open. Reload. |
| `That stage could not be found.` | The stage was removed while your page was open. Reload. |
| `That stage belongs to a different pipeline.` | Reload the board. A deal can only move between stages on its own pipeline. |
| `This record changed while you were editing it. Reload and try again.` | Somebody else changed the deal first. Reload and move it again. |
| `Accountant access to this module is read-only.` | You are signed in as the outside accountant, who can read the board but not move anything. |
| `Invalid input` | The move was refused before it started. Reload the page. |
| `Something went wrong. Please try again.` | Something unexpected. Nothing moved. Try again, and tell us if it keeps happening. |

## Not on this page

No deal can be deleted, here or anywhere else in CRM. A deal raised by mistake can only be moved into a stage that closes as lost and left there. Ask us if you need one gone for good.

Nothing on a card can be edited here. Click the deal's name to change its name, amount, expected close date or your own fields.

Nothing on this board says whose deal it is. A deal has no owner you can set, and there is nothing that shows or filters by the person handling it.

Cards cannot be dragged. The menu on every card is the only way to move one, which is why it works the same one-handed on a phone.

There is no search, no filter, no sort and no page control. The board draws everything on the pipeline, up to 1000 deals, and nothing hides the closed ones.

The likelihood an owner sets on a stage changes no number on this page. A column total is a plain sum of the amounts you typed, and nothing is weighted. For totals you can group, compare and save, use [Reports](reports.md).

Nothing here sends a message or an email when a deal moves. Rules can raise a follow-up or change a record instead. See [Rules that run by themselves](automations.md).

## Who can do what

Owners see every card and can move any of them. Opening this page as an owner is what creates the first pipeline. Staff get the same board and can move deals as freely, except that a deal against a record they have not been given access to is missing from the board altogether, with no gap to show it was ever there. Only an owner can change the stages themselves, so {button:Stages|outline} opens a read-only list for everybody else. The outside accountant can read the board, and {button:Move|ghost|chevron-right} still shows on every card but answers `Accountant access to this module is read-only.`
