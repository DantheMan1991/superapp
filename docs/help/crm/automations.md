# Rules that run by themselves

> Rules that watch for something happening in the CRM and then do one thing: raise a follow-up, set a record's stage, or hand a record to somebody. Read what each rule is doing, build one, pause one, or delete it.
> **Route:** /dashboard/m/crm/automations
> **Order:** 140
> **Area:** Automations

Open `Automations` in the CRM menu. Every rule you have is listed as a plain sentence, so you can read what the app is doing to your records without opening anything. To build one, click {button:Add a rule|primary|plus}. Only owners see that button, and only owners can pause or delete a rule.

## What you see

- **The title and the line under it.** `Automations`, then `Things that happen on their own. Each one runs as whoever triggered it, so a rule can only change what that person could change themselves.`
- **The CRM menu.** The row of sections under the title. `Automations` is the one you are on.
- **{button:Add a rule|primary|plus}.** Owners only, at the right above the list. It opens the builder.
- **The empty state.** With no rules you see `No rules yet. A rule watches for something happening and then does one thing — like adding a follow-up when a record is created.`
- **The list.** One row per rule, in name order from A to Z. Every rule is on the one page, running or paused, and there is nothing to page through.
- **A rule's name and its badges.** {badge:paused|outline} means somebody switched it off, so it does nothing at all. {badge:needs attention|outline} means the app can no longer read the rule, so it is skipped every time instead of half applied. {badge:failing|destructive} means the rule reads fine and is being run, and the running keeps going wrong.
- **The sentence under the name.** The rule read back in words, such as `When a new record is added, add a follow-up “Call to say hello” due tomorrow for whoever the record is assigned to.` A rule carrying {badge:needs attention|outline} shows `This rule refers to something that no longer exists, so it is being skipped.` in place of its sentence.
- **The red line under a failing rule.** `Failed once — `, or `Failed 4 times in a row — ` once it has gone wrong more than once, then the reason word for word, then the date and time it last went wrong. The reason is whatever the app threw, not wording written for you. `no details row to update` means the rule found nothing to change on the record it aimed at, because that record is hidden from the person whose action set the rule off, or because the CRM holds no details for it. `The rule failed without saying why.` means it gave no reason at all.
- **The switch.** Owners only, at the right of a row. Nothing is written on it. Its name is `Pause this rule` while the rule is on, and `Resume this rule` while it is off.
- **{button:Delete|ghost|trash}.** Owners only, beside the switch, a trash can with no wording on it. It removes the rule the moment you click it.
- **The note for everyone else.** If you are not an owner and there is at least one rule, you see `Only an owner can add or change these. They are shown here so you can see what is running.` With no rules at all you get only the empty state.

## How to add a rule

1. Click {button:Add a rule|primary|plus}. The dialog is headed `Add a rule` and reads `It runs as whoever triggers it, so it can only ever change records that person could change themselves.`
2. Type a `Name`, such as `Welcome new customers`. Up to 80 characters, and no two rules can share one. The name is also the running order, so a rule starting `A` runs before one starting `B`.
3. Pick `When`, which is the thing that sets the rule off. The five choices are below.
4. Pick `Then`, which is the one thing the rule does. The three choices are below.
5. Fill in the boxes that appear under `Then`. Changing `Then` empties them, because a follow-up's name means nothing to an assignment.
6. Read the box at the bottom of the dialog. It shows your rule as the same sentence the list will show, or, while something is missing, the first thing wrong with it.
7. Click {button:Add rule|primary}. It stays grayed out while the name is empty or the box is showing a problem, and reads `Adding…` while it saves. You see `Rule added` and the rule appears in the list, switched on.

Click {button:Cancel|ghost} to close the dialog and save nothing. After a rule is saved, your `When`, `Then` and their boxes stay as you left them for the next one you build. Only the `Name` is cleared.

**The `When` choices.** What sets a rule off. Five of them, and no others.

| `When` | What sets it off | What does not |
| --- | --- | --- |
| `A record is added` | Somebody adds a record on the CRM's own add-a-record form. | A customer or supplier added in Accounting, and an existing one being pulled into the CRM for the first time. |
| `A deal moves stage` | A deal is moved into a different stage. | Any other change to a deal. |
| `A deal is won` | A deal moves into a stage that counts as won. | A move into any other stage, and any other change to a deal. |
| `A deal is lost` | A deal moves into a stage that counts as lost. | A move into any other stage, and any other change to a deal. |
| `A follow-up is completed` | Somebody ticks off a follow-up in the CRM that is attached to a record. | Reopening one, a follow-up attached to no record, and ticking the same one off in Work. |

A deal moved into a won stage sets off `A deal moves stage` and `A deal is won` together, so rules watching each of them all run. Whatever the trigger, a rule acts on the record. For the three deal triggers that is the record the deal is with, never the deal.

**The `Then` choices.** What a rule does. Three of them, and a rule does exactly one.

| `Then` | What it does |
| --- | --- |
| `Add a follow-up` | Raises a follow-up in your main work list, linked to the record. |
| `Set the stage` | Writes a stage onto the record, over whatever was there. |
| `Assign the record` | Changes who the record is assigned to, over whoever was there. |

`Add a follow-up` gives you three boxes. `Follow-up` is what it will be called, up to 120 characters, shown as `Call to say hello` until you type. `Due in (days)` counts from the day the rule runs, in your business's own time zone: `0` is today, `1` is tomorrow, and `365` is as far out as it goes. It starts at `1`, and emptying the box makes it `0`. `For` is who gets it, with `Whoever owns the record` first, then your people by name, or by email address where they have no name. With nobody to pick from, that box is replaced by the words `Whoever owns the record.` When the record is assigned to nobody, the follow-up goes to whoever set the rule off. If the rule names somebody who has since left, the follow-up is raised with nobody on it rather than being lost.

`Set the stage` gives you one box, `Stage`, shown as `customer` until you type, up to 60 characters. It is free typing with no list to pick from, so a typo makes a rule that quietly sets a stage nothing else uses. This is the record's own `Stage`, the box on the record page, not a column on the deal board.

`Assign the record` gives you one box, `Assign to`, reading `Choose a colleague` until you pick somebody. There is no `Whoever owns the record` here, because that would be a rule that changes nothing. With nobody to pick from, this rule can never be finished.

A rule runs the moment somebody does the thing it watches for, inside their own save, as them. So a rule can never touch a record that person could not touch themselves, and a rule that goes wrong never undoes their work. Rules watching the same trigger run one after another in name order. What a rule does never sets off another rule, so rules cannot chain. Rules only ever run when the thing happens, so adding one does nothing to the records you already have.

## How to pause a rule, delete it, or change what it says

1. Turn a rule's switch off to stop it. You see `Rule paused`, {badge:paused|outline} appears next to its name, and it does nothing until you turn it back on. Everything the rule says is kept.
2. Turn the switch back on and you see `Rule resumed`. The badge goes and it starts watching again.
3. Click {button:Delete|ghost|trash} to remove a rule. There is no question first and no undo. You see `Rule deleted` and the row goes.
4. There is no way to change a rule. To change one, delete it and build it again.
5. You cannot rename a rule either, so the only way to change the order two rules run in is to delete one and add it back under a name that sorts where you want it.

## How to deal with a rule that is failing

1. Read the red line under the rule. It is the reason word for word, with the number of times in a row it has gone wrong and when it last did.
2. Turn the switch off while you work out what to do. That stops it trying on every record.
3. The {badge:failing|destructive} badge goes the next time the rule runs without a problem. Nothing on this page dismisses it, and you get no list of past failures, only the latest reason and the count.
4. {badge:needs attention|outline} is the other problem, and a different one. The app cannot read that rule at all, so it is skipped rather than run and there is nothing to fix in place. Delete it and build a new one.

## Messages

| Message | What it means |
| --- | --- |
| `Rule added` | The rule is saved and switched on. |
| `Rule paused` / `Rule resumed` | You turned the switch off or back on. |
| `Rule deleted` | The rule is gone for good. |
| `Give the follow-up a name` | In the box at the bottom of the builder. Type something in `Follow-up`. |
| `That name is too long` | The `Follow-up` text is over 120 characters. |
| `Due in must be a whole number of days, up to a year` | `Due in (days)` is under `0` or over `365`. |
| `Choose a stage` | `Set the stage` needs something typed in `Stage`. |
| `That stage name is too long` | The `Stage` text is over 60 characters. |
| `Choose who to assign it to` | `Assign the record` needs a person picked in `Assign to`. |
| `A rule with that name already exists.` | Rule names have to be different. Pick another. |
| `Invalid input` | Usually a `Name` longer than 80 characters. Shorten it. |
| `You do not have permission to do that.` | You are not an owner. You also get this pausing or deleting a rule that somebody else has already deleted, so reload the page. |
| `Accountant access to this module is read-only.` | You are signed in as the outside accountant. |
| `Something went wrong. Please try again.` | Something we did not expect. Try again, and tell us if it keeps happening. |
| `no details row to update` | In the red line under a failing rule. It found nothing to change on the record it aimed at, because that record is hidden from whoever set the rule off, or because the CRM holds no details for it. |

## Not on this page

You cannot limit a rule to some records only. There is nothing here that narrows one down to a stage, a type or a person, so every rule you build runs on every record its trigger reaches. You cannot edit or rename a rule either, only delete it and build it again. A rule cannot send anything: no email, no text message, no alert to you or anybody else, and nothing goes to another system. It cannot delete anything, write a note, or raise a deal, and it can only ever do one thing. Nothing here runs a rule over the records you already have. There is no log of when a rule ran or how often, only the red line while one is failing. A stage set by a rule skips the check on fields marked `needed to change stage`, so it moves even when one of those is blank. Setting up those fields is in [Your own fields](fields.md), the record a rule changes is in [One record](record.md), and the follow-ups a rule raises are in [Follow-ups](tasks.md). Ask us if you need something a rule cannot do.

## Who can do what

Owners do everything here: add a rule, pause it, resume it and delete it. Staff and the outside accountant see the same page and the same rules as sentences, with the switch and the delete button absent, and the note telling them so. Every rule runs as the person whose action set it off, so a staff member's edit can never make a rule change a record they are not allowed to see.
