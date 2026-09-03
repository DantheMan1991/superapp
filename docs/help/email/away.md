# Automatic reply

> Set the reply people get while nobody is answering this mailbox: the days it runs, the subject and the message. Turn it off again from the same place.
> **Route:** /dashboard/m/email?away=1
> **Order:** 100
> **Area:** Rules and replies

Open **Mail** in the sidebar, then click `Auto-reply` in the row along the top of the page. The form opens where you normally read a message, and your folders and message list stay beside it. Check `Reply automatically to incoming mail`, write the message, then click {button:Save|primary}. Your mail server holds this setting and sends the replies, so they go out whether or not anyone is signed in, and whatever you have open on your phone.

## What you see

- **`Auto-reply` in the top row.** Click it to open this form. It only reads that way while no reply is set, and it is hidden on a narrow screen. See the pills below for the other wordings.
- **The pill in the top row when a reply is set.** It is the reminder that something is going out in your name, so it sits on every Mail screen, not only this one. Click it to open the form.
  - `Auto-reply on` in amber. Replies are going out now. When you set an end date, the date follows the words.
  - `Auto-reply from` in gray, with the date. You set a start date and it has not arrived yet. Nothing is being sent.
  - `Auto-reply finished` in gray. The box is still checked, but the end date has passed, so nothing is being sent.
  - Nothing at all, not even the plain `Auto-reply` link. Your mail server would not answer when Mail asked, and saying it is off would be a claim nobody can back. Reload the page in a minute and the way in comes back.
- **`Close`** at the top right of the form. Goes back to your mail without saving. While this form is open, clicking a message in the list beside it highlights that row and nothing else, because the form keeps the pane. Click `Close` first.
- **The shared mailbox notice**, in amber, only on a mailbox you share with colleagues. It reads `[address] is a shared mailbox.` and `The mail server keeps one auto-reply per mailbox, so saving this sets it for everyone who uses this address — and replaces whatever a colleague set.` There is one reply per address, so what you save answers every message that arrives at it, whoever wrote to it.
- **The overwrite warning**, in amber, only when your mail server would not say what is already set: `The mail server didn't say what the current setting is, so this form is showing an empty one. Saving it will overwrite whatever is actually there.` Click `Close` and come back in a moment rather than saving over something you cannot see.
- **`Reply automatically to incoming mail`.** The checkbox that turns the whole thing on. Under it: `The mail server sends these, so they go out whether or not anyone is signed in.`
- **`Start`.** The date and time replies begin. Type it or use your browser's date picker. Under it: `Leave blank to start now.`
- **`End`.** The date and time replies stop. Under it: `Leave blank and it runs until you turn it off.` Blank means blank, and nothing turns it off for you.
- **`Subject`.** The subject line on the reply, up to 200 characters. The gray text in the empty box reads `Out of the office`. Leave it blank and no subject is sent, so your mail server decides what to put there.
- **`Message`.** What people get, up to 4,000 characters. The gray text in the empty box reads `Thanks for your message. I'm away until…`. Under it: `Plain text. Everyone who writes to you sees this, including people you have never met.` There is no formatting, no signature and no attachment.
- **The line above the buttons**, in gray, once the box is checked and there is nothing wrong with what you typed:
  - `Replying to everyone, until you turn this off.` when you set no end date.
  - `Replying to everyone until [date and time].` when you set one.
  - `Nothing will send until [date and time].` when your start date is still ahead.
  - Nothing, when the end date has already passed. Look for the red line instead.
- **Red text under the fields.** What is wrong with the dates or the message. {button:Save|primary} stays grayed out until you fix it. The wordings are in Messages below.
- **{button:Save|primary} and `Cancel`.** Save writes the setting to your mail server. `Cancel` leaves without saving.

## How to turn on an automatic reply

1. Click `Auto-reply` in the top row of Mail.
2. Check `Reply automatically to incoming mail`.
3. Type the `Subject` people will see, such as `Out of the office`. You can leave it blank.
4. Type the `Message`. Say when you are back and who to contact meanwhile. Keep in mind that strangers and anyone who has your address get this word for word.
5. Leave `Start` and `End` blank if you want it running from now until you stop it. To set them, see below.
6. Read the gray line above the buttons. It tells you what your mail server will do.
7. Click {button:Save|primary}. You see `Auto-reply is on.` The form stays open, and the top row now shows the amber `Auto-reply on` pill.

Replies begin as soon as your mail server accepts the setting. The setting itself lives on the mail server and not in Yosher, so it keeps running exactly as you left it whether or not anybody opens Mail again.

## How to set the days it runs

1. Fill in `Start` with the date and time replies should begin. Leave it blank to begin the moment you save.
2. Fill in `End` with the date and time they should stop. This is the field worth filling in, because a blank one keeps answering your customers until somebody comes back and unchecks the box.
3. Both fields take your own clock time, not anyone else's.
4. Check the gray line above the buttons, then click {button:Save|primary}.
5. Before the start date, the top row shows `Auto-reply from` with the date. Between the two dates it shows `Auto-reply on` and the end date.

An end date that has already gone by is refused while you are still looking at the form. Change it, clear it, or uncheck the box.

## How to turn it off again

1. Click the pill in the top row of Mail. The form opens with what is currently set.
2. Uncheck `Reply automatically to incoming mail`.
3. Click {button:Save|primary}. You see `Auto-reply is off.` The pill goes, and the plain `Auto-reply` link takes its place.

Your dates, subject and message are saved as they are, so checking the box again next time reuses them. If the box is checked and the end date has passed, red text blocks {button:Save|primary}. Unchecking the box clears the red text, because nothing is checked on a reply that is switched off.

## Messages

| Message | What it means |
| --- | --- |
| `Auto-reply is on.` | Saved, with the box checked. What happens next is the gray line you read before saving. |
| `Auto-reply is off.` | Saved, with the box unchecked. Nothing more goes out. |
| `Write the message people will get.` | The box is checked and the message is empty. An empty reply to everyone who writes is worse than no reply. |
| `That end date has already passed, so this would never send.` | Your end date is in the past. It would save and then never send anything. |
| `The end has to come after the start.` | The two dates are the wrong way round. |
| `That end date isn't a date.` | The end date could not be read. Clear the field and pick it again. |
| `Keep it under 4,000 characters.` and `Keep the subject under 200 characters.` | The boxes stop you at those lengths, so you rarely see these. |
| `Invalid input` | The form sent something the server would not accept. Reload Mail and try again. |
| `That mailbox isn't connected.` | This mailbox is no longer connected to Yosher. See [Connecting your mailbox](connect.md). |
| `This mailbox needs to be reconnected before it can be read again.` | Your sign-in for this mailbox has run out. Reconnect it, then set the reply again. |
| `Couldn't reach the mail server. Your mail is safe — try again shortly.` | Nothing was saved. Whatever was set before is still set. Try again in a minute. |
| `That mailbox is out of space.` | Your mail server refused the change. Clear some mail out, then save again. |
| `The mail server rejected that message as malformed.` | Your mail server would not accept the subject or the message as typed. Shorten it, take out anything pasted in, and save again. |
| `The mail server refused that message ([reason]).` | Your mail server declined and gave its own reason. Tell us the wording in the brackets. |
| `Accountant access is read-only — reviews, sign-offs and exports only.` | An accountant cannot save anything in Mail. |
| `Something went wrong. Please try again.` | Nothing was saved. Try again, and tell us if it keeps happening. |

## Not on this page

Everyone who writes to the address gets the reply while the window is open, including people you have never met. There is no setting for replying only to people you know, and no separate wording for people outside the business. How long your mail server waits before answering the same person a second time is its own decision, and nothing here changes it.

This form only ever writes the plain text version of the reply. If a formatted one was set from another mail program before, this leaves it alone, and a mail server that prefers formatted mail can keep sending that older wording. Ask us to clear it.

There is no preview, no test send, and no list of who has been answered. One mailbox holds one automatic reply, so you cannot set a different one for a second address you send from.

While a reply is switched off, the way into this form is hidden on a phone-width screen. Open Mail on a computer, or widen the window, to turn one on. Once it is on, the pill shows at every width.

Rules that file mail as it arrives are in [Rules](rules.md). The wording added to the bottom of messages you send is in [Your signature](signature.md). Copying attachments into Documents is in [Automatic filing](filing.md).

## Who can do what

Owners and staff do exactly the same thing here, each on their own mailbox. There is no owner-only field on this form. On a mailbox shared with colleagues, the reply belongs to the address, so what you save is what everyone writing to it gets, and it replaces whatever a colleague set. An accountant cannot save anything in Mail, and {button:Save|primary} answers `Accountant access is read-only — reviews, sign-offs and exports only.`
