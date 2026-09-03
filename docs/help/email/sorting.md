# Sorting mail

> Deal with several conversations at once, and keep them where you will find them again: read and unread, flags, snoozing, archive and trash, labels and folders.
> **Route:** /dashboard/m/email
> **Order:** 20
> **Area:** Reading

Open **Mail** in the sidebar. Tick the box at the left of a row and a bar appears above the list with everything you can do to what you ticked. Folders and labels are one and the same thing on the mail server, so a folder you make here turns up in Outlook and on your phone too. The list itself, its filters and saved views are in [Your mailbox](mailbox.md).

## What you see

- **The folder rail.** Down the left, or a strip across the top on a phone. `Inbox`, `Drafts`, `Sent`, `Archive`, `Junk` and `Trash` first, then your own folders in alphabetical order. A folder carries the number of unread messages in it, or `99+` above ninety-nine. Click one to open it. That empties the search box and takes you to the newest messages in it. The `Unread`, `Flagged` and `Has files` filters stay on.
- **{button:New folder|ghost|folder-plus}.** Under the folder list. Makes a folder on the mail server.
- **`Snoozed`.** An ordinary folder in the rail, made the first time you snooze anything. Everything you have deferred sits in it until its time comes.
- **`Select all on this page`.** A checkbox above the list. It ticks the rows on this page and nothing else, so at most 40 conversations, never the whole folder. Click it again to untick them.
- **A row's checkbox.** At the left of every row. Tick one and the bar appears. Ticks are held on the page only, so opening a message, changing folder, paging or searching loses them.
- **The flag.** The outline next to the checkbox. Click it to flag that one conversation, click again to take the flag off. It fills in the moment you click, and goes back if the mail server refuses.
- **Label chips.** Small gray chips on a row, naming your own folders that conversation is also in. The folder you are standing in is left off, and so are `Inbox`, `Drafts`, `Sent`, `Archive`, `Junk` and `Trash`. You cannot take a label off from the chip.
- **The bar.** Sticks above the list while anything is ticked, covering nothing. At the left it counts what you picked, such as `12 selected`, and a spinner turns while it works. Every button acts on all of them at once.
  - {button:Read|ghost} marks them read. The bold sender goes plain.
  - {button:Unread|ghost|mail} marks them unread again.
  - {button:Flag|ghost} flags them. There is no button that takes flags off a group.
  - {button:Snooze|ghost|clock} opens the snooze sheet.
  - {button:Archive|ghost} moves them into `Archive`. Only shown when this mailbox has one.
  - {button:Trash|ghost|trash} moves them into `Trash`. Only shown when this mailbox has one. Nothing is destroyed, and you can open `Trash` and move them to `Archive` from there.
  - {button:Label|ghost|tag} opens the label menu. It is absent when you have no folder that can be used as a label.
  - `Clear` at the right end unticks everything and puts the bar away.

## How to act on several conversations at once

1. Tick the box on each row you want, or tick `Select all on this page` to take every row on the page.
2. Click {button:Read|ghost}, {button:Unread|ghost|mail}, {button:Flag|ghost}, {button:Archive|ghost} or {button:Trash|ghost|trash}.
3. You see `12 updated.` The ticks clear, the bar goes away, and the list re-reads from the mail server.
4. If the mail server would not take all of them you see `9 of 12 done — the mail server refused 3.` instead. The ones it refused are unchanged. Try them again.

Archive and trash are moves, so the conversation leaves the folder it was in. To put it somewhere and leave it where it is, use a label instead.

## How to snooze conversations

1. Tick the conversations, then click {button:Snooze|ghost|clock}. A sheet opens at the bottom of the screen reading `Snooze 3 until`.
2. Pick one of four times. Each shows what it works out to on the right, in your own clock, such as `Tue, 8:00 AM`.
   - `Later today` is three hours from now. If that lands at 9 PM or later, or falls on the next day, it becomes 8 AM tomorrow instead.
   - `Tomorrow` is 8 AM tomorrow, not twenty-four hours from now.
   - `This weekend` is 8 AM on the next Saturday. Asked on a Saturday it is the Saturday after, never today.
   - `Next week` is 8 AM on the next Monday. Asked on a Monday it is the Monday after.
3. You see `3 snoozed until Tue, 8:00 AM.` The conversations leave the list and move into `Snoozed` on the mail server, so they are gone from your phone and Outlook as well.
4. They come back to the folder that was highlighted in the rail when you snoozed them, within about ten minutes of the time you picked. Nothing announces it. If it was unread the folder's count goes up, and that is the only sign.

Click `Esc` at the top right of the sheet, or press {kbd:Esc}, to close it without picking. Snoozing something that is already snoozed replaces the time rather than adding a second reminder. The furthest ahead you can park anything is a year.

## How to label conversations

A label is a folder. Applying one puts the conversation in that folder as well and leaves it where it already was, which is what makes it a label rather than a move.

1. Tick the conversations, then click {button:Label|ghost|tag}. A menu opens above the bar, listing every folder you can add mail to, in alphabetical order. `Inbox`, `Archive`, `Drafts`, `Sent`, `Trash` and `Junk` are never offered, and neither is a shared folder the mail server will not let you write to. `Snoozed` is offered, and applying it labels the mail rather than snoozing it.
2. Read the box at the left of each name. A check means every ticked conversation already carries that label. A dash means some of them do. An empty box means none do.
3. Click a name with a dash or an empty box and it is applied to all of them. Click a name with a check and it comes off all of them. Only a label every ticked conversation already carries can be taken off in one click.
4. The menu stays open, so pick as many as you want. Click `Done` at the bottom to apply them.
5. You see `Labelled.` when you only added, `Labels removed.` when you only removed, and `Labels updated.` when you did both. The ticks clear and the list re-reads.

Clicking anywhere outside the menu applies your picks as well. There is no cancel. Pressing {kbd:Esc} clears the whole selection, which closes the menu and drops what you picked. To take a label off one conversation, tick that conversation on its own first.

Taking the last label off a conversation would leave it in no folder at all, so that one is skipped and you see `Labels updated. 2 left alone — removing that would have left them in no folder.` When every conversation you ticked would be left with nowhere, nothing changes and the message you get is the wrong one, `The mail server wouldn't send that message. Nothing was delivered — check Drafts.` No mail was sent and no label was touched. Put them in a folder first.

## How to make a folder

1. Click {button:New folder|ghost|folder-plus} under the folder list. The dialog reads `Created on the mail server, so it appears everywhere you read this mailbox.`
2. Type a name, up to 120 characters. The box shows `Quotes` as an example.
3. Press {kbd:Enter} or click {button:Create|primary}. {button:Create|primary} stays gray until you type something.
4. You see `Created “Quotes” — it'll appear in your other mail apps too.` The folder appears in the rail, in Outlook and on your phone. It is not opened for you, so click it in the rail.

Every folder is made at the top level, and there is no way to put one inside another. There is no cancel button on the dialog, so press {kbd:Esc} or click outside it. The new folder can be used as a label straight away.

## How to use the keyboard for the same things

1. Press {kbd:x} to tick the conversation the cursor is on, and {kbd:j} and {kbd:k} to move the cursor down and up.
2. Press {kbd:e} to archive, {kbd:#} to trash, {kbd:b} to open the snooze sheet, {kbd:Shift+I} to mark read and {kbd:Shift+U} to mark unread. Each acts on everything ticked, or on the conversation under the cursor when nothing is ticked.
3. Press {kbd:s} to turn the flag on or off. This one always acts on the conversation under the cursor, never on what you ticked.
4. Press {kbd:Esc} to close the snooze sheet, then the shortcut list, then to clear the ticks, then to close the open message.
5. Press {kbd:?} for the list of keys.

{kbd:e} and {kbd:#} do nothing at all when the mailbox has no `Archive` or `Trash` folder, the same way the buttons are not drawn. Nothing happens while you are typing in a box, where only {kbd:Esc} still works, and a key held with Ctrl, Alt or Cmd is handed back to the browser.

## Messages

| Message | What it means |
| --- | --- |
| `12 updated.` | That many conversations were changed. |
| `9 of 12 done — the mail server refused 3.` | Some went through and some did not. The rest are unchanged. Try them again. |
| `The mail server refused that.` | A flag you clicked on one row was not accepted. The flag goes back to how it was. |
| `3 snoozed until Tue, 8:00 AM.` | They moved into `Snoozed` and come back at that time. |
| `Nowhere to return this to. Open a folder and try again.` | Nothing was snoozed, because there is no folder to bring the mail back to. Click a folder in the rail first. |
| `Pick a time in the future, within the next year.` | A year is the furthest ahead anything can be parked. |
| `Labelled.` `Labels removed.` `Labels updated.` | The labels went on, came off, or both. |
| `Labels updated. 2 left alone — removing that would have left them in no folder.` | That many were skipped, because taking the label off was the last thing keeping them in a folder. |
| `The mail server wouldn't send that message. Nothing was delivered — check Drafts.` | Nothing was sent. You get this when taking a label off would leave every conversation you ticked in no folder at all. Nothing changed. |
| `Created “Quotes” — it'll appear in your other mail apps too.` | The folder is on the mail server, not only here. |
| `Give the folder a name.` | The name was blank, or longer than 120 characters. |
| `That mailbox is out of space.` | The mail server would not make the folder. |
| `That folder no longer exists on the mail server.` | The mail server refused to make the folder. Reload the page and try again. |
| `That mailbox isn't connected.` | Your mailbox connection has been removed. Reconnect it. |
| `This mailbox needs to be reconnected before it can be read again.` | The mail server no longer accepts the stored sign-in. Reconnect the mailbox. |
| `Couldn't reach the mail server. Your mail is safe — try again shortly.` | Nothing changed. Try again in a moment. |
| `Something went wrong. Please try again.` | Nothing changed, and the cause was not one we can name. Try again, and tell us if it keeps happening. |

## Not on this page

You cannot rename, move or delete a folder here, and a folder made by mistake stays until you remove it in Outlook or on your phone. There is no "move to folder" picker either, so {button:Archive|ghost} and {button:Trash|ghost|trash} are the only places a button moves mail to, and putting mail in your own folder is done by labeling, which adds the folder and leaves the mail where it was. Labels have no colors and cannot be nested. Nothing lists what you have snoozed and nothing cancels a snooze, so open `Snoozed` and move the message yourself. Do that and the reminder still stands, so at its due time the message is moved to the folder you snoozed it from anyway. Flags come off one row at a time. Ask us if you need any of this.

The list, its `Unread`, `Flagged` and `Has files` filters and saved views are in [Your mailbox](mailbox.md). The buttons on an open message are in [Reading a message](message.md). Filing mail into a folder as it arrives is in [Rules](rules.md). Copying attachments into Documents on their own is in [Automatic filing](filing.md). Finding a conversation again is in [Finding a message](search.md).

## Who can do what

Owners and staff do exactly the same things here. Nothing on this screen is owner-only. On a shared mailbox everything works the same way, and a folder or label you make belongs to the mailbox, so everyone reading that address gets it. Snoozing on a shared mailbox moves the conversation into `Snoozed` for everyone. The reminder that brings it back is yours alone. Accountants have no mail at all, and every button here answers `Accountant access is read-only — reviews, sign-offs and exports only.`
