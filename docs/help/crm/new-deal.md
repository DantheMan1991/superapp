# Add a deal

> Raising a deal against a record: the three boxes, your own fields, what the amount box accepts, and where the deal lands once you save it.
> **Route:** /dashboard/m/crm/records/*/deals/new
> **Order:** 90
> **Area:** Board

Open a record, find its `Deals` section, and click {button:Add a deal|outline|plus}. That is the only way onto this page. A deal always belongs to a record, so there is no page that starts one from nothing, and no box here that asks you which company it is for. Fill in the boxes and click {button:Add deal|primary}. The deal starts in the first open stage of your pipeline, and you move it along from the board afterwards.

## What you see

- **The back link.** {icon:chevron-left} and the record's own name, above the title. Click it to go back to the record. Nothing you have typed is saved.
- **The title row.** `Add a deal`, and under it `It starts in the first stage of the default pipeline. You can move it from the board.` At the right sits {icon:circle-question-mark}, which opens this help.
- **The tabs.** `Records`, `Follow-ups`, `Board`, `Pipelines`, `Fields`, `Reports`, `Automations` and `Duplicates`. Clicking any of them leaves the form and throws away what you have typed.
- **`What is it`.** The name of the deal, and the only box you have to fill in. The gray suggestion in it reads `Work for` and then the record's name. Type up to 200 characters. Nothing stops you typing past that, and the refusal comes when you save.
- **`Amount`.** What the work is worth to you. Leave it blank when you do not know yet. The gray suggestion reads `Leave blank if not priced yet`. What it accepts is below.
- **`Expected close`.** A date box with your browser's own date picker in it. Pick the day you expect to know either way. Leave it blank if you have no view yet.
- **`Your fields`.** A bordered block under the three boxes, and only when your business has set up deal fields of its own. Beside the heading sits the note `Set up under Fields in this module.`
- **{button:Add deal|primary}.** Saves the deal. It grays out and spins while it works, so you cannot save the same deal twice.
- **{button:Cancel|ghost}.** Takes you back to the record. Nothing is saved and nothing asks you to confirm.

## How to add a deal

1. Type a name into `What is it`. Say what the work is, such as `Annual service contract` or `Spring order`.
2. Type the price into `Amount`, or leave it blank. A deal with no amount is normal and the board says so on the card.
3. Pick a day in `Expected close`, or leave it blank. Nobody is reminded about this date. It only prints on the card as `Expected 2026-09-30`.
4. Fill in anything under `Your fields`. Every one of them can be left blank here.
5. Click {button:Add deal|primary}. You see `Deal added`, and the deal's own page opens.

You do not land back on the record and you do not land on the board. Everything you can do with the deal from here is in [A deal](deal.md).

The deal now shows up in two places. It sits in the `Deals` section of the record you started from, with its amount and its stage. It also sits in the first column of the board, which is covered in [The deal board](board.md). On the stages that ship with CRM that first column is `New`. Moving it on is the only way to mark it won or lost.

## How to fill in the amount

`1234.56`, `1,234.56` and `$1,234.56` all mean the same thing, so type whichever is quickest. One decimal place is enough, so `1234.5` and `1234.50` come to the same money. Two decimal places is the most it takes.

Anything else is refused when you save, with `Enter an amount like 1234.56`. That covers a negative number, three decimal places, a space inside the number, a currency code such as `USD`, and words. The largest amount it takes is a hundred billion. Type more than 30 characters into the box and you get a length refusal instead.

Nothing you type here posts to the accounts. The amount is a figure for your pipeline only, and no invoice, bill or ledger entry comes of it.

## How to fill in your own fields

The `Your fields` block only appears when somebody has set up deal fields for your business. Setting them up is in [Your own fields](fields.md). Each one carries the label the owner gave it, and the owner's help text sits in small gray type underneath.

1. A plain box takes text, up to 2000 characters.
2. A number field cannot be filled in today. The box empties as you type, so nothing can be entered into it. Tell us if you need one.
3. A date box gives you the same picker as `Expected close`.
4. A link box shows the gray suggestion `https://`. Type the whole address, starting `http://` or `https://`.
5. A switch is a yes or no. It sits off until you turn it on.
6. A one-choice field is a list. Its first entry is `Not set`, and that is what it shows while nothing is picked. Pick `Not set` again to empty it.
7. A several-choice field is a row of round chips. Click one to turn it on and click it again to turn it off.

A field carrying {badge:needed to change stage} can still be left blank here, and the deal saves. That badge only bites later, when you try to move the deal into a stage that closes it as won or lost. Leaving it for now is the normal way to start.

When something is wrong, a red line replaces the help text under that field, and the toast counts them, such as `1 field need attention.` Fix the fields the red lines point at and click {button:Add deal|primary} again.

## Messages

| Message | What it means |
| --- | --- |
| `Deal added` | It worked. The deal's own page is opening. |
| `Give the deal a name` | `What is it` is empty, or holds only spaces. Nothing was sent. Type a name. |
| `Too big: expected string to have <=200 characters` | The name is too long. Shorten it to 200 characters. |
| `Enter an amount like 1234.56` | The `Amount` box holds something that is not a plain price. See above for what it takes. |
| `Too big: expected string to have <=30 characters` | You typed more than 30 characters into `Amount`. |
| `Invalid ISO date` | The `Expected close` box holds a date the app cannot read. Clear it and pick again. |
| `That pipeline could not be found.` | Nobody has opened the board yet, so your business has no stages. An owner opening `Board` once sets up `New`, `In progress`, `Won` and `Lost`. Only an owner can do that. |
| `This pipeline has no open stage to start a deal in. Add one first.` | Every stage you have closes a deal as won or lost, so there is nowhere to start. An owner adds an open stage under [Stages](pipelines.md). |
| `That record could not be found.` | The record was merged into another one, or removed, while this page sat open. Archiving a record does not do this. Go back and check it. |
| `1 field need attention.` | One of your own fields holds something it will not take. A red line under that field says what. `2 fields need attention.` counts two, and so on. |
| `Must be a full link, starting http:// or https://.` | A link field is missing the start. Type `https://` in front of the address. |
| `Only http:// and https:// links are allowed.` | A link field holds an address of a kind the app will not store. |
| `Must be 2000 characters or fewer.` | A text or link field is too long. |
| `Not one of the choices.` | Somebody removed that choice while this page sat open. Reload and pick again. |
| `Accountant access to this module is read-only.` | You are signed in as the outside accountant. The form fills in, and saving is refused. |
| `Something went wrong. Please try again.` | Try once more. You also get this when you reach this page for a record that is held back to owners and you are not one of them, in which case saving will keep failing. |

## Not on this page

There is no pipeline picker and no stage picker. Every deal starts in the first open stage of the one pipeline your business has, whatever board you were last looking at. Renaming those stages, and adding your own, is in [Stages](pipelines.md).

Nothing here says whose deal it is. There is no box for the person handling it, and none for a contact inside the company, even though a deal's page can print a contact name beside the record.

There is no box for notes, no place to attach a file, and no follow-up to raise. All three hang off the record instead, in [The timeline](timeline.md).

A deal cannot be deleted once it is saved, from this page or any other. A deal typed by mistake is moved into your `Lost` stage and left there, so check the name before you save.

Nothing is kept if you leave this page. There is no draft and no warning, so a tab you close is a deal you never raised.

## Who can do what

Owners and staff get exactly the same form and both can add deals. The outside accountant sees the form and can fill it in, and clicking {button:Add deal|primary} answers `Accountant access to this module is read-only.` A record held back to owners is invisible to staff, and its `Deals` section is hidden with the rest of it, so staff never reach this page for one by clicking.
