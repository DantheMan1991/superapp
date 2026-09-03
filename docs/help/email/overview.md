# Mail at a glance

> Your business mailbox, read and written here. What the three panes hold, what every link in the top bar does, how new mail reaches you, and which guide covers which screen.
> **Route:** /dashboard/m/email/**
> **Order:** 0

Open **Mail** in the sidebar. Your folders are on the left, your conversations in the middle, and the message you picked on the right. Mail is one screen, and every folder, search, message and settings form opens inside it. Your mail keeps living on your own mail server, so a message you read, file, flag or send here looks the same later in Outlook and on your phone. To start a message, click {button:Write|outline|pen-square}.

## What you see

- **The `Mail` row in the sidebar.** It carries the number of unread conversations in your Inbox, or `99+` above ninety-nine. A dot in place of the number means a mailbox needs reconnecting. The number is written by the last check, so it can be ten minutes behind.
- **The top bar.** Across the top of Mail, left to right: the word `Mail`, {button:Write|outline|pen-square}, the auto-reply link, the `Shared` pill, `Rules`, `Signature`, `Templates`, `Filing`, the search box, {button:Advanced|ghost|filter}, and the {icon:circle-question-mark} that opens this help. It never names the address you are reading.
- **{button:Write|outline|pen-square}.** Opens a blank message in the right pane, in place of whatever was there. See [Writing a message](compose.md).
- **The auto-reply link.** It reads `Auto-reply` when nothing is going out. While a reply is going out it turns amber and reads `Auto-reply on`, followed by `until` and the day it stops when you set an end date. Before a start date you set, it reads `Auto-reply from` and that day. After the end date it reads `Auto-reply finished`, which means it is switched on and answering nobody. Click any of them to open the form. See [Automatic reply](away.md). If the mail server will not answer the question, nothing shows here at all.
- **`Shared`.** Shows only when the address you are reading belongs to the whole business rather than to you. Hold the pointer over it to read `[address] is a shared mailbox. Settings here apply to everyone who uses it.`
- **`Rules`.** Opens the rules that sort mail as it arrives. See [Rules](rules.md). It is missing on a shared mailbox, because one set of rules covers the address and yours would replace a colleague's.
- **`Signature`.** Opens the wording added to the bottom of what you send. See [Your signature](signature.md).
- **`Templates`.** Opens the messages you write once and reuse. See [Templates](templates.md).
- **`Filing`.** Opens the rules that copy mail into Documents on their own. See [Automatic filing](filing.md).
- **The search box.** `Search mail…`, up to 200 characters. Press {kbd:Enter} and it searches every folder, not the one you are in. See [Finding a message](search.md).
- **{button:Advanced|ghost|filter}.** Opens a small panel for searching by sender, recipient, subject, words in the message, folder and dates. It turns gray while any of those but `Folder` is filled in.
- **The folder list.** Every folder your mail server lets you read, the standard ones first, then yours by name. A folder holding unread mail shows how many messages are unread, so the Inbox number here can differ from the sidebar one, which counts conversations. Under the folders, {button:New folder|ghost|folder-plus}, and then your saved views. See [Your mailbox](mailbox.md).
- **The conversation list.** One row per conversation, newest first, forty at a time. Above it the filters `Unread`, `Flagged` and `Has files`. See [Your mailbox](mailbox.md) to read it and [Sorting mail](sorting.md) to act on it.
- **The reading pane.** The message you picked, with {button:Reply|outline}, {button:Forward|outline} and the controls for filing it and attaching it to a record. Until you pick one it reads `Pick a message to read it.` See [Reading a message](message.md).
- **On a phone.** The folders become a row across the top, and you see either the list or the message, never both. Open a message and `← Back to list` appears above it. Any screen narrower than a laptop stacks the panes the same way.

## How to tell when new mail has arrived

1. Leave Mail open. While its tab is the one in front, it checks about every 45 seconds.
2. On a second monitor, where Mail is visible but you are typing somewhere else, it checks every 2 minutes.
3. After three checks in a row that find nothing, it slows to at least 90 seconds.
4. A hidden tab does not check at all. Come back to it and it checks straight away.
5. New mail appears in place. The folder counts and the list update themselves, and nothing reloads.

Mail is not pushed to you. One check per mailbox is allowed each minute, so a message can be about a minute old before it appears. With no tab open, mail is checked in the background about every ten minutes, which is also when snoozed messages come back and scheduled messages go out. When the mail server refuses a check, Mail waits longer each time, up to five minutes. When your access is the problem it stops checking until you reload the page.

## How to reconnect a mailbox

1. When Mail cannot open your mailbox, the whole screen is replaced by one line saying what went wrong. There are no folders, no search and no way back on that page, so use your browser's back button when you are done.
2. If it reads `This mailbox needs to be reconnected.`, click {button:Reconnect this mailbox|primary}. Your mail server asks you to approve Yosher again, and you land back in your inbox.
3. If it reads `You no longer have access to this mailbox. Ask whoever administers it to grant it again.`, there is no button, and reconnecting would change nothing. Whoever runs the mail server took the access away and only they can give it back. Nobody can grant it from inside Yosher.
4. Anything else about the mail server is usually a moment's trouble. Wait and reload.

Connecting a mailbox for the first time is a different job. See [Connecting your mailbox](connect.md).

## How to find the guide for a screen

Press the {icon:circle-question-mark} in the top bar and the guide for what you have open appears beside it, with the page still usable. These are the rest:

- [Your mailbox](mailbox.md). The folder list, the conversation list, the filters and saved views.
- [Sorting mail](sorting.md). Flagging, archiving, snoozing, labeling, and acting on several messages at once.
- [Reading a message](message.md). The reading pane, attachments, blocked pictures, and replying.
- [Finding a message](search.md). The search box, the advanced panel, and what a search covers.
- [Writing a message](compose.md). The composer, attachments, scheduling a send, and what happens after you send.
- [Templates](templates.md). Messages you write once, and the blanks that fill themselves in.
- [Your signature](signature.md). What goes on the bottom of what you send.
- [Rules](rules.md). Sorting mail as it arrives, on the mail server, whether or not you are here.
- [Automatic filing](filing.md). Copying mail from a sender straight into a folder in Documents.
- [Automatic reply](away.md). The reply that goes out while you are away, and when it stops.
- [Attaching an email to your records](records.md). Putting a conversation on an invoice, a bill or a contact.
- [Connecting your mailbox](connect.md). Connecting, disconnecting, and what `Shared` means.

## Messages

| Message | What it means |
| --- | --- |
| `Reading mail isn't switched on yet` | Reading mail has not been set up for your business. Ask us. |
| `No mailboxes yet` | Your business has no addresses on its own domain yet. An owner creates them in [Email setup](/dashboard/email). |
| `This mailbox needs to be reconnected.` | Your approval expired or was withdrawn. Click {button:Reconnect this mailbox|primary}. |
| `You no longer have access to this mailbox. Ask whoever administers it to grant it again.` | Access to a shared address was taken away at the mail server. Reconnecting will not help. |
| `Reading mail isn't configured on this server.` | The connection between Yosher and the mail server is not set up. Ask us. |
| `Couldn't reach the mail server.` | The mail server did not answer. Your mail is safe. Reload in a moment. |
| `The mail server didn't respond in time.` | The same, after twenty seconds of waiting. Reload. |
| `The mail server refused that request ([reason]).` | The mail server answered with an error. In the brackets is its own code for it, sometimes a number and sometimes a word. Reload, and tell us if it keeps happening. |
| `The mail server returned no folders.` | The mailbox opened but gave nothing back. Reload. |
| `Couldn't reach the mail server. Your mail is safe — try again shortly.` | Something you clicked could not reach the mail server. Nothing was changed. Try again. |
| `This mailbox needs to be reconnected before it can be read again.` | The same as `This mailbox needs to be reconnected.`, shown when you click something rather than when the page loads. |
| `Accountant access is read-only — reviews, sign-offs and exports only.` | An accountant pressed something in Mail. Mail is not part of what an accountant is given. |

## Not on this page

Only one mailbox is read, and it is always the connected address that comes first alphabetically. There is no mailbox switcher, so connecting a second address gives you no way to open it. Once a mailbox is connected there is no link back to the list of mailboxes either, and adding `?setup=1` to the end of the web address is the only way back to it.

Connecting tells you nothing when it works and nothing when it fails. You land back on the Mail page either way, and the reason sits in the address bar rather than on the screen.

`Rules`, `Signature`, `Templates`, `Filing` and the `Auto-reply` link while it is off are all hidden on a narrow phone screen. Use a wider screen to reach those five. Templates are the one part of Mail kept here rather than on the mail server, so they never appear on your phone or in Outlook.

Folders can be made but not renamed, moved or deleted. Ask us if you need any of this.

## Who can do what

Owners and staff get exactly the same Mail. Nothing inside it is owner-only. What only an owner can do is create the addresses in the first place, in [Email setup](/dashboard/email).

Everyone connects their own mailbox, and everything personal stays personal. Your saved views, rules, snoozed messages, scheduled sends and filing rules are yours, and a colleague cannot see them or your mail. A shared address is the exception, because everyone connected to it reads the same mail. What a colleague can see otherwise is what somebody attached to a record on purpose, which files a copy into Documents for the whole business.

Your accountant gets no Mail at all. No unread count, no `Email` card on an invoice or a bill, and nothing to read. The pages still open for them, and everything they press answers `Accountant access is read-only — reviews, sign-offs and exports only.`
