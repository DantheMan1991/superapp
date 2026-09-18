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

Every {{project|lower}} you have, and what each one is worth, has cost and has been billed. The page is built to answer one question without opening anything: which {{project|lower}} needs you today.

### The four figures along the top

- **`Under contract`** — everything signed, revised by approved change orders. Underneath, how many {{project|plural|lower}} have something signed. A proposal nobody has signed yet is not in this figure.
- **`Earned to date`** — what the work done so far is worth. Measured cost-to-cost: what a {{project|lower}} has cost so far against what it was expected to cost, applied to its contract. `cost-to-cost, to date` under the figure is the reminder that it is measured from your books, not typed in by anyone.
- **`Under-billed`** — earned but not yet invoiced. Work you have done and not asked to be paid for.
- **`Over-billed`** — invoiced ahead of what has been earned.

**`Under-billed` and `Over-billed` are never added together**, and the footnote says so. One {{project|lower}} billed behind and another billed ahead are two separate facts about two separate {{project|plural|lower}}; netting them into one number would hide both. Cancelled {{project|plural|lower}} are in none of these four figures.

The line under the page title says how many {{project|plural|lower}} are underway, and adds a sentence in red when any of them are billed ahead of what they have earned.

### Two views

`Table` and `Board`, top right. The choice goes in the address, so a refresh keeps it and you can send somebody the view you are looking at. Switching keeps whatever filter and search you had.

**Board** shows the same {{project|plural|lower}} as cards in three columns — `On site`, `Coming up` and `Stalled & closed` — each with a count. A cancelled {{project|lower}} sits under the last of those rather than disappearing.

Each card carries the number and name, the {{customer|lower}} and how it is billed, a ring with percent complete, the contract and whether it is under- or over-billed, the next thing on its schedule (in red when that date has passed), and a chip for anything needing somebody:

- **`Billed ahead`** — invoiced past what it has earned.
- **`N selections overdue`**, or **`N to choose`** when none are past their date yet.
- **`N certificates lapsing`** — a subcontractor you have ordered from on this {{project|lower}} has a certificate expired or expiring within 30 days. Only subcontractors with an order on this job count.

A finished {{project|lower}} has no ring and sits greyed: there is nothing left to do on it.

### Narrowing the list

`All`, `Active`, `Planned`, `On hold`, `Complete` — and `Cancelled` only when you have some. Each carries its own count, and clicking one puts it in the address, so a filtered list survives a refresh and can be sent to somebody. The four figures at the top do **not** change when you filter: they describe the whole business, not the rows on screen.

The search box on the right matches the number, the name, the address and the {{customer|lower}}. It keeps whichever filter you are on.

### The columns

- **`{{project}}`** — the number (a link to the {{project|lower}}'s own page), the name, and the address underneath.
- **`{{customer}} & kind`** — who it is for, then the kind of work and how it is billed, then the company and division it belongs to.
- **`Complete · cost to date`** — how far along, then what it has cost and what it was expected to cost, then a bar. What you see here is never a rounded-down zero:
  - a percentage and a bar when there is a budget to measure against;
  - `Not started` when nothing has been spent yet;
  - `No estimate` when money has been spent but there is no budget to measure it against — the fix is to give the {{project|lower}} a budget;
  - `By hours` on a time-and-materials {{project|lower}}, because what it has earned depends on each approved hour at its rate. That figure is on the **Work in progress** page rather than guessed at here.
- **`Contract`** — the revised value, with `incl. $… in changes` beneath when approved change orders have moved it. A {{project|lower}} with nothing signed reads `Nothing signed`, and shows what is out for signature underneath when there is a proposal waiting.
- **`Billed vs earned`** — what has been invoiced, and underneath whether that is behind or ahead of what has been earned: `under-billed` in green, `over-billed` in red, `level with earned` when they match. A complete {{project|lower}} shows its gross profit instead, because the variance no longer matters once the job is done.
- **`Status`** — where the {{project|lower}} stands. A {{project|lower}} billed ahead also gets `Billed ahead` under the badge and a faint red wash across the row.

Clicking anywhere on a row opens that {{project|lower}}. The number stays a real link, so you can still middle-click or right-click it to open in a new tab.

### When the list is empty

Before you have added anything you see `No {{project|plural|lower}} yet`. Staff see the same page with no buttons and a line saying an owner sets the first one up.

If a filter or a search hides everything, the panel says so and offers `Show all` rather than leaving you looking at an empty table wondering whether the data is gone.

## A {{project|lower}}'s page

Everything about one {{project|lower}}, in sections. The top of the page never changes as you move between them: it is the {{project|lower}}'s identity and its position, so you always know which job you are looking at and how it is doing.

### The top of every section

`‹ All {{project|plural|lower}}` goes back to the list.

Then the {{project|lower}}'s name, with its number, address, {{customer|lower}} and kind of work on the line beneath, and on the right: {button:Edit|outline} (owners only) and a badge for the status — `Active`, `Planned`, `On hold`, `Complete` or `Cancelled`.

### The five figures

One strip, read left to right. It is the same arithmetic the list uses, so a figure here matches what you just saw on the list.

- **`Contract, revised`** — the revised value: signed and complete agreements, moved by approved change orders. `incl. $… in changes` underneath when changes have moved it, or just `revised` when they have not. A {{project|lower}} with nothing signed reads `Nothing signed`, and underneath either what is out for signature or `nothing out for signature`.
- **`Committed`** — what you have ordered against the job, billed or not.
- **`Actual cost`** — what it has cost, read from your books. Not typed in by anyone, which is why it agrees with your profit and loss.
- **`Complete`** — how far along, with a bar. `Not started` when nothing has been spent, `No estimate` when money has gone out but there is no budget to measure it against, and `By hours` on a time-and-materials job, whose earned figure is worked out on **Work in progress** instead.
- **`Billed vs earned`** — **how far out the billing is**, green when you are under and red when you are ahead, with what has actually been invoiced on the line beneath. If the {{project|lower}} has no budget and no estimate this reads `Needs an estimate` instead of a figure: without one there is nothing to work out what has been earned from, so no honest variance exists. **Billed here is the gross amount, before any retainage** — the Contracts tab shows what is currently payable, which is the same billing less what is being held. The figure answers "which way is this job out", which is the question the label asks; what has been billed is the supporting number. A complete {{project|lower}} shows its gross profit instead, because the variance stops mattering once the job is done.

### The sections

A row of tabs under the figures. Whichever you are on is underlined and coloured.

- **`Overview`** — the {{project|lower}}'s own details, and a look into each other section.
- **`Contracts`** — the agreements, what each is worth now, and what has been billed against each.
- **`Changes`** — every change order, and which ones have moved the contract.
- **`Job cost`** — the budget by cost code against what is ordered and spent.
- **`Ordered`** — what you have committed to subcontractors and suppliers.
- **`Schedule`** — the phases on a calendar.
- **`Selections`** — what the client still owes a decision on.
- **`Field`** — the daily log and the punch list.
- **`Drawings`** — the drawing sets and their sheets.
- **`Estimates`** — pricing the job before anybody signs.
- **`Warranty`** — the warranty period, and the claims that come in after the job is done.

Opening a record inside a section — a contract, an order — keeps that section's tab lit, so you can see where you are and get back with one click.

### What is on Overview

Two columns on a wide screen, stacked on a phone. The left is what to do; the right is what the {{project|lower}} is.

#### `Needs a decision`

Everything waiting on somebody, most urgent first, each with the one place to go about it. Nothing here is stored — it is worked out from the same figures the rest of the page shows:

- **Billed ahead of the work** — invoiced past what has been earned. {button:Open WIP|outline}. Under-billing is not listed: it is on the strip above, and the answer is always just to invoice it.
- **A cost code over its budget** — the worst one, with how many others are also over, and whichever of ordered or spent caused it. {button:Open code|outline}.
- **A selection overdue**, or waiting on the client when none is late yet. {button:Send reminder|outline}.
- **Changes proposed, not approved** — nothing counts toward the contract until the owner says yes. {button:View|outline}.
- **Somebody paid with no unconditional lien waiver** — the money has already gone out. {button:Chase|outline}.
- **A subcontractor certificate lapsed** while they are on site. {button:Request a copy|outline}.

When there is nothing, it says so plainly rather than showing an empty box.

#### `Job cost by code` and `Contracts`

Short versions of their own tabs — the codes with a bar for spend against budget and the over ones tinted, and the agreements with what each is worth now and what has been billed. {button:All codes|outline} and {button:All contracts|outline} go to the full screens.

#### The right-hand rail

- **`Details`** — the {{customer|lower}}, company, division, kind of work, cost codes, start and end, plus one row worth understanding:
  - **`Charged to`** — the name this job appears under in your cost reports, which is its number and its name together. If it ever reads `Not a cost object — this should not happen; tell us`, tell us: it means the job was created but the thing that lets reports group by it was not, and costs put against it will not show up where you expect.
- **`Next on the schedule`** — the next three phases that are not done, with anything overdue in red.
- **`Punch list`** — the same list as the Field tab, with its add row. Tick an item to close it.
- **`Last days logged`** — the two most recent daily reports.

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
| {button:Proposal|outline|file-text} | Opens the proposal — the estimate as the client sees it — as a PDF in a new tab, the letter or the brochure according to what the estimate is set to. |

### Starting one

{button:New estimate|primary}, on the panel or the list.

1. **`Number`** — required, and different from the {{project|lower}}'s other estimates. `EST-1`.
2. **`Title`** — `New home, as drawn`. Optional.

{button:Start estimate|primary} stays greyed until the number is filled in; on success you see `Estimate started` and land on the estimate's page. `That estimate number is already used on this job.` if the number is taken.

### The estimate's page

The header shows the number, the title, the {{project|lower}}, the contract it became, and its status.

**It saves itself.** About a second after you stop typing, whatever you have changed is saved — you do not have to remember to. Beside the {button:Save|primary} button a line tells you where you stand:

| It says | It means |
| --- | --- |
| `Saved` | the estimate on screen and the estimate on file are the same |
| `Unsaved changes` | you have just changed something; it will save itself in a moment |
| `Saving…` | it is going now |
| `Not saved — try Save` | something went wrong and **your changes are still only on this screen**. The message above it says what; press {button:Save|primary} once you have dealt with it. |

{button:Save|primary} still works and does one thing the automatic save does not: it refreshes the figures beside the editor — **By cost code** and the panels on the {{project|lower}}'s page. The automatic save deliberately leaves the page alone so nothing moves under your cursor while you are typing.

Two things worth knowing. Anything you type *while* a save is in flight is not in that save — it is picked up by the next one, and the line will say `Unsaved changes` until it is. And if you leave the page while it still says `Unsaved changes`, those changes are lost, so give it a second or press {button:Save|primary}.

**The top block.**

- **`Number`** and **`Title`**.
- **`Status`** — `Draft`, `Sent`, `Declined` or `Superseded`. `Accepted` is not on the list: accepting is a button of its own, below. Picking `Sent` fills **`Sent`** with today; picking `Declined` fills **`Decided`**.
- **`Sent`**, **`Valid until`**, **`Decided`** — dates, all optional.
- **`Markup on cost, %`** — the rate every line sells at unless the line says otherwise. `15`.
- **`Overhead, %`** — on the lines' price. `10`.
- **`Profit, %`** — on the price plus overhead. `10`. Leave both at nothing if you price everything on the lines; leave the markup at nothing if you sell at cost and take it all below. Either way it is the same estimate, and the margin at the bottom is the same number.

**Items — what the client buys.** A client does not buy "320 sf of tile at $4.20, 320 sf of tile labour at $3.50, two bags of thinset". A client buys **tile flooring**, at one price. An **item** is that: a name in the client's own words, with the lines that build it up underneath it. The proposal shows the item and its price; the build-up behind it is yours.

{button:Add item|ghost} adds one. An item is a shaded row across the table with its lines beneath it, and a second row under its name for the sentence the client reads:

| On the item's row | What it is |
| --- | --- |
| `Item name` | What the client reads — `Tile flooring, master and hall baths`. Required: **an item with no name is ignored when you save**, the way a line with no description is, and its lines are saved as ordinary loose lines. |
| How it is priced | `Add up the lines` or `Price it myself`. See below. |
| The price | Only when you chose `Price it myself`: what the client pays for this item. Otherwise the cell reads *Its lines add up*. |
| `Cost` | What the lines under it cost you. |
| `Price` | What the client is asked for it, with the margin and its percentage underneath — this is the number that tells you whether a round price was a safe one. |
| The bin | **Removes the item and leaves its lines.** They become ordinary lines again with their pricing untouched; nothing you typed is thrown away. |
| The sentence below | One line the client reads under this item on the proposal — *Porcelain tile, master and hall baths, as selected.* Optional, and it prints only on the by-item and line-by-line proposals. |

**The two ways to price an item.**

- **`Add up the lines`** — the item is worth what its lines are worth, and each line takes the markup, the overhead and the profit exactly as any line does. This is the ordinary case.
- **`Price it myself`** — you type what the client pays and **that is the number that prints**. Overhead and profit are *not* added to it again: typing $8,400 means the client is asked $8,400, and the margin beside it shows what that leaves you against the $6,950 behind it. Use it when you sell round numbers, or when the build-up is yours alone.

If you want a lump you have *costed* — "the plumbing subcontract is $12,000 and I mark it up like everything else" — that is a **line** with a blank quantity, not an item priced by hand.

**When every item is priced by hand** there is nothing left for overhead and profit to be taken on, and the total is simply the sum of the prices you typed. The page says so under the figures. That is how a typed price works; if you meant the rates to apply, let the item's lines add up instead.

**{button:Add line|ghost} at the top** adds a line in no item. Each item has its own {button:Add line to …|ghost} underneath it. A line's first cell — **`Item`** — is which item it belongs to, and `Not in an item` moves it out; **that column is not there at all until the estimate has an item**, so an estimate of plain lines looks exactly as it always did. Lines in no item are listed last, under **Not in an item**.

Once the estimate is accepted its items are fixed with its lines and its rates.

**Lines.** One row per thing you are pricing. The bin at the end of a row removes it (the last row stays).

| Column | What it is |
| --- | --- |
| `Item` | Which item this line builds up, or `Not in an item`. Only shown once the estimate has an item. With **Client wording** on, a `Show it` tick appears under it for a line inside an item — see below. |
| `Cost code` | Where the money lands in the budget, from the {{project|lower}}'s cost code list. `No code` is allowed and the line still prices; it is left out when the estimate becomes the budget. **A cost code is yours and is not on the proposal** unless you choose to show the price by code. |
| `Description` | Required; a row with none is ignored when you save. `Slab, 4in, fibre mesh`. Write it for **yourself** — where the price came from, what the scope excludes, which quote it is off. With **Client wording** on, a second smaller box appears underneath for what the client reads instead. |
| `Qty` | Blank is one — a lump sum. `120`. |
| `Unit` | `cy`, `sf`, `ea`, `ls` — yours. |
| `Unit cost` | What one unit costs you. `185.00`. |
| `Markup %` | This line's markup, if it differs from the estimate's; the estimate's rate shows greyed as the placeholder. Greyed out once a unit price is typed, because the price then does not come from a markup. |
| `Unit price` | Type a price per unit and the line sells at quantity times that, whatever the markup — a unit-price bid. Blank reads `by markup`. |
| `Cost` | Quantity at the unit cost, as you type. |
| `Price` | Quantity at the unit price if there is one, else the cost plus its markup. |

Cost and price are worked out as you type and never stored, so a line typed as 320 sf at $4.20 and a line typed as $1,344.00 agree to the cent.

**Typing a line as a sentence.** The box under the table is the fast way in, and it is what you will use for most of an estimate. Type one line, press **Enter**, and it appears in the table with the cursor still in the box ready for the next one.

| Type this | You get |
| --- | --- |
| `320 sf tile @ 4.20` | 320 sf of *tile* at $4.20 |
| `tile labour 320 sf @ 3.50` | the same, said the other way round — the quantity can come first or last |
| `120 cy concrete 185` | the `@` is optional; a number on the end is the unit cost |
| `plumbing rough 12000` | a lump sum of $12,000 — no quantity, no unit |
| `plumbing rough` | just the description, to price later |
| a row copied out of a spreadsheet | the columns read as if you had typed them, tabs and all |

Prices take a `$` and commas if you like them: `2 ea door @ 1,250` and `@ $4.20` both work. Quantities go to thousandths, so `0.333 cy` is fine.

**It knows the trade's units** — `sf`, `lf`, `cy`, `ea`, `ls`, `ton`, `bdl` and the rest — **and it learns yours.** Any unit you have ever typed on an estimate is recognised from then on, so if you write `coats`, `2 coats paint @ 1.10` reads `coats` as the unit the next time. A word it does not know stays part of the description, which is why `2 coats paint` reads as *coats paint*, quantity 2, until you have taught it.

**A sentence it cannot read is refused, not guessed.** Type `tile @ four twenty` and nothing is added: your text stays in the box and it says so. That is deliberate — a line that quietly landed at $0.00 on a bid you sent is the expensive kind of mistake. A sentence with no description is refused the same way: `320 sf @ 4.20` is a quantity and a price for nothing.

**Where a typed line lands.** Once the estimate has items, a select beside the box says which item the next line goes in, and **it stays where you put it** — you are usually typing one item's lines together. Set it back to `Not in an item` for loose lines.

**{button:Paste lines|outline|clipboard-paste}** takes a whole block at once: one line each, in the same words, or straight out of a spreadsheet. Every line is shown in a preview before anything is added — quantity, unit and unit cost as they were read — and any line it could not read is marked in red and counted on the button, which reads *Add 4 lines, leave out 1*. Nothing is added until you press it, and the lines land in the item the select names.

**{key:Ctrl+D}** while the cursor is in a row copies that row directly beneath it. Most lines in a takeoff are a small change from the line above, so this is usually quicker than typing another sentence.

**Client wording.** The tick beside {button:Add item|ghost} on the **Lines** header. Off by default, because writing the client's words is a pass of its own and you do not want a second box on every row while you are typing a takeoff. It comes up already on for an estimate that has client wording or a hidden line. With it on, every line gets two more controls:

| Control | What it does |
| --- | --- |
| The second description box | What the client reads in place of your line. You keep `Tile — mud set, Schluter, mtl only, per AJ quote 8/14`; the client reads `Porcelain tile flooring`. **Leave it blank and the client reads your line as written** — so only fill it in where your own wording would not do. It is used on the proposal *and* on the schedule of values, because the schedule becomes the invoice the client receives. |
| `Show it` | Only on a line **inside an item**. Untick it and the line is not a row on the proposal at all — contingency, supervision, an allowance carry, cleanup you price but will not itemise. **The money does not change**: it is still in the item's price, the cost, the total, the margin and the budget. It simply is not printed. |

A line you have hidden reads **Not on the proposal** in its row whether the tick box is showing or not, so you cannot lose track of it.

**A line can only be hidden inside an item**, and that is not fussiness: hidden money has to have somewhere to hide. On a line-by-line proposal a hidden loose line would be money with no row, and the page would stop adding up. The item is that somewhere — and **an item that hides any of its lines prints as one row at its price**, exactly as an item you priced yourself does, so the client never sees half a build-up.

Hiding a line keeps it off the *list*; it is not a way to make money untraceable. A hidden line's cost still lands in its cost code, so if you show the price **By cost code** its amount is inside one of those sums. If you need the money itself not to be followable, price the item yourself.

**The six figures.** `Cost` (every line at cost — every line, whether it sits in an item or not), `Price` (what the client is asked for the lines and the items, before overhead and profit; it also names how much of that was **priced by hand** when any item is), `Overhead`, `Profit`, `Total` (price plus overhead plus profit — what the client is asked for) and `Margin` (total less cost, with its percentage of the total).

**The proposal block.** What the client is sent, saved with the rest of the form.

- **`What it is`** — two documents, and this picks which one you get.
  - **`A letter`** — the default, and what a production job, a remodel or a repair sends: two or three pages on your letterhead with the facts, the scope, the price, the exclusions, the terms and a line to sign. {button:Print proposal|outline|file-text} gives you the PDF.
  - **`A brochure`** — for a custom home, where the proposal is the thing that wins the job. A cover of its own with your logo and colour, a letter from you, what is being built in plain words, the price sheet, the allowances still to be chosen, when the work happens, then the terms and the signatures. {button:Open brochure|outline|book-open} opens it on screen and {button:Print proposal|outline|file-text} gives you the PDF, the same as for a letter.
- **`The letter it opens with`** — only printed on the brochure. Write it in your own voice, over your business's name; each line you type is its own paragraph. **Leave it blank and the page is left out** — that is true of every page of the brochure, so an estimate with no allowances has no allowances page rather than an empty heading.
- **`Show the price`** — four ways, and the total is the same in all four. Overhead and profit are in the prices whichever you pick: **cost, markup, overhead, profit and margin never print.**
  - **`By item`** — one row per item at its price with its sentence beneath it, and one row for each line in no item. What a custom-home client reads, and the one that shows nothing of the build-up.
  - **`Line by line`** — a takeoff, with quantity and per-unit columns when a line has them, each line in the client's wording where you wrote some. Items that add up their lines print as a heading with their lines beneath; **an item prints as one row at its price if you priced it yourself or if it hides any of its lines**, because either one is you saying the build-up is not the client's.
  - **`By cost code`** — each code's sum, the no-code lines as *Other*. For a client who expects a trade breakdown; most clients do not, and `By item` is the better answer. Picking it reveals **`Print the code numbers too`**, off by default: off you get `Tiling`, on you get `09 30 00 · Tiling`. Leave it off unless the client is genuinely reading a schedule — the number is your accounting key and it means nothing to a homeowner. The money is the same either way.
  - **`One sum`** — one figure.
- **`Scope of work`** — what the price covers, in the client's words. Every line you type is its own paragraph on the page.
- **`Not included`** — one exclusion per line: *Permits and utility fees.* *Landscaping.*
- **`Terms`** — the payment schedule, what a change costs, how long the price holds. A new estimate starts with the terms of the last one you wrote, so this is usually a read-through.
- {button:Print proposal|outline|file-text} opens the proposal as a PDF in a new tab — **whichever document `What it is` names**, so you never have to think about it — and {button:Open brochure|outline|book-open} opens the same document on screen, where a {button:Print|primary} button in the corner prints it from your browser. Both show the estimate **as saved**; it saves itself about a second after you stop typing, so watch for `Saved` beside the {button:Save|primary} button first.
- **A brochure's PDF takes a few seconds the first time after a quiet spell**, because a brochure is printed by a browser on the server rather than drawn like the letter. If it comes back with a page saying it could not be printed, the proposal itself is fine: {button:Open brochure|outline|book-open} and use the {button:Print|primary} button, choosing **Save as PDF** as the destination. Tell us, though — that page means something needs setting on our side, not yours.

**The client's link — send the proposal instead of attaching it.** Under the proposal block, **`The client's link`**. Anybody on the team may make one.

{button:Make a link|outline|link-2} makes a private web address for this proposal and **copies it to your clipboard**, ready to paste into your own email. Your client opens it on a phone, a tablet or a laptop, with nothing to install and nobody to sign in as. They see exactly the document you would have attached — the brochure or the letter, whichever `What it is` says — with a {button:Print|primary} button for their own copy, and underneath it a card where they can **type their name and accept**.

| What you see | What it means |
| --- | --- |
| {chip:Open|secondary} | Live. The client can read it and accept it. |
| {chip:Accepted|default} | They accepted. The name, the date and the price are above the list. |
| {chip:Revoked|outline} | You took it back. It no longer opens. |
| {chip:Expired|outline} | Past its date. It no longer opens. |
| {chip:Estimate changed|outline} | It was accepted and then you edited the estimate, so it has stopped working. |
| `Opened 4 times, last on 14 October` | How often it has been opened, so you know whether to chase. `Not opened yet` until they do. |

- **The link ends when your offer ends.** It stops working on the date in `Valid until`, or in thirty days when you have not set one. There is no such thing as a link that lives forever.
- {button:Copy|ghost} copies an open link again, for when you need to re-send it. {button:Revoke|ghost} kills it immediately — use it the moment a proposal goes to the wrong address.
- **Anyone holding the link can open it**, so treat it like the proposal itself: it is private because the address is unguessable, not because it asks who you are. Send it to the person, not to a public channel.
- **Accepting on the link does not accept the estimate here.** It records that they accepted — their name, the date, and the price they were looking at — and that is what you then act on with {button:Accept|primary} below, which is where you name the contract it becomes. Nothing about your books moves because a client pressed a button.
- **You are not notified yet.** The acceptance shows here, on the estimate, and you will see it next time you open it. Checking back is on you for now.
- **If you edit the estimate after they accepted**, that link stops working — it cannot go on showing a document that is not the one they agreed to. Their acceptance stays on the record, against the version and price they saw. Make a new link for the revision.

**What the brochure puts on each page, and where it comes from.** Nothing here is typed twice — every page reads something the {{project|lower}} already holds, which is why filling in the rest of the {{project|lower}} makes the proposal better on its own.

| Page | What is on it | Where it comes from |
| --- | --- | --- |
| The cover | The estimate's title, who it is for, the {{project|lower}} and the site, your logo and colour | the estimate and your brand kit |
| The letter | Your paragraphs, over your business's name | **`The letter it opens with`**, above |
| The work | Your scope, paragraph by paragraph | **`Scope of work`**, above |
| What is included | Each item's name with its sentence underneath, and **no money at all** | the items on the **Lines** block and the sentence each carries |
| The price | The price the way you chose to show it | the lines and items |
| Allowances | Each allowance, what is set aside and what has been chosen — or `Still to choose` and the date it is needed by | the **Selections** tab |
| How it goes | Each stage, its dates and the trade on it | the **Schedule** tab |
| Terms, exclusions, signatures | As on the letter | above |

Two things follow from that. A page with nothing behind it does not print, so a brochure on a bare estimate is a cover, a price and a signature page. And **an item's sentence prints once** — on *What is included*, not again beside its price.

Once the estimate is accepted the letter and the three texts are fixed with the price (they are the agreement); how the price is shown, and whether it prints as a letter or a brochure, can still change — those are printing choices.

**`Notes`** — anything the estimate should remember that the client does not see.

What can stop a save: `Check the form and try again.` (a rate or a quantity that is not a number) · `That estimate number is already used on this job.` · `A markup must be between 0% and 1,000%.` · `A unit cost cannot be negative.` · `Somebody changed this while you had it open. Reload and try again.`

### Accepting it

The client said yes. {button:Accept|primary} (owners; greyed until the {{project|lower}} has a contract) asks for the **`Contract`** it priced and **`Accepted on`** (today). The estimate's total, as saved, becomes that contract's value; the estimate is marked `Accepted`, shows the contract in its header, and its rates and lines are fixed from here — shown, greyed, and not sent. `Estimate accepted`.

A **signed** contract's value moves by change order, not by accepting an estimate: `That contract is signed, so its value changes with a change order.` — unless the estimate's total is already the contract's value to the cent, which is accepted and touches nothing, or the signed contract has **no value recorded yet** (a cost-plus agreement usually has none), in which case the estimate fills it in: entry, not revision. A contract on another {{project|lower}} is refused: `That is on another job: …`. Accepting twice, or changing an accepted estimate's rates, lines or status, is refused: `That estimate is fixed: estimate EST-1 was accepted; revise it as a new one.` To revise, start a new estimate and set this one to `Superseded` — the one status an accepted estimate can move to; the title and the notes still move too.

### Making it the budget

{button:Use as budget|outline} (owners). The dialog says the cost as saved and what happens: each cost code's **cost** on the estimate becomes that code's original budget on the {{project|lower}}, replacing what the code had, and lines with no cost code are left out. {button:Make it the budget|primary}. `Budget set on 2 codes — $1,500.00 on lines with no code left out`. From there the budget moves as it always does, by change order, and the **Job cost** tab reads it.

### Making it the schedule of values

{button:Use as schedule of values|outline} (owners; greyed until the {{project|lower}} has a contract). Pick the **`Contract`**, then — **once the estimate has items** — **`Written`**:

- **`By item`**, the default: one schedule line per item and one for each line in no item. This is almost always what you want, because it is the schedule your client can read: it matches the proposal they signed, and every draw is measured against it. An item bills as a sum and carries its lines' cost code when they all share one.
- **`Line by line`**: one schedule line per estimate line — the whole takeoff. Fine on a short estimate; on a two-hundred-line one it makes a schedule nobody will certify. An item you priced yourself has that price shared across its own lines, so the schedule still adds up to the total.

An estimate with no items is written line by line and the choice is not offered.

Either way the schedule takes each line's **client wording** where you wrote some, because the schedule is what a pay application invoices against and the client reads it. An item that hides a line is one schedule line, the same as on the proposal.

Then {button:Make it the schedule|primary}: each row at its **price**, with the overhead and profit spread across them in proportion so the schedule adds up to the estimate's total — the contract sum, which a pay application is measured against — replacing the contract's schedule and carrying the cost code. A line sold at a unit price keeps billing by the quantity, with its unit price raised by the same share. `Schedule written: 4 lines, $89,122.55`. The schedule is what a fixed-price or unit-price contract bills against; a cost-plus or time-and-materials contract bills its cost and leaves the schedule unread. A schedule line an application has already billed against cannot be removed, and the write is refused if the estimate would drop one — see **Billing a contract**. If you want overhead or your fee as a line of its own on the schedule, type it as a line of the estimate.

Neither button is automatic on accepting: a {{project|lower}} budgeted at cost and billed on a schedule of milestones is written from the estimate for one and by hand for the other.

### By cost code

Under the editor, once the estimate has lines: each code's cost and price from the saved lines — the cost is what **Use as budget** writes, the price is what the job cost report will compare it with once the {{project|lower}} is billed. `No cost code` is the last row. A line held by an item you priced yourself is shown at its **share of that price** rather than at its own markup, so the prices here still add up to the estimate's.

### The proposal

{button:Print proposal|outline|file-text} on the estimate's page, or {button:Proposal|outline|file-text} on the list. One letter page (a second when the scope, the lines or the terms need it), under your logo and colour where the brand kit has them: **PROPOSAL** and the estimate's title; the {{project|lower}} (number and name), the site if the {{project|lower}} carries an address, the proposal number, its date (the `Sent` date; *Not yet sent* on a draft) and `Valid until`; **To** the client — the contract's counterparty once the estimate names a contract, else the {{project|lower}}'s customer, with their address from Accounting when they have been billed before — and **From** your business.

Then **Scope of work** (your paragraphs), **The price** the way you chose — item, quantity and per-unit columns only when a line needs them, amount, with an item's own sentence in smaller type under its name and an item that adds up its lines printed as a bold heading over them; a *Rounding* line only when unit prices cannot add to the total to the cent; the **Total** — or, for one sum, *Price for the work described* on its own line; **Not included**; **Terms**; *This proposal is valid until …* when a date is set; the acceptance sentence; and two signature blocks, *Accepted for <the client>* (signed, name, date) and *For <your business>* (signed, date). A draft prints under **DRAFT**, a declined one under **DECLINED**, a superseded one under **SUPERSEDED**; sent and accepted print clean. The footer names the business, the proposal and the {{project|lower}} on every page.

The proposal is made from the estimate every time it is opened, never stored, so a draft's proposal is always the draft as it is now, and an accepted one cannot drift from what was signed. It is not sent from here yet — save the PDF and attach it to your own message.

## Contracts

A {{project|lower}} can have **several agreements over its life**, and that is the normal case rather than the exception. A custom home often runs a design agreement, then a drawings agreement, then the build — three contracts, one job, and **the first two may be the only two that ever happen** if the client sees the number and stops there.

They are listed on the {{project|lower}}'s own page, numbered in the order you agreed them. Owners only to add. **Click a contract's kind to open its own page** — its schedule of values and its pay applications; see Billing a contract. The `Billed` column is what has been certified for payment so far, with what is held back under it, and `—` until the first application is issued.

### Adding one

{button:Add contract|primary} on the **Contracts** tab. Before there are any, the tab explains what an agreement is and offers the same button.

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

Status chips read the same way on every screen in {{project|plural|lower}}: **green** means it is real and counts (a signed contract, an issued order, an accepted estimate, an active {{project|lower}}); **blue** means it is going the right way but is not there yet (a planned {{project|lower}}, an estimate you have sent); **amber** means somebody has to act (a proposal out for signature, a draft nobody has issued, a {{project|lower}} on hold); **grey** means it is over, one way or another.

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

The `Contract` column is the same total: signed and complete only, revised by approved change orders, with `incl. $… in changes` under it when there are any. A {{project|lower}} with nothing signed yet reads `Nothing signed` rather than `0.00`, because zero would read as "worth nothing" when the truth is "not agreed yet" — and underneath it shows what is out for signature, so an unsigned {{project|lower}} still tells you what is waiting on a client.

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

### Printing a change order

Every row on the Changes tab has a print icon beside the pencil; anybody on the team may use it. It opens the change order as a one-page PDF in a new tab, under your logo and colour where the brand kit has them:

- **CHANGE ORDER** and its number and title; the {{project|lower}}, the site, the contract it changes, the number, `Requested` and either `Approved` with the date or `Status`.
- **To** the contract's counterparty — the client — with their address from Accounting when they have been billed before; **From** your business.
- **The change**, as you described it.
- **Contract sum before this change**, **This change** (signed, so a deduction reads `−800.00`), **Contract sum after this change**. Before is the contract's signed value plus the approved changes that came before this one, so a stack of approved changes prints as a ladder whose last line is the revised contract sum on the {{project|lower}}'s page. For a change not yet approved, before is the sum as it stands today. A contract with no signed value prints the change alone.
- A signature block for the client and one for you. A proposed change carries a **PROPOSED** watermark and asks for the signature; an approved one says when it was approved; declined and void say so across the page.

The client never sees the change's cost lines or their cost codes: those are what the change is expected to cost you, and they stay on the tab. The document is rendered when you open it, never stored, so a proposed change's paper changes whenever the change does.

## Billing a contract

Owners only. Click a contract's kind in the table on the **Contracts** tab to open the contract's own page: its **schedule of values** and the **pay applications** drawn against it.

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

Owners only to set. The **Job cost** tab.

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
| `Of budget` | How much of that budget is already spoken for, with a bar. Measured on the **greater** of ordered and spent — the same figure `Left` subtracts — so the percentage and the figure beside it can never disagree. **The number is not capped:** a code at `159.1%` says so, because knowing how far over it is matters. The bar stops at full, since a bar cannot be longer than its track. A code with no budget reads `no budget` rather than `0%`. |
| `Left` | Budget minus the **greater** of ordered and spent — what the code will cost at least. Ordered but not yet billed is still owed; billed beyond what was ordered has already happened; adding the two would count one dollar twice. **Negative and red means that trade is over**, and the whole row takes a faint red wash. |

A code you have ordered against or spent against but never budgeted appears with a `Not budgeted` badge. That row is usually the one worth looking at. A code that was never budgeted but has an approved change order against it appears without the badge, budgeted at the change.

### Narrowing it, and the row at the bottom

`All codes`, `Over budget` and `Not budgeted` above the table, each with its count — and `Over budget` only ever means a code that **had** a budget and has gone past it. A code with nothing budgeted cannot be over one, however much is on it; it is under `Not budgeted`.

**Two totals, and they are answering different questions.**

The line above the table reads *"Budget $… against $… ordered and $… spent"*, and adds *"after $… in approved changes"* when there are any. That describes the whole {{project|lower}} and **does not change when you click a filter** — it is the job's position, not the view's.

The row at the bottom of the table totals **what is on screen**. Filter to `Over budget` and it tells you what those codes alone are over by. It says how many codes it covers — `2 budgeted codes` — and, when any are left out, `· 1 not budgeted, left out`. Codes with no budget are in neither total: adding them would compare a spend against a budget that does not exist.

### Spend with no cost code

A bill line can carry the job and no code. That money is real, it is in the job's `Actual cost` in the strip at the top of the page, and no row of this table can hold it — so the note under the table says how much: *"$3,000.00 has been spent on this job with no cost code on the line."* Fix it where it happened: open the bill in Accounting and put the code on the line. The `Spent` column is only ever as good as the coding on the bills.

## What you have ordered

Owners only to add. On the **Ordered** tab.

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

### Printing an order

The print icon on an order's row on the Ordered tab, or {button:Print order|outline} / {button:Print subcontract|outline} on the order's page. Anybody on the team may print. The PDF:

- **PURCHASE ORDER** or **SUBCONTRACT**, the number and description; the {{project|lower}}, the site, the order number and `Issued` (or *Not yet issued*).
- **Vendor** or **Subcontractor** with their address from Accounting when the books hold one; **From** your business.
- **The order**: the lines the order was placed with, each with its cost code when any line has one, and **Order as placed**.
- **Change orders on this order**: every change on the order, with its amount and where it stands — `approved 2026-05-20`, `proposed`, `declined`, `void`.
- **Order as placed**, **Approved changes**, and the **Purchase order total** or **Subcontract total**, which counts only the approved changes.
- **Terms**: the order's notes, paragraph by paragraph.
- A subcontract carries a signature block for the subcontractor and one for you; a purchase order carries yours. A draft order prints **DRAFT** across the page, a cancelled one **CANCELLED**.

An issued order's lines are locked, so what prints is what was agreed; a draft's paper changes whenever the draft does.

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

**What an approved change does.** Its lines join the order's **Lines** table at once, each marked `Added by SCO-1`, and the value at the top of the page reads the revised sum with `orig. $… · $… in approved changes` under it. On the **Ordered** tab the table's `Amount` is the revised sum with `orig. $…` beneath, **Committed** and the job cost report's `Ordered` column move by the change's lines, by code, and the next subcontractor application picks the lines up — an open draft on its next save, a new one when it is made — after the original lines, with the change's number in front of the description. The bill that application becomes names the change on its line: `Application 2 — SCO-1 · Blocking through 2026-10-31`.

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

### Back-charges — money you spent that was theirs

Owners only, and subcontracts only. When you pay for something that was the subcontractor's to pay for — the cleanup they skipped, the lift you rented because theirs never arrived, the fix your own crew made good — you record it here and it comes off their next application.

**A back-charge is not a change order.** The subcontract still says what they agreed to do for what money; a deductive change order would quietly rewrite that. This is money kept back from a payment, and the order's total is untouched.

The line under the heading says where things stand — *1,450.00 charged back: 250.00 on the draft application, 800.00 not yet deducted, 400.00 already deducted.* — or *Nothing charged back on this order.*

#### Raising one

{button:Raise a back-charge|outline}. The dialog:

| Field | What to put |
| --- | --- |
| `What you paid for` | In your own words. It goes on their bill, so write what you would want to read back. Required. |
| `Amount` | What you spent. `800` and `1,200.50` both work. Always a positive number: a back-charge only runs one way. |
| `Spent on` | The day the money went out. |
| `Cost code it landed on` | The code the cost was charged to on this job. The deduction goes back to that code, so the job cost report nets out. |
| `From a warranty claim` | The claim this came from, when it came from one — the list is this {{project|lower}}'s claims. The claim's row then says what has been charged back to the trade. |
| `Notes` | What you told them and when. |

{button:Raise|primary} gives it the next number on the order and leaves it `Not yet deducted`.

#### The table

| Column | What it is |
| --- | --- |
| `#` | Its number on this order. |
| `What you paid for` | With the warranty claim it came from, your notes, and the reason if it was dropped. |
| `Spent` | The day the money went out. |
| `Cost code` | The code it will be credited back to. |
| `Amount` | What is being kept back. Struck through once dropped. |
| `Standing` | `Not yet deducted`, `On the draft`, `Deducted`, or `Dropped`. Worked out from the application it is riding — nothing here is typed. |

At the end of each row, while it has not been deducted:

- {button:Deduct on 2|outline} puts it on the open draft application. Only shows when a draft exists; if there is none, raise one first and the button appears.
- {button:Take off|outline} takes it back off the draft.
- **The pencil** edits it.
- **The circle-slash** drops it, after asking why — *They came back and did it.* It stays on the order as a record, because they will ask, and comes off whatever draft it was riding. {button:Charge it again|outline} puts it back.

**Once it has been deducted on a billed application it is fixed**: no edit, no drop, no moving it. Void that application and it is owed again, free for the next one.

#### What it does to the payment

On the applications table, the `Payment due` figure becomes what they are actually paid, with the arithmetic underneath: *9,000.00 less 250.00 charged back*.

Approving the application posts the back-charge as **its own negative line on the bill**, described *Back-charge 1 — Cleaned the site after them (application 1)*, against your subcontractor expense account and tagged with the job and the cost code. So:

- Their bill, and what you owe them, is lower by that much.
- The job's spend on that cost code drops by the same amount, which is what you want: you paid 800 for the cleanup and recovered 800, so the job's net cost for it is nothing.

**The certificate above it does not move.** Completed to date, retainage and *less previous certificates* are all about the work, and the work is the same whoever paid for it. That is deliberate: if a back-charge came off the certificate, the next application would quietly hand the money back.

If the back-charges riding on an application come to as much as it does or more, approving refuses: *2 back-charges come to 1,250.00 against a payment of 500.00. Take some of them off this application and deduct them on a later one.* Nothing is posted; take one off and it goes through.

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

## The schedule

Anybody on the {{project|lower}} may keep it. On the {{project|lower}}'s page under **Schedule**, and on its own page — {button:All phases|outline}.

The schedule is the {{project|lower}}'s phases in order — site work, foundation, framing, roof — each with the days it takes and the trade doing it, and the milestones between (an inspection, a delivery, a walk-through). Every phase is also an event on the business's **Job schedule** calendar, so it shows on the company calendar in Scheduling, on the week and month views, and on the phone feed of anybody who subscribes — with no extra work.

### The panel on the {{project|lower}}'s page

One sentence: *7 phases from 2026-09-14 to 2026-10-29: 2 done, underway: Framing, next Roof on 2026-10-24, 1 overdue.* — or *No phases yet* and what a schedule is. {button:All phases|outline} opens the page; {button:Add phase|primary} opens the dialog below.

### The page

The sentence again at the top, {button:Company calendar|outline} to Scheduling, and {button:Add phase|primary}. Then one row per phase, soonest first, and a timeline beside them.

| Column | What it is |
| --- | --- |
| `Phase` | The name — a small diamond before a milestone — with what it follows and the lag (`after Slab +2d`), or `no predecessor`, and its cost code, under it. |
| `Who` | The trade or crew doing it. |
| `Starts` / `Ends` | First and last day, inclusive. `not started` in red under a planned phase whose first day has passed. A milestone has no end. |
| `Days` | Calendar days from first to last. |
| `Status` | `Planned`, `Underway` or `Done`, with `overdue` in red under a phase past its last day and not done. |
| The timeline | Sunday-first weeks across the whole schedule, a bar per phase (grey planned, dark underway, green done, a red ring when overdue), a diamond for a milestone, a red line for today. Hover a bar for its dates. A **legend** above the grid names each of those, so the colours do not have to be guessed. |

At the end of each row: the pencil.

### Adding one

{button:Add phase|primary}.

1. **`Phase`** — required. `Framing`.
2. **`Kind`** — `Phase` (runs for days) or `Milestone` (one day: an inspection, a delivery).
3. **`Starts`** and **`Ends`** — the first and last day on site, inclusive; leave the end blank for a one-day phase. A milestone asks for `On` alone.
4. **`Follows`** — the phase this one waits for, or `Nothing in particular`. With one named, **`Lag, days`** is how many days after its last day this one may start: `0` is the next day, `2` leaves two clear days, `-2` starts two days before it finishes. A line under it says *May start from <date>, the day after <phase>*, and turns red — with the button greyed — if the start you typed is too early.
5. **`Who`** — the trade or crew, from your people and businesses, or `Nobody yet`.
6. **`Cost code`** — optional; shown under the phase.
7. **`Status`** — `Planned`, `Underway`, `Done`.
8. **`Notes`** — `Inspection booked for the Thursday.`

{button:Add phase|primary} stays greyed until the name and the start are filled in. On success: `Phase added`. The very first phase in the business — or the first time an owner opens a schedule — makes the **Job schedule** calendar, and only an owner can make it: a staff member who gets there first sees `The business's Job schedule calendar is made by an owner. Ask one to open the schedule or add the first phase; from then anybody can.` What can stop a save: `<Phase> cannot start before <date>: <predecessor> runs to <date>.` · `That would make the schedule loop: …` (naming a phase that already comes after this one) · `That is on another job: the phase named as predecessor is on another job.`

### Moving one, and what moves with it

Open a phase with the pencil and change its dates. **Move a phase later and everything that follows it moves with it**, each phase keeping its length, until every one starts no earlier than its predecessor allows — the toast says `Phase saved — 3 later phases moved with it`. Move a phase earlier and nothing else moves: slack you left in the schedule is yours to close. Change only the start and the phase keeps its length; change the end alone and it grows or shrinks in place.

Marking a phase `Done` clears its `overdue`; `Underway` clears `not started`. Renaming a phase renames its event on the calendar.

### Removing one

In the dialog, {button:Remove|ghost} then {button:Remove <phase>|destructive}. Whatever followed the removed phase now follows what it followed, with its own lag; the event leaves the calendar. `Phase removed — what followed it now follows what it followed`.

### On the company calendar

Every phase is an all-day event named `<{{project|lower}} number> · <phase>` on the **Job schedule** calendar, which the business owns and everyone can see and change. Opening one there shows the {{project|lower}} it belongs to and opens it. Moving it there moves the phase here — but only this phase; the pushing of what follows happens when a phase is moved from the schedule page.

## Drawings

Anybody on the {{project|lower}} may keep them. On the {{project|lower}}'s page under **Drawings**, and on its own page — {button:All sheets|outline}. Drawings need Documents switched on: a set is a PDF in the cabinet.

A **set** is one issue of the drawings — the permit set, the construction set, ASI 3, addendum 2 — with the date on the drawings. A **sheet** is one page of the set's PDF with the number the trade calls it by: `A-101`, `S-201`, `E-101`. **The current set is the newest issue of every sheet number**: when ASI 3 reissues A-102 and A-104, those two come from ASI 3 and every other sheet still comes from the set before, with nothing to move by hand. Older issues are kept as superseded.

### The panel on the {{project|lower}}'s page

One sentence: *38 sheets in the current set from 3 issues; newest ASI 3, dated 2026-08-15, 4 superseded.* — or *No drawings yet* and what a set is. {button:All sheets|outline} opens the page; {button:Add a set|primary} starts one here.

### The page

The sentence again at the top and {button:Add a set|primary}. Then three panels.

**Current set** — a card per sheet, grouped by discipline in the order an index page lists them (general, civil, landscape, structural, architectural, interiors, … electrical, and *Other* for a number with no letter the convention knows). Each card: the sheet number, its title, the set it comes from and that set's date, `rev 2` when the sheet carries a revision mark, and `3 issues` when the number has been reissued. Click a card to open the sheet.

**Sets** — newest issue first:

| Column | What it is |
| --- | --- |
| `Set` | Its name, with its notes under it. |
| `Dated` | The date on the drawings. This is what orders the issues, so a bulletin dated after the set it revises supersedes it. |
| `From` | Who issued it, when you keep them as a party — the architect, the engineer. |
| `Files` | Each PDF in the set: the name opens the file; beside it how many sheets it was read into, `not read yet` when nobody has, `not a PDF` for a file that has no pages to read. |
| `Sheets` | How many sheets the set carries. |
| the pencil | The set's own dialog, below. |

**Superseded** — shown once any sheet has been reissued: each earlier issue with its set and date and `replaced by <set> · <date>`. Click the number to open it.

### Adding a set

{button:Add a set|primary} is one dialog in three steps.

1. **The set** — `Set` (its name: `Permit set`, `ASI 3`), `Dated` (today unless you change it; type the date on the drawings), `From` (a party, or *Nobody in particular*), `Notes`. {button:Next: the file|primary} saves the set and moves on; the set exists from here, so closing the dialog keeps it and a file can be added later from its row.
2. **The file** — {button:Add a file|outline} uploads a PDF from your computer or phone, up to 100MB; {button:From Documents|outline} searches the cabinet for a PDF already there — the set the architect emailed and Mail filed. Either way the pages are read in your browser: *Reading page 12 of 40…*.
3. **The sheets** — one row per page:

| Column | What it is |
| --- | --- |
| `Page` | The tick — ticked when the page is a sheet — a small picture of the page, the page number and why the row reads as it does: `read off the title block`, `no number found` (unticked; tick it and type the number if it is a sheet), `no text on the page` (a scanned set: read the number off the picture and type it). |
| `Sheet` | The sheet number, read off the title block. Typed lower case is saved upper case. A number on two ticked pages is marked `Twice in this set.` and the save waits. |
| `Title` | The title, read off the title block in sentence case. Fix it or leave it. |
| `Rev` | The revision mark on the sheet, if it has one: `2`, `B`, `ASI-3`. |

The line above the table counts the pages, the ticked rows and any ticked without a number. {button:Save 38 sheets|primary} stores what you confirmed — `38 sheets on the job` — and the page shows them. A page you leave unticked (the cover, a legend) is simply not a sheet.

The reading is a rule, not a guess at meaning: the sheet number is the number-shaped text nearest the bottom-right corner of the page, where every title block puts it, and the title is the biggest other text in that corner that is not a label, a date or a scale. A set laid out unusually gets its numbers typed; the pictures are there for that.

### A set's row

The pencil opens the set: `Set`, `Dated`, `From`, `Notes` and {button:Save|primary}. Under **Files**, each PDF with {button:Read again|ghost} — or {button:Read the pages|ghost} for one never read — which reads the file again and shows the table with what was indexed before filled in where the page still exists; and {button:Let go|ghost}, which takes the file out of the set with its sheets, **leaving the file in Documents**. {button:Add a file|outline} and {button:From Documents|outline} add another PDF, for a set that came as one file per sheet: each file is read into its own pages.

{button:Remove|ghost} then {button:Remove <set>|destructive} removes the set and its sheets; its files stay in Documents — `Set removed — its files stay in Documents`. Whatever the removed set had reissued becomes current again from the issue before it.

### A sheet's page

The sheet number and title, then the discipline, the set and its date, `rev 2`, and which page of which file it is. The page is drawn large in a panel that scrolls; {button:−|outline} and {button:+|outline} zoom from 1× to 6× — on a phone, 3× is a plan you can read. `Page 4 of the file · 2×` above the drawing says where you are.

{button:← A-101|outline} and {button:A-103 →|outline} walk the current set in the index page's order (only on a current sheet). {button:The file|outline} downloads the whole PDF. {button:Edit|outline} opens `Sheet`, `Revision` and `Title` — {button:Save|primary} — and {button:Not a sheet|ghost} then {button:Take A-101 out|destructive} takes the page out of the set, leaving the file alone.

A sheet that has been reissued shows **Issues of A-102** under the drawing: every set it came in, newest first, with `current` on the newest and `(this one)` on the one you are looking at. Opening an earlier issue shows a note above the drawing — *Superseded. This is the Permit set issue of A-102, dated 2026-06-01; the current one is from ASI 3, dated 2026-08-15* — with **Open the current A-102**.

### Marking up a sheet

Anybody on the {{project|lower}} may draw on a sheet. Above the drawing, a row of tools and five colours:

| Tool | What it does |
| --- | --- |
| {button:Move about|primary} | Drag the sheet about with a finger or the mouse; two fingers pinch to zoom; ctrl and the wheel zoom about the pointer. Tap a shape to select it — its row in the list lights up. This is the tool a reader has. |
| {button:Cloud|outline} | Drag a box around what changed. The revision cloud is drawn when you let go. |
| {button:Arrow|outline} | Drag from where the arrow starts to what it points at. |
| {button:Note|outline} | Tap where the note goes, type it, {button:Add the note|primary}. The words sit on the sheet in the colour chosen. |
| {button:Pin|outline} | Tap where the problem is. Type `What needs doing`; leave **Put it on the punch list** ticked and give it a `Due` date if it has one; {button:Place the pin|primary}. The pin is numbered in the order pins were placed. |
| the five colours | Red, blue, green, yellow, black — the pen for the next thing you draw. |

A line under the tools says what the chosen tool wants; `Esc` goes back to moving about. The zoom is the same as before — {button:−|outline} {button:+|outline} and {button:⛶|outline} to fit the width — and what you draw at 3× is exactly where it is at 1×: a markup is stored as a place on the page, not on the screen.

**A pin is a punch item.** Placing one with the box ticked puts `What needs doing` on the {{project|lower}}'s punch list as a work item — the same row the **Punch list** on the Field page and Work show, with *On sheet A-101 · First floor plan* in its notes — and the pin follows it: the row in the list below the drawing says `On the punch list`, `Due 2026-09-30` or `Done`, and the tick beside it closes the item from here. A done pin shows ✓ on the sheet and fades. A pin placed with the box unticked is a marker and raises nothing.

**The list under the drawing** — *1 cloud, 1 arrow, 1 note, 2 pins; 1 pin is still open on the punch list.* — has a row per markup: the kind, the words, who drew it and the day. Tap a row to find it on the sheet. The pencil opens its words and colour — {button:Save|primary} — and {button:Rub out|ghost} then {button:Rub out|destructive} removes it. Rubbing out a pin **leaves its punch item on the list**: the site still owes it. Clearing the item in Work leaves the pin on the sheet as a note, marked `Punch item gone`.

**Which issue.** A markup belongs to the issue it was drawn on. When a set reissues the sheet, the new issue starts clean and the earlier one keeps what was drawn; **Issues of A-102** says `3 markups` beside an issue that carries some. Nothing is carried forward for you: the cloud may have been about the very thing the reissue fixed.

The sheet's file is never changed by any of this. {button:The file|outline} downloads the PDF exactly as it came in.

### Measuring a sheet, and the takeoff

Three more tools on the same row — {button:Length|outline}, {button:Area|outline}, {button:Count|outline} — and beside them {button:Set the scale|secondary}, which reads the sheet's scale once it has one: `1/4" = 1'-0"`, or `18.00 pt per ft` when it matches no standard.

**The scale first.** A length or an area is nothing without it; a count needs none. {button:Set the scale|secondary} opens the sheet's scale:

- **From a dimension the drawing states** — {button:Tap a known dimension|outline}, then tap the two ends of a dimension on the sheet (the wall the drawing says is `24'-6"`), and type what it says: `Length` as a decimal (`24.5`), `Unit` feet or metres, {button:Set the scale|primary}. This is the honest way and works on any plot — a half-size print, a sheet somebody printed to fit.
- **From the title block** — pick the scale the title block states (`1/4" = 1'-0"`, `1" = 20'`, `1:100`) and {button:Use it|primary}. Right only when the PDF is the sheet's own size, which the dialog says; a set printed to letter size is not, and the known dimension is the way.
- {button:Clear the scale|ghost} takes it off. Setting it again, either way, corrects every length and area already on the sheet at once: a measurement is points on the page, and its feet are read through the scale every time.

**Measuring.** Pick the tool and tap: along a wall corner by corner for a length, around a room corner by corner for an area, on each fixture for a count. The tool line counts the taps and shows the quantity so far — *4 points · 59 sq ft* — with {button:Finish|primary} (or `Enter`) to keep it and {button:Start over|ghost} to clear it. On the sheet a length carries its feet at its middle, an area its square feet in a tinted fill, a count `×N` beside the first tap. In the list a measurement reads its quantity, `needs the scale` when the sheet has none, and the pencil names it (*Kitchen*, *North wall*) and colours it; the points stay where they are. Rub it out and draw again to change one.

**The takeoff.** {button:Takeoff|outline} on a measurement's row puts its quantity onto an estimate line:

| Field | What it is |
| --- | --- |
| `Measurements to add up` | When the sheet has more of the same kind, tick the ones that go together — two floors onto one flooring line. A length, an area and a count never share a line. |
| the line above the fields | *59 sq ft goes on the line as 59.026 sf* — the quantity in the unit the estimate prices by: `lf` and `sf` (or `m` and `m2`), `ea` for a count. |
| `Estimate` | The {{project|lower}}'s draft and sent estimates. An accepted one is the agreement and cannot take a quantity. |
| `Line` | An existing line of that estimate, or *A new line*. |
| `The new line`, `Cost code` | For a new line: what it is and its code. Its unit is the measurement's; its notes say *From the takeoff.* |

{button:Add the line|primary} or {button:Set the quantity|primary}: **the line's quantity becomes the total** — a push states, it never adds — and the toast says what went where. The row then carries a chip: `→ EST-2 · Flooring, kitchen · 59.026 sf`, reading the line as it is now on the estimate. Measure the sheet again and the chip says `measured since`; push again to bring the line up to date, or leave it. {button:×|ghost} beside the chip lets the measurement go without touching the line. Taking the line off the estimate leaves the measurement, marked `Line gone`.

The estimate's unit prices do the rest: open the estimate, and the line has its quantity waiting for a cost per unit.

## Warranty — after the {{project|lower}} is done

The `Warranty` tab on a {{project|lower}}: the period you warrant the work for, and the claims that come in once the {{customer|lower}} has moved in. A claim is the record of the call; the work it needs is an ordinary work item, so it shows up in Work and in the daily digest beside everything else that needs doing.

The line under the heading says where things stand in one sentence — *Under warranty until 2027-06-30, 287 days left. 3 claims: 1 open, 1 scheduled, 1 done.* — or *No warranty period set.* until an owner sets one.

### The period

The `The period` panel shows four things: `Substantial completion`, `Warranty` (in months), `Ends` (worked out from the two) and `Standing`:

- `No period` — nothing set yet.
- `Not started` — today is before the completion date.
- `Under warranty` — running.
- `Ending soon` — sixty days or fewer to go. Book the last walk-through.
- `Ended` — the date has passed.

Owners see {button:Set the period|outline} (or {button:Change the period|outline} once it is set). Type the months — `12`, `24` — and pick the day the job was substantially complete, then {button:Save|primary}. Either can be left blank; clear both to remove the period. A month count that is not a whole number from 1 to 1,200 says *A warranty runs a whole number of months, like 12.* The end date is never typed: it is the completion date plus the months, with the day clamped to the month's last (31 January plus a month is 28 February).

When any claim names a cost code, a line under the panel says what the job cost report shows spent under those codes — *1,240.00 spent under the claims' cost code (WAR-01)* — because the bills for the fix land on the {{project|lower}} like any other cost. Nothing is typed here: code the bill to the {{project|lower}} and the warranty code, and the figure appears.

### Recording a claim

{button:Record a claim|primary} at the top right. Anybody except an accountant can, because the person who takes the call is rarely the owner. The dialog:

| Field | What to put |
| --- | --- |
| `What is wrong` | In the caller's words. Required. |
| `Where` | The room or the elevation. |
| `Reported by` | Who called — the owner, the tenant, the property manager. |
| `Reported on` | Today, unless the call came in earlier. |
| `Look at it by` | The day somebody should have been to see it. It goes on the work item as its due date. |
| `Trade responsible` | The subcontractor you think it comes back to. The parties with an order on this {{project|lower}} are listed first under `On this job`; everybody else follows. `Not named yet` is fine. |
| `Cost code for the fix` | The code the fix will be charged under — most builders keep a warranty code. The list is the {{project|lower}}'s own cost code list. |
| `Notes` | What they said, what you saw. |

{button:Record|primary} gives the claim the next number on the {{project|lower}} — claim 1, claim 2 — and raises a work item titled *Warranty claim 1 on 24-109: Drip under the sink*, with the where, who and when in its notes. The toast says *Claim recorded, and the work raised.* Open Work and it is there, linked to the claim, ready to be assigned to somebody.

A claim reported after the period ends is recorded like any other, and its row says *Outside the warranty period* in red under the date. Nothing refuses it: whether you fix it anyway is your call, and the decision below is where you record what you decided.

### The claims table

Open and scheduled claims first, then the rest, newest first.

| Column | What it is |
| --- | --- |
| `No.` | The claim's number, with a tick box in front of it. |
| `What` | What is wrong, with where and the notes underneath. Greyed once done or not covered. |
| `Reported` | The date, who reported it, and *Outside the warranty period* when it is. |
| `Trade` | The subcontractor named, if any. |
| `Cost code` | The code named, if any. |
| `Standing` | `Open`, `Scheduled` (with the day underneath), `Done`, or `Not covered`. Worked out from the decision and the work item — nothing here is typed. If the work item was deleted in Work the row says *No work item — cleared in Work*; ticking the claim raises a new one. |
| `Decision` | `Covered` or `Not covered` with the day and the reason; `—` while undecided. |

At the end of each row:

- **The tick box** (in the `No.` column) marks the claim done — the same as ticking its work item in Work. Untick to reopen it; the scheduled day is kept. Greyed out on a claim that is not covered.
- {button:Schedule|outline} (or the day already set) — pick the day somebody will be there and {button:Save|primary}. It goes on the work item, so Work and the digest carry it. {button:Clear the day|outline} takes it off.
- {button:Decide|outline} (or {button:Decision|outline} once decided) — `Covered`, `Not covered` or `Undecided`, the day decided (filled with today), and `Why` in a line. **Not covered closes the work item**: going to look was the work, and the claim stays on record with your reason. Covered leaves the work open for the fix. Putting it back to `Undecided` clears the day; the work item stays as it was.
- **The pencil** edits the claim — every field except the number and the look-by day, which lives on the work item. The work item's title follows the new wording.
- **The bin** (owners only) removes a claim recorded by mistake, after *Remove claim 2? Its work item stays in Work.* The work item is left in Work with its link removed, because somebody may already have been out to look.

### The Warranty page across {{project|plural|lower}}

{button:Warranty|outline} at the top of the {{project|plural|lower}} list opens `/dashboard/m/jobs/warranty`, which reads across every {{project|lower}}:

- **`Open claims`** — every open or scheduled claim in the workspace with its {{project|lower}}, newest reported first. The {{project|lower}} number is a link to the claim's row on its Warranty tab. Nothing is changed here; a claim is recorded, scheduled and decided on its {{project|lower}}.
- **`Under warranty`** — every {{project|lower}} with a period set, soonest to end first, with the days left. `Ending soon` is the sixty-day mark.
- **`Recently closed`** — the last ten claims done or not covered, with the decision and its day.

The line under the heading counts them: *2 open claims on 2 {{project|plural|lower}} · 3 {{project|plural|lower}} under warranty, 1 ending within 60 days.*

## Bonding — what your surety will back

Two screens. The record of each bond lives on its {{project|lower}}'s Contracts tab. **Can I bid this one** is answered on the Bonding page, reached with {button:Bonding|outline} at the top of the {{project|plural|lower}} list.

Owners only, both of them. A bond is a term of the agreement, the way a contract's value is.

### Bonds on a {{project|lower}}

The `Bonds` panel sits under the contracts. The line above it counts them — *2 bonds: 1 ending soon, 1 in force.*

{button:Record a bond|outline} opens the form:

| Field | What to put |
| --- | --- |
| `Kind` | `performance`, `payment`, `bid`, `maintenance` and `subdivision` are offered, and anything else lowercase with underscores is accepted. What you post differs by state and by who is asking. |
| `Bond number` | The surety's own, in whatever form they write it. |
| `What it covers` | The penal sum. Usually the contract sum on a performance bond. |
| `Premium` | What the bond cost you. Recorded here, never posted: the surety's invoice is an ordinary bill in Accounting. |
| `Surety` | The surety company, from your parties. |
| `Against the contract` | Which agreement it bonds. A bid bond has none yet, which is the point of it. |
| `Took effect` | Leave blank while you have only asked for it. Filling it in puts the bond in force. |
| `Runs out` | Many bonds have none and are released instead. |
| `Premium's cost code` | Where the premium belongs on this job. |

#### The table

| Column | What it is |
| --- | --- |
| `Bond` | The kind, with the bond number, the contract it names and your notes underneath. |
| `Surety` | Who wrote it. |
| `Covers` | The penal sum. |
| `Premium` | What it cost, with the cost code underneath. |
| `Dates` | When it took effect, when it runs out, when it was released. |
| `Standing` | `Asked for`, `In force`, `Ending soon` (within a month), `Expired`, `Released` or `Dropped`. Worked out from the status and the expiry against today — nothing here is typed. |

{button:Standing|outline} moves a bond along. Issued needs the day it took effect; released needs that and the day it was released. **Releasing is what gives its share of your line back.** Dropping one you never got leaves the record. The pencil edits everything else.

### The Bonding page

The sentence at the top is the whole answer: *43,525.05 of bonded work on hand across 1 {{project|lower}}, leaving 4,956,474.95 of the 5,000,000.00 your surety backs.* When you have not recorded your limits it says so and tells you to.

#### `Your line`

Per company, because a surety underwrites a legal entity. If you run more than one, the buttons above the panel switch between them.

{button:Set the line|outline} takes the two numbers off your surety's letter: the biggest `Single job` they will bond, and the `Aggregate` work they will back at once. Either can be left blank; half a line is worth more than none. A single-job limit above the aggregate is refused as the typo it is: *A single-job limit cannot be more than the aggregate.*

The four figures:

- `Single job` and `Aggregate` — what you typed.
- `Work on hand` — what your bonded {{project|plural|lower}} still have to build.
- `Left on the line` — the aggregate less that, in red once you are past it.

#### `What is tying it up`

One row per bonded {{project|lower}}, biggest first, with its contract, what has been billed, the work on hand, and every bond still holding it.

**Two things about this table are deliberate and worth knowing:**

- **Work on hand is backlog, not contract value.** It is the contract less what you have billed. A surety is exposed to what is left to build, so a job billed to the end ties up nothing even while its bond is open.
- **A {{project|lower}} counts once, however many bonds it carries.** Performance and payment bonds come as a pair on the same contract. Counting both would report twice the exposure on every properly bonded job.

A bond ties up the line **from the day you ask for it**, because the job is going ahead either way. Released, expired and dropped bonds let their {{project|lower}} go. A cancelled {{project|lower}} ties up nothing.

#### `Worth a look`

Bonds ending soon, past their date, or still only asked for. An expired bond has quietly let its {{project|lower}} go on the line above, which may be right or may mean nobody renewed it.

## On site — the daily log, photos and the punch list

Anyone on the team, not only owners: the field is a chore, and the person with the phone on the site is rarely the owner.

### The daily log

One report per {{project|lower}} per day. On the **Field** tab, {button:Log today|primary}; every day has its own panel, newest first. A short **On site** panel on `Overview` shows the last few days and links here.

The Field tab is two columns on a wide screen: the log on the left, the **punch list** and **This month** on the right. On a phone they stack with the log first — that is the one being written on site.

**`This month`** counts the calendar month so far: `Days logged`, `Man-hours` and `Photos`. A day is counted once however many times it was added to. There is no *days lost to weather* figure, and that is deliberate: `Weather` is free text, so nothing in your record says a day was lost rather than wet.

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
- **A subcontractor's application does not print.** It is the subcontractor's document, prepared on their side; your own applications, change orders and orders print from their rows.
- **A lien waiver is not generated.** The form itself is your state's or your lawyer's, not something Jobs prints; the signed one attaches as a photo, a file or from Documents.
- **The schedule counts calendar days, and a phase waits only for the one it follows.** No working-day calendar or holidays yet, no start-to-start dependencies, no baseline to measure slip against, and nothing tells the trade — the phase names them, and the company calendar and the feed are how they hear. A schedule is typed per {{project|lower}}; a template that fills a new one is next.
- **A markup is drawn once.** A cloud, an arrow, a note, a pin or a measurement cannot be moved or resized after the fact — rub it out and draw it again — there is no freehand pen, nothing carries a markup onto a reissued sheet, and a marked-up sheet is not printed or sent with its markups on it. No overlay of one issue on another, and the cover sheet's index is not read to fill titles.
- **The takeoff pushes one way.** A measurement puts its quantity on an estimate line and remembers the line; the estimate does not point back at the sheets, an opening is not deducted from an area, nothing measures a volume, and a total across sheets is added up by you. The scale is set by hand — from a known dimension or the title block — never read from the PDF.
- **An estimate is lines you type.** No assemblies (a bundle of lines dropped in as one), no unit cost book that remembers what concrete cost last time, no takeoff from the drawings. A supplier's quote cannot be attached to an estimate yet. Both proposals print, as a PDF and on screen, and a client can accept one on a link — but neither is **sent** from here (you paste the link or attach the PDF to your own email), and nothing tells you when a client accepts: it shows on the estimate and you have to look.
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
| Raise, change, drop or deduct a back-charge | ● | | |
| Record a subcontractor's certificate or W-9, or ask for one in Work | ● | ● | ● |
| Write, send, decline or supersede an estimate, or print its proposal | ● | ● | ● |
| Print a change order, a purchase order or a subcontract | ● | ● | ● |
| Accept an estimate, or make it the budget or the schedule of values | ● | | |
| Draw up selections, record the client's choice, remind them in Work | ● | ● | ● |
| Raise a selection's difference as a change order | ● | | |
| Add, move, mark done or remove a phase of the schedule | ● | ● | ● |
| Add a set of drawings, read its pages into sheets, correct or remove a sheet | ● | ● | ● |
| Upload a set's file, or attach one from Documents | ● | ● | |
| Draw on a sheet, place a pin on the punch list, or rub a markup out | ● | ● | ● |
| Set a sheet's scale, measure on it, or push a quantity onto an estimate line | ● | ● | ● |
| Log a day on site, or add and tick a punch item | ● | ● | ● |
| Record a warranty claim, schedule it, decide it, tick it done | ● | ● | ● |
| Set a {{project|lower}}'s warranty period, or remove a claim | ● | | |
| Record or change a bond, or set the bonding line | ● | | |
| See the bonding page and what is tying up the line | ● | ● | ● |
| Add photos to a day | ● | ● | |
| See the work in progress schedule | ● | ● | ● |
| Type an estimate, post or unpost a work in progress period | ● | | |

Starting a job is a decision, and it creates the thing your books group costs by — which is why it is kept to owners. Reading the list is ordinary work for anybody who has to go and stand on the site.
