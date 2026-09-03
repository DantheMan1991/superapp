# Reading a message

> One open message: who sent it, what it says, what came attached, and the buttons that answer it, file it or throw it out.
> **Route:** /dashboard/m/email?message
> **Order:** 30
> **Area:** Reading

Click a row in the middle list and that message opens in the pane on the right. Everything you can do to it sits at the top of the pane, above the message itself. To answer it, click {button:Reply|outline}. The list you picked it from is in [Your mailbox](mailbox.md).

## What you see

- **The subject.** In bold at the top. A message sent without one reads `No subject` in gray italics.
- **Who sent it.** The sender's name, then their address after it in gray. When there is no name you get the address on its own. Only the first sender is ever shown.
- **The date and time.** At the right of the sender line, such as `9/3/2026, 2:41:07 PM`. This is the clock on our server, not yours, so it can read hours away from your own time. Nothing shows when the mail server gave no date.
- **`To`.** The line under the sender, naming everyone the message was addressed to. It is cut off after one line. Anyone copied in is not shown.
- **{button:Reply|outline}, {button:Reply all|outline} and {button:Forward|outline}.** Each opens a draft in this same pane, in place of the message. `Reply all` shows only when the message reached more than one address, counting people copied in. See [Writing a message](compose.md).
- **{button:Read|ghost} or {button:Unread|ghost|mail}.** Marks the message read, or puts it back to unread. The button shows the state you can switch to, not the state it is in.
- **{button:Flag|ghost} or {button:Unflag|ghost}.** Puts a flag on the message, or takes it off. A flagged message shows a filled flag, and the `Flagged` filter above the list finds it.
- **{button:Archive|ghost}.** Moves the message to your Archive folder. It shows only when your mailbox has one.
- **{button:Trash|ghost}.** Moves the message to Trash. It shows only when your mailbox has one, and it asks nothing first.
- **Chips for the records this conversation is attached to.** Each one names an invoice, bill, customer, file or folder and opens it when you click it. See [Attaching an email to your records](records.md).
- **{button:Attach to…|outline|link-2}.** Files a copy of the conversation against a record of your choosing, also covered in [Attaching an email to your records](records.md).
- **{button:Draft an invoice|outline|sparkles} and {button:Draft a bill|outline|sparkles}.** Read the whole conversation and build a draft you review before anything is issued. Both are in [Attaching an email to your records](records.md).
- **The blocked-images bar.** Only above a message that carries pictures from the internet.
- **The message.** The sender's own words, in a box of their own on a white background whatever theme you use. The box grows to fit, so you scroll the pane and never the message. A message too wide for the pane scrolls sideways inside its own box.
- **What a message is allowed to do.** Nothing in one ever runs, and a form inside one cannot be filled in or sent. Links work and open in a new tab. Rest on a link and it shows you the site it goes to. A link pointing anywhere but a web page, an email address or a phone number keeps its words and stops being clickable.
- **A plain message with no styling.** Lines the sender quoted from an older message fold behind `Quoted text (12 lines)` once there are more than three. Everything after their sign-off line folds behind `Signature`. Click either one to open it.
- **Attachments.** Under the message, when there are any.
- **On a phone,** the list is hidden while a message is open and `← Back to list` sits above the pane. Click it to go back.
- **Before you pick anything,** you see `Pick a message to read it.` under a magnifier. On a phone that pane stays hidden until you open a message.

## How to answer the message

1. Click {button:Reply|outline} to write back to the sender, {button:Reply all|outline} to write to everyone on it, or {button:Forward|outline} to send it on to somebody new.
2. The draft opens in this pane and the message you are answering leaves the screen. The words you are answering are quoted inside the draft.
3. Close the draft and the message comes straight back.

`Reply all` writes to the people copied in as well, even though this page does not show you who they are. Check the addresses in the draft before you send.

## How to mark, flag, archive or trash it

1. Click {button:Read|ghost}, {button:Flag|ghost}, {button:Archive|ghost} or {button:Trash|ghost}.
2. Every button in the row grays out while one is working, and a spinner turns at the left. Nothing on screen changes until your mail server has answered, so what you see is what your mailbox really holds.
3. Marking read or flagging leaves the message open and flips the button. You see `Marked read`, `Marked unread`, `Flagged` or `Flag removed`.
4. Archiving or trashing closes the message. You see `Archived` or `Moved to trash`, and the pane goes back to `Pick a message to read it.`

Trash is not delete. The message goes to your Trash folder and nothing on this page destroys it.

## How to show the pictures in a message

1. A message with pictures loaded from the internet opens with them held back. The bar reads `Images are blocked so the sender can't tell you opened this.`
2. Click `Show images`. The bar goes and the pictures appear.
3. Even then your browser never asks the sender for anything. We fetch each picture for you, so all the sender can learn is that somebody opened the message, never who or where from.

The decision lasts for this look at this message and nothing more. There is no way to hide the pictures again short of opening the message afresh, and no way to tell us to always trust a sender. Move to another message and the block is back on.

Pictures the sender put inside the message itself always show. They came in the same envelope and asking for them tells nobody anything. A picture we cannot fetch, or one over 5 MB, shows as a broken image with no explanation.

## How to save an attachment

1. Look under the message for a paperclip and a count, such as `1 attachment` or `4 attachments`.
2. Each file is a chip showing its name and its size. A very long name is cut to 120 characters. Sizes are always in `KB`, so a 42 MB video reads `43008 KB` and a tiny file reads `1 KB`.
3. A program, a web page or anything else that could run on your machine carries {badge:Risky|secondary}. You can still download it. Nothing here opens it, and no browser will run it straight from Yosher. Be sure you know the sender.
4. Click the chip. The file downloads. It never opens inside Yosher.

A download link is good for twenty-four hours from the moment the page loaded. After that, reload the page and click again. A file over 50 MB will not come down at all, and the download fails with nothing said. Get that one from your phone or from Outlook.

## Messages

| Message | What it means |
| --- | --- |
| `Pick a message to read it.` | Nothing is open. Click a row in the list. |
| `No subject` | The sender left the subject blank. |
| `This message has no text — check its attachments.` | The message carried no words at all. Whatever was sent is in the attachments. |
| `This message was shortened because it is unusually large. Open it in your mail app to see all of it.` | The mail server cut the message off. We show what it gave us. Nothing here shows the rest. |
| `Images are blocked so the sender can't tell you opened this.` | Click `Show images` to see them. |
| `Quoted text (12 lines)` | An older message quoted underneath, folded away. Click it to open. |
| `Signature` | The sender's sign-off, folded away. Click it to open. |
| `No longer available` | A chip whose record has been deleted, or which you are not allowed to see. The two read the same on purpose. |
| `That message no longer exists.` | The message was moved or deleted somewhere else while you had it open. |
| `That folder no longer exists.` | Your Archive or Trash folder has been removed. |
| `Couldn't reach the mail server. Your mail is safe — try again shortly.` | A hiccup between us and your mail server. Nothing was lost. Try again. |
| `This mailbox needs to be reconnected before it can be read again.` | Sign in to the mailbox again. See [Connecting your mailbox](connect.md). |
| `Accountant access is read-only — reviews, sign-offs and exports only.` | An accountant pressed a button in Mail. |

## Not on this page

You cannot see who was copied in. Cc and Bcc are never shown here. Click {button:Reply all|outline} and the draft fills in everyone it will write to.

One message shows at a time. Earlier messages in the same conversation are not stacked under it and there is nothing to expand.

Opening a message does not mark it read. An unread message stays bold in the list until you press {button:Read|ghost}.

There is no print, no way to look at the raw message, and no snooze or label button here. `Snooze` and `Label` are on the list instead: check the message's box and use the bar that appears. See [Sorting mail](sorting.md). Nothing anywhere in Mail reports a sender as junk.

There is no preview of an attachment, no thumbnail, and no way to put one attachment into Documents by itself. Filing the whole conversation, which files every attachment with it, is in [Attaching an email to your records](records.md).

Once you click inside the message text the keyboard shortcuts stop reaching the page. {kbd:j}, {kbd:e} and {kbd:Esc} do nothing until you click outside the message again.

Ask us if you need any of these.

## Who can do what

Owners and staff see exactly the same page and can use every button on it. A shared mailbox someone has given you changes nothing here. Your outside accountant gets no mail at all: the message never loads, and every button answers `Accountant access is read-only — reviews, sign-offs and exports only.`
