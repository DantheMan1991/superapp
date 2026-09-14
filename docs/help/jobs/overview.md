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

## Cost codes

{button:Cost codes|outline} on the {{project|plural}} page. Owners only to change; anyone can read.

**Nothing here suggests a list to you**, and that is on purpose — some businesses use CSI MasterFormat, some use NAHB's chart, and plenty use codes they made up years ago. Yours are whichever you already put on a job cost report.

- {button:New list|primary} — give it a name. **The first list you add becomes the default**, so jobs use it without being asked.
- {button:Make default|ghost} — on any list that is not already the default. Only one list can be the default at a time; making a new one takes it off the old one for you.
- {button:Add code|outline} — a `Code` and a `Name`. The code is free text, so `03 30 00`, `1000` and `CONC-SLAB` are all fine. Two codes cannot share a code in one list; you see `That code is already in this list.` if they would.

New codes are added to the end of the list, not the top, so a list you arranged stays arranged.

## What this does not do yet

Worth knowing so you are not looking for it:

- **No budget.** A job collects what it cost; nothing yet compares that to what it was meant to cost.
- **No contracts and no billing.** Those come next.
- **A {{project|lower}} cannot be edited once created**, and codes cannot be renamed or removed from the screen. Ask us if you need one changed.

## Who can do what

| | Owner | Staff | Accountant |
| --- | :-: | :-: | :-: |
| See {{project|plural|lower}} and cost codes | ● | ● | ● |
| Start a {{project|lower}} | ● | | |
| Add or change cost code lists | ● | | |

Starting a job is a decision, and it creates the thing your books group costs by — which is why it is kept to owners. Reading the list is ordinary work for anybody who has to go and stand on the site.
