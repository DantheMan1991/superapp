# A deal

> One piece of work in front of a record: what it is called, what it is worth, when you expect it to close, and how it moves through the stages until it is won or lost.
> **Route:** /dashboard/m/crm/deals/*
> **Order:** 80
> **Area:** Board

Open a deal by clicking its name on the board, or in the `Deals` list on the record it belongs to. There is no separate edit screen. The boxes on this page are the deal, so change one and click {button:Save|primary}. Moving the deal along, and marking it won or lost, is the one other thing you do here, with {button:Move stage|ghost|chevron-right}. Raising a new deal starts from a record instead, in [Add a deal](new-deal.md).

## What you see

- **`Board`.** Top left, after {icon:chevron-left}. Click it to go back to [The deal board](board.md).
- **The deal's name.** The heading. It is whatever `What is it` holds, so saving a new name changes the heading.
- **The record it belongs to.** Under the name, after a person or building icon. Click the name to open it. That page is [One record](record.md).
- **The main contact.** After a middle dot in the same line, and only when one is recorded. Nothing on this page picks or changes it.
- **The stage.** A badge in the same line carrying the stage's own name. It is filled in, like {badge:In progress|secondary}, while the deal is open. It turns to an outline, like {badge:Won|outline}, once the stage counts as won or lost.
- **`closed 2026-08-31`.** Small text at the end of that line, once the deal has reached a won or lost stage. The date is in UTC, so an evening move can show as the next day.
- **{button:Move stage|ghost|chevron-right}.** Top right. It opens a menu of the other stages in this deal's pipeline. It is missing when the pipeline has only one stage that is not archived, because there is nowhere to send the deal.
- **The tabs.** `Records`, `Follow-ups`, `Board`, `Pipelines`, `Fields`, `Reports`, `Automations` and `Duplicates` take you to the rest of the module. None of them is about this deal.
- **`What is it`.** The deal's name. It cannot be blank, and 200 characters is the most it takes. The empty box suggests `Work for` and then the record's name.
- **`Amount`.** What the work is worth. Type `4500`, `4,500.00` or `$4500`. A leading dollar sign and commas are fine, two decimal places at most, and nothing negative. Leave it blank while you do not know, which is what `Leave blank if not priced yet` means. A stored amount shows as `4500.00`, with no separator and no currency sign.
- **`Expected close`.** A date box with a calendar. When you think this will be settled. It is optional, and nothing chases it.
- **`Your fields`.** A bordered block, and only when your business has set up its own deal fields. `Set up under Fields in this module.` sits at its right. Setting them up is in [Your own fields](fields.md).
- **{badge:needed to change stage|outline}.** Beside the label of a field your business marked required. It never stops you saving. It stops the deal reaching a won or lost stage while that field is blank.
- **{button:Save|primary}.** Sends the three boxes and every one of your own fields together.
- **{button:Cancel|ghost}.** Sends nothing and leaves you on this deal. Reload the page to bring the stored values back into the boxes.
- **`Also involved`.** Only appears when other people are already recorded on this deal. Each row is a name you click through to, with their role under it when one is stored. Nothing on this page adds anybody to that list or takes anybody off it.
- **`History`.** Every stage this deal has been through, newest first. A row reads `New → In progress`, or `Started in New` for the line written when the deal was raised. The date sits at the right, again in UTC. A stage that was deleted reads `a removed stage`. Only stage moves are kept. Renaming or repricing a deal is not recorded.

## How to change the name, the amount or the date

1. Click into `What is it`, `Amount` or `Expected close` and change what is there.
2. Fill in anything under `Your fields`. A choice field offers `Not set` to put it back to blank. A yes or no field is a switch.
3. Click {button:Save|primary}. You see `Saved` and the page redraws with your changes.
4. Emptying a box clears the stored value. Clear `Amount` and the deal is unpriced again, and its card on the board reads `No amount yet`.
5. A field marked {badge:needed to change stage|outline} can be left blank and still saves.

## How to move a deal to another stage

1. Click {button:Move stage|ghost|chevron-right}. The menu lists every other stage in this deal's pipeline that is not archived, in board order.
2. A stage that ends the deal carries `closes as won` or `closes as lost` beside its name.
3. Click the stage you want. You see `Moved` and the badge in the header changes.
4. The card moves column on the board and both column totals recompute. The badge in the record's `Deals` list changes too.
5. A line is added to `History`. Nothing removes it, so a move made by mistake stays on the list after you move the deal back.
6. Any rule watching `A deal moves stage` runs. Rules are in [Rules that run by themselves](automations.md).

The stages themselves, and their order, are set up by an owner in [Stages](pipelines.md). You cannot move a deal onto a different pipeline.

## How to mark a deal won or lost

1. Click {button:Move stage|ghost|chevron-right} and pick the stage that says `closes as won` or `closes as lost`.
2. Every field marked {badge:needed to change stage|outline} has to be filled in and saved first. If one is blank the move is refused and the message names it, such as `1 field need attention. PO number`. Fill it in, click {button:Save|primary}, then move again.
3. You see `Moved`. The badge turns to the outline style and `closed` with the date appears beside it.
4. The closing date is stamped once. Correcting a won deal to a lost stage, or the other way round, keeps the first date.
5. Rules watching `A deal is won` or `A deal is lost` run as well. A rule can raise a follow-up, set the record's lifecycle stage, or assign the record to somebody. Nothing is emailed to anybody, on this page or by a rule.
6. The deal counts as won or lost in [Reports](reports.md) from that moment, because the stage it sits in is the only thing that decides.

## How to reopen a closed deal

1. Click {button:Move stage|ghost|chevron-right} and pick a stage that says nothing about closing.
2. You see `Moved`. The `closed` date is cleared, so the deal stops counting as won or lost anywhere. Close it again later and it takes that day's date instead.
3. The badge is filled in again, like {badge:In progress|secondary}, and carries the stage you picked. The card is drawn in its new column on the board.
4. Reopening is a stage move like any other, so `A deal moves stage` rules run and a line goes into `History`.

## Messages

| Message | What it means |
| --- | --- |
| `Saved` | Your boxes are stored. You stay on the deal. |
| `Moved` | The deal is in the new stage. |
| `Give the deal a name` | `What is it` is empty. Type something and click {button:Save|primary} again. Nothing was sent. |
| `Enter an amount like 1234.56` | `Amount` holds something that is not a plain amount. Take out any letters, the minus sign and a third decimal place. |
| `Too big: expected string to have <=200 characters` | The name is too long. Keep it to 200 characters. |
| `Too big: expected string to have <=30 characters` | `Amount` holds more than 30 characters. |
| `Invalid ISO date` | `Expected close` does not hold a real date. Pick one from the calendar. |
| `2 fields need attention.` | One of your own fields holds something it does not accept. The reason is written in red under that field. With a single field it reads `1 field need attention.` |
| `Must be a number.` | Under one of your own fields, with `Must be a date.`, `That date does not exist.`, `Must be yes or no.`, `Not one of the choices.`, `Must be a full link, starting http:// or https://.`, `Only http:// and https:// links are allowed.` and `Must be 2000 characters or fewer.` Fix that field and save again. |
| `This record changed while you were editing it. Reload and try again.` | Somebody else saved this deal while you had it open. Nothing of yours was stored. Reload and type it again. |
| `That deal could not be found.` | The deal went while your page was open. Go back to the board. |
| `That stage could not be found.` | The stage was archived or removed while your page was open. Reload. |
| `That stage belongs to a different pipeline.` | Your page is out of date. Reload. |
| `Nothing recorded yet.` | Under `History`, when this deal has no stage lines at all. Every deal raised in the app gets one when it is created, so you should not see it. |
| `Accountant access to this module is read-only.` | You are signed in as the outside accountant. The page no longer offers a control that answers this. |
| `Something went wrong. Please try again.` | Something unexpected went wrong and nothing was stored. Try again, and tell us if it keeps happening. |
| `Page not found` | The deal has gone, or it sits on a record somebody restricted and you were not given access to it. |

## Not on this page

A deal cannot be deleted or archived. Nothing anywhere in the module removes one. A deal raised by mistake can only be moved into a stage that closes as lost and left there. Ask us if you need one taken out.

Nothing says whose deal it is. There is no owner box and no assignee. Nothing picks the main contact shown at the top either, so it stays as it is. Nobody can be added to `Also involved` or taken off it here.

You cannot write a note against a deal, log a call on it, attach a file to it, or raise a follow-up from it. All of those hang off the record instead, in [The timeline](timeline.md). `History` is stage moves and nothing else, so it will not tell you who changed the amount. It does not name who made a move either, only the stages and the date.

The stage cannot be changed from the form. The menu is the only way, on purpose, so that every move is recorded.

## Who can do what

Owners and staff get exactly the same page and can do all of it: change the boxes, save, and move the deal between stages. Neither can delete one. Accountants read the page — every figure legible, a line under the tabs saying so — and neither {button:Save|primary} nor {button:Move stage|ghost|chevron-right} is drawn. A deal against a record somebody restricted is invisible to staff who were not given access to that record, and its link answers `Page not found` rather than saying they are not allowed.
