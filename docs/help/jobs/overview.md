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

They are listed on the {{project|lower}}'s own page, numbered in the order you agreed them. Owners only to add.

### Adding one

{button:Add contract|primary} on the {{project|lower}}'s page.

1. **`Kind`** — required. What sort of agreement it is. If your industry pack is set up you pick from a list; otherwise you type it, lowercase with underscores: `concept_design`, `new_home`, `aia`.
2. **`Name`** — optional, for when the kind alone will not tell two apart.
3. **`Who holds it`** — `We hold the contract` when the job is yours, or `We are a subcontractor` when you are working under somebody else's general contractor. The next field's label changes to match.
4. **`{{customer}}`** / **`General contractor`** — who the agreement is with, picked from the people in your books. `Nobody yet` is fine for a proposal written before they are on file.
5. **`Value`** — what was agreed. Type it however you like: `182,500`, `$182500` and `182500.00` all mean the same thing. Leave it blank for cost-plus work that has no fixed number until it is done.
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

### On the {{project|plural}} list

The `Value` column is the same total: signed and complete only. A job with nothing signed yet shows `—` rather than `0.00`, because zero would read as "worth nothing" when the truth is "not agreed yet".

## Job cost — what it was meant to cost

Owners only to set. On the {{project|lower}}'s page, under **Job cost**.

A budget here is **per cost code**, never one number for the whole job. That is deliberate: "the job is $40,000 over" tells you something has gone wrong and nothing about what to do; "the framing is $40,000 over" is a decision you can act on.

### Setting a budget

{button:Set budget|outline}. You get your whole cost code list with a box beside each, and whatever you have already set filled in.

- **Leave a code blank** if you have no plan for it yet. It simply will not appear on the report.
- **Zero is different from blank.** Zero means you are carrying that code at nil, so anything spent against it shows as a variance. Blank means you have not decided.
- **Codes you do not touch are left alone.** Saving does not wipe the rest of the budget, so two people can fill in different trades on different days.
- Retired codes are not offered, unless one already has a budget against it — in which case it stays editable rather than stranding the figure.

`Total typed` at the bottom adds up what is in the boxes as you go.

### Reading the report

| Column | What it is |
| --- | --- |
| `Budget` | What you planned for that code. |
| `Ordered` | What you have committed on **this job** against it — issued and closed orders only. |
| `Left` | Budget minus ordered. **Negative and red means that trade is over.** |

A code you have ordered against but never budgeted appears with a `Not budgeted` badge. That row is usually the one worth looking at.

### What the report does not show yet

**There is no actual cost per code.** The job's total actual is in the `Ordered` panel below; the per-code column stops at what has been ordered.

The reason is honest rather than temporary: the books can group costs by job, or by cost code across every job, but not both at once. Showing a per-code figure here today would mean putting another job's spending in this job's column. It arrives when that is fixed properly.

## What you have ordered

Owners only to add. On the {{project|lower}}'s page, under **Ordered**.

A purchase order or a subcontract is money the job **already owes**, whether or not the bill has arrived. That is the number a job cost report is missing when it looks fine and is not: you can be $400,000 into a $1.8m job and have already ordered $1.5m of it.

Three figures sit at the top of the panel:

- **Contract value** — what you are being paid, from signed agreements.
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

The pencil at the end of its row. **Changing the lines replaces all of them**, so what you see in the dialog is what you get. Changing only the status leaves the money alone.

## Changing something

Owners only. Everything you can add, you can change.

- **A {{project|lower}}** — {button:Edit|outline} beside the status on its page. Every field except the company, which is fixed at creation because moving a job's costs between two sets of books is not an edit.
- **A contract** — the pencil at the end of its row.
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

**Nothing here suggests a list to you**, and that is on purpose — some businesses use CSI MasterFormat, some use NAHB's chart, and plenty use codes they made up years ago. Yours are whichever you already put on a job cost report.

- {button:New list|primary} — give it a name. **The first list you add becomes the default**, so jobs use it without being asked.
- {button:Make default|ghost} — on any list that is not already the default. Only one list can be the default at a time; making a new one takes it off the old one for you.
- {button:Add code|outline} — a `Code` and a `Name`. The code is free text, so `03 30 00`, `1000` and `CONC-SLAB` are all fine. Two codes cannot share a code in one list; you see `That code is already in this list.` if they would.

New codes are added to the end of the list, not the top, so a list you arranged stays arranged.

## What this does not do yet

Worth knowing so you are not looking for it:

- **Nothing revises a budget or a contract.** A change order is the proper way either of those moves, and it is what is being built next. For now both are edited in place, so you lose the `original + approved changes = revised` line.
- **No billing.** Every contract records how it should be billed, and nothing bills yet.
- **Cost codes can now be put on a bill.** They appear in Accounting wherever you tag a line, beside the job itself — so a bill can say which job and which trade. Actual cost per code follows once bills carry them.
- **Nothing is ever deleted.** A contract you should not have added is set to `Cancelled` or `Declined`; a cost code is retired; a {{project|lower}} is cancelled. That is on purpose — a job's history is the point of keeping it.

## Who can do what

| | Owner | Staff | Accountant |
| --- | :-: | :-: | :-: |
| See {{project|plural|lower}} and cost codes | ● | ● | ● |
| Start a {{project|lower}} | ● | | |
| Add or change cost code lists | ● | | |

Starting a job is a decision, and it creates the thing your books group costs by — which is why it is kept to owners. Reading the list is ordinary work for anybody who has to go and stand on the site.
