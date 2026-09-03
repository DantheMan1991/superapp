# Your mailbox

> Your folders and the list of conversations in them: what a row tells you, the three filters, the keyboard, and how new mail turns up on its own.
> **Route:** /dashboard/m/email
> **Order:** 10
> **Area:** Reading

Open **Mail** in the sidebar. Your folders run down the left, your conversations sit in the middle, and the one you pick opens on the right. Click a conversation to read it. To start a new message, click {button:Write|outline|pen-square} at the top left.

## What you see

- **The row along the top.** {button:Write|outline|pen-square} to start a message, the auto-reply link, the `Shared` label on an address your colleagues read too, then `Rules`, `Signature`, `Templates` and `Filing`, the search box, {button:Advanced|ghost|filter} and the {icon:circle-question-mark} that opens this help. Each of those has its own guide, and all but the search and the help are hidden on a phone.
- **The folder list.** Every folder your mail server lets you read. The standard ones come first in a fixed order: `Inbox` with {icon:inbox}, `Drafts` with {icon:file-text}, `Sent` with {icon:send}, `Archive` with a box, `Junk` with a shield, `Trash` with {icon:trash}. Your own folders follow in alphabetical order with {icon:folder-open}, including `Snoozed` if you have ever deferred a message. Click a folder to see what is in it. The folder you are in is shaded.
- **The unread count.** A blue number at the right of a folder, when that folder holds anything unread. Above 99 it reads `99+`. It counts unread messages. The count beside **Mail** in the sidebar counts unread conversations in the Inbox instead, so the two numbers can differ on the same mailbox.
- **{button:New folder|ghost|folder-plus}.** Under the folders. It makes a folder on the mail server, so the folder turns up in Outlook and on your phone too.
- **`Saved`.** A heading under the folders, and only once you have saved at least one view. Each row is a {icon:bookmark} link you click to go back to that view. Hover a row and an {icon:x} appears at its right. Click it to remove that saved view, with no confirmation and no undo. Saving and using views is in [Finding a message](search.md).
- **The three filters.** `Unread`, `Flagged` and `Has files`, above the list. Each one is explained below.
- **The result line.** Only after you have searched from the box at the top. It reads `12 results across all folders`, or `1 result across all folders` for a single hit, or `Results across all folders` when the mail server would not count them. Click `clear` at the end of it to drop the search and go back to the folder you were in. Your filters stay on.
- **`Select all on this page`.** A checkbox above the list. Ticking rows lets you act on several at once, which is in [Sorting mail](sorting.md).
- **The list.** One row per conversation, newest first, forty to a page. A back and forth with one person is one row, not one row per reply.
- **A row.** Left to right: a checkbox, a flag outline you click to flag or unflag, then the conversation itself.
  - The first line is the sender's name, or their address when they gave no name, or `Unknown sender` when there is neither. It is bold while the conversation is unread.
  - Next to the sender, a small gray chip for each of your own folders the message is also in, other than the one you are looking at.
  - {icon:paperclip} at the right when something is attached.
  - Then the date. Today shows a time, such as `2:41 PM`. Within the last week shows a short weekday, such as `Tue`. Older shows the day and month, such as `Aug 14`.
  - The second line is the subject, or `No subject` in italics when there is none.
  - The third line is the opening words of the message, when the mail server gave any.
- **`← Newer` and `Older →`.** Under the list, when there is a page to go to. Each moves forty conversations and closes whatever you had open.
- **The reading pane.** Empty until you pick something, and it reads `Pick a message to read it.` What you can do with an open message is in [Reading a message](message.md).
- **New mail arrives on its own.** While this tab is in front, the screen checks the mail server about every 45 seconds and redraws the list and the counts when something has changed. On a second monitor it checks every two minutes. It stops while the tab is hidden, then checks the moment you come back to it. After a few quiet checks it slows to about a minute and a half, and after a failure it waits longer each time, up to five minutes. You do not have to reload. The one thing that stops checking for good is your connection running out, and the list then sits unchanged until you reload.
- **On a phone.** The folders sit in a short scrolling list at the top, and you see one pane at a time. Open a conversation and the message replaces the list, with `← Back to list` above it. `Rules`, `Signature`, `Templates` and `Filing` are hidden on a narrow screen, so use a laptop for those.

## How to read your mail

1. Click a folder. The list shows what is in it, newest first.
2. Click a conversation. It opens on the right and the row is shaded.
3. Click the flag outline at the left of any row to flag it. The flag fills straight away. If the mail server refuses, it empties again and you see `The mail server refused that.`
4. Click `Older →` at the bottom for the next forty, going back in time. Click `← Newer` to come forward again. Both close the message you had open.

## How to show only some conversations

1. Click `Unread` above the list. It turns blue and the list shows only conversations you have not read.
2. Click `Flagged` or `Has files` as well to narrow further. Two or three together mean all of them at once, so `Unread` and `Has files` shows unread conversations that carry a file.
3. Click a blue filter again to clear it. There is no button that clears all three at once.
4. The filters narrow the folder you are in. Clicking any of them closes the message you had open and takes you back to the first page.
5. Change folder and the filters stay on. The blue chips tell you they are still there.

## How to use the keyboard

The keys work as soon as the screen is open. You never have to click into the list first.

| Key | What it does |
| --- | --- |
| {kbd:j} or {kbd:↓} | Open the next conversation down |
| {kbd:k} or {kbd:↑} | Open the previous one. At the top and bottom the key scrolls the page instead |
| {kbd:o} or {kbd:Enter} | Open the one you are on |
| {kbd:Esc} | Close one layer at a time: the snooze sheet, then this key list, then your ticked rows, then the open message |
| {kbd:x} | Tick or untick the one you are on |
| {kbd:s} | Flag or unflag the one you are on |
| {kbd:e} | Move it to Archive. Nothing happens if your mailbox has no Archive folder |
| {kbd:b} | Open the snooze sheet, which asks when to bring it back |
| {kbd:#} | Move it to Trash. Nothing happens if your mailbox has no Trash folder |
| {kbd:Shift+I} | Mark read |
| {kbd:Shift+U} | Mark unread |
| {kbd:r} | Reply to the one you are on |
| {kbd:c} | Start a new message |
| {kbd:/} | Jump to the search box at the top |
| {kbd:?} | Show or hide the key list |

Press {kbd:?} for the list on screen. It is headed `Keyboard shortcuts` and closes with the small `Esc` button in its corner. Three working keys are missing from it: {kbd:o}, {kbd:↑} and {kbd:↓}.

{kbd:e}, {kbd:b}, {kbd:#}, {kbd:Shift+I} and {kbd:Shift+U} act on every row you have ticked, and on the one you are reading when you have ticked nothing. The rest always act on the one you are reading.

The keys stop the moment you are typing. Click into the search box, a dialog field or the text of a reply and every key but {kbd:Esc} goes into what you are typing. The message you are reading sits in its own frame, so clicking inside the message text stops the keys too. Click the list again to get them back. Anything held with {kbd:Ctrl}, {kbd:Alt} or {kbd:⌘} is left to your browser, so {kbd:Ctrl+F} still finds text on the page.

## How to make a folder

1. Click {button:New folder|ghost|folder-plus} under the folder list. The dialog reads `Created on the mail server, so it appears everywhere you read this mailbox.`
2. Type a name, such as `Quotes`, up to 120 characters.
3. Press {kbd:Enter} or click {button:Create|primary}, which stays grayed out until you have typed a name.
4. You see `Created “Quotes” — it'll appear in your other mail apps too.` and the folder appears in the list.
5. Click the new folder to open it. It is not opened for you.

Every folder you make here sits at the top level. There is no way to put one inside another from this screen.

## How to get back in when mail will not load

When the mail server cannot be reached, the whole screen is replaced by a warning triangle and one sentence. There are no folders, no search and no way back except your browser's back button.

1. If it reads `This mailbox needs to be reconnected.` click {button:Reconnect this mailbox|primary}. That sends you to your mail server to sign in again. See [Connecting your mailbox](connect.md).
2. If it reads `Couldn't reach the mail server.` or `The mail server didn't respond in time.` wait a moment and reload. Nothing is lost and no mail is affected.
3. If it reads `You no longer have access to this mailbox. Ask whoever administers it to grant it again.` there is no button, and reconnecting will not help. Ask whoever set up that shared address to grant you access again.

## Messages

| Message | What it means |
| --- | --- |
| `Nothing here yet. New mail will appear as it arrives.` | This folder is empty, or your filters match nothing in it. Click a blue filter to clear it. You also get this line, rather than the search one, when an advanced search found nothing. |
| `Nothing matched that search.` | Your search found nothing. Click `clear` in the line above the list. |
| `Pick a message to read it.` | Nothing is open on the right. Click a row. |
| `Give the folder a name.` | The name was longer than 120 characters. Shorten it and click {button:Create|primary}. |
| `That mailbox is out of space.` | Your mail server refused the new folder because the mailbox is full. Clear some mail out first. |
| `That folder no longer exists on the mail server.` | The folder was removed somewhere else while your page was open. Reload. |
| `The mail server refused that.` | Your flag did not stick. The flag goes back to how it was. Try again. |
| `Couldn't reach the mail server. Your mail is safe — try again shortly.` | The mail server did not answer. Nothing was changed. Try again in a moment. |
| `This mailbox needs to be reconnected before it can be read again.` | Your connection has expired. See [Connecting your mailbox](connect.md). |
| `The mail server returned no folders.` | The mail server answered but listed nothing. Reload, and tell us if it keeps happening. |
| `That saved search has already been removed.` | Somebody removed that saved view, or you clicked twice. Reload. |
| `Accountant access is read-only — reviews, sign-offs and exports only.` | You are signed in as the outside accountant, who gets no mail. |

## Not on this page

You cannot rename or delete a folder here, and you cannot put one folder inside another. Do both in Outlook or on your phone, and the change shows up here. There is no control that moves a message into one of your own folders, only Archive and Trash. Nothing sorts the list any way but newest first, there are no page numbers, and forty a page cannot be changed. Ticking rows and acting on several at once is in [Sorting mail](sorting.md). Searching, the advanced search and saving a view are in [Finding a message](search.md). Writing is in [Writing a message](compose.md).

## Who can do what

Owners and staff get exactly the same screen and can do everything on it, including making folders and saving views. Your saved views are yours alone and nobody else sees them. On a mailbox shared with colleagues, `Shared` appears at the top and everything on this page still works the same way. The outside accountant gets no mail at all, and every button here answers `Accountant access is read-only — reviews, sign-offs and exports only.`
