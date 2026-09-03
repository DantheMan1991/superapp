# Stages

> The steps a deal moves through, from the first ask to won or lost. Add a step, rename one, change what reaching it means, and put one away.
> **Route:** /dashboard/m/crm/pipelines
> **Order:** 100
> **Area:** Pipelines

Open **CRM** in the sidebar, then click `Pipelines` in the row of tabs. You can also get here from the board, with {button:Stages|outline}. Every deal in the business sits in one of the steps listed on this page, and this is where you name them. To add one, click {button:Add a stage|primary|plus}. Moving a deal from one step to the next happens on [The deal board](board.md).

## What you see

- **{icon:chevron-left} `Board`.** Above the title. Takes you back to the deal board.
- **The title.** The name of your steps, always `Sales`. Under it, `The steps a deal moves through, in this business's own words.`
- **The tabs.** `Records`, `Follow-ups`, `Board`, `Pipelines`, `Fields`, `Reports`, `Automations` and `Duplicates`. `Pipelines` is underlined while you are here.
- **`Stages, in order`.** The heading over the list. Under it, `A deal starts in the first open stage.` The order you read down this list is the order of the columns across the board, left to right.
- **{button:Add a stage|primary|plus}.** At the right of that heading. Owners only.
- **A stage row.** The name on the left. Under the name, one line saying what reaching it means: `Still open · 50% likely`, `Closes as won` or `Closes as lost`. The likelihood shows only on an open step.
- **{badge:Won|outline} and {badge:Lost|outline}.** At the right of a row that closes a deal. An open step carries no badge.
- **{button:Edit|ghost}.** On every step still in use. Opens the same dialog with that step's own words in it.
- **The small button at the end of the row.** It carries a box icon and no words, so there is nothing to read on it. On a step in use it puts the step away. On a step under `Archived` it brings the step back. It spins while it works.
- **The four steps you start with.** `New` at 10%, `In progress` at 50%, `Won` and `Lost`. The first two are open, the last two close a deal. They are made the first time an owner opens the board or this page. Rename any of them.
- **`Archived`.** A second list under the first, and only once you have put a step away. The rows read the same but carry no {button:Edit|ghost}.

## How to add a stage

1. Click {button:Add a stage|primary|plus}. The dialog `Add a stage` opens, reading `Name it whatever this business actually calls it.`
2. Type a `Name`, such as `Quote sent`. Up to 60 characters. Nothing counts them for you, and a longer name is refused with `Invalid input`.
3. Pick `Reaching this stage means`. Three choices, in this order: `Still open`, `Closes as won`, `Closes as lost`. A new step starts on `Still open`.
4. On `Still open` only, a `Likelihood` box appears, starting at `0`. It reads `0 to 100. Used to weight the pipeline total, not to decide anything.` Type a whole number from 0 to 100. An empty box counts as `0`.
5. Click {button:Add stage|primary}. You see `Stage added`, the dialog closes, and the row appears. {button:Cancel|ghost} closes it and keeps nothing.
6. The new step goes last, after `Lost`, and on the board it is the far right column. You cannot move it anywhere else.

## How to rename a stage

1. Click {button:Edit|ghost} on the row. `Edit stage` opens with that step's current words.
2. Change the `Name` and click {button:Save|primary}. You see `Stage saved`.
3. The new word replaces the old one everywhere at once: the column heading on the board, the badge on every deal sitting in it, and every line of that deal's history that names it. See [A deal](deal.md).
4. Nothing about the deals themselves changes. A rename moves no deal and closes no deal.

## How to change what a stage means

1. Click {button:Edit|ghost}, then pick a different `Reaching this stage means`. Click {button:Save|primary}. You see `Stage saved`.
2. Switch to `Closes as won` or `Closes as lost` and the `Likelihood` box goes away. Switch back to `Still open` and the number you had comes back.
3. The change only counts from now on. A deal moved in after it closes and takes today's date.
4. Deals already sitting there are left alone. They get no closing date and no `Won` on their card. To fix one, move it out to an open step and back in.
5. A step that closes a deal is also where your required fields bite. A deal missing one cannot be moved in, and the person moving it sees `1 field need attention.` with the field named. See [Your own fields](fields.md).

## How to put a stage away

1. Move every deal out of that step first, on the board. A step holding even one deal cannot be put away.
2. Click the small button at the end of the row. You see `Stage archived`, the row drops to `Archived`, and the column leaves the board.
3. With a deal still in it you see `Move the deals out of this stage before archiving it.` and nothing changes. The count is not shown, so look at the number on the column.
4. This throws nothing away. The step is only hidden from the board and from the move menu.
5. Keep at least one open step. Put them all away and nobody can raise a deal, and the new deal form answers `This pipeline has no open stage to start a deal in. Add one first.`

## How to bring a stage back

1. Click the small button at the end of the row under `Archived`. You see `Stage restored`.
2. The step goes back to the place it held before, not to the end, and its column returns to the board.
3. To rename it, bring it back first. A row under `Archived` carries no {button:Edit|ghost}.

## Messages

| Message | What it means |
| --- | --- |
| `Give the stage a name` | The `Name` box was empty. Type something and try again. |
| `Likelihood must be a whole number from 0 to 100` | `Likelihood` had a decimal, a letter or a number outside 0 to 100. Whole numbers only. |
| `Move the deals out of this stage before archiving it.` | The step still holds deals. Move them on the board, then try again. |
| `This record changed while you were editing it. Reload and try again.` | Somebody else changed that step while your dialog was open. Reload the page. |
| `Invalid input` | The name was longer than 60 characters. Shorten it. |
| `That pipeline could not be found.` | Your steps were changed or removed while the page was open. Reload. |
| `You do not have permission to do that.` | You are staff. Only an owner changes these. |
| `Accountant access to this module is read-only.` | You are signed in as the outside accountant. |
| `Something went wrong. Please try again.` | Something unexpected failed. Nothing was changed. Try again, and tell us if it keeps happening. |
| `Only an owner can change these.` | You are staff or the accountant. You see the list and nothing else. |
| `An owner needs to set up the first pipeline.` | Nobody has set up any steps yet, and the title reads `Pipeline`. Ask an owner to open the board once. |

## Not on this page

You get one set of steps and you cannot make a second. There is no button that adds one, so every deal in the business runs on the same steps, and the name at the top cannot be changed either. You cannot reorder the steps, even though the heading reads `Stages, in order`. A new step always goes last, after `Lost`, so add one before you need it in the middle and it will still be at the end. A step cannot be deleted, only put away. `Likelihood` promises to weight the pipeline total, and nothing uses it: it appears on this page and nowhere else, and the board adds up the plain amounts. No deal is moved from here. Ask us if you need any of it.

## Who can do what

Owners do everything on this page. Staff and the outside accountant see the steps still in use and the line under each one, with the note `Only an owner can change these.` They get no buttons, and steps under `Archived` are hidden from them entirely. Owners and staff can move a deal between steps on the board, whatever they can do here. The accountant cannot move one.
