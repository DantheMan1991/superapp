# Jobs

> Every job you are running, each with its own number, and every cost charged to the one it belongs to. This is where a job starts; once it exists, bills and hours can be put against it and your reports will split by it.
> **Route:** /dashboard/m/jobs/**
> **Order:** 100

## What a {{project|lower}} is here

A {{project|lower}} is one piece of work you cost on its own: a house, a fit-out, a service call, a site. It carries a **number** you choose, and everything charged to that number adds up in one place.

Three things sit on every {{project|lower}}, and only the first is required.

- **Company.** Whose books the cost lands in. If your business is one company you will never see this — it fills itself in. If you keep more than one set of books, you pick, and you pick once: it cannot be changed by editing later, because moving a job's costs between two companies is not an edit.
- **Division.** Which part of the business runs it, when you have divisions set up under Settings. Leave it on `Whole business` if you do not.
- **Cost codes.** Which list of codes the job is charged against. With one list you are never asked; the default is used.

## Starting a {{project|lower}}

Owners only. Click {button:New {{project|lower}}|primary} on the {{project|plural}} page.

1. **`Number`** — required. Whatever you already write on a job: `24-108`, `Oak Row`, `1042`. It has to be different from every other {{project|lower}}'s, and you see `That job number is already in use. Pick another.` if it is not.
2. **`Starts`** — optional. Leave it blank until the job is real.
3. **`Name`** — required. What people call it.
4. **`Address`** — optional. Where the work is. It shows under the name in the list.
5. **`Company`** — only appears if you keep more than one set of books.
6. **`{{customer}}`** — who the job is for, picked from the people already in your books. `Nobody yet` is a real answer: a spec build has no {{customer|lower}} until it sells.
7. **`Kind of work`** — optional, and deliberately so. If your industry pack is set up you pick from a list; if not you type it, or leave it blank. **A job can exist before you know what it will be** — a design agreement is real work whether or not the build ever happens.
8. **`Division`** — only appears if you have divisions.
9. **`Cost codes`** — only appears if you keep more than one list.
10. **`Notes`** — anything you want on the page.

{button:Add {{project|lower}}|primary} stays greyed out until the number and the name are filled in. On success you see `{{project}} added` and the new row appears at the top of the list.

## The list

Six columns: `Number`, `{{project}}`, `{{customer}}`, `Kind`, `Company`, `Status`. The number is a link to the job's own page. A `—` means nothing was filled in, which is not an error.

Before you have added anything you see `No {{project|plural|lower}} yet`. Staff see the same page with no buttons and a line saying an owner sets the first one up.

## A {{project|lower}}'s page

`Details` lists everything above, plus one row worth understanding:

- **`Charged to`** — the name this job appears under in your cost reports, which is its number and its name together. If it ever reads `Not a cost object — this should not happen; tell us`, tell us: it means the job was created but the thing that lets reports group by it was not, and costs put against it will not show up where you expect.

`Cost codes` below it lists the codes this job is charged against, or a link to add some.

## Contracts

A {{project|lower}} can have **several agreements over its life**, and that is the normal case rather than the exception. A custom home often runs a design agreement, then a drawings agreement, then the build — three contracts, one job, and **the first two may be the only two that ever happen** if the client sees the number and stops there.

They are listed on the {{project|lower}}'s own page, numbered in the order you agreed them. Owners only to add. **Click a contract's kind to open its own page** — its schedule of values and its pay applications; see Billing a contract. The `Billed` column is what has been certified for payment so far, with what is held back under it, and `—` until the first application is issued.

### Adding one

{button:Add contract|primary} on the {{project|lower}}'s page.

1. **`Kind`** — required. What sort of agreement it is. If your industry pack is set up you pick from a list; otherwise you type it, lowercase with underscores: `concept_design`, `new_home`, `aia`.
2. **`Name`** — optional, for when the kind alone will not tell two apart.
3. **`Who holds it`** — `We hold the contract` when the job is yours, or `We are a subcontractor` when you are working under somebody else's general contractor. The next field's label changes to match.
4. **`{{customer}}`** / **`General contractor`** — who the agreement is with, picked from the people in your books. `Nobody yet` is fine for a proposal written before they are on file.
5. **`Value`** — what was agreed. Type it however you like: `182,500`, `$182500` and `182500.00` all mean the same thing. Leave it blank for cost-plus work that has no fixed number until it is done. **Once the contract is signed the box is locked** and reads `Signed. Change the value with a change order.` — see Change orders below. A signed contract whose value was never filled in can still have it filled in once.
6. **`Signed`** — optional.
7. **`Billed by`** — how this one gets invoiced. Recorded now and used when billing is built; nothing bills yet.
8. **`Status`** — see below.
9. **`Notes`**.

{button:Add contract|primary} stays greyed until the kind is filled in. Every field resets afterwards, so adding a second agreement does not quietly inherit the first one's status.

### Status, and what counts as money

| Status | Counts toward the job's value |
| --- | :-: |
| `Proposed` | |
| `Signed` | ● |
| `Complete` | ● |
| `Declined` | |
| `Cancelled` | |

**Only signed and complete agreements are added up.** A proposal the client has not accepted is not money, and a job that counted it would make the business look bigger than it is. Proposals still show in the list, and the line above it says how many are outstanding: *"Worth $1,854,500.00 across 2 signed agreements, with 1 still proposed."*

`Declined` is a real ending, not a failure to record something — it is the client who read the number and walked.

The `Value` column shows what each agreement is worth **now** — its original value plus any approved change orders — with `orig. $…` underneath when the two differ, and the sentence above adds *"including $… in approved changes"* when there are any. See Change orders.

### On the {{project|plural}} list

The `Value` column is the same total: signed and complete only, revised by approved change orders, with `incl. $… in changes` under it when there are any. A job with nothing signed yet shows `—` rather than `0.00`, because zero would read as "worth nothing" when the truth is "not agreed yet".

## Change orders

Owners only to add. On the {{project|lower}}'s page, under **Change orders**.

A change order is the one proper way a signed contract's value or a job's budget moves. It records two different numbers at once: **what the client pays** for the change, and **what it costs you**, by cost code. They are different because the price carries your markup, so the form asks for both rather than guessing one from the other.

The line the panel is built around is *original + approved changes = revised*. Only an **approved** change order moves anything; a proposed one is a price the client has been shown and not yet answered.

### Adding one

{button:Add change order|primary}. The button only appears once the {{project|lower}} has a contract, because a change order changes an agreement — if there is none, the panel says `A change order changes an agreement, so add a contract first.`

1. **`Against`** — which agreement this changes. Filled in for you when the job has one contract, or one signed one; otherwise you pick. **It cannot be changed afterwards** — a change order stays on the agreement it was raised against.
2. **`Number`** — required. However you number them: `CO-3`, `PCO 12`, `7`. It has to be different from the other change orders **on the same contract**; two contracts may each have a `CO-1`. You see `That change order number is already used on this contract.` if it clashes.
3. **`Title`** — required. `Add covered porch`.
4. **`What changes`** — optional. The scope, as it will read on the pay application.
5. **`Price to the client`** — what the contract value moves by. Type it however you like. **Negative is allowed here**, and it is the one money box in Jobs where it is: a deduction — the client drops the pool — is `-18,500`, not a separate kind of form. Leave it blank for a change with no price.
6. **`Requested`** — optional date.
7. **Cost, by code** — what the change is expected to cost you. Each line takes a `Cost code` (required on any line with an amount), an optional description and an `Amount`, which may also be negative to move a code down. {button:Add line|ghost} for more. **A line with no amount is ignored**; a line with an amount and no code is refused with `Every line on a change order needs a cost code.` `Cost typed` on the right adds up the lines as you go. No lines at all is fine — a negotiated price change with no extra scope has none. If the job's list has no active codes, the lines are replaced by a note saying so: the price still moves the contract value, and restoring or adding a code under Cost codes brings the lines back.
8. **`Status`** — see below.
9. **`Approved on`** — appears when the status is `Approved`, and fills in with today's date if it was empty. Change it to the day the signature actually landed. An approved change order cannot be saved without one: `Give an approved change order the date it was approved.`
10. **`Notes`**.

{button:Add change order|primary} stays greyed until the contract, number and title are filled in. On success you see `Change order added`; the contract stays selected for the next one and everything else clears.

### Status, and what it moves

| Status | Moves the contract value and the budget |
| --- | :-: |
| `Proposed` | |
| `Approved` | ● |
| `Declined` | |
| `Void` | |

`Proposed` is what a commercial job calls a PCO — priced and put to the client. `Declined` is the client saying no. `Void` is withdrawn before anybody answered. Setting an approved change order back to any of these clears its approval date.

An approved change order on a contract that does not itself count — one that is proposed, declined or cancelled — moves nothing. It is a change to an agreement that is not there.

### Reading the table

| Column | What it is |
| --- | --- |
| `Number` | Yours. |
| `Change` | The title, with `Approved <date>` under it once it is. |
| `Against` | Which contract it changes. |
| `Price` | What the client pays. A minus sign is a deduction. |
| `Cost` | The lines added up, with how many codes when there is more than one. `—` when there are no lines. |
| `Status` | As above. |

The line above the table adds up the approved ones: *"2 approved, worth $12,500.00 on the contract value, with 1 still proposed."*

### Where it shows up

- **Contracts.** The `Value` column shows the **revised** value — original plus approved changes — with `orig. $…` underneath when they differ, and the sentence above the table says how much of the total is approved changes. The number in the column is the one the next pay application is against.
- **Job cost.** The `Budget` column is the revised budget per code, with `orig. $…` underneath where a change moved it. A code that was never budgeted but has an approved change against it is budgeted at the change, and does not get the `Not budgeted` badge — the client approved money onto it, which is a plan, arrived late.
- **The {{project|plural}} list.** `Value` is revised, with `incl. $… in changes` under it when there are any.

### Editing one

The pencil at the end of its row. Everything except which contract it is against. **Changing the lines replaces all of them**, so what you see in the dialog is what you get — and removing every line is a real instruction, not a mistake, because a change order with no lines is a legitimate thing to be.

## Billing a contract

Owners only. Click a contract's kind in the **Contracts** table on the {{project|lower}}'s page to open the contract's own page: its **schedule of values** and the **pay applications** drawn against it.

What the page shows depends on the contract's **Billed by** setting. A fixed-price contract is billed in draws against a schedule of values; a **cost plus a fee** contract is billed as what the job has cost plus the fee, with nothing to set up (see *Cost plus a fee* below); a **time and materials** contract is billed as the hours Time has approved on the job at their rates, plus the rest of the cost with a markup (see *Time and materials* below); a **unit price** contract is billed by the quantities installed at the schedule's prices (see *Unit price* below).

A fixed-price contract is billed in draws. The schedule breaks the contract sum into lines — by trade, by phase, or as milestones — and each application says how much of each line is complete to date. What is due is that, less the retainage held back, less what earlier applications already certified. **Issuing an application makes it an ordinary invoice** in Accounting, so it ages, gets chased and gets paid like any other.

Five figures sit at the top of the page:

- **Contract value** — the revised value, original plus approved change orders.
- **Scheduled** — what the schedule adds up to. When it does not match the contract you see `$… not on the schedule` or `$… over the contract` in red. Neither stops you; both mean the schedule is not finished.
- **Billed to date** — the payment due on every issued application, added up.
- **Retainage held** — what the latest issued application holds back.
- **Balance to finish** — scheduled, less everything completed to date.

### The schedule of values

{button:Set up the schedule|outline} the first time, {button:Edit schedule|outline} after. Each line takes a **description** (required — a row without one is ignored), an optional **cost code**, where it came from (**Original contract**, or the approved **change order** that added it) and its **scheduled value**. {button:Add line|ghost} for more. The total is shown against the contract as you type.

- **One line for the whole contract** — offered when the schedule is empty. A home billed monthly on percent complete needs no breakdown; this gives it one line worth the contract sum.
- **Saving replaces the schedule** with what is in the dialog, in that order. Except a line that has been billed on an application: its remove button is greyed and reads *Billed on an application; cannot be removed*. Its value can still change.
- The `Complete` column on the schedule reads from the latest issued application.

### Starting an application

{button:New application|primary}. Greyed with a reason when there is no schedule yet, or when a draft is already open — **a contract holds one draft at a time**, because each application carries the previous one's figures forward.

1. **`Period to`** — the last day the application covers.
2. **`Retainage %`** — held back from everything completed to date. It carries over from the last application, so you set it once. Blank is none.
3. **`Notes`**.

{button:Start application|primary} numbers it after the last one on the contract, void ones included, and gives it a line for every schedule line.

### Filling in a draft

{button:Open|outline} on the draft's row. One row per schedule line:

| Column | What it is |
| --- | --- |
| `Scheduled` | The line's value. |
| `Previous` | Work completed on earlier applications. Carried, not typed. |
| `This period` | What was completed this period. **May be negative** to correct an earlier over-billing. |
| `Stored` | Materials on site, not yet installed. Entered fresh each period. |
| `To date` | Previous + this period + stored. Cannot go below nothing. |
| `%` | To date as a share of scheduled. |

Under the table, live as you type: *Completed and stored to date*, *Retainage*, *Total earned less retainage*, *Less previous certificates*, and **Current payment due** — the same arithmetic the invoice will carry. If the schedule gained lines since the draft was started (a change order's, say), they appear when you save.

- {button:Save draft|outline} keeps it.
- {button:Issue as invoice|primary} — dated `Issue on` — freezes the certificate and posts it as an invoice to the contract's {{customer|lower}}, on the {{project|lower}}'s company's books. Greyed while nothing is due. The invoice has two lines: the work earned this period to contract revenue, and the retainage withheld this period as a negative line to Retainage Receivable — so the ledger reads Dr AR (net), Dr Retainage Receivable (held), Cr Revenue (gross). You see `Application N issued as an invoice`, and the row shows the invoice's number and whether it is `Open`, `Partly paid` or `Paid`.
- {button:Delete draft|ghost} throws it away; an issued application is never deleted.

What can stop an issue, in its own words: `Nothing is due on this application, so there is nothing to invoice.` · `Say who the contract is with before billing it.` · `The chart of accounts is missing something: …` (a business withholding retainage needs a `1230` Retainage Receivable account; the construction profile adds it) · Accounting's own refusals, such as a closed period.

### Releasing retainage

There is no separate step. A later application at a **lower rate** — the final one at `0` — computes less retainage to date than the last certificate held, and the difference is due: the invoice carries a `Retainage released` line. Set the rate to zero on the last application and everything held comes back.

### Cost plus a fee

Choose `Cost plus a fee` as the contract's **Billed by** and three boxes appear on the contract: **Fee % of cost**, **Fixed fee**, and **Guaranteed maximum**. Fill in the rate, the sum, or both; leave the maximum blank when there is none. A signed cost-plus contract has no value of its own — its worth is what the work costs.

The contract's page then shows **Cost plus a fee** in place of the schedule of values: the terms in a sentence, and **In the books to date** — every bill, timecard and journal line tagged to the {{project|lower}}, by cost code, with a `No cost code` line for money tagged to the job alone. There is nothing to set up: **the coding on the bills is the schedule.** The five figures at the top become **Fee**, **Cost to date**, **Billed to date**, **Retainage held** and **Guaranteed maximum** (with what is left to bill under it).

{button:New application|primary} works as for a fixed-price contract, without needing a schedule first. {button:Open|outline} on the draft shows one row per cost code:

| Column | What it is |
| --- | --- |
| `In the books to date` | What the books carry on this code for this job, dated on or before the period end. Refreshed every time you save. |
| `Billed before` | What earlier applications billed on the code. Carried, not typed. |
| `This period` | What this application bills. It starts at the difference. Type less to leave a disputed bill out — the row then says `$… left unbilled` — or less than nothing to pass a credit on. |
| `Billed to date` | Billed before plus this period. |

A bill dated inside an earlier period and posted late simply shows as more in the books than billed, and the next application picks it up: **each application bills to date, never by window.**

Under the rows: *Cost to date*, *Fee to date* (the rate on the whole cost to date, plus the fixed fee), *Cost plus fee to date* — or *Cost plus fee, at the guaranteed maximum* when the cap holds it down — then *Retainage*, *Earned less retainage*, *Less previous certificates* and **Current payment due**, and *Balance to the guaranteed maximum* when there is one. On a contract with a fixed fee the box **Fixed fee billed to date** is yours to type; it cannot exceed the fee, and it starts where the last application left it.

{button:Issue as invoice|primary} posts an invoice with a line for the cost this period, a line for the fee this period, and the retainage line — or, when the maximum holds, one line that says *at the guaranteed maximum*. Everything else — retainage, release, voiding, one draft at a time — works exactly as for a fixed-price contract.

One job's cost is billed by **one** cost-plus contract. Starting an application on a second cost-plus contract on the same {{project|lower}} says *Another cost-plus contract on this job is already billing its cost.* A fixed-price contract beside a cost-plus one is fine.

### Time and materials

Choose `Time and materials` as the contract's **Billed by** and four boxes appear on the contract: **Labour rate, everybody**, **Markup % on cost**, **Fixed fee** and **Not to exceed**. Leave the labour rate blank to bill each person at the `Charged out at` rate on their Time rate card, from the day it starts; fill it in to bill everybody's hours at one rate. Leave the maximum blank when there is none. A signed time-and-materials contract has no value of its own.

The hours come from **Time**: an entry tagged with the {{project|lower}} — the same tag a bill line carries — of worked time (paid leave is a cost, never a charge), on a timesheet that has been **approved**. Hours on a sheet nobody has approved are counted and shown, and not billed. Time has to be switched on; the page says so when it is not.

The contract's page shows **Time and materials** in place of the schedule of values: the terms in a sentence, **Approved hours on the job** (and how many more await approval), and **In the books, wages aside** — every bill and journal line tagged to the {{project|lower}}, by cost code, except the wages accounts, because the hours are billed instead and must not be marked up on top of them. The five figures at the top become **Labour**, **Cost to date**, **Billed to date**, **Retainage held** and **Not to exceed**.

{button:New application|primary} works as for a cost-plus contract, with nothing to set up. {button:Open|outline} on the draft shows two tables. The hours first, one row per person per rate:

| Column | What it is |
| --- | --- |
| `Person` and `Rate` | Who, and the rate their hours are billed at: the contract's rate for everybody, or their Time rate in force on the day. A person whose rate changed mid-job has two rows. `—` with a red note means no rate could be found. |
| `Approved to date` | Worked hours tagged with the {{project|lower}} on approved timesheets, dated on or before the period end. Refreshed every time you save. |
| `Billed before` | Hours earlier applications billed at this rate. Carried, not typed. |
| `This period (h)` | Hours this application bills, typed in hours (`7.5`). It starts at the difference. Type less to hold hours back — the row says `… h left unbilled` — or less than nothing to credit hours back. |
| `This period` and `Billed to date` | Those hours at the rate, and the running total. |

Then the cost table, exactly as for cost plus a fee, with the wages accounts left out. Under both, live as you type: *Labour to date*, *Cost to date, wages aside*, *Markup to date*, *Labour, cost and markup to date* — or *…, at the not-to-exceed* when the cap holds — then *Retainage*, *Earned less retainage*, *Less previous certificates* and **Current payment due**.

{button:Issue as invoice|primary} posts an invoice with a line per person — `Alice Carpenter, 10 h at 65.00/h through 2026-09-30` — then the cost this period, the markup, and retainage; or one line *at the not-to-exceed* when the cap holds. It is greyed while anybody on the draft has hours this period and no rate, and the note under the buttons says who: set a `Charged out at` rate for them in Time and save the draft, put one rate for everybody on the contract, or type `0` on their row to leave their hours for a later application.

What can stop an issue, beyond the cost-plus refusals: `Hours with no bill rate: Bob Labourer. Set a charged-out rate in Time, or one rate for everybody on the contract.`

- **A timesheet approved late** simply shows as more hours to date than billed, and the next application picks them up — to date, never by window, like a late bill.
- **The contract's rate for everybody is fixed once an application has issued**: the box greys with `Fixed once an application has issued`, and a save that changes it is refused in those words. A rate that changes over time is set in Time with its date, and each person's hours are billed at the rate in force on the day.
- **One contract bills a job's books**, cost plus or time and materials; a second one starting an application is refused as for cost plus.

### Unit price

Choose `Unit price` as the contract's **Billed by**. The contract's **Value** is the estimate: what the schedule adds up to, which the work is expected to pass or fall short of. The contract's page then shows a **Schedule of unit prices** where the schedule of values would be.

{button:Set up the schedule|outline} takes one row per item: a **description**, the optional cost code and change order, the **unit** (`cy`, `lf`, `ea`, `ton` — whatever you measure in), the **estimated quantity** (up to three decimals) and the **unit price**. The value beside the row is the estimate at the price; it is shown, never typed. Everything else — saving replaces the schedule, a billed item cannot be removed but its quantity and price can change, the total against the contract — is as for a schedule of values.

{button:New application|primary} works as for a fixed-price contract. {button:Open|outline} on the draft shows one row per item:

| Column | What it is |
| --- | --- |
| `Item` | The description, with the price per unit and the estimated value under it. |
| `Est. qty` | The estimated quantity, in its unit. |
| `Previous qty` | The quantity billed on earlier applications. Carried, not typed. |
| `This period qty` | **What you type**: the quantity installed this period. May be negative to correct an earlier count. |
| `This period` | That quantity at the item's price, worked out as you type. |
| `Stored` | Materials on site, as money, exactly as on a schedule of values. |
| `To date` and `%` | The money to date and its share of the estimate. Past the estimate the percent passes 100 and the balance goes negative, which is what unit price is for. |

{button:Issue as invoice|primary} posts an invoice with **a line per item** — `Excavation, 600 cy at 18.00/cy through 2026-09-30` — and, when stored materials change, one line for that; then retainage as on any application. The printout's continuation sheet carries the unit, the price, the estimate and the quantities beside the money.

### Printing an application

{button:PDF|ghost} on any application's row — draft, issued or voided — opens it as a two-page PDF in a new tab, ready to print, sign and send.

- **Page one, the certificate**: who it is from and to, the {{project|lower}}, the contract and its date, the application number, the period and the date issued; then the nine lines every owner and architect expects — original contract sum, net change by change orders, contract sum to date, total completed and stored to date, retainage, total earned less retainage, less previous certificates, **current payment due**, and balance to finish — a change-order summary (additions and deductions, approved before the last certificate and since), a certification sentence for you to sign and date, and an *Amount certified* line with a signature and date for the owner or architect.
- **Page two, the continuation sheet**, sideways: a row per schedule line with its scheduled value, work from previous applications, this period, stored materials, the total to date, its percent, and the balance to finish, with totals.
- A **cost plus a fee** or **time and materials** application prints on the same two pages with its own lines: the guaranteed maximum or not-to-exceed where the contract sum goes (`None` when there is none), *Cost plus fee to date* or *Labour, cost and markup to date* as line 4 with its parts under it, and on the continuation sheet the cost by code and, for time and materials, the hours by person and rate.
- A draft prints with **DRAFT** across every page and *Not yet issued* as its date; a voided application prints with **VOID**. An issued one prints the figures it froze at issue, so it reads the same for as long as it exists.
- The *To* block is the contract's {{customer|lower}} and, when they have been invoiced before, the postal address on their Accounting customer record; a {{customer|lower}} never billed prints as a name alone.

The form itself, its wording and its name belong to the AIA and are not reproduced; a business that must file the AIA's own form copies these nine figures onto it.

### Voiding

{button:Void|ghost} on the **latest issued** application only — every later one was computed from it. Accounting voids its invoice too, and refuses if a payment has been recorded against it (unapply the payment first). The next draft then certifies against the application before it.

## Job cost — what it was meant to cost

Owners only to set. On the {{project|lower}}'s page, under **Job cost**.

A budget here is **per cost code**, never one number for the whole job. That is deliberate: "the job is $40,000 over" tells you something has gone wrong and nothing about what to do; "the framing is $40,000 over" is a decision you can act on.

### Setting a budget

{button:Set budget|outline}. You get your whole cost code list with a box beside each, and whatever you have already set filled in.

- **Leave a code blank** if you have no plan for it yet. It simply will not appear on the report.
- **Zero is different from blank.** Zero means you are carrying that code at nil, so anything spent against it shows as a variance. Blank means you have not decided.
- **Codes you do not touch are left alone.** Saving does not wipe the rest of the budget, so two people can fill in different trades on different days.
- Retired codes are not offered, unless one already has a budget against it — in which case it stays editable rather than stranding the figure.
- **What you type is the original.** Approved change orders sit on top of it, and the report shows both.

`Total typed` at the bottom adds up what is in the boxes as you go.

### Reading the report

| Column | What it is |
| --- | --- |
| `Budget` | What you planned for that code, revised by approved change orders, with `orig. $…` underneath when one moved it. |
| `Ordered` | What you have committed on **this job** against it — issued and closed orders only. |
| `Spent` | What your books have been billed for it on **this job** — every bill, timecard or journal line tagged with the job and this code. Another job's spend on the same code is never here. |
| `Left` | Budget minus the **greater** of ordered and spent — what the code will cost at least. Ordered but not yet billed is still owed; billed beyond what was ordered has already happened; adding the two would count one dollar twice. **Negative and red means that trade is over.** |

A code you have ordered against or spent against but never budgeted appears with a `Not budgeted` badge. That row is usually the one worth looking at. A code that was never budgeted but has an approved change order against it appears without the badge, budgeted at the change.

The line above the table reads *"Budget $… against $… ordered and $… spent"*, and adds *"after $… in approved changes"* when there are any. Ordered and spent there are over budgeted codes only, so the headline compares like with like.

### Spend with no cost code

A bill line can carry the job and no code. That money is real, it is in the job's `Actual cost` in the panel below, and no row of this table can hold it — so the note under the table says how much: *"$3,000.00 has been spent on this job with no cost code on the line."* Fix it where it happened: open the bill in Accounting and put the code on the line. The `Spent` column is only ever as good as the coding on the bills.

## What you have ordered

Owners only to add. On the {{project|lower}}'s page, under **Ordered**.

A purchase order or a subcontract is money the job **already owes**, whether or not the bill has arrived. That is the number a job cost report is missing when it looks fine and is not: you can be $400,000 into a $1.8m job and have already ordered $1.5m of it.

Three figures sit at the top of the panel:

- **Contract value** — what you are being paid, from signed agreements, including approved change orders.
- **Committed** — what you have ordered.
- **Actual cost** — what has actually been billed to the job in the books.

Actual cost reads `0.00` until bills are charged to the job. That is a real answer, not a missing one.

### Adding an order

{button:Order something|primary}.

1. **`Kind`** — `Purchase order` or `Subcontract`. Pick honestly: they behave differently later, when retainage and lien waivers arrive.
2. **`Number`** — required, and different from every other order. It is what a supplier quotes back on the invoice, so two the same is a matching problem. You see `That order number is already in use. Pick another.` if it clashes.
3. **`Who is being paid`** — required. Unlike a contract, an order has to be to somebody who is already in your books; add them in Accounting first if they are not.
4. **`What it is for`** — optional.
5. **Lines** — the money. Each line takes a `Cost code`, an optional description and an `Amount`. {button:Add line|ghost} for more; a framing subcontract covering labour and materials is two lines. **A line with no amount is ignored**, so the empty last row costs you nothing.
6. **`Status`** — see below.
7. **`Issued`** and **`Notes`** — optional.

### Status, and what counts as committed

| Status | Counts as committed |
| --- | :-: |
| `Draft` | |
| `Issued` | ● |
| `Closed` | ● |
| `Cancelled` | |

A draft is written but not sent, so nobody is owed anything. `Closed` still counts — the work was ordered and done, and dropping it would make a finished job look cheaper than it was.

### Editing an order

The pencil at the end of its row. **Changing the lines replaces all of them**, so what you see in the dialog is what you get. Changing only the status leaves the money alone. A subcontract that has been billed against refuses a change to its lines — the certificates point at them.

### Billing a subcontractor, and holding retainage

Click an order's number in the **Ordered** table to open its own page. A purchase order's page shows its lines and says that it is billed with an ordinary bill in Accounting. A **subcontract's** page adds **Subcontractor applications**: what the subcontractor bills you, recorded the same way you bill your client.

Four figures sit at the top: **Subcontract value**, **Billed to date**, **Retainage held** (what you are holding back from them) and **Balance to finish**. The `Complete` column on the lines reads from the latest billed application.

{button:New application|primary} — greyed while a draft is open, or when the subcontract has no lines — takes `Period to`, `Retainage %` (what you hold back; it carries over from the last application) and `Notes`. {button:Open|outline} on the draft is the same grid as a pay application, one row per subcontract line: `Scheduled`, `Previous` (carried), `This period`, `Stored`, `To date`, `%`, with the certificate live underneath — *Completed and stored to date*, *Retainage*, *Total earned less retainage*, *Less previous certificates* and **Current payment due**. `Bill dated` is the date the bill will carry.

{button:Approve as bill|primary} posts an ordinary bill in Accounting to the subcontractor, on the {{project|lower}}'s company's books: a line for the work this period on each subcontract line, to Subcontractor Expense and **tagged with the job and the line's cost code** — so it lands on the job cost report's `Spent` column at once — and the retainage held this period as a negative line to `2120 Retainage Payable`. The ledger reads Dr expense (gross), Cr Retainage Payable (held), Cr Accounts Payable (net). The subcontractor's own invoice number, typed in `Their reference`, becomes the bill's number. The row shows `Billed`, the bill's number and whether it is `Open`, `Partly paid` or `Paid`; pay it from Accounting like any other bill.

**Releasing retainage** is a later application at a lower rate — the final one at `0` — which carries a `Retainage released` line and pays out what was held. Nothing else to do.

What can stop an approval, in its own words: `A purchase order is billed with an ordinary bill in Accounting. Applications are for subcontracts.` · `This contract already has a draft application. Finish that one first.` · `Nothing is due on this application, so there is nothing to invoice.` · `The chart of accounts is missing something: the chart has no 2120 Retainage Payable account` (the construction profile adds it) · Accounting's own refusals, such as a closed period. {button:Void|ghost} works on the latest billed application only and voids its bill too; Accounting refuses if the bill has been paid.

On the {{project|lower}}'s page the Ordered table's `Billed` column reads what each subcontractor has billed and what is held from them.

## On site — the daily log, photos and the punch list

Anyone on the team, not only owners: the field is a chore, and the person with the phone on the site is rarely the owner.

### The daily log

One report per {{project|lower}} per day. On the {{project|lower}}'s page, under **On site**, {button:Log today|primary}; or {button:All days|outline} for the full record, where every day has its own panel.

1. **`Day`** — today unless you change it. **Logging a day that already has a report edits that report** rather than making a second one, so two people logging the same day end up with one.
2. **`Weather`** — free text: `Clear, 78°`, `Rain after two`.
3. **`What happened`** — the report itself, as many lines as you like.
4. **Who was on site** — one row per trade or subcontractor: the `Trade` (`Framing`, `Electrical`, `Own crew`), the `Subcontractor` from your books if it was one, how many `People`, and `Hours each`. {button:Add crew|ghost} for another row. A row with no trade and no subcontractor is ignored; a row with one and `Hours` that is not a number is refused with `Hours must be a number, like 8 or 6.5.` **This is a headcount** — who was on the site, including other companies' crews. Your own people's timecards are in Time and this does not touch them.

{button:Log it|primary}; on a day that already exists the button reads {button:Save day|primary} and there is a {button:Remove day|ghost} beside it. Removing a day takes its crew lines with it; **its photos stay in Documents**.

The **On site** panel shows the last five days — the date, how many were on site, the photo count, the weather, and the first lines of the report. The **Daily log** page shows every day with the crews as a table and the day's man-hours.

### Photos

On the **Daily log** page, each day has a photo strip: {button:Add photos|outline} or the camera on a phone. A photo attaches to the day, is filed in Documents' Photos folder, and can be made the day's main picture or removed from the day (the file stays in Documents). Photos need Documents switched on; without it the panel says so instead of offering a button that would fail.

### The punch list

Under **Punch list** on the {{project|lower}}'s page: what still needs fixing or finishing. Type the item, optionally a date, {button:Add|primary}. Tick the box when it is done; untick to reopen.

**A punch item is a work item.** It is the same row that appears in Work with everything else that needs doing, where it can be assigned, dated and chased in the daily digest. This panel is the job's view of it — add and tick — and Work is where the rest happens.

### Saying it instead

The tell box knows the site. *"Poured the garage slab at Oak Row, four guys, six hours"* becomes a line on today's report for 24-108 with a crew of four at six hours each; *"punch item at Oak Row: touch up the paint in the master bath"* becomes a punch item on that job. The job is found by its number, its name or its street — say whichever you would say on the phone. A log entry is read back for you to confirm; a punch item records itself, because it lands on a list you can see and remove from in one press.

## Work in progress — earned revenue and over/under billing

{button:Work in progress|outline} on the {{project|plural|lower}} list, at `/dashboard/m/jobs/wip`. Everyone can read it; only an owner can type an estimate or post.

Your books say what you have **billed**. This schedule says what you have **earned** on each job as of a date, and the difference between the two — per job, never netted — is what a bank or a surety asks to see before anything else. Posting it puts that difference in your books for the period, so the profit and loss for the month reads the work that was done rather than the draws that happened to go out.

### Picking the company and the date

- **Company** appears only when you keep more than one set of books. A schedule is per company, because the entry lands in one company's books and each company closes its own months.
- **As of** is the period end — a month end for nearly everybody. It starts on the last complete month. Type any date and press {button:Show|outline}.

Under the picker one line says where the period stands:

- `Draft` — *Live figures as of …* The numbers come from your books as they are right now, and change as bills and invoices land. If you have typed estimates for this date, the line says they are kept.
- `Posted` — *Posted on …, figures frozen*, with links to **the adjustment** and **its reversal** in Accounting's journal, and {button:Unpost|outline} for an owner.

### Reading the schedule

One row per {{project|lower}} of the company that has a contract value, a cost or a billing as of the date. A cancelled job is never shown. A job marked complete stays until it has been fully billed, then drops off — the schedule is for work in progress, not for every job you have ever finished.

| Column | What it is |
| --- | --- |
| `Contract` | Original value plus approved change orders, over signed and complete contracts. `—` when the job has no fixed value. |
| `Est. cost` | What the job is expected to cost in total: the revised budget, unless you typed an estimate for this period (then `budget $…` sits underneath, or `re-estimated` once posted). |
| `Cost to date` | Everything in your books tagged to the job on an expense account, dated on or before the period end. Bills, timecards, journal entries — whatever carries the job. |
| `% done` | Cost to date divided by estimated cost. Capped at 100. A job marked `Complete` is 100 whatever its cost says. `—` when there is nothing to divide by. |
| `Earned` | The contract value at that percent. |
| `Billed` | Everything invoiced against the job, before retainage, dated on or before the period end — pay applications and any other invoice tagged to the job. |
| `Under-billed` | Earned minus billed, when the work is ahead of the billing. Money you have earned and not yet asked for: an asset. |
| `Over-billed` | Billed minus earned, when the billing is ahead of the work. Money you have been paid for work not yet done: a liability. |
| `Profit to date` | Earned minus cost to date. Red when negative. |

The total row adds each column and says how many jobs were measured and how many were left out. The two billing columns are added separately and never against each other: a job billed ahead and a job billed behind are two facts, and your balance sheet carries both.

A row may carry a badge saying why it is left out of the entry:

- `No budget and no estimate to measure cost against` — the job has value or cost but nothing to divide by. Type an estimate here, or set a budget on the job's page. **Until you do, the period cannot post**: a schedule missing a job is exactly what a bank would not accept, so nothing posts quietly around it.
- `No fixed contract value to earn against` — a job mixing billing methods, or a signed contract with no value yet (a unit-price job's value is its estimate, and counts). It is shown and left out. If it also has billings, the period cannot post, because those billings cannot be measured this way. A job whose only signed contract is cost plus a fee or time and materials is measured its own way and never shows this.
- `Hours on the job with no bill rate — set one in Time, or one rate on the contract` — a time-and-materials job with approved hours for somebody who has no `Charged out at` rate in Time and no rate for everybody on the contract. Shown and left out, and the period cannot post until the rate is set. Only owners can see rates, so somebody who is not an owner sees this on every time-and-materials job with hours; the posted schedule is the owner's and reads the same for everybody.

### The estimate

Owners only, and only while the period is a draft. The box in the `Est. cost` column shows the budget as its placeholder. Type the total cost you now expect the job to finish at — `1300000` or `1,300,000.00` both work — and press Enter or click away; it saves on its own. `budget $…` appears underneath so you can see what you overrode. Clear the box to go back to the budget.

An estimate belongs to **this period only**. Next month starts from the budget again unless you type one — which is what a monthly cost-to-complete review is.

A wrong entry says *An estimate must be an amount, like 1300000 or 1,300,000.00.* Once the period has posted the boxes become plain figures, and trying to save says *That is not something this can do next.*

### Posting the entry

The panel **The entry** says what will post, in the words your accountant uses:

- *$… under-billed: Dr 1240 Costs in Excess of Billings / Cr revenue.*
- *$… over-billed: Dr revenue / Cr 2420 Billings in Excess of Costs.*
- *One pair of lines per job, tagged with the job, dated the period end and reversed the next day.*

If billings equal earned revenue on every measured job it says so and there is nothing to post. If a job is blocking, its reason is listed in red. If your chart lacks an account the entry needs — `1240`, `2420`, or a revenue account — it says which; add it under Accounting first. The construction profile seeds all three; a pack never adds an account to your chart on its own.

{button:Post the adjustment|primary} asks you to confirm with the same figures, then posts two entries in Accounting: the adjustment dated the period end, and its reversal dated the next day. The status line turns to `Posted`, the figures freeze, and the estimate boxes become plain figures.

**Why a reversal.** Each period's entry is the whole over/under as of that date. Reversing it the next morning means your books between period ends carry billings, exactly as before, and the month-end statements carry what was earned. Next period's entry is the whole figure again. Nothing accumulates and nothing has to be reconciled.

Messages you may see instead:

- *Give every job a budget or an estimate before posting: 24-108.* — the badge above, by job number.
- *A job with billings needs a fixed contract value to measure against: 24-110.*
- *A period must come after the latest posted one, 2026-08-31. Unpost that one first.* — periods post forward only, latest first, the way a month is closed.
- *Billings equal earned revenue on every job, so there is nothing to post for this period.*
- *The chart of accounts is missing something: the chart has no 1240 Costs in Excess of Billings account.*
- *Period closed through …* — the period end is inside a month you have already closed in Accounting. Reopen it there or pick a later date.
- *Only an owner can change a project.* — posting is an owner's decision.

### Unposting

{button:Unpost|outline} on a posted period asks you to confirm, voids both entries in Accounting, and puts the period back to `Draft` with the estimates you typed kept and the figures live again. Only the **latest** posted period of a company can be unposted — *Only the latest posted period can be unposted, and that is 2026-10-31.* — so to redo August you unpost September first. Accounting refuses in its own words if the entries sit in a closed month or on a reconciled line.

Neither entry can be voided from the journal itself; they belong to the period, and the journal says so.

### Periods

The list at the bottom is every period saved or posted for the company, newest first, each a link back to its schedule with a `Posted` or `Draft` badge. A draft period exists as soon as an estimate has been typed for a date.

### What this changes elsewhere

- **Reports at a period end** — a profit and loss ending on a posted date carries earned revenue, and the balance sheet carries `1240` and `2420`. Between period ends everything reads billings.
- **A job's revenue on reports** is earned revenue at a posted period end, because every line of the entry is tagged with the job.
- **Cash-basis reports ignore the adjustment entirely.** Percent complete is an accrual idea; a cash report reads what came in.
- **Closing a month** in Accounting after posting locks both entries, the same as any other.

## Changing something

Owners only. Everything you can add, you can change.

- **A {{project|lower}}** — {button:Edit|outline} beside the status on its page. Every field except the company, which is fixed at creation because moving a job's costs between two sets of books is not an edit.
- **A contract** — the pencil at the end of its row. Its value, once signed, moves only by change order.
- **A change order** — the pencil at the end of its row. Everything except which contract it is against.
- **A pay application** — only while it is a draft. Issued, it is a certificate and an invoice; it is voided, never edited.
- **A cost code, or the list it is in** — the pencil beside each, on the Cost codes page.

**If somebody else saved while you had the form open**, you see `Somebody changed this while you had it open. Reload and try again.` Nothing you typed is sent. Reload, look at what changed, and make your change again — this is deliberately a refusal rather than letting the last person to press Save quietly overwrite the first.

### Changing a {{project|lower}}'s status

Setting it to `Cancelled` **takes it off every list a bill or an hour can be charged to.** What is already charged stays exactly where it is. Setting it back to any other status puts it back.

`Complete` does **not** do that, on purpose: bills keep arriving for months after a job finishes.

### Retiring a cost code

Tick `Retire this code` in its dialog. It stops being offered on new work; everything already charged to it stays. Untick it to bring it back. **Codes are never deleted** — one that vanished would take a year of job history with it.

You can also renumber a code in place, which is what moving from your own scheme to CSI actually means. Two codes in one list cannot share a number; you see `That code is already in this list.` if they would.

## Cost codes

{button:Cost codes|outline} on the {{project|plural}} page. Owners only to change; anyone can read.

**If your industry profile brought starter lists, they are already here** — a construction business starts with `Residential phases` (a home's phases in build order, the default) and `CSI divisions` (the commercial convention, at division level). They are yours from that moment: rename, renumber, retire what you do not use, or make the other one the default. Without a profile nothing suggests a list, and that is on purpose — some businesses use CSI MasterFormat, some use NAHB's chart, and plenty use codes they made up years ago. Yours are whichever you already put on a job cost report.

- {button:New list|primary} — give it a name. **The first list you add becomes the default**, so jobs use it without being asked.
- {button:Make default|ghost} — on any list that is not already the default. Only one list can be the default at a time; making a new one takes it off the old one for you.
- {button:Add code|outline} — a `Code` and a `Name`. The code is free text, so `03 30 00`, `1000` and `CONC-SLAB` are all fine. Two codes cannot share a code in one list; you see `That code is already in this list.` if they would.

New codes are added to the end of the list, not the top, so a list you arranged stays arranged.

## What this does not do yet

Worth knowing so you are not looking for it:

- **A change order cannot be moved to another contract.** Raise it again on the right one and set the wrong one to `Void`.
- **The daily log is not a timecard.** Who was on site is a headcount for the record; your own people's hours for wages are in Time, and the two are not joined.
- **A unit-price job on the work in progress schedule is measured cost-to-cost against its estimate**, like a fixed-price job; units installed over units estimated is a better measure for this kind of work and is not built.
- **Time and materials has no rate card of its own.** Each person's rate comes from Time, or one rate on the contract covers everybody; a rate per trade (carpenter, labourer, foreman) or a rate negotiated for one customer is not a thing you can set yet.
- **A cost-plus job on the work in progress schedule earns what it has cost plus its fee**, capped at its maximum, with no estimate asked for — when it is the job's only signed contract. A time-and-materials job earns its approved hours at their rates plus the rest of its cost marked up, the same way; one with hours nobody has priced shows `Hours on the job with no bill rate` and blocks the period until a rate is set. A job mixing methods is shown and left out, and a period with billings on one cannot post until it has a value.
- **A subcontractor's application does not print.** It is the subcontractor's document, prepared on their side; your own applications print from their row.
- **Nothing codes a bill for you.** Cost codes appear in Accounting wherever you tag a line, beside the job itself, and the `Spent` column reads what the bills carry. A line with the job and no code shows up as the uncoded note under the job cost table, not on a row.
- **Nothing is ever deleted.** A contract you should not have added is set to `Cancelled` or `Declined`; a cost code is retired; a {{project|lower}} is cancelled. That is on purpose — a job's history is the point of keeping it.

## Who can do what

| | Owner | Staff | Accountant |
| --- | :-: | :-: | :-: |
| See {{project|plural|lower}} and cost codes | ● | ● | ● |
| Start a {{project|lower}} | ● | | |
| Add or change cost code lists | ● | | |
| Add, approve or change a change order | ● | | |
| Set a schedule of values, or issue a pay application | ● | | |
| Record or approve a subcontractor's application | ● | | |
| Log a day on site, or add and tick a punch item | ● | ● | ● |
| Add photos to a day | ● | ● | |
| See the work in progress schedule | ● | ● | ● |
| Type an estimate, post or unpost a work in progress period | ● | | |

Starting a job is a decision, and it creates the thing your books group costs by — which is why it is kept to owners. Reading the list is ordinary work for anybody who has to go and stand on the site.
