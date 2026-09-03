# Your records

> Everyone the business deals with, in one list: the search box, the four buttons that narrow it, what a row tells you, and how to page through them.
> **Route:** /dashboard/m/crm
> **Order:** 10
> **Area:** Records

Open **CRM** in the sidebar and you land here. This list holds every company and person the business deals with. Anyone invoiced or paid through Accounting is already in it, whether or not CRM has ever been used on them. Click a row to open that record. To add somebody who is not here yet, click {button:Add a record|primary} at the top right.

## What you see

- **The title row.** `CRM`, and under it `Everyone the business deals with, and where each one stands.` At the right sit {icon:circle-question-mark}, which opens this help, and {button:Add a record|primary}, which opens the form. Filling it in is [Add a record](new-record.md).
- **The tabs.** `Records`, `Follow-ups`, `Board`, `Pipelines`, `Fields`, `Reports`, `Automations` and `Duplicates`, each with its own icon. The one you are on is underlined in color. On a narrow screen the row scrolls sideways, and a round button appears on the side that still has something to show, labeled `Scroll left` or `Scroll right`.
- **The view row.** The name of the view you are in, such as `All records`, then {button:Filter|outline|filter}. A number beside `Filter` counts the conditions in use. A `*` after the view's name means you have changed its filter without saving. `Save as view` appears next to it once you have. All of that is in [Filters and saved views](views.md).
- **The search box.** The wide box with {icon:search} in it and the placeholder `Search by name`.
- **`People`, `Companies`, `In CRM` and `Archived`.** Four buttons to the right of the box. Each one fills in solid while it is on and sits as an outline while it is off.
- **The line under them.** One small gray sentence saying what the view filters on. With no filter it reads `All records`. With one it reads like `Type is Company` or `Added in the last 30 days`. Several are joined with a middle dot. It never mentions your search or the four buttons, so the list is often narrower than that line says.
- **A row.** A person icon for a person or {icon:building} for a company, then the name. The whole width of the row is the link, so click anywhere along it. It shades as you pass over it.
- **`archived`.** Small gray text after the name, on a record that has been archived. You only see these rows once `Archived` is on.
- **The line under the name.** The stage recorded on the record, such as `Lead`. It reads `Not worked in CRM yet` when no stage has been typed in. A record CRM has never been asked about reads the same, and so does a record you added a minute ago and left blank.
- **The badges at the right of a row.** {badge:Customer|secondary} when the record is set up as a customer in Accounting, {badge:Vendor|secondary} when it is set up as a vendor, and {badge:Restricted} when the record is held back to owners. One record can carry all three. {icon:chevron-right} sits at the far right of every row.
- **The order.** Name, A to Z, ignoring capitals, so `acme` and `Acme` stay together. A view can carry a different order. `Added recently` puts the newest first. Nothing on this page changes the order.
- **The count at the bottom.** `137 records`, or `1 record` when there is one. With more than one page it reads `137 records · page 2 of 3`. It counts every record the filter matches, not the fifty in front of you. It is hidden when nothing matched.
- **`Previous` and `Next`.** Small underlined links at the bottom right, and only when there is more than one page. `Previous` is missing on page 1 and `Next` on the last page.

## How to find a record

1. Type part of a name in the search box.
2. Press {kbd:Enter}. Nothing happens until you do. There is no search button and no waiting for it to catch up.
3. The list narrows to records whose name contains what you typed. It looks at the name on screen and at the legal name recorded on the record. It does not look at email addresses, phone numbers, the stage, the source, notes, your own fields or connections.
4. To clear it, empty the box and press {kbd:Enter} again. There is no × in the box.
5. Click the row you want. The record opens, which is [One record](record.md).

Capitals make no difference. A `%` or an `_` is read as itself, so searching for `50%` finds a name containing those two characters.

Searching from page 2 or later keeps the page number you were on. A search with six matches then shows `Nothing matches that` while the six sit on page 1, and no `Previous` link appears to take you there. Press the back button, or click the view's name and pick the same view again, which puts you back on page 1 and keeps your search.

## How to narrow the list with the four buttons

1. Click `People` to show only people. Click `Companies` to show only companies. These two are one choice, so clicking one turns the other off.
2. Click `In CRM` to leave out every record CRM has never been asked about. What stays is the records CRM holds something on: every record added on this page, every record somebody opened and brought in with `Add to CRM`, and every record given a connection, a deal, a note or a follow-up.
3. Click `Archived` to add archived records to the list. Left off, you see only active records. It adds them, so you get active and archived together and never archived on their own.
4. Click a solid button again to turn it off. There is no button that clears all four at once.
5. Turn on as many as you like. They apply together, on top of the view's own filter and on top of your search, so `People` with `Archived` and a search for `smith` gives you archived and active people named Smith.

Your choices stay in the address bar, so the page is a link you can send to a colleague and the back button undoes one step at a time.

## How to move through the pages

1. Click `Next` at the bottom right for the next fifty records. `Previous` brings you back. Fifty to a page cannot be changed.
2. Check the count as you go. `137 records · page 2 of 3` tells you where you are.
3. A filter with more than one condition loses all but the first the moment you click `Next` or `Previous`. The count grows to match, so page 2 can hold more records than page 1 promised. Click the view's name and pick that view again to put the conditions back.
4. A page number typed into the address bar past the last page shows an empty list while the count still reads the real total, as `137 records · page 9999 of 3`. `Previous` steps back only one page from there, so go back to the plain address instead.

## How to send this list to a colleague

1. Set the view, type your search and turn on the buttons you want.
2. Copy the whole web address out of your browser.
3. Send it. Whoever opens it gets the same view, the same search and the same buttons, on the same page number. On `All records` with nothing switched on the address carries none of that, so they land on whichever view opens by default for them.
4. They still see only what they are allowed to see, so a restricted record reaches a staff member with nothing under the name.

## Messages

| Message | What it means |
| --- | --- |
| `All records` | The view has no filter on it. Your search and the four buttons still apply and are not named in this line. |
| `Nothing matches that` with `Loosen a filter, or clear them to see everyone.` | Your search, or one of the four buttons, matched nothing. Turn a solid button off, or clear the search box and press {kbd:Enter}. |
| `Add your first record` with `Anyone you invoice or buy from already appears here — the party spine means a customer and a vendor can be the same record.` | Nothing is in the list and none of the four buttons or the search is on. It comes with an {button:Add a record|primary} button. You also get this one when a saved view's own filter matches nothing, so read the view name and the gray line before you believe you have no records. |
| `Not worked in CRM yet` | No stage has been recorded on that record. Open it and set one. |
| `Accountant access to this module is read-only.` | You are signed in as the outside accountant. Reading the list is fine, saving is not. |

## Not on this page

There are no columns, no checkboxes and no way to select several records at once, so there are no bulk actions and no export. Nothing here archives, deletes or edits a record. There is no control that changes the order of the list. `Customer` and `Vendor` are shown on rows but you cannot filter on either. Your own fields cannot be searched, filtered or sorted on. Ask us if you need any of these. Merging two records that are the same is on the `Duplicates` tab, which is [Duplicates](duplicates.md). Follow-ups across every record are on the `Follow-ups` tab, which is [Follow-ups](tasks.md).

## Who can do what

Owners see every record, with its stage and, on a restricted one, {badge:Restricted}. Staff see every name and can search, filter and page exactly the same way, but a restricted record reaches them with nothing under the name. It reads `Not worked in CRM yet` and carries no {badge:Restricted}, which is on purpose, so restricted and never worked look alike to them. It still shows {badge:Customer|secondary} and {badge:Vendor|secondary}, because those come from Accounting. `In CRM` therefore drops restricted records for a staff member as well. A staff member who has been given access to one restricted record sees that record in full, like any other. The outside accountant can open this page, search, filter and page through it, and gets `Accountant access to this module is read-only.` on trying to save anything.
