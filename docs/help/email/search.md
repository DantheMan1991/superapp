# Finding a message

> Search your whole mailbox from the box in the top bar, narrow it by sender, subject or date, and keep a search you run often.
> **Route:** /dashboard/m/email?q
> **Order:** 40
> **Area:** Reading

Open **Mail** in the sidebar. Click the box marked `Search mail…` at the top right, type what you remember, and press {kbd:Enter}. The search runs on your mail server and covers every folder, so it finds a message wherever it was filed. To narrow it down, click {button:Advanced|ghost|filter} beside the box.

## What you see

- **The search box.** Top right of the bar, with the placeholder `Search mail…`. It holds 200 characters. Press {kbd:/} anywhere on the mail screen to jump into it and select what is already there. There is no search button, so press {kbd:Enter} to run it.
- **{button:Advanced|ghost|filter}.** Right of the box. Opens a panel with `From`, `To`, `Subject`, `Body`, `Folder` and two dates. While any of them but `Folder` is set the button becomes filled instead of plain, {button:Advanced|secondary|filter}. On a phone it shows only its icon.
- **The result line.** Appears under the filter chips once you search from the box: `12 results across all folders`, or `1 result across all folders` for one, or `Results across all folders` when your mail server sends no count. Then `clear`, which drops the words and goes back to the folder.
- **The results.** The usual list, newest first, 40 at a time. A folder still looks picked in the rail during a search, but the results come from everywhere.
- **{button:Save this view|ghost|bookmark}.** At the right of the chip row, whenever a search or a filter is on. It is not there on a plain folder, because a saved view that selects everything is only a folder.
- **`Saved`.** A heading in the folder rail, below your folders, listing the views you have saved. It is only there once you have saved one.
- **`← Newer` and `Older →`.** Under the list, when there is a page to go to.

## How to search your mailbox

1. Click the box, or press {kbd:/}.
2. Type words and press {kbd:Enter}. The result line appears above the list.
3. The search covers Inbox, Sent, Drafts, Archive, Junk, Trash and every folder of your own. The folder you were standing in is ignored on purpose, because being told there are no results when the message is one folder away is the worst thing a mail search does.
4. Nothing found? You see `Nothing matched that search.`
5. To finish, click `clear`, or empty the box and press {kbd:Enter}.

Pressing {kbd:Enter} in the box throws away everything except the folder. The filter chips, every field in the advanced panel, the message you had open and your place in the list all go. The `clear` link on the result line is gentler: it drops the words and keeps the chips and the advanced fields.

Search asks your mail server, not Yosher, so a message that arrived seconds ago may not be findable for a moment while the server indexes it. It is already in the list.

## How to narrow a search

1. Click {button:Advanced|ghost|filter}.
2. Fill in what you know. `From` and `To` both read `name or address` and match either. `Subject` matches words in the subject line. `Body` reads `words in the message`. Each takes plain text, and anything past 200 characters is dropped when the search runs.
3. Every field you fill in has to match. There is no way to ask for one thing or another.
4. `Folder` starts at `Anywhere`, or at the folder the page was opened in. Pick a folder to hold the search inside it. This only bites when you have also filled in one of the four fields above or a date. With only words in the search box, the folder is ignored and the search still spans everything. Choosing `Anywhere` again drops the folder, and Inbox looks picked in the rail instead.
5. `Between` is two date boxes, After on the left and Before on the right. Either one works on its own. The line under them reads `Both dates are included.`
6. Click {button:Search|primary}, or press {kbd:Enter} in any of the four text fields. The panel closes, the list reloads from the first page, and any open message closes. Words in the search box and the filter chips stay as they were.
7. Clicking outside the panel closes it and runs nothing. What you typed is still there when you reopen it, until you leave the page.

The two dates are read in UTC, not by your own clock, so `Both dates are included.` is exactly true only if you keep UTC time. Further west, a message that arrived late on the Before day is left out. Further east, a message that arrived early on the After day is left out. A message that arrived at the exact stroke of midnight on the After day is left out either way. Give yourself a day either side when a date decides the answer.

## How to clear an advanced search

1. Click {button:Advanced|secondary|filter} again, then {button:Clear|ghost}. That button is only there while `From`, `To`, `Subject`, `Body` or a date is set.
2. It drops `From`, `To`, `Subject`, `Body` and both dates from the search, and goes back to the first page. It keeps the words in the search box, the folder and the chips. Reopen the panel and the boxes still hold what you typed, so empty them by hand before you search again.
3. With the search box empty, an advanced search shows no result line and no count, and there is no `clear` link on the list for it. The filled button is the only sign that one is running.
4. It also survives clicking through folders in the rail, which quietly re-runs it in each folder you open. Nothing on the screen says so.
5. When an advanced search with an empty search box matches nothing you see `Nothing here yet. New mail will appear as it arrives.`, which is the empty-folder line rather than a no-match line. Check the {button:Advanced|secondary|filter} button before you believe the folder is empty.

## How to save a search

1. Get the view you want on screen, then click {button:Save this view|ghost|bookmark}.
2. The dialog `Save this view` opens. It reads `It appears in your folder rail as a link. Saved views are yours alone — they point at folders in your own mailbox, which mean nothing in a colleague's.`
3. Type a name, or leave the box empty to take the suggestion showing in it, which spells out the view itself, such as `“quote”, from dan@acme.example, unread`. Names are cut at 60 characters.
4. Click {button:Save|primary}, or press {kbd:Enter}. You see `Saved “[name]”.` and the name appears under `Saved` in the rail, in alphabetical order. You stay on the view you saved.
5. The dialog has no Cancel button. Click {icon:x} at its top right, press {kbd:Esc}, or click outside it to back out.
6. You can keep 20 saved views of your own on each mailbox.

A saved view keeps only three things: the folder, the words from the search box, and the `Unread`, `Flagged` and `Has files` chips. `From`, `To`, `Subject`, `Body` and the dates are stored with it but dropped when you click it, so a saved advanced search comes back without them, under a name that describes a search it is no longer running. Save advanced searches by bookmarking the address in your browser instead.

## How to remove a saved view

1. Hover the row under `Saved` in the rail. {icon:x} appears at its right.
2. Click it. There is no confirmation, no undo and no message. The row goes.
3. Only a failure speaks up: `That saved search has already been removed.`
4. Nothing happens to your mail. A saved view is a link, not a place messages live.

## How to move through the results

1. Results come 40 to a page, newest first. You cannot change the order or the number.
2. Click `Older →` for the next 40 and `← Newer` to come back. Each one is only there when there is somewhere to go.
3. Both close the message you had open, because it may not be on the page you land on.
4. There are no page numbers and no way to jump.

## Messages

| Message | What it means |
| --- | --- |
| `12 results across all folders` | The count your mail server gave for the words in the box. One match reads `1 result across all folders`. |
| `Results across all folders` | Your mail server sent results but no count. The list is right, the number is unknown. |
| `Nothing matched that search.` | The words in the box matched nothing anywhere in the mailbox. Try fewer words. |
| `Nothing here yet. New mail will appear as it arrives.` | The folder is empty. You also see this when an advanced search matched nothing and the search box is empty, so check {button:Advanced|secondary|filter} first. |
| `Saved “Unpaid quotes”.` | Your view is saved and is now in the rail. |
| `Give the saved search a name.` | The name was blank and there was no suggestion to fall back on. |
| `You already have a saved search with that name.` | One of your own saved views uses that name. Extra spaces and capitals do not count as a difference. A colleague's name never clashes with yours. |
| `There's nothing to save — add a search term or a filter first.` | The view selects everything. Search for something, or turn on a chip. |
| `That's as many saved searches as one mailbox can hold.` | You have 20. Remove one first. |
| `That saved search has already been removed.` | It was gone before you clicked. Reload the page. |
| `That mailbox isn't connected.` | Your mailbox connection has been dropped. Reconnect it, then try again. See [Connecting your mailbox](connect.md). |
| `Couldn't reach the mail server. Your mail is safe — try again shortly.` | The mail server did not answer. Nothing was lost. |
| `Something went wrong. Please try again.` | Something unexpected failed. Try once more, and tell us if it keeps happening. |

## Not on this page

The `Unread`, `Flagged` and `Has files` chips are covered in [Your mailbox](mailbox.md), and what you do with a result once you have found it is in [Sorting mail](sorting.md). Search cannot look inside a header, cannot match one thing or another, and cannot exclude anything. There is no attachment-name search and no way to sort results other than newest first. A saved view cannot be renamed, reordered, or given to a colleague. Ask us if you need one of these.

## Who can do what

Owners and staff get exactly the same search, panel and saved views. Saved views belong to the person who made them and to one mailbox, so nobody else can see, click or remove yours, and a colleague reading the same shared address keeps a separate set. Accountants have no access to Mail at all, and every button here answers `Accountant access is read-only — reviews, sign-offs and exports only.`
