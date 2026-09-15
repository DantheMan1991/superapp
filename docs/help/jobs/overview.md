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

## Estimates — pricing the {{project|lower}} before anybody signs

Anybody on the {{project|lower}} may write an estimate; accepting one, or making it the budget or the schedule of values, is owners only. On the {{project|lower}}'s page under **Estimates**, on the **Estimates** page — {button:All estimates|outline} — and on each estimate's own page.

An estimate is the {{project|lower}} priced, line by line: what each line will **cost** you and what you will **charge** for it, with overhead and profit below the lines, and the margin between. Several on one {{project|lower}} is ordinary — a bid gets revised, and a design phase is priced before the build — so each has a number of its own. When the client says yes, an owner **accepts** it onto a contract and its total becomes that contract's value; two more buttons make it the budget and the schedule of values, so nothing is typed twice.

### The panel on the {{project|lower}}'s page

One sentence: *2 estimates: EST-2 $89,122.55 (accepted) · EST-1 $84,300.00 (superseded).* — the three newest, with `· …` when there are more — or *Nothing priced yet* and what an estimate is. {button:All estimates|outline} opens the page; {button:New estimate|primary} opens the dialog below.

### The list

Newest first.

| Column | What it is |
| --- | --- |
| `Number` | Yours — `EST-1`, `Q-2026-014`, whatever you use. Opens the estimate. |
| `Title` | With the number of lines, `sent <date>` and `valid to <date>` under it. |
| `Cost` | What the lines add up to at their unit costs. |
| `Total` | Their price with overhead and profit on top — what the client is asked for. |
| `Margin` | Total less cost, and the percentage of the total it is. |
| `Status` | `Draft`, `Sent`, `Accepted`, `Declined` or `Superseded`, with the date decided under it. |
| `Contract` | The agreement an accepted estimate became; opens it. |

### Starting one

{button:New estimate|primary}, on the panel or the list.

1. **`Number`** — required, and different from the {{project|lower}}'s other estimates. `EST-1`.
2. **`Title`** — `New home, as drawn`. Optional.

{button:Start estimate|primary} stays greyed until the number is filled in; on success you see `Estimate started` and land on the estimate's page. `That estimate number is already used on this job.` if the number is taken.

### The estimate's page

The header shows the number, the title, the {{project|lower}}, the contract it became, and its status. Everything below is one form: nothing is saved until {button:Save|primary}, and `Estimate saved` confirms it.

**The top block.**

- **`Number`** and **`Title`**.
- **`Status`** — `Draft`, `Sent`, `Declined` or `Superseded`. `Accepted` is not on the list: accepting is a button of its own, below. Picking `Sent` fills **`Sent`** with today; picking `Declined` fills **`Decided`**.
- **`Sent`**, **`Valid until`**, **`Decided`** — dates, all optional.
- **`Markup on cost, %`** — the rate every line sells at unless the line says otherwise. `15`.
- **`Overhead, %`** — on the lines' price. `10`.
- **`Profit, %`** — on the price plus overhead. `10`. Leave both at nothing if you price everything on the lines; leave the markup at nothing if you sell at cost and take it all below. Either way it is the same estimate, and the margin at the bottom is the same number.

**Lines.** One row per thing you are pricing. {button:Add line|ghost} adds a row; the bin at the end of a row removes it (the last row stays).

| Column | What it is |
| --- | --- |
| `Cost code` | Where the money lands in the budget, from the {{project|lower}}'s cost code list. `No code` is allowed and the line still prices; it is left out when the estimate becomes the budget. |
| `Description` | Required; a row with none is ignored when you save. `Slab, 4in, fibre mesh`. |
| `Qty` | Blank is one — a lump sum. `120`. |
| `Unit` | `cy`, `sf`, `ea`, `ls` — yours. |
| `Unit cost` | What one unit costs you. `185.00`. |
| `Markup %` | This line's markup, if it differs from the estimate's; the estimate's rate shows greyed as the placeholder. Greyed out once a unit price is typed, because the price then does not come from a markup. |
| `Unit price` | Type a price per unit and the line sells at quantity times that, whatever the markup — a unit-price bid. Blank reads `by markup`. |
| `Cost` | Quantity at the unit cost, as you type. |
| `Price` | Quantity at the unit price if there is one, else the cost plus its markup. |

Cost and price are worked out as you type and never stored, so a line typed as 320 sf at $4.20 and a line typed as $1,344.00 agree to the cent.

**The six figures.** `Cost` (every line at cost), `Price` (every line at its price), `Overhead`, `Profit`, `Total` (price plus overhead plus profit — what the client is asked for) and `Margin` (total less cost, with its percentage of the total).

**`Notes`** — whatever the estimate should remember: the terms, the exclusions.

What can stop a save: `Check the form and try again.` (a rate or a quantity that is not a number) · `That estimate number is already used on this job.` · `A markup must be between 0% and 1,000%.` · `A unit cost cannot be negative.` · `Somebody changed this while you had it open. Reload and try again.`

### Accepting it

The client said yes. {button:Accept|primary} (owners; greyed until the {{project|lower}} has a contract) asks for the **`Contract`** it priced and **`Accepted on`** (today). The estimate's total, as saved, becomes that contract's value; the estimate is marked `Accepted`, shows the contract in its header, and its rates and lines are fixed from here — shown, greyed, and not sent. `Estimate accepted`.

A **signed** contract's value moves by change order, not by accepting an estimate: `That contract is signed, so its value changes with a change order.` — unless the estimate's total is already the contract's value to the cent, which is accepted and touches nothing, or the signed contract has **no value recorded yet** (a cost-plus agreement usually has none), in which case the estimate fills it in: entry, not revision. A contract on another {{project|lower}} is refused: `That is on another job: …`. Accepting twice, or changing an accepted estimate's rates, lines or status, is refused: `That estimate is fixed: estimate EST-1 was accepted; revise it as a new one.` To revise, start a new estimate and set this one to `Superseded` — the one status an accepted estimate can move to; the title and the notes still move too.

### Making it the budget

{button:Use as budget|outline} (owners). The dialog says the cost as saved and what happens: each cost code's **cost** on the estimate becomes that code's original budget on the {{project|lower}}, replacing what the code had, and lines with no cost code are left out. {button:Make it the budget|primary}. `Budget set on 2 codes — $1,500.00 on lines with no code left out`. From there the budget moves as it always does, by change order, and **Job cost** on the {{project|lower}}'s page reads it.

### Making it the schedule of values

{button:Use as schedule of values|outline} (owners; greyed until the {{project|lower}} has a contract). Pick the **`Contract`** and {button:Make it the schedule|primary}: one schedule line per estimate line at its **price**, with the overhead and profit spread across the lines in proportion so the schedule adds up to the estimate's total — the contract sum, which a pay application is measured against — replacing the contract's schedule and carrying each line's cost code. A line sold at a unit price keeps billing by the quantity, with its unit price raised by the same share. `Schedule written: 4 lines, $89,122.55`. The schedule is what a fixed-price or unit-price contract bills against; a cost-plus or time-and-materials contract bills its cost and leaves the schedule unread. A schedule line an application has already billed against cannot be removed, and the write is refused if the estimate would drop one — see **Billing a contract**. If you want overhead or your fee as a line of its own on the schedule, type it as a line of the estimate.

Neither button is automatic on accepting: a {{project|lower}} budgeted at cost and billed on a schedule of milestones is written from the estimate for one and by hand for the other.

### By cost code

Under the editor, once the estimate has lines: each code's cost and price from the saved lines — the cost is what **Use as budget** writes, the price is what the job cost report will compare it with once the {{project|lower}} is billed. `No cost code` is the last row.

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

The pencil at the end of its row. While the order is a **draft**, changing the lines replaces all of them, so what you see in the dialog is what you get; changing only the status leaves the money alone.

Once the order is **issued** or **closed**, its lines are shown in the dialog but cannot be edited — `Issued. The lines change with a change order, on the order's page.` The rest of the dialog still works: the status, the issued date, who is paid, the notes. If a save does try to move locked lines, you see `That order has been issued or billed against, so its lines change with a change order on the order's page.` The same applies to a draft a subcontractor has already billed against.

### Changing an order — subcontract change orders

Owners only. On the order's own page (click its number in the **Ordered** table), under **Change orders**.

When a subcontractor's scope moves — more work found behind a wall, scope the client dropped, a price agreed after the fact, or their share of one of the client's change orders — you record it as a change order **on the order**. It works for a purchase order too (a revision that adds lumber). The panel's line reads *original + approved changes*: only an **approved** change moves what the job has committed and reaches the subcontractor's next application.

{button:Add change order|primary}.

1. **`Against`** — the order, shown as text. A change order stays on the order it was raised against.
2. **`Number`** — required. However you number them: `SCO-1`, `PO-1042 R2`, `3`. It has to be different from the other change orders **on the same order**; two orders may each have an `SCO-1`. You see `That change order number is already used on this order.` if it clashes.
3. **`Title`** — required. `Extra blocking at the stair`.
4. **`What changes`** — optional. The scope, as it will read on the subcontractor's application.
5. **`Passes down`** — the client's change order this one is the subcontractor's share of, from the job's change orders, or `None — a change of our own`. It has to be on this job: `That client change order is on another job.`
6. **`Requested`** — optional date.
7. **Lines** — the money. Each line takes a `Cost code` (optional, `No code` is allowed, as on the order itself), an optional description and an `Amount`. {button:Add line|ghost} for more. **A line with no amount is ignored.** **Negative takes scope back**: `-2,000` is a deduction, not a separate form. No lines at all is fine — a time extension or a re-worded scope has none. `Typed` on the right adds the lines up as you go.
8. **`Status`** — `Proposed`, `Approved`, `Declined` or `Void`, the same four as a client change order. Only an approved one moves anything.
9. **`Approved on`** — appears when the status is `Approved`, fills in with today, and is required: `Give an approved change order the date it was approved.`
10. **`Notes`**.

{button:Add change order|primary} stays greyed until the number and title are filled in. On success you see `Change order added`.

**What an approved change does.** Its lines join the order's **Lines** table at once, each marked `Added by SCO-1`, and the value at the top of the page reads the revised sum with `orig. $… · $… in approved changes` under it. On the {{project|lower}}'s page the **Ordered** table's `Amount` is the revised sum with `orig. $…` beneath, **Committed** and the job cost report's `Ordered` column move by the change's lines, by code, and the next subcontractor application picks the lines up — an open draft on its next save, a new one when it is made — after the original lines, with the change's number in front of the description. The bill that application becomes names the change on its line: `Application 2 — SCO-1 · Blocking through 2026-10-31`.

**A deduction on the application.** A negative line is completed **to less than nothing**: type `-2,000` on it and `Completed` and `Payment due` go down by that much; nothing can be stored against it, and typing a positive figure on it is refused with `A deduction cannot be completed to more than nothing.`, and stored materials on it with `Nothing is stored against a deduction.` Its `%` reads like any other line's.

**Reading the table.** `Number` · `Change` (the title, with `Approved <date>` and `Passes down CO-3 · …` under it) · `Amount` (the lines added up; a minus sign is a deduction; `—` with no lines) · `Status`. `Billed against` under the status means the subcontractor has billed one of its lines.

**Editing one.** The pencil at the end of its row. Everything but which order it is against. Changing the lines replaces all of them, and removing every line is a real instruction. **Once the subcontractor has billed against it**, the status stays `Approved` and the lines are shown but not editable — `The subcontractor has billed against that change, so it stays approved and its lines stay as they are. Raise another change.` — while the title, the words, the dates and `Passes down` still change. Taking an unbilled change back to `Proposed` or `Declined` removes its lines from the open draft, whatever was typed on them.

### Billing a subcontractor, and holding retainage

Click an order's number in the **Ordered** table to open its own page. A purchase order's page shows its lines and says that it is billed with an ordinary bill in Accounting. A **subcontract's** page adds **Subcontractor applications**: what the subcontractor bills you, recorded the same way you bill your client.

Four figures sit at the top: **Subcontract value**, **Billed to date**, **Retainage held** (what you are holding back from them) and **Balance to finish**. The `Complete` column on the lines reads from the latest billed application.

{button:New application|primary} — greyed while a draft is open, or when the subcontract has no lines — takes `Period to`, `Retainage %` (what you hold back; it carries over from the last application) and `Notes`. {button:Open|outline} on the draft is the same grid as a pay application, one row per subcontract line — the lines it was placed with and every approved change order's, the latter with the change's number in front (`SCO-1 · Blocking`): `Scheduled`, `Previous` (carried), `This period`, `Stored`, `To date`, `%`, with the certificate live underneath — *Completed and stored to date*, *Retainage*, *Total earned less retainage*, *Less previous certificates* and **Current payment due**. `Bill dated` is the date the bill will carry.

{button:Approve as bill|primary} posts an ordinary bill in Accounting to the subcontractor, on the {{project|lower}}'s company's books: a line for the work this period on each subcontract line, to Subcontractor Expense and **tagged with the job and the line's cost code** — so it lands on the job cost report's `Spent` column at once — and the retainage held this period as a negative line to `2120 Retainage Payable`. The ledger reads Dr expense (gross), Cr Retainage Payable (held), Cr Accounts Payable (net). The subcontractor's own invoice number, typed in `Their reference`, becomes the bill's number. The row shows `Billed`, the bill's number and whether it is `Open`, `Partly paid` or `Paid`; pay it from Accounting like any other bill.

**Releasing retainage** is a later application at a lower rate — the final one at `0` — which carries a `Retainage released` line and pays out what was held. Nothing else to do.

What can stop an approval, in its own words: `A purchase order is billed with an ordinary bill in Accounting. Applications are for subcontracts.` · `This contract already has a draft application. Finish that one first.` · `Nothing is due on this application, so there is nothing to invoice.` · `The chart of accounts is missing something: the chart has no 2120 Retainage Payable account` (the construction profile adds it) · Accounting's own refusals, such as a closed period. {button:Void|ghost} works on the latest billed application only and voids its bill too; Accounting refuses if the bill has been paid.

On the {{project|lower}}'s page the Ordered table's `Billed` column reads what each subcontractor has billed and what is held from them, and under it whether a lien waiver covers them.

### Lien waivers

Anybody on the job may record one. On the order's own page, under **Lien waivers**.

A lien waiver is the document a subcontractor or supplier signs to give up its right to put a lien on the property for the work you have paid for. The owner and the bank want one from everybody paid before they fund the next draw, and paying without one is how a job ends up with a lien on it and the money paid twice. The words on the form are your state's or your lawyer's; what is kept here is **who signed, of which kind, through which date, for how much, and whether it arrived** — and a photo of the signed page.

The panel's first line says what is on file: `Unconditional waiver on file through 2026-10-31; conditional through 2026-11-30.`, `No unconditional waiver on file.`, or `A final unconditional waiver is on file`. Under it, one sentence per gap:

- `Application 2 (2026-10-31, $8,100.00) has been paid and no unconditional waiver covers it.` — in red. The bill in Accounting is paid, partly or wholly, and nothing unconditional on file runs that far.
- `Application 2 (2026-10-31) is billed and no waiver covers it yet.` — not yet paid, and neither a conditional nor an unconditional waiver covers it.

{button:Ask for it|outline} beside a gap adds an item to Work — `Lien waiver from Pleasant Valley Feed Mill: unconditional through 2026-10-31 (SC-24109-1)` — linked to the order, beside everything else the office has to do; the panel then reads `Being chased in Work: …` until it is ticked off there. It is not on the job's punch list, which is for the site.

{button:Record waiver|primary}.

1. **`On`** — the order, as text.
2. **`From`** — who gives up the lien right. Filled in with the order's subcontractor or supplier; pick somebody else for a waiver from a supplier of theirs.
3. **`Kind`** — `Conditional, progress`, `Unconditional, progress`, `Conditional, final` or `Unconditional, final`. A conditional waiver comes with the application and takes effect when the payment clears; an unconditional one is given after the money went out, and is the one the bank wants. A final one covers the whole job whatever its date.
4. **`Through`** — required. The date the work is waived through.
5. **`Amount`** — what the form states; leave it blank when it states none.
6. **`Covers`** — a billed application on this order, or `Work through the date`. A draft cannot be named: a waiver covers a payment.
7. **`Status`** — `Requested`, `Received` or `Void`. `Received` fills today into **`Received`**, which is required: `Give a received waiver the date it arrived.` **`Requested`** is the date you asked, optional.
8. **`Signed by`**, **`Their reference`**, **`Notes`** (exceptions the form lists, disputed amounts).

{button:Record waiver|primary} is greyed until the party and the through date are filled in. On success you see `Waiver recorded`. Open it again with the pencil to attach the **Signed copy** — three ways, all through Documents (it needs Documents switched on): {button:Add a photo|outline|image-plus} for a picture of the page (on a phone, {button:Take photo|outline|camera}), {button:Add a file|outline|paperclip} for the PDF that came back by email, or {button:From Documents|outline|folder-open} to pick a file already in your cabinet — type in `Search your files`, newest first, {button:Attach|outline} beside the one. Photos show as a gallery, files as a list with their kind and size, each opening in a new tab; the × beside either removes it from the waiver and leaves the file in Documents.

**When a waiver counts.** Only a **received** one. It covers an application when it names it in `Covers`, when it is a final one, or when its through date is on or after the application's period end. Setting one to `Void` stops it counting; a wrong form is voided and recorded again.

**Reading the table.** `Kind` (with their reference under it) · `From` (with who signed) · `Through` · `Amount` (`—` when the form states none) · `Covers` · `Status` (with the received date, or `Asked <date>`) · `Signed copy` (how many photos). Every billed application in the table above says `Unconditional waiver on file`, `Conditional waiver on file`, `No waiver yet` or, in red, `Paid · no unconditional waiver`.

A waiver on a **purchase order** is recorded the same way — suppliers have lien rights too — but the gaps are only worked out for subcontracts, whose applications the pack bills.

## Subcontractors — insurance, W-9s and the rest

Anybody on the job may record a document. From the {{project|plural}} list, {button:Subcontractors|outline}; and one line at the top of every order's page.

Before you pay a subcontractor or supplier, or let them on site, you collect their paperwork: a **certificate of insurance** that runs out on a date, a **W-9** that does not, a licence where the state wants one, whatever else your insurer or your lawyer asks for. This page lists **everybody with an issued or closed order on a job that is not complete or cancelled**, and where each stands. A document hangs off the subcontractor, not the job — one certificate covers every job they are on.

### Reading the page

The line under the title counts them: *5 with orders on live jobs · 1 not in good standing · 2 expiring within a month*. The sentence in the panel names what is required — `Certificate of insurance, W-9` unless your business has set its own list.

| Column | What it is |
| --- | --- |
| `Subcontractor` | The name, the jobs they have orders on, and `Being chased in Work: …` when you have asked for something. |
| One column per required kind | `On file, expires 2027-03-01` · `Expires 2026-10-10` (in bold, within a month) · `Expired 2026-09-01` or `Not on file` (in red), with the title, who issued it and the coverage limit under it; a pencil to open it and, when it is a gap, {button:Ask for it|outline}. |
| `Other documents` | Everything else on file — a licence, a safety plan — with its expiry. |
| The badge | `Good standing` when nothing required is missing or expired; `Not in good standing` otherwise. Expiring still stands. |

{button:Ask for it|outline} adds an item to Work — `Certificate of insurance from Pleasant Valley Feed Mill` — linked to the subcontractor, beside everything else the office has to do. Nothing here stops an order or a payment; the page says it, and you decide.

### Recording a document

{button:Record document|outline} at the end of the row.

1. **`From`** — the subcontractor, as text.
2. **`Kind`** — the required kinds and the suggested ones (`Certificate of insurance`, `W-9`, `Licence`), or `Other…`, which shows **`What kind`** — type it as you say it (`Safety plan`); it is kept as a name of its own.
3. **`Title`** — `General liability`, optional.
4. **`Issued by`** and **`Number`** — the carrier or board, the policy or licence number.
5. **`Issued`** and **`Expires`** — leave `Expires` blank for one that does not run out, such as a W-9. A certificate past its date is as good as missing.
6. **`Coverage limit`** — what the certificate states, optional.
7. **`Status`** — `On file` (fills **`Received`** with today, and the date is required: `Give a received document the date it arrived.`), `Requested` (with the date you asked), or `Void` for a wrong one.
8. **`Notes`** — additional insured named, endorsements, what is missing.

{button:Record document|primary} is greyed until a kind is set. On success you see `Document recorded`. Open it again with the pencil to attach the **Scanned copy** — three ways, all through Documents (it needs Documents switched on): {button:Add a photo|outline|image-plus} for a picture of the page (on a phone, {button:Take photo|outline|camera}), {button:Add a file|outline|paperclip} for the PDF the broker sent, or {button:From Documents|outline|folder-open} to pick a file already in your cabinet — type in `Search your files`, newest first, {button:Attach|outline} beside the one. Photos show as a gallery, files as a list with their kind and size; the × beside either removes it from the document and leaves the file in Documents. A renewal is a second document of the same kind with the later date: the one that runs longest is the one that counts, so the old one can stay for the record.

### On an order's page

One line under the order's title: `Certificate of insurance expired 2026-09-01 · W-9 on file · Subcontractors` — red where something is missing or expired, with the link to the page.

## Selections and allowances

Anybody on the job may draw up the list and record a choice; raising the money is owners only. On the {{project|lower}}'s page under **Selections**, and on its own page — {button:All selections|outline}.

A selection is a decision the client still owes: the tile, the countertops, the front door hardware. Each carries what the contract **set aside** for it (the allowance), the date it is **needed by** so the schedule holds, and the **choices** on offer — the standard and the upgrades, or whatever came back from the showroom — each with a price. When the client picks one, the difference against the allowance is worked out for you, and once you have approved the pick it is raised as an ordinary change order on the contract.

### The panel on the {{project|lower}}'s page

One sentence: *3 selections, 1 pending (1 overdue) · allowances $16,600.00 · chosen $13,100.00, under by $500.00 · $2,500.00 approved and not yet raised as a change order.* {button:All selections|outline} opens the page; {button:Add selection|primary} opens the dialog below.

### The page

Five figures sit at the top: **Allowances** (every selection that is not cancelled), **Chosen** (the picked prices, where the client has chosen), **Over** or **Under** (chosen less allowances), **To raise** (approved differences not yet a change order) and **Raised** (the change orders raised, whatever their status short of void).

| Column | What it is |
| --- | --- |
| `Selection` | The name, with the room, the cost code and the contract under it. |
| `Needed by` | The date; in red with `overdue` under it when a pending selection is past it. |
| `Allowance` | What the contract set aside. `—` for a standard included item. |
| `Chosen` | The client's pick, with its reference and `320 sf at $4.20` when priced by the unit; `2 on offer` or `Nothing on offer yet` until they choose. |
| `Price` | The chosen price. |
| `Over / under` | Chosen less allowance, once the client has chosen; over in red, under with a minus sign. |
| `Status` | `Pending`, `Selected`, `Approved` or `Cancelled`, with `Decided <date>`, the change order raised (`CO-4 · Approved`), reminders open in Work, and photos. |

At the end of each row: {button:Raise overage|outline} or {button:Raise credit|outline} (owners, once the selection is approved with a difference and no change order standing), {button:Remind|outline} (while pending) and the pencil.

### Adding one

{button:Add selection|primary}.

1. **`Selection`** — required. `Master bath tile`.
2. **`Where`** — the room or area, optional.
3. **`In the price of`** — the contract whose price holds the allowance; filled in when the job has one. `No contract yet` while the list is drawn up during design — a difference cannot be raised until one is named.
4. **`Cost code`** — where the money lands in the budget; a raised change order carries one line on it.
5. **`Allowance`** — what the contract set aside. Blank for a standard included item.
6. **`Needed by`** — the date the choice is needed for the schedule.
7. **`Status`** — `Pending` (the client owes it), `Selected` (they chose; needs a choice marked), `Approved` (you confirmed the pick and its price), `Cancelled`. Picking `Selected` or `Approved` shows **`Decided on`**, filled in with today.
8. **`What it covers`** — optional.
9. **Choices** — one row per thing on offer: the radio marks the client's pick; `Description` (required on any row that counts; a blank row is ignored), `Model / SKU`, `Supplier` (somebody in your books, or `No supplier`), `Qty`, unit, `per unit` and `Price`. Type a quantity and a unit price and the price box becomes the computed figure — `320` sf at `4.20` is `1,344.00`; leave them blank and type the price. Beside the block: `Over by …`, `Under by …`, `On the allowance` or `No choice marked`, live. {button:Add choice|ghost} for more.
10. **`Notes`**.

{button:Add selection|primary} stays greyed until the name is filled in. On success you see `Selection added`. What can stop a save: `Mark the choice the client made before calling the selection selected.` · `One choice is chosen, not two.` · `A choice priced by the unit needs both a quantity and a price per unit.` · `That is on another job: the contract named is on another job.`

Open a selection again with the pencil to add **samples and spec sheets** — a photo of the sample, a PDF spec sheet with {button:Add a file|outline|paperclip}, or a file already in your cabinet with {button:From Documents|outline|folder-open}, the same gallery a day on site uses.

### Raising the difference

Once a selection is **approved** and its pick is over or under the allowance, {button:Raise overage|outline} or {button:Raise credit|outline} appears (owners). The dialog says the amount and asks for the change order's **`Number`** (yours), a **`Title`** (filled in: `Master bath tile: allowance overage`), and whether it starts **`Proposed`** or **`Approved`** (with `Approved on`). The change order carries the difference as its price — a credit as a negative — and one cost line moving the selection's code by the same amount; it appears in the {{project|lower}}'s **Change orders** panel like any other and moves the contract value and the budget when approved. The selection shows the number under its status.

**Once raised, the allowance and the choices are fixed**: the dialog shows them but does not send them — `Fixed: raised as CO-4.` Void that change order (in the Change orders panel) to re-price, and raise again. Raising twice is refused: `The difference on that selection has been raised: already raised as change order CO-4. Void the change order to re-price it.` A pick exactly on the allowance has nothing to raise, and a selection with no contract has nowhere to.

### Reminders

A pending selection past its `Needed by` reads `overdue` in red. {button:Remind|outline} adds an item to Work — `Selection needed: Master bath tile by 2026-10-15 (24-108)`, due that day — linked to the selection, beside everything else the office has to do; the row reads `Reminder open in Work` until it is ticked off there. It is not on the {{project|lower}}'s punch list, which is for the site.

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
- **A subcontractor's application does not print**, and neither does a change order on an order. They are the subcontractor's documents, prepared on their side; your own applications print from their row.
- **A lien waiver is not generated.** The form itself is your state's or your lawyer's, not something Jobs prints; the signed one attaches as a photo, a file or from Documents.
- **An estimate is lines you type.** No assemblies (a bundle of lines dropped in as one), no unit cost book that remembers what concrete cost last time, no takeoff from the drawings, and the proposal does not print — send the client your own document for now. A supplier's quote cannot be attached to an estimate yet.
- **A subcontractor out of standing is not stopped.** An order can be issued and a bill paid while a certificate is missing or expired; the Subcontractors page and the order's page say so in red, and the decision is yours. Which kinds are required is set in the module's configuration for now, not on a screen.
- **The option book is per job.** The same selections with the same choices on every plan are entered on each job for now; a book that seeds a new job is next. Nothing here lets the client choose for themselves; the office records what they said.
- **A back-charge is not a change order.** Money you deduct from a subcontractor's payment for something you paid on their behalf reduces the payment, not the scope; a deductive change order reduces the scope. Record a back-charge as a credit in Accounting for now.
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
| Record a lien waiver, or ask for one in Work | ● | ● | ● |
| Record a subcontractor's certificate or W-9, or ask for one in Work | ● | ● | ● |
| Write, send, decline or supersede an estimate | ● | ● | ● |
| Accept an estimate, or make it the budget or the schedule of values | ● | | |
| Draw up selections, record the client's choice, remind them in Work | ● | ● | ● |
| Raise a selection's difference as a change order | ● | | |
| Log a day on site, or add and tick a punch item | ● | ● | ● |
| Add photos to a day | ● | ● | |
| See the work in progress schedule | ● | ● | ● |
| Type an estimate, post or unpost a work in progress period | ● | | |

Starting a job is a decision, and it creates the thing your books group costs by — which is why it is kept to owners. Reading the list is ordinary work for anybody who has to go and stand on the site.
