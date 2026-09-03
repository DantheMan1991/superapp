# Your CRM

> Everyone the business deals with, and where each one stands: the records list you land on, the eight tabs above it, what a restricted record means, and how CRM meets Mail, Work and Accounting.
> **Route:** /dashboard/m/crm/**
> **Order:** 0

Open **CRM** in the sidebar. The front door is the list of records itself, not a page of counts, so you land on the people and companies straight away. Click a name to open that record. To add somebody, click {button:Add a record|primary} at the top right. The row of tabs under the title takes you everywhere else in CRM, and it sits on every CRM page.

## What you see

- **The title and the line under it.** `CRM`, then `Everyone the business deals with, and where each one stands.`
- **{button:Add a record|primary}.** Top right. Opens a blank form for a company or a person. See [Add a record](new-record.md).
- **{icon:circle-question-mark}.** Beside it, on every screen in CRM. It opens this help for whichever CRM screen you are on.
- **The tabs.** Eight of them, in a single row that never wraps. On a narrow screen the row scrolls sideways, and a round {icon:chevron-left} or {icon:chevron-right} appears at whichever edge still has something to show. The tab you are on is underlined in the module color.
  - `Records`. The list of everyone you deal with, and where you start. It is underlined only on the list itself, so no tab is marked while you are on one record or adding one. See [Your records](records.md).
  - `Follow-ups`. `What is still outstanding on your records.` Open it to see what is owed to whom. See [Follow-ups](tasks.md).
  - `Board`. Your deals as columns, one per stage. Open it to see where the work stands. See [The deal board](board.md).
  - `Pipelines`. `The steps a deal moves through, in this business's own words.` Open it to add, rename or retire a stage. Only an owner changes them. See [Stages](pipelines.md).
  - `Fields`. `The things this business tracks that the standard fields do not cover.` Open it to add a field of your own to every record. Only an owner changes them. See [Your own fields](fields.md).
  - `Reports`. Questions counted from the records you can see. Open it for a total by stage, by month or by the person carrying it. See [Reports](reports.md).
  - `Automations`. `Things that happen on their own. Each one runs as whoever triggered it, so a rule can only change what that person could change themselves.` Open it to see what is running. Only an owner adds or changes a rule. See [Rules that run by themselves](automations.md).
  - `Duplicates`. Two records that look like the same business or person. Open it to fold one into the other. Owners only. See [Duplicates](duplicates.md).
- **The view picker and {button:Filter|outline|filter}.** Above the list. The picker opens a saved set of conditions, and `Filter` builds one. See [Filters and saved views](views.md).
- **The list.** One row per record, fifty to a page, with the stage underneath the name. {badge:Customer|secondary} and {badge:Vendor|secondary} say Accounting also knows them. See [Your records](records.md).

## How to find somebody

1. Type into `Search by name` above the list and press {kbd:Enter}. Nothing happens until you press it.
2. It matches the name only. An email address, a phone number, a stage or a note will not find anyone.
3. Narrow further with `People`, `Companies`, `In CRM` and `Archived` beside the box. `In CRM` keeps only records somebody has already worked. `Archived` adds the ones you have put away.
4. Click a row to open the record. Everything on it is in [One record](record.md).

## How to bring a customer from Accounting into the CRM

One record covers the whole business. Somebody you invoice, or a supplier you pay, is in this list already and only needs the CRM side filling in.

1. Search their name. In the list, under the name, it reads `Not worked in CRM yet` until somebody starts. Click the row.
2. On the record, an owner sees `Not in the CRM yet` and `Add it to track a stage, notes and connections.` A staff member sees `Nothing to show here`.
3. Click {button:Add to CRM|outline}. You see `Added to CRM`, and the stage, notes, connections, deals and timeline appear.
4. Raising a follow-up on a record does this for you, so you never have to remember step 3.

{badge:Customer|secondary} and {badge:Vendor|secondary} are labels, not links. There is no jump from a CRM record to its Accounting page, or back, in either direction. One company can hold both labels at once and still be one record, which is the point.

## How to keep a record to owners only

Only an owner can do this.

1. Open the record and turn on `Restrict this record`. It reads `Only owners see the stage, notes and connections. The name stays visible to staff, who can already see it in Accounting.`
2. Click {button:Save|primary}. You see `Saved`, and {badge:Restricted|outline} appears beside the name and on the row in the list.
3. Staff still see the name. Under it they read `Not worked in CRM yet`, and on the record `You can see who this is, but not what the CRM holds on them — either nobody has worked this record yet, or it is restricted.` They cannot tell the two apart, which is deliberate.
4. To let one colleague in, use `Who can see this` on the record. Pick them under `Add someone` from `Choose a colleague`, then click {button:Add|primary|plus}. You see `Access granted`, and they get the whole record: notes, deals, timeline and follow-ups. Owners are not in that list because they can already see everything.
5. Nobody is told they have been given access, or that it has been taken away. Say so yourself.

A follow-up you raise on a restricted record is an ordinary work item, and Work hides items by list, not by record. Its title is readable by staff in Work unless an owner puts it on an owners-only list.

## How to keep an email with a record

1. Open the conversation in Mail and click {button:Attach to…|outline|link-2}. `Attach this conversation` opens.
2. Type a name. CRM's answers arrive under `Contacts`, `Companies` and `Deals`. The search box does not name them, but they are there.
3. Click one. You see `Attached. A copy is in the Documents inbox.`
4. The link stays on the mail conversation. A record's timeline shows notes, calls and meetings, and never email, so look for the message in Mail or in Documents.

Staff searching here find a restricted record's name, because they can already see the name, but not that record's deals.

## Messages

| Message | What it means |
| --- | --- |
| `Not worked in CRM yet` | Under a name in the list. Nobody has filled in a stage, or it is restricted and you are not an owner. |
| `Add your first record` | Nothing is in the list at all. It reads `Anyone you invoice or buy from already appears here — the party spine means a customer and a vendor can be the same record.` A saved view whose conditions match nothing shows this too, even when you have plenty of records. |
| `Nothing matches that` | Your search, or one of the four buttons beside it, matches nothing. `Loosen a filter, or clear them to see everyone.` |
| `Nothing outstanding` | No follow-up is open on any record. `Follow-ups you raise on a record show up here. Add one from the record itself.` |
| `An owner needs to set up the first pipeline before this board can be used.` | Under `No pipeline yet` on the Board. Ask an owner to open `Pipelines`. |
| `Only an owner can change these.` | On `Pipelines`. You can read them and nothing else. On `Fields` the line goes on: `Everything set up here appears on every record.` |
| `Only an owner can add or change these. They are shown here so you can see what is running.` | On `Automations`. |
| `Owners only` | On `Duplicates`, to anyone who is not an owner. `Merging moves invoices and bills onto one customer and cannot be undone, so it is kept to the people who own the books.` |
| `You do not have permission to do that.` | The action is kept to owners. Ask one. |
| `This record changed while you were editing it. Reload and try again.` | Somebody saved it while your page was open. Reload, then redo your change. |
| `That record could not be found.` | It was merged away or archived while your page was open. Go back to the list. |
| `Accountant access to this module is read-only.` | You are signed in as the outside accountant. Every screen opens and nothing saves. |
| `Something went wrong. Please try again.` | Nothing was saved. Try once more, and tell us if it keeps happening. |

If CRM is switched off for your business, every address under CRM answers with the not-found page. There is no message and nothing to turn on from here.

## Not on this page

A follow-up you raise reaches whoever you hand it to, on their `What needs you` page and in their daily email, once it has a date inside the next week. Nothing else in CRM tells anybody anything. There are no alerts, no emails when a record changes, no notice when somebody is given access to a restricted record, and no scheduled or emailed reports. Nothing exports. There is no spreadsheet, no PDF and no export button on any CRM screen. Nothing attaches a file to a record either, so file a message and its attachments through Mail and find them in Documents. A merge cannot be undone. Ask us if you need any of these.

The rest of CRM has a guide each: [Your records](records.md), [Filters and saved views](views.md), [Add a record](new-record.md), [One record](record.md), [The timeline](timeline.md), [Follow-ups](tasks.md), [The deal board](board.md), [Add a deal](new-deal.md), [A deal](deal.md), [Stages](pipelines.md), [Your own fields](fields.md), [Reports](reports.md), [Reading a report](report.md), [Rules that run by themselves](automations.md) and [Duplicates](duplicates.md).

## Who can do what

- **Owners** do everything: restrict a record and let one colleague in, set up fields, pipelines and stages, add, pause and delete rules, and merge duplicates. They see every record whole, restricted ones included.
- **Staff** see every name in the business and work every record that is not restricted. They add records, edit them, raise deals and follow-ups, search, filter, and save and share views and reports of their own. They read `Fields`, `Pipelines` and `Automations` without changing them. `Duplicates` is closed to them.
- **Your accountant** can open and read every CRM screen, search it and page through it. Buttons still show, and pressing one answers `Accountant access to this module is read-only.`
- **A colleague let into one restricted record** works that record exactly as they would any other, and sees nothing more.
- A saved view or a report is answered from the records you can see. Two people opening the same shared one get different totals, and both are right.
