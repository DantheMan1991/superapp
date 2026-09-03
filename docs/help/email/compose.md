# Writing a message

> Write a new message, or answer one you are reading, then send it now or later.
> **Route:** /dashboard/m/email?compose
> **Order:** 50
> **Area:** Writing

Click {button:Write|outline|pen-square} at the top of Mail to start a new message. On a message you are reading, click {button:Reply|outline}, {button:Reply all|outline} or {button:Forward|outline}. The writing pane takes over the reading pane, so the message you are answering is hidden while you write. Nothing you type is kept anywhere until you send it.

## What you see

- **The title, and `Close`.** The title reads `New message`, `Reply`, `Reply all` or `Forward`, whichever you clicked. `Close` sits at the top right and throws away everything you typed.
- **`To`, with `Cc` and `Bcc` beside it.** Where the message goes. The box reads `Start typing a name or address` while it is empty. Click `Cc` or `Bcc` to show that row.
- **`Subject`.** One line, no limit on screen. Anything over 998 characters is refused at send.
- **The formatting toolbar and the writing area.** A strip of buttons over a blank first line, your signature under it, and on a reply or a forward the older message under that.
- **Attachment chips.** One rounded chip per file you attach, with its name, its size in KB, and {icon:x} to take it off.
- **The buttons along the bottom.** {button:Send|primary|send} and its clock half, {button:Template|outline|file-text}, {button:Attach|outline|paperclip} and {button:Plain text|outline}. All four stop working while a message is going out or a file is going up. On a narrow phone screen the words `Write` and `Template` drop off and you see only the icon.

## How to start a message

1. Click {button:Write|outline|pen-square} for a blank message. `To`, `Subject` and the body are empty apart from your signature.
2. Click {button:Reply|outline} on a message to answer the sender. `To` is filled with the address the sender asked answers to go to, or the address it came from. Your own address is left out.
3. Click {button:Reply all|outline} to answer everyone. The sender and the people in the original `To` all go in `To`, the original `Cc` goes into `Cc`, and that row is already showing. This button appears only when the message went to more than one address.
4. Click {button:Forward|outline} to pass it on. `To` and `Cc` start empty on purpose, so a private thread is never sent back to the people it was about.

A reply fills `Subject` with `Re: ` and the original subject, with any earlier `Re:` or `Fwd:` taken off first. A forward uses `Fwd: `. Replying to a message you sent yourself addresses it to the people you wrote to. Under your signature, a reply carries a line like `On 2026-07-28 21:12 UTC, Dana Rowe <dana@example.com> wrote:` and then the old message. A forward carries a block starting `---------- Forwarded message ----------` with the sender, date, subject and recipients. The old message is quoted as plain words only. Its pictures, colors and layout are not carried over, and a very long one is cut at 50,000 characters and ends `[…]`.

Answer a message that has since been moved or deleted somewhere else and the pane opens empty, still titled `Reply`. Nothing tells you why. Close it, open the message again, and reply from there.

Your signature comes from the mail account for the address you send from. Change it in [Your signature](signature.md). There is no way to leave it off for one message.

## How to address it

1. Type a name or an address in `To`. After two characters, suggestions appear under the box, eight at most.
2. Suggestions come from three places. People from your recent mail, marked `Emailed today`, `Emailed this week`, `Emailed this month`, `Emailed this year` or `Emailed before`, which includes anyone who only ever wrote to you. Your business records, such as a customer or a vendor, marked with what they are. Your mail account's own address book, marked with the contact's organization or `Address book`.
3. Press {kbd:Down} and {kbd:Up} to move, {kbd:Enter} or {kbd:Tab} to take the one you want, {kbd:Escape} to hide the list. Enter never sends the message while the list is open.
4. Taking a suggestion puts `Name <address>` in the box and a comma after it, ready for the next name.
5. To write to several people, separate them with commas. Paste a list from a spreadsheet or from Outlook and both commas and semicolons are read as separators. A name holding a comma has to be in quotes, as in `"Smith, John" <j@z.test>`. To take somebody off, delete their text from the box.
6. Click `Cc` or `Bcc` to show that row. Neither row can be hidden again once you have shown it, so close the pane and start over if you opened one by mistake.

Anyone already in `To`, `Cc` or `Bcc` is left out of the suggestions. Nothing here checks an address. A name typed with no address is refused when you press send, not before.

## How to format what you write

Every icon on the toolbar names itself when you hover over it.

1. `Font` and `Size` open short lists. Nine faces, from `Sans Serif` to `Verdana`, each shown in its own face. Four sizes, `Small`, `Normal`, `Large` and `Huge`, each shown at its own size.
2. {button:Undo|ghost|undo} and {button:Redo|ghost} step back and forward, the same as {kbd:Ctrl+Z} and {kbd:Ctrl+Y}.
3. {button:Bold|ghost}, {button:Italic|ghost}, {button:Underline|ghost} and {button:Strikethrough|ghost}, with {kbd:Ctrl+B}, {kbd:Ctrl+I} and {kbd:Ctrl+U} for the first three.
4. {button:Text and highlight colour|ghost} opens two grids of the same 36 colors, headed `Text` and `Highlight`. Hover a square to see its color code.
5. {button:Align|ghost} offers `Align left`, `Align centre` and `Align right`. There is no justified setting.
6. {button:Bulleted list|ghost|list} and {button:Numbered list|ghost}, with {kbd:Ctrl+Shift+8} and {kbd:Ctrl+Shift+7}. {button:Decrease indent|ghost} and {button:Increase indent|ghost} move a paragraph sideways, and {button:Quote|ghost} marks it as a quotation, which the reader sees as a bar down the side.
7. {button:Insert link|ghost|link-2}, or {kbd:Ctrl+K}, opens a strip with `Text to show` and `example.com or name@example.com`. Select a word first and it fills `Text to show` for you. Click {button:Add|ghost} to put the link in, or {button:Cancel|ghost} to drop it. A bare web address gets `https://` and a bare email address becomes a mail link. Anything else is refused with nothing on screen to say so, so check that the link appeared. {button:Remove link|ghost} takes a link off again.
8. {button:Insert emoji|ghost} opens 300 emoji in seven groups with a `Search emoji` box over them. {button:Clear formatting|ghost} strips the formatting off whatever you have selected.

Pasting always arrives as plain words. Formatting, pictures and layout from Word, a web page or another email are dropped, and nothing on screen warns you first. A picture on the clipboard is dropped too.

Each panel closes when you choose something, press {kbd:Escape}, or click the same button again. Clicking elsewhere does not close it.

## How to write in plain text

1. Click {button:Plain text|outline}. The toolbar goes and what you have written carries over as plain words.
2. Do not click {button:Rich text|outline} to go back. It does not return what you typed. The writing area comes back holding the message exactly as it was when the pane opened, and everything you have written since is gone for good.

## How to put a picture in the message

1. Click {button:Insert picture|ghost|image-plus} on the toolbar. A panel opens with two tabs, `Upload` and `From Documents`.
2. On `Upload`, click {button:Choose a picture|outline}. It reads `Adding…` while it works. The note under it reads `PNG, JPEG, GIF or WebP, up to 10 MB.` Pick several at once if you like. Each one is checked on its own. The panel closes afterwards either way.
3. On `From Documents`, type in `Search your files`. Results are grouped by where the file came from, 24 per group, and an empty box lists the most recent. You see only the files you are allowed to see.
4. Click a result and the picture drops in where your cursor was.

Up to 20 pictures go in one message. A photo is sent at its full size, so a 9 MB picture off a phone leaves as 9 MB. Delete a picture from the body and it is not sent. There is no option to point at a picture on the web, because that would track the person reading your message.

## How to attach files

1. Click {button:Attach|outline|paperclip} and pick one or more files. Any kind of file is accepted.
2. Each file goes up in turn and appears as a chip under the message.
3. To take one off, click {icon:x} on its chip. That removes it from this message only.

One file can be up to 30 MB, and one message can carry 25 files. Your mail provider may allow less.

## How to use a saved reply

Click {button:Template|outline|file-text} and pick one. It drops in where your cursor is rather than replacing what you have written, and it fills `Subject` only when `Subject` is still empty. In plain text it is added at the end instead. A template that names one of your records asks which one first. See [Templates](templates.md). The button is not there at all when your business has saved none.

## How to send it

1. Click {button:Send|primary|send}.
2. The pane closes at once and you land back on the message or folder you came from.
3. You see `Sending in 15s…` with an `Undo` next to it.
4. Leave it alone for fifteen seconds and you see `Sent.` The message moves out of `Drafts` and into `Sent`.
5. Click `Undo` and you see `Not sent.` The message is destroyed and nothing is left behind.

Closing the tab during those fifteen seconds leaves the finished message sitting in `Drafts`, unsent. There is no keyboard shortcut for sending, and pressing {kbd:Enter} in `Subject` does nothing.

## How to send it later

1. Click {button:Schedule send|primary|clock}, the clock half of the send button. A short list opens headed `Send later`, with the time each choice means on the right.
2. `Later today` is the top of the hour three hours from now. It only appears while that is still today and before 19:00.
3. `Tomorrow morning` is 08:00 tomorrow. `Monday morning` is 08:00 next Monday, never today.
4. For anything else, use `Or pick a time`, fill in the date and time box, and click {button:Set|outline}. `Set` stays gray until the time works.
5. The pane closes and you see `Scheduled for` followed by the day and time you chose.

Times are read from your own computer's clock. Yosher looks for messages that are due every ten minutes and sends up to 50 each time.

## How to close without sending

Click `Close`, or the back button. Everything you typed is gone. Clicking a folder or another message leaves the writing pane open and empties it, which loses what you typed the same way. Nothing is saved as a draft while you write, and there is no button that saves one.

## Messages

| Message | What it means |
| --- | --- |
| `Add at least one recipient.` | `To` is empty, or holds nothing that reads as an address. |
| `Couldn't read: [what you typed]` | Part of `To`, `Cc` or `Bcc` is not an address. Usually a name typed with no address after it. Nothing was sent. |
| `That doesn't look like an email address.` | One of the addresses was refused. You also see this when you have put more than 100 people in one of the three rows. |
| `Couldn't prepare that message.` | Yosher could not build the message. Nothing was sent, and what you typed is still in the pane. |
| `This message still has {{recipient.name}} in it. Fill those in before sending — a template was inserted before there was anything to fill them from.` | A saved reply left a blank in the message. Delete the words in braces or fill them in, then send again. |
| `The mail server wouldn't send that message. Nothing was delivered — check Drafts.` | The send was refused. It also means you went over a limit: more than 25 files, more than 20 pictures, a subject over 998 characters, or a message body over 500,000 characters. |
| `This mailbox can't send from inside Yosher — the mail server didn't grant permission to. Reconnect it, or send from your phone or Outlook.` | The connection allows reading but not sending. See [Connecting your mailbox](connect.md). |
| `This mailbox has no Drafts folder, so there's nowhere to compose from.` | Every message is written as a draft first, so this mailbox cannot be written from. |
| `This mailbox needs to be reconnected before it can be read again.` | Sign in to the mailbox again. |
| `Couldn't reach the mail server. Your mail is safe — try again shortly.` | A temporary fault. Your typing is still in the pane. |
| `That mailbox isn't connected.` | The mailbox is gone, or it was never yours. |
| `Sending is switched off in this environment.` | You are on a test copy of Yosher, not the live one. Nothing was sent. |
| `Held back. The message is in your drafts.` | You clicked `Undo` and the message was stopped, but the copy in `Drafts` could not be cleared away. Delete it there. |
| `[the reason] The message is still in your drafts.` | The fifteen seconds ran out and the send then failed. Nothing went out. Open `Drafts` and try again. |
| `Up to 90 days ahead.`, `Pick a time at least a minute away.` or `Pick a time in the future.` | The time under `Or pick a time` cannot be used. `Set` stays gray until you fix it. |
| `That attachment is too large.` | The file is over 30 MB. |
| `That file is empty.`, `Couldn't attach [file name].` or `Couldn't add [file name].` | The file has nothing in it, or the mail server refused it and gave no reason. |
| `[file name] is not an image we can put in a message.` or `[file name] can't be shown in the message body.` | Only PNG, JPEG, GIF and WebP go in the body. Attach anything else instead. |
| `[file name] is too large to put in a message.` | A picture in the body has to be under 10 MB. Attach it instead. |
| `No pictures match “[what you typed]”.` or `No pictures in your files yet.` | Nothing you typed matched, or there are no pictures at all in the files you can reach. |
| `Nothing matches “[what you typed]”.` | No emoji matched what you typed in `Search emoji`. |
| `Not production: this will be delivered only to [address], whatever the To line says.` | You are on a test copy. Nothing reaches the people in `To`. |
| `Sent — delivered only to [address] (not production).` | The message went out on a test copy, so it reached only that one address. |
| `Accountant access is read-only — reviews, sign-offs and exports only.` | Your outside accountant cannot send mail. |

## Not on this page

Nothing is saved as you write, and there is no draft to come back to. A message you have scheduled is not listed anywhere and cannot be canceled once the pane has closed, so ask us if you need one stopped. A failed scheduled send tells nobody. Once you have shown `Cc` or `Bcc` you cannot hide it again. There is no key that sends, no way to turn off your signature for one message, and no counter warning you before you go over a limit. Templates are managed in [Templates](templates.md). Filing a conversation against a customer or an invoice is in [Attaching an email to your records](records.md). The message you are answering is described in [Reading a message](message.md).

## Who can do what

Owners and staff write, attach, insert pictures, send and schedule in exactly the same way. In `From Documents`, an owner also sees pictures in owners-only folders. On a shared mailbox everything here works the same, and a reply leaves out the shared address rather than your own, so writing from a shared address never copies it back to itself. Your outside accountant cannot send anything from Mail, and {button:Send|primary|send} answers `Accountant access is read-only — reviews, sign-offs and exports only.`
