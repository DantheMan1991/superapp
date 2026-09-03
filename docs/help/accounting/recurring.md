# Recurring entries

> Invoices, bills and journal entries the books make every month on their own: the list, adding and editing a template, pausing, the morning run and catch-up, and what each badge means.
> **Route:** /dashboard/m/accounting/recurring
> **Order:** 340

## The page

**Recurring** in the strip. The line under the title reads `Everything the books produce every month — invoices, bills and journals. Catch-up dates each one to the month it was for, never to today.` Owners see **Generate now** and **Add recurring** at the top right. The old Sales link for recurring invoices lands here too.

Before the first template: `Nothing recurring yet` and `The rent you invoice on the first, the rent you pay on the fifth, or the monthly depreciation journal — anything the books produce on a schedule.`

## Each row

Templates are listed by name. A row is the whole of a template. There is no separate page for one. The first line shows the name and its badges:

- `Invoice`, `Bill` or `Journal`. What it makes.
- `posts automatically`. A journal that posts itself each month instead of waiting as a draft.
- `paused`. The template is switched off and makes nothing until you resume it.
- `template needs fixing`. The saved template can no longer be read. Pause it and write a new one.
- `failing`. The last run could not make its entry. The reason is written under the row in red with the date of the run, for example `That customer is inactive — reactivate them first. — 2026-09-01`. Fix the cause. The note clears on the template's next clean run, not when you edit it.

The second line reads, for example, `Pleasant Valley Feed · 240.00 · day 5 · next run 2026-10-05 · last generated 2026-09-05`. The name is the customer or supplier, marked `(inactive)` when they have been deactivated. The amount is one month's worth: a journal's debits, a bill's lines, or an invoice's lines before tax. Tags on the template's lines are shown as chips, with `(retired)` after a tag that no longer exists.

Owners see **Edit** and **Pause** or **Resume** on each row. There is no delete. Pausing is how a template stops. Edit is not offered on a template the dialog cannot show faithfully: one that needs fixing, a bill with more than one line, or an invoice with a negative price. Ask us if you need one of those changed.

## When entries are made

Every morning at 6am, your local time, Yosher makes whatever is due: one entry for each template whose run day has come, dated to that day. If a run was missed, for example a template added with a first run in the past, catch-up makes one entry for each missed month, each dated to its own month, up to twelve months in one go.

Invoices and bills are always made as drafts. Issue the invoice, or approve the bill, when you are ready. A journal is made as a draft too, unless **Post automatically** is on, in which case it is posted straight away. A journal due in a month that is already closed is left as a draft instead of being posted, whatever the switch says.

**Generate now** runs the same thing at once instead of waiting for the morning. The button reads `Running…`. If nothing is due, you see `Nothing was due`. Otherwise `Created 3, 1 posted`, with a line under it when it applies: `2 left as drafts — their period is closed`, `1 tag dropped — the member was retired`, `1 template failed`.

## Adding a template

Click **Add recurring**. The dialog is titled `Add a recurring entry` and reads `Runs once a month. Catch-up creates one entry per missed month, dated to that month rather than to today.`

- **Type.** `Invoice`, `Bill` or `Journal entry`. It cannot be changed once the template is saved.
- **Name.** Required. For example `Unit 4 rent`, `Yard rent` or `Monthly depreciation`.
- **Day of month.** `1–28, so every month has one`. A day outside that answers `Day of month must be 1–28`.
- **First run.** The date of the first entry. A date in the past means catch-up makes the missed months at the next run.
- **Due in days.** Invoices and bills only. `30` to begin with. Each entry's due date is this many days after its date.

Every template runs monthly. There is no other schedule yet. Ask us if you need one.

**An invoice.** Pick the **Customer** (`Pick a customer`). Each line has a **Description**, a quantity, a unit price and an **Income account** (`Income account`), and tags when you use them. **Add line** adds another. The lines carry no tax rate from here. Add the rate on each month's draft invoice before you issue it. The note at the bottom reads `Invoices are always created as drafts — issuing one is what posts it and starts the clock on getting paid.`

**A bill.** Pick the **Supplier** (`Pick a supplier`), give a **Description** and an **Amount**, and a **Category (optional)**. Leave the category on `Leave uncoded — AI can code it later` and each bill arrives uncoded, for the assistant or you to code before approval. **Tags (optional)** when you use them. The note reads `Bills are always created as drafts — approving one is what posts it.`

**A journal entry.** Under **Lines**, each line has an account (`Account`), an amount, a **Debit** or **Credit** button that flips the side, and a remove button, greyed out while only two lines remain. Tags sit under each line when you use them. **Add line** adds another. The readout at the top right says `Balanced`, or `Out by 40.00` in amber. Saving needs at least two lines and a balanced total.

**Post automatically** is a switch under the lines: `Off by default. When on, each month posts straight to the ledger — except a month whose period is already closed, which is left as a draft.` Only a journal can post automatically.

Click **Add recurring**. The button reads `Adding…`, then you see `Recurring invoice added`, `Recurring bill added` or `Recurring journal added`.

## Editing a template

Click **Edit** on the row. The dialog is titled `Edit recurring entry` and reads `Changes apply from the next run. It cannot move to an earlier month than the schedule has reached.` Everything but the type can change. **First run** is called **Next run** here. Click **Save changes**. The button reads `Saving…`, then you see `Recurring invoice updated`, `Recurring bill updated` or `Recurring journal updated`.

Next run can move within the month the schedule has reached, for example from the 5th to the 1st, but not back into a month that has already been made: `The next run cannot move to an earlier month than the schedule has reached.` If the template changed while your dialog was open, you see `This entry changed since you opened it — reload and try again.`

A customer, supplier, account or tag the template names that can no longer be picked is shown greyed out with `(inactive)`, `(cannot be chosen)` or `(retired)` after it, and a red line above the buttons says what to do: `That supplier is inactive. Pick another, or reactivate them first.`, `That customer is inactive. Pick another, or reactivate them first.`, `The account is inactive. Pick another, or reactivate it first.`, `Line 2's account is inactive. Pick another, or reactivate it first.`, `The account can no longer be chosen by hand. Pick another.` or `Line 2's account can no longer be chosen by hand. Pick another.` Save stays greyed out until you pick another.

## Pausing and resuming

**Pause** stops the template making anything, and the row shows `paused`. **Resume** starts it again from where the schedule stopped, so the months that passed while it was paused are made at the next run, each dated to its own month, up to twelve. If you do not want them, click **Edit** first and move **Next run** forward. If somebody else changed the template in the meantime, you see `This entry changed since you opened it — reload and try again.`

## Why a run fails

The sentence under a `failing` row is the reason the morning run could not make the entry. The ones you are likely to see:

- `That customer is inactive — reactivate them first.`, `That customer no longer exists.`, `That vendor is inactive — reactivate them first.`, `That vendor no longer exists.`
- `One of the selected accounts no longer exists.`, `One of the selected accounts is inactive.`, `A line is coded to an account that cannot be chosen by hand. Pick an ordinary account — or, if a match set it, undo the match first.`
- `That tax rate is inactive or no longer exists — pick another one.`, `One of the selected tags is invalid or inactive.`
- `Debits and credits must be equal before posting.`, `A journal entry needs at least two lines.`, `Every line needs a non-zero amount.`, `That amount is larger than the ledger accepts.`
- `That date falls in a closed period. Use a reversal, or reopen the period first.`
- `That company no longer exists.`, `That company is inactive — reactivate it first.`
- `The template can no longer be read — pause it and write a new one.`
- `Failed for a reason the sweep could not name.` Ask us.

## Who can do what

Only an owner can add, edit, pause, resume or run templates. Staff and accountants see the list with no buttons.
