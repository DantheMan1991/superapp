# Your own fields

> The extra things you want to know about the people and businesses you deal with. Add a field, choose what it accepts, mark it as needed before a stage change, and archive one you have finished with.
> **Route:** /dashboard/m/crm/fields
> **Order:** 110
> **Area:** Fields

Open **Fields** in the CRM menu. This is where you add the questions a plain record does not ask, such as `Warranty expiry` or `Account number`. Each one turns into a box people fill in on a record. To add one, click {button:Add a field|primary|plus}. Only an owner can change anything here.

## What you see

- **The title.** `Fields`, with `The things this business tracks that the standard fields do not cover.` under it.
- **The CRM menu.** `Records`, `Follow-ups`, `Board`, `Pipelines`, `Fields`, `Reports`, `Automations` and `Duplicates`. Click any of them to move around the module.
- **`Fields on every record`.** The heading over your live fields. Read it as every record, not every screen. A field shows on a record's own page and on the form that adds a record, and nowhere else in the CRM.
- **The count.** Under that heading. `None yet.` with nothing set up, `1 field.` with one, `3 fields.` with three.
- **{button:Add a field|primary|plus}.** At the right of the heading. It opens a dialog headed `Add a field`.
- **The empty state.** With nothing set up you see `Add the things you track that the standard fields do not cover.`
- **A field row.** The name on the first line. Under it, in small gray text, the kind and the reference, such as `Text · warranty_expiry`. A choice field adds its count on the end, `· 3 options`, or `· 1 option` for one.
- **{badge:needed to change stage}.** On a row you marked that way. An archived row never carries it.
- **{button:Edit|ghost}.** On a live row. It opens the same dialog, headed `Edit field`.
- **{icon:archive}.** The last thing on every row, and it carries no words. On a live field it takes the field off every record. On an archived one the same button puts it back. It spins while it works.
- **The order.** Oldest first, newest at the bottom. Where two share a position the order falls back to their names. Nothing on this page moves a field up or down.
- **`Archived`.** A second list under the first, and only once you have archived something. It reads `These no longer appear on records. Everything already entered against them is kept — that is why they are archived rather than deleted.` Those rows carry no {button:Edit|ghost} and no badge.

## How to add a field

1. Click {button:Add a field|primary|plus}. The dialog reads `This appears on every record in the CRM.`, which means every record, not a deal and not the list.
2. Type the `Name`, such as `Warranty expiry`. This is what people read on the record. Up to 80 characters.
3. Leave `Reference` alone unless you have a reason. It fills itself in from the name as you type, so `Warranty expiry` becomes `warranty_expiry`. Type in the box once and it stops following the name.
4. A reference starts with a lowercase letter and holds only lowercase letters, numbers and underscores, up to 63 characters. A name starting with a number gets an `f` in front, so `2026 target` becomes `f2026_target`. Two live fields cannot share one. Under the box you see `Used for imports. Safe to change later — it is not what the answers are stored against.`
5. Pick the `Type` from the seven below. Choose carefully, because it cannot be changed afterward.
6. For `One choice` or `Several choices`, fill in `Choices`. That is the next section.
7. Type a `Hint (optional)` when the name is not enough on its own, up to 200 characters. It shows in small gray text under the box on the record.
8. Turn on `Needed to change stage` when the answer has to be there before the record moves on. That is the section after next.
9. Click {button:Add field|primary}. You see `Field added`, the dialog closes, and the field appears at the bottom of the list. {button:Cancel|ghost} closes the dialog and saves nothing. Either way the boxes keep what you last typed, so clear them when you open the dialog for the next field.

| `Type` | What people get on the record |
| --- | --- |
| `Text` | One line to type in, up to 2000 characters. Spaces at each end are trimmed off. |
| `Number` | A number box with small up and down arrows to step the figure. It takes whole numbers, decimals and negative numbers. Zero is an answer, not a blank. Letters cannot be typed into it. A trailing zero is dropped, so `42.50` comes back as `42.5`. |
| `Date` | A date picker. A day that does not exist, such as the 31st of February, is refused. |
| `Yes / no` | A switch. Turning it off is an answer, not a blank. |
| `One choice` | A dropdown holding `Not set` and then your choices. `Not set` is how somebody clears a wrong answer. |
| `Several choices` | Your choices as small buttons to switch on and off, as many as apply. It takes the full width of the panel. |
| `Link` | A web address box showing `https://`. The address has to start `http://` or `https://`, up to 2000 characters. |

## How to set up the choices

1. Pick `One choice` or `Several choices` as the `Type`. `Choices` appears under it.
2. Click {button:Add a choice|outline|plus}. Type the choice into the box, such as `North`.
3. Repeat for each one. You can have up to 100 choices, each up to 80 characters.
4. Click {button:Remove choice|ghost|x} beside a choice to take it out.
5. Empty boxes are dropped when you save, and the same choice twice is kept once.
6. Renaming a choice on a field you have already saved changes only the words people read. Answers already given stay attached to it.
7. Taking a choice away leaves what those records already hold untouched. The next time somebody saves one of them the save is refused, with `Not one of the choices.` under the field, so pick a new answer there. Until they do, a `One choice` box on that record reads `Not set`.

## How to make a field needed before a stage change

1. Open the field and turn on `Needed to change stage`. Under the switch you see `Records can still be created and saved without it. It is asked for when the stage moves, so imports and quick captures are not blocked.`
2. That is the whole rule. Adding a record works with the field blank, and so does an ordinary save.
3. Changing the record's stage with the field blank is stopped instead. A field named `Warranty expiry` answers `Warranty expiry is required before this record can move stage.` under its box.
4. On the record the field's name carries {badge:needed to change stage}, so people know before they get there.
5. Turn the switch off again and the next stage change goes through.

## How to change a field

1. Click {button:Edit|ghost} on the row. The dialog is headed `Edit field`.
2. Change the `Name`, the `Reference`, the `Choices`, the `Hint (optional)` or the switch. Here the `Reference` never follows the name.
3. `Type` is grayed out. Under it you see `The type cannot change — existing answers would stop matching it. Archive this field and add a new one instead.`
4. Click {button:Save|primary}. You see `Field saved` and the row updates.
5. Answers already given are untouched by any of this. A rename changes the words on the form and nothing else.

## How to archive a field and bring it back

1. Click {icon:archive} at the right of a live row. Nothing is asked first.
2. You see `Field archived. Values already entered are kept.` The field drops off every record straight away and moves down into `Archived`.
3. Nothing anybody typed into it is thrown away. It is out of sight and waiting.
4. To bring it back, click {icon:archive-restore} on the archived row. You see `Field restored`, and the field and all of its old answers come back onto every record.
5. A field can never be deleted. Archiving is the only way to take one off the form, and no button anywhere removes one for good.

## Messages

| Message | What it means |
| --- | --- |
| `Give the field a name` | The `Name` box was empty. Type one and save again. |
| `Add at least one choice` | A choice field needs at least one choice. Click {button:Add a choice|outline|plus}. |
| `Field added` | The field is saved and is on every record from now on. |
| `Field saved` | Your changes to the field are saved. |
| `Field archived. Values already entered are kept.` | The field is off the form and its answers are kept. |
| `Field restored` | The field is back on every record, answers and all. |
| `A field with that name already exists.` | Another live field already has that `Reference`. Change it. You also get this restoring an archived field whose reference was taken while it was away. |
| `A choice field needs at least one option.` | A choice field reached the save with no choices on it. Add one. |
| `That field could not be found.` | The field was removed somewhere else while your dialog was open. Reload the page. |
| `This record changed while you were editing it. Reload and try again.` | Somebody else saved this field since your page loaded. Reload and make the change again. |
| `Use lowercase letters, numbers and underscores` | The `Reference` has a capital, a space or a symbol in it, or starts with something other than a letter. |
| `You do not have permission to do that.` | You are not an owner. |
| `Accountant access to this module is read-only.` | You are signed in as the outside accountant. |
| `Invalid input` | The dialog sent something the checker would not take. Reload and try again. |
| `Something went wrong. Please try again.` | Anything else. Try once more, and tell us if it keeps happening. |
| `No custom fields yet.` | Nothing is set up. Staff and the accountant see this in place of the list. |
| `Add the things you track that the standard fields do not cover.` | The same thing as an owner. Click {button:Add a field|primary|plus} to make the first one. |

Nothing stops you typing past a limit in a box. A `Name` over 80 characters, a `Hint (optional)` over 200 or a choice over 80 is refused on save, with wording from the checker naming the number rather than a sentence written for this screen.

## Not on this page

There is no delete. A field is only ever archived, and every answer ever given stays. Nothing reorders the list, so a new field always lands at the bottom. A `Type` is fixed once saved. Fields for a deal cannot be set up here, so a deal never shows any of your own fields. The `Reference` help says `Used for imports.`, and there is no import in the CRM today that reads it. Your fields are not columns in the records list, cannot be filtered on or saved into a view, are not in any report, and are not searched. Nothing counts how many records have answered a field. A rule that sets a stage on its own does not check a field marked `Needed to change stage`. Filling a field in is in [One record](record.md) and [Add a record](new-record.md). Rules are in [Rules that run by themselves](automations.md). Ask us if you need any of this.

## Who can do what

Owners do everything on this page and are the only ones who see the `Archived` list. Staff get the page with no buttons on it and this line at the top: `Only an owner can change these. Everything set up here appears on every record.` Each row shows them the field's name and, under it, its hint, or its reference when it has no hint. They see no kind, no choice count and no badge, and no archived field at all. The outside accountant sees exactly what staff see, and any action answers `Accountant access to this module is read-only.`
