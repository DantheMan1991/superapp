# Recurring entries

> Invoices, bills and journal entries the books make every month on their own: the list, adding and editing a template, pausing, the morning run and catch-up, and what each badge means.
> **Route:** /dashboard/m/accounting/recurring
> **Order:** 220
> **Area:** Recurring

Open **Recurring** in the accounting menu. The line under the title reads `Everything the books produce every month — invoices, bills and journals. Catch-up dates each one to the month it was for, never to today.` Every morning at 6am, your local time, Yosher makes whatever is due. To add a template, owners click {button:Add recurring|primary|plus}. The old Sales link for recurring invoices lands here too.

## What you see

- **The buttons.** Owners see {button:Generate now|outline} and {button:Add recurring|primary|plus} at the top right.
- **Each row.** A row is the whole of a template; there is no separate page. The first line is the name and its badges: {badge:Invoice|outline}, {badge:Bill|outline} or {badge:Journal|outline}, what it makes; {badge:posts automatically|primary}, a journal that posts itself each month instead of waiting as a draft; {badge:paused|outline}, switched off until you resume it; {badge:template needs fixing|destructive}, the saved template can no longer be read, so pause it and write a new one; {badge:failing|destructive}, the last run could not make its entry. The second line reads, for example, `Pleasant Valley Feed · 240.00 · day 5 · next run 2026-10-05 · last generated 2026-09-05`, where the name is the customer or supplier, marked `(inactive)` when they have been deactivated, and the amount is one month's worth: a journal's debits, a bill's lines, or an invoice's lines before tax. Tags on the template's lines are shown as chips, with `(retired)` after a tag that no longer exists. Under a failing row, the reason in red with the date of the run, such as `That customer is inactive — reactivate them first. — 2026-09-01`.
- **On each row.** Owners see {button:Edit|outline|pencil} and {button:Pause|outline} or {button:Resume|outline}. There is no delete. Pausing is how a template stops. {button:Edit|outline|pencil} is not offered on a template the dialog cannot show faithfully: one that needs fixing, a bill with more than one line, or an invoice with a negative price.

## How the morning run works

- Each template whose run day has come gets one entry, dated to that day. If a run was missed, for example a template added with a first run in the past, catch-up makes one entry for each missed month, each dated to its own month, up to twelve months in one go.
- Invoices and bills are always made as drafts. Issue the invoice, or approve the bill, when you are ready. A journal is made as a draft too, unless `Post automatically` is on, in which case it is posted straight away. A journal due in a month that is already closed is left as a draft instead of being posted, whatever the switch says.
- A failing template keeps its note until its next clean run. Editing it does not clear the note.

## How to run it now

1. Click {button:Generate now|outline}. It reads `Running…`.
2. You see `Nothing was due`, or `Created 3, 1 posted` with a line under it when it applies: `2 left as drafts — their period is closed`, `1 tag dropped — the member was retired`, `1 template failed`.

## How to add a template

1. Click {button:Add recurring|primary|plus}. The dialog is `Add a recurring entry` and reads `Runs once a month. Catch-up creates one entry per missed month, dated to that month rather than to today.`
2. Pick `Type`: `Invoice`, `Bill` or `Journal entry`. It cannot be changed once the template is saved. Fill in `Name`, such as `Unit 4 rent`, `Yard rent` or `Monthly depreciation`.
3. Set `Day of month`, `1–28, so every month has one`, and `First run`, the date of the first entry. A date in the past means catch-up makes the missed months at the next run. For an invoice or a bill, set `Due in days`, `30` to begin with.
4. For an invoice, pick the `Customer` (`Pick a customer`). Each line has a `Description`, a quantity, a unit price and an `Income account`, and tags when you use them; {button:Add line|outline|plus} adds another. The lines carry no tax rate from here; add the rate on each month's draft invoice before you issue it. The note reads `Invoices are always created as drafts — issuing one is what posts it and starts the clock on getting paid.`
5. For a bill, pick the `Supplier` (`Pick a supplier`), give a `Description` and an `Amount`, and a `Category (optional)`. Leave the category on `Leave uncoded — AI can code it later` and each bill arrives uncoded, for the assistant or you to code before approval. `Tags (optional)` when you use them. The note reads `Bills are always created as drafts — approving one is what posts it.`
6. For a journal entry, under `Lines`, each line has an account (`Account`), an amount, a {button:Debit|outline} or {button:Credit|outline} button that flips the side, and {button:Remove line|ghost|trash}, gray while only two lines remain. Tags sit under each line when you use them. {button:Add line|outline|plus} adds another. The readout at the top right says `Balanced`, or `Out by 40.00` in amber. Turn on `Post automatically` if the journal should post itself: `Off by default. When on, each month posts straight to the ledger — except a month whose period is already closed, which is left as a draft.` Only a journal can post automatically.
7. Click {button:Add recurring|primary}. It reads `Adding…`, then you see `Recurring invoice added`, `Recurring bill added` or `Recurring journal added`.

Every template runs monthly. There is no other schedule yet.

## How to edit a template

1. Click {button:Edit|outline|pencil}. The dialog is `Edit recurring entry` and reads `Changes apply from the next run. It cannot move to an earlier month than the schedule has reached.` Everything but the type can change. `First run` is called `Next run` here.
2. Click {button:Save changes|primary}. It reads `Saving…`, then you see `Recurring invoice updated`, `Recurring bill updated` or `Recurring journal updated`.

`Next run` can move within the month the schedule has reached, for example from the 5th to the 1st, but not back into a month that has already been made. A customer, supplier, account or tag the template names that can no longer be picked is shown gray with `(inactive)`, `(cannot be chosen)` or `(retired)` after it, and a red line above the buttons says what to do. {button:Save changes|primary} stays gray until you pick another.

## How to pause and resume

1. Click {button:Pause|outline}. The template makes nothing, and the row shows {badge:paused|outline}.
2. Click {button:Resume|outline} to start it again from where the schedule stopped. The months that passed while it was paused are made at the next run, each dated to its own month, up to twelve. If you do not want them, click {button:Edit|outline|pencil} first and move `Next run` forward.

## Messages

| Message | What it means |
| --- | --- |
| `Nothing recurring yet` and `The rent you invoice on the first, the rent you pay on the fifth, or the monthly depreciation journal — anything the books produce on a schedule.` | No template exists yet. |
| `Day of month must be 1–28` | The day is outside 1 to 28. |
| `The next run cannot move to an earlier month than the schedule has reached.` | You moved `Next run` back into a month already made. |
| `This entry changed since you opened it — reload and try again.` | Somebody else changed the template while your dialog was open. |
| `That supplier is inactive. Pick another, or reactivate them first.`, `That customer is inactive. Pick another, or reactivate them first.`, `The account is inactive. Pick another, or reactivate it first.`, `Line 2's account is inactive. Pick another, or reactivate it first.`, `The account can no longer be chosen by hand. Pick another.`, `Line 2's account can no longer be chosen by hand. Pick another.` | The template names something that can no longer be picked. Pick another before saving. |
| Under a failing row: `That customer is inactive — reactivate them first.`, `That customer no longer exists.`, `That vendor is inactive — reactivate them first.`, `That vendor no longer exists.`, `One of the selected accounts no longer exists.`, `One of the selected accounts is inactive.`, `A line is coded to an account that cannot be chosen by hand. Pick an ordinary account — or, if a match set it, undo the match first.`, `That tax rate is inactive or no longer exists — pick another one.`, `One of the selected tags is invalid or inactive.`, `Debits and credits must be equal before posting.`, `A journal entry needs at least two lines.`, `Every line needs a non-zero amount.`, `That amount is larger than the ledger accepts.`, `That date falls in a closed period. Use a reversal, or reopen the period first.`, `That company no longer exists.`, `That company is inactive — reactivate it first.`, `The template can no longer be read — pause it and write a new one.` | Why the morning run could not make the entry. Fix the cause and the note clears on the next clean run. |
| `Failed for a reason the sweep could not name.` | Ask us. |

## Not on this page

There is no delete, no schedule but monthly, and no tax rate on a recurring invoice's lines. Ask us if you need any of these.

## Who can do what

Only an owner can add, edit, pause, resume or run templates. Staff and accountants see the list with no buttons.
