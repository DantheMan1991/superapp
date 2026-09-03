# One record

> One person or company, top to bottom: the name and its badges, the fields you fill in, the ways to reach them, who can see it, its deals and its connections.
> **Route:** /dashboard/m/crm/records/*
> **Order:** 40
> **Area:** Records

Click any name in [Your records](records.md) to open it. The fields are live on the page, so type into them and click {button:Save|primary} when you are done. Under them are the ways to reach this record, who can see it, its deals and its connections. Notes, logged calls and follow-ups are in [The timeline](timeline.md).

## What you see

- **`All records`.** The link at the top left. Click it to go back to the records list.
- **The name.** The record's name as it is stored, with a person outline beside it for a person and a building for a company.
- **The badges under the name.** {badge:Customer|secondary} when Accounting holds this record as a customer. {badge:Vendor|secondary} when Accounting holds it as a supplier. {badge:Archived|outline} once you have archived it. {badge:Restricted|outline}, with a padlock, when only owners see the CRM side of it. You may see any of them, all of them or none.
- **{button:Add to CRM|outline}.** At the top right, only while this record has no CRM side yet. It fills the page in with the fields, timeline, deals and connections.
- **{button:Archive|outline}.** Always at the top right. It reads {button:Restore|outline} once the record is archived.
- **The tabs.** `Records`, `Follow-ups`, `Board`, `Pipelines`, `Fields`, `Reports`, `Automations` and `Duplicates`. The same tabs are on every CRM screen.
- **The fields.** `Type`, the name boxes, `Stage`, `Where they came from` and `Notes`. Nothing is kept until you click {button:Save|primary}.
- **`Your fields`.** A bordered box of the fields you set up yourself, and only when you have set some up. The note beside the heading reads `Set up under Fields in this module.` Making them is in [Your own fields](fields.md).
- **`Restrict this record`.** A switch only owners see. It reads `Only owners see the stage, notes and connections. The name stays visible to staff, who can already see it in Accounting.`
- **`How to reach them`.** Every email address, phone number and website for this record. The line under the heading reads `Shared with Accounting and offered when composing mail.`
- **`Who can see this`.** For owners only, and only on a restricted record. It names the colleagues you have let in.
- **`Timeline`.** Notes, logged calls and follow-ups, with three buttons above them. All of it is in [The timeline](timeline.md).
- **`Deals`.** Every deal against this record, most recently changed first. Nothing is left out and there are no pages.
- **`Connections`.** Where a person works, or who works at a company. Current ones first, then the ones that have ended.

## How to start working a record Accounting made

A customer or supplier that Accounting created is not in the CRM until somebody adds it.

1. You see the panel `Not in the CRM yet`, reading `Add it to track a stage, notes and connections.`
2. Click {button:Add to CRM|outline}. You see `Added to CRM` and the whole page fills in.
3. Clicking it twice is safe. The second click changes nothing.

Staff see `Nothing to show here` instead, reading `You can see who this is, but not what the CRM holds on them — either nobody has worked this record yet, or it is restricted.` The {button:Add to CRM|outline} at the top right is still shown to staff. On a restricted record it answers `Something went wrong. Please try again.`, because the record is already in the CRM and staff cannot see it.

## How to change a record's details

1. Set `Type` to `Company` or `Person`. Choosing `Person` shows `First name` and `Last name`, up to 100 characters each. Choosing `Company` hides both and empties them on the next save.
2. Fill in `Name` on a company, up to 200 characters. On a person the box is called `Display name` instead.
3. Fill in `Legal name` on a company, up to 200 characters. Its placeholder reads `Registered name, if different`. On a person the box is called `Formal name`.
4. Type anything you like in `Stage`, up to 60 characters. It is free text, and the placeholder suggests `Lead, active, dormant…`.
5. Type anything you like in `Where they came from`, up to 60 characters. Its placeholder suggests `Referral, website, walk-in…`.
6. Write whatever you need in `Notes`, up to 4000 characters. The box grows taller as you type.
7. Click {button:Save|primary}. You see `Saved` and the page reloads with what was stored.

{button:Cancel|ghost} sends you to the page you are already on. Anything you typed stays on screen and is not saved. Nothing warns you about unsaved changes if you leave the page, so click {button:Save|primary} first.

## How to fill in your own fields

Your own fields sit in the `Your fields` box, in the order set on the Fields tab. Each one shows its label, its control, and the help text you gave it. A field marked required carries {badge:needed to change stage|outline} beside its label.

1. A text field takes up to 2000 characters. Clearing the box removes the answer.
2. A number field cannot be filled in today. The box empties as you type, so nothing can be entered into it. Tell us if you need one. A date field takes a real calendar date.
3. A yes or no field is a switch. Turn it on and then off again to answer no, which counts as an answer rather than a blank. A switch you have never touched is still blank.
4. A one-choice field is a list whose first item is `Not set`. Pick `Not set` to clear the answer.
5. A several-choice field is a row of round chips. Click one to turn it on, click it again to turn it off.
6. A link field takes a full web address, up to 2000 characters. It must start `http://` or `https://`.
7. Click {button:Save|primary}. You see `Saved`.

A required field only bites when you change `Stage`. An ordinary save with the field left blank goes through. When you do change the stage, the save is refused and the message under the field ends `is required before this record can move stage.` Fill it in and save again. A field somebody has since retired keeps whatever it held, even though it no longer shows.

## How to add a phone number, an email address or a website

1. Click {button:Add|outline|plus} beside `How to reach them`. A short form opens below the list.
2. Set `Type` to `Email`, `Phone` or `Website`.
3. Type the value in the box below, up to 320 characters. The box is named after the type you picked.
4. An email needs one `@` and a dot after it. A phone needs at least six digits, and brackets, spaces and dashes are all fine. A website can be typed bare, such as `example.com`.
5. Fill in `Label (optional)` if it helps, up to 40 characters. Its placeholder suggests `work, mobile, billing…`.
6. Click away from the value box and the page checks the rest of your records. You see `Checking…`, then nothing, or a yellow box naming who already has that value and ending `. You can still add it.` It is a warning and never stops you. At most ten names are listed, and each is a link.
7. Click {button:Add|primary}. You see `Added` and the row appears in the list.

The first email you add is automatically the main one, and the same goes for the first phone and the first website. To change that later, click {icon:star} at the right of another row. Nothing is announced, and {badge:Main|secondary} moves to that row.

To take a row away, click {icon:trash} at its right. There is no confirmation and no undo. You see `Removed`. If you removed the main one, the oldest of that kind takes over as main. A row cannot be edited. To fix a typo, remove the row and add it again, then mark it as the main one if it was.

## How to say who can see a restricted record

Restricting a record hides the stage, the source, the notes, your own fields, the connections, the deals, the timeline and the follow-ups. The ways to reach them go from this page too, because the whole CRM half of it does. It does not hide the name, which staff can already see in Accounting.

1. As an owner, turn on `Restrict this record` and click {button:Save|primary}. You see `Saved` and {badge:Restricted|outline} appears under the name.
2. The `Who can see this` section appears. It reads `This record is restricted, so owners can see it and nobody else can. Anyone added here gets the whole record — its notes, deals, timeline and follow-ups.`
3. Open `Add someone` and pick a name. The list reads `Choose a colleague` until you do. Owners are not offered, because they see every restricted record already. Anybody already added is not offered either, and the outside accountant is never offered. When nobody is left to offer, the list is replaced by `Everyone who can be added already has access.`, or by `Nobody else to add — owners can already see this record.` when you have added nobody yet.
4. Click {button:Add|primary|plus}. You see `Access granted` and the name joins the list.
5. To take access away, click {icon:x} at the right of a name. There is no confirmation. You see `Access removed`.

A colleague who has left the business shows as a string of letters and numbers instead of a name. Remove that row the same way. Somebody you add gets the whole record and can edit it, but cannot add anybody else. Only owners can.

## How to raise a deal

1. Click {button:Add a deal|outline|plus} beside `Deals`. The form is covered in [Add a deal](new-deal.md).
2. Each deal shows its name, then its amount or `No amount yet`, then a badge carrying its stage. The badge is filled while the deal is open and outlined once it is won or lost.
3. Click a deal's name to open [A deal](deal.md), where you change it.

## How to connect a person and a company

1. Click {button:Connect|outline|plus} beside `Connections`. On a person the dialog is `Connect to a company`, and on a company it is `Connect a person`.
2. It reads `Both records stay their own; this records the relationship between them, and keeps it when it ends.`
3. Start typing in the top box, whose placeholder is `Start typing a name`. You see `Searching…`, then up to ten names. Click one to pick it.
4. Fill in `Role (optional)` if you know it, up to 120 characters. Its placeholder suggests `Operations Manager`.
5. Click {button:Connect|primary}. You see `Connected` and the row appears on both records.

Each row shows the other record's name, then the role or `No role recorded`. {badge:Primary|secondary} marks the one company a person is mainly at. Nothing on this page sets that badge, so a connection you make here never carries it.

To end one, click {icon:unlink} at the right of a current row. The dialog is `End this connection?` and says the other name `will show as a former connection rather than disappearing — the history is usually the point.` Click {button:End connection|primary}. You see `Marked as ended. The connection stays on the record.` The row drops to the bottom, loses its badge and its button, and gains the date it ended. Today's date comes from your own computer. Connect the same pair again later and you get a second row, which is the history.

## Messages

| Message | What it means |
| --- | --- |
| `Give the record a name` | Every record needs a name. On a person a first or last name is enough. |
| `Saved` | Your edit went through. |
| `Invalid input` | Something is over its limit. Nothing marks which, so shorten the notes, the stage, the source or a name and save again. |
| `1 field need attention.` | One of your own fields was refused. The reason is under that field. Two or more say `2 fields need attention.` instead. |
| `Some fields need attention.` | The same thing, with no per-field reason. |
| `This record changed while you were editing it. Reload and try again.` | Somebody else saved this record first. Reload and redo your edit. Staff also get this if they somehow set `Restrict this record`. |
| `A name is required.` | The name was only spaces. |
| `That record could not be found.` | The record was removed or hidden while your page was open. |
| `Record archived` / `Record restored` | The badge under the name appears or disappears, and the button flips. |
| `Enter a value first` | The contact box was empty. |
| `Added` | A contact row was added. Adding a value the record already has says this too, and adds nothing. |
| `Removed` | A contact row is gone. |
| `Something went wrong. Please try again.` | Most often a contact value nothing can use, such as a four-digit phone. Check it and add it again. |
| `That person no longer has access to this record.` | The grant was already removed. Reload. |
| `Pick a company` / `Pick a person` | Choose a name from the search results before connecting. |
| `A person can only be connected to an organization.` | Connections only run between a person and a company, never two of a kind. |
| `That connection already exists.` | These two are already connected, and it has not ended. |
| `No match. The other record has to exist first.` | Nothing matched what you typed. Add that record first. |
| `That connection could not be found.` | The connection changed while your page was open. Reload. |
| `No contact details yet.` / `No deals yet.` / `No connections yet.` | Nothing is there yet. Use the button beside the heading. |
| `You do not have permission to do that.` | Only owners can grant or take away access. |
| `Accountant access to this module is read-only.` | You are signed in as the outside accountant. Every button here answers this. |

## Not on this page

Nobody owns a record. There is no field for an account manager and no page shows one, so use `Notes` or a field of your own. Deal amounts always print a dollar sign, whatever currency your business is set to. There is no delete, only {button:Archive|outline}, and an archived record keeps every section and drops out of the records list and the connection picker. Nothing here merges two records or flags this one as a duplicate, which is in [Duplicates](duplicates.md). Nothing turns a record into a customer or a supplier, so do that in Accounting. Emails, documents, invoices and bills never appear on this page. On a person, `Display name` says `Built from the names below`, but that only happens when the record is first added, so clearing the box later leaves the old name in place. Switching a restricted record back to everyone hides the `Who can see this` section but keeps the grants, so restricting it again silently lets the same people back in. Ask us if you need any of this.

## Who can do what

Owners can do everything here, and only owners see `Restrict this record` and `Who can see this`. Staff can edit the fields, add and remove contact details, raise deals, make and end connections, and archive a record, on any record they can see. Staff cannot see a restricted record's CRM side at all unless an owner adds them, and cannot grant access even then. The outside accountant sees every box and button live but cannot use any of them, and gets `Accountant access to this module is read-only.` on every click.
