# Attaching an email to your records

> Tie the conversation you have open to the invoice, bill, customer, file or folder it is about, and draft an invoice or a bill from what was agreed in it.
> **Route:** /dashboard/m/email?message
> **Order:** 110
> **Area:** Records

Open a message. Under the buttons at the top of it you see what this conversation is already attached to, and the way to attach it to something else. Click {button:Attach to…|outline|link-2} to pick a record. The rest of the open message is in [Reading a message](message.md), replying is in [Writing a message](compose.md), and attachments that file themselves are in [Automatic filing](filing.md).

## What you see

- **What this conversation is attached to.** A row of chips, newest first. The row is there even when nothing is attached.
- **A chip.** An icon for the kind of record, then its name. Click the name to open it. An invoice reads `Invoice` and the number. A bill reads the vendor's name and the vendor's own number, or `Bill from` and the vendor's name when the vendor gave no number. A customer or vendor chip opens the whole customer or vendor list rather than that one record. The chip for a filed copy opens the folder it sits in, or the Documents inbox when it is not in a folder.
- **`No longer available`.** The record was deleted, or you are not allowed to see it. The words are the same either way, and the chip is not a link.
- **{icon:x} on a chip.** Takes that attachment off the conversation. There is no confirmation.
- **{button:Attach to…|outline|link-2}.** Opens the picker. You only have it when your business has Documents, because a copy of the email has to go somewhere everyone can read.
- **`Attaching a conversation needs the Documents module.`** Stands in place of the button when you do not have Documents. Chips attached earlier still show.
- **{button:Draft an invoice|outline|sparkles} and {button:Draft a bill|outline|sparkles}.** Read the conversation and propose a draft record from it. Both are there when your business has Accounting, and neither is there otherwise.

## How to attach this conversation to a record

1. Click {button:Attach to…|outline|link-2}. The dialog `Attach this conversation` opens. It tells you a copy of this email and its attachments is filed into Documents, in the folder you pick or in the Documents inbox otherwise, and that the copy is a snapshot of the message as it is now.
2. Type into the box. Before you type you see `Start typing to find the record this email is about.` While it looks you see `Searching…`.
3. Results come back in groups, up to six of each kind: `Invoices`, `Bills`, `Customers`, `Vendors`, `Contacts`, `Companies`, `Deals`, `Files`, `Folders`. When nothing matches you see `Nothing matched that.`
4. Click a row. It attaches at once, with no second step.
5. You see `Attached. A copy is in the Documents inbox.`, with the folder's name in place of the inbox when you picked a folder. Two chips appear: the record you picked, and the filed copy.

The box reads `Search invoices, bills, customers, files…` whatever your business has switched on, so take it as a hint and not a list. What it really matches: an invoice by its number or its customer's name, a bill by the vendor's own number or the vendor's name, a customer or vendor by name or by an email address on file, a contact or company by its name or its legal name, a deal by its name or who it is with, a file by its title or file name, and a folder by its name. It never reads the email you have open, and it never reads inside a file. A search longer than 120 characters is refused, and all you see is `Nothing matched that.` A kind of record that takes longer than two and a half seconds to answer is left out of the results.

Those nine kinds are the whole list. Nothing else can be attached.

Attaching also files a copy, and that copy is what a colleague can actually read. It is the whole email, filed into Documents with `.eml` on the end. Its title is the subject, or `(no subject)`. Its file name is the subject cut to 80 characters, or `message.eml` when there is no subject. Every attachment that is not part of the message's own layout is filed as a file of its own beside it. What the message says is stored with the copy, so Documents search finds it by its words. Attach to a folder and all of it goes in that folder, which means a copy filed into an owners-only folder is hidden from staff. Attach to anything else and it goes to the Documents inbox.

Attaching the same message a second time never makes a second copy. You see `Attached. A copy was already filed — it's in the Documents inbox.` A copy still sitting in the Documents inbox moves to the folder you now pick. A copy somebody already put in a folder stays there, and the sentence names that instead: `it's in the folder it was already filed in.` when you picked a folder, and `it's in Documents.` when you picked anything else.

The message itself can be up to 25 MB. One attachment can be up to 20 MB, all of them together up to 40 MB, and the message plus the attachments that are kept up to 60 MB. You see `2 attachments filed too.` for the ones that were filed and `1 couldn't be filed separately — they're still inside the email.` for the ones that were not. Nothing is lost either way, because the whole email is in the copy.

## How to remove an attachment

1. Click {icon:x} on the chip. It goes at once, with no confirmation and no undo.
2. You see `Detached. The filed copy is still in Documents.`
3. The filed copy is not deleted by this. Delete it in Documents if you want it gone.
4. The copy has a chip of its own. Removing that chip only takes the copy off this conversation.

## How to draft an invoice or a bill from a conversation

1. Click {button:Draft an invoice|outline|sparkles} or {button:Draft a bill|outline|sparkles}. The dialog opens and shows `Reading the conversation…`. It reads up to 20 messages of the conversation, oldest first, and 4,000 characters of each. It is also given the names and addresses of up to 200 of your active customers, or vendors for a bill, and nothing else about them.
2. Read the warnings at the top of the dialog when there are any. They tell you what was ambiguous or thrown away.
3. Check `Customer`, or `Supplier` on a bill. You cannot change it here. When nobody matched you see `Not matched to anyone on file — add them first, then draft again.` and {button:Create draft invoice|primary} cannot be clicked. Add the customer or vendor in Accounting, then come back and draft again.
4. Check `Dates`. It shows the date the record will carry, then the due date after an arrow, or `· no due date`.
5. Check every line. A line shows a check box, what it is for, and the quantity and unit price with no currency symbol. Under it are the words it came from, ending with `— message 3` to name the message they were taken from. Up to 40 lines.
6. Lines whose words were found in the message they name are ticked for you. A line whose words were not found arrives unticked and carries {badge:not found in that message|outline}. `No source quoted — check this one yourself.` means the line came with no words at all. The email is behind the dialog, so compare each doubtful line against it. Tick and clear until the list is what you agreed.
7. When nothing in the conversation was an agreement you see `Nothing in this conversation looked like an agreed amount.`
8. Click {button:Create draft invoice|primary}, or {button:Create draft bill|primary}. It reads `Creating…` while it saves.
9. You see `Draft invoice created` and `Nothing has been posted — open it to review and issue.`, and the new draft opens.

Wait 15 seconds between drafts. The wait is for the whole business and covers both buttons, so a colleague drafting starts the clock too.

Nothing reaches your books from here. Every line of a drafted invoice lands on your lowest-numbered active income account, usually `4000 Sales`, so re-point the lines that belong elsewhere. A drafted bill's lines arrive with no account on them at all. The memo on the new record reads `Drafted from an email conversation.`, or `Drafted from an email conversation (2 caveats at drafting).` when the dialog warned you about anything. The conversation is not attached to the new record, so go back to the message and attach it yourself if you want the two tied together.

## How to see the email from the record's own page

1. Open the invoice or the bill.
2. A card headed `Email` lists everything attached to the same conversations, apart from the record you are on. Mostly that is the filed copies. Under the list it reads `Filed copies, captured when each email was attached. Later replies are new messages and have to be attached too.`
3. Click a filed copy to open the folder it is in, or the Documents inbox when it is not in a folder. A row you are not allowed to see reads `No longer available`.

The card is not there when nothing is attached. Only invoices and bills have it. A customer, vendor, contact, company, deal, file or folder shows nothing about email on its own page, however many conversations you attach to it.

## Messages

| Message | What it means |
| --- | --- |
| `Start typing to find the record this email is about.` | The picker is open and the box is empty. |
| `Nothing matched that.` | Nothing you are allowed to see matches those words. Try the number, or the name on the record. |
| `Attached. A copy is in the Documents inbox.` | It worked. The folder's name replaces the inbox when you attached to a folder. |
| `Attached. A copy was already filed — it's in the Documents inbox.` | This message had been filed before. Only the new chip was added. |
| `1 couldn't be filed separately — they're still inside the email.` | An attachment was over its limit, was a kind of file Documents does not take, or the mail server would not hand it over. It is still inside the filed copy. |
| `Detached. The filed copy is still in Documents.` | The chip is gone. The copy stays. |
| `That attachment has already been removed.` | Somebody removed the same chip while your page was open. Reload. |
| `That record no longer exists.` | The record was deleted, or it is not yours to see. |
| `That isn't something a conversation can be attached to.` | The module that owns that kind of record has been switched off. |
| `Attaching needs the Documents module — a copy of the email has to go somewhere the whole business can read it.` | Ask us to switch Documents on. |
| `That message is too large to file a copy of — download it and attach it by hand.` | The email is over 25 MB. Save it from your phone or Outlook and upload it to Documents. |
| `That message no longer exists.` or `That conversation no longer exists.` | It was moved or deleted while you had it open. |
| `That mailbox isn't connected.` | The mailbox was disconnected. See [Connecting your mailbox](connect.md). |
| `This mailbox needs to be reconnected before it can be read again.` | Reconnect it, then try again. |
| `Couldn't reach the mail server. Your mail is safe — try again shortly.` | The mail server did not answer. Nothing was changed. |
| `1 line could not be matched to the conversation and is unticked below — check it against the email before including it.` | That line's words are not in the message it names. Read it against the email before you tick it. |
| `Unticked lines could not be matched to the conversation.` | Sits above the create button whenever any line arrived unticked. |
| `2 proposed lines were discarded as malformed.` | Lines came back unusable and were thrown away. Check the email for anything they missed. |
| `The assistant returned nothing usable.` | Nothing came back. Try again in 15 seconds, or write the record by hand. |
| `Tick at least one line first` | You pressed the create button with every line cleared. |
| `Nothing to draft from this conversation.` | The drafter came back with nothing at all. Write the record by hand. |
| `Invalid input` | The dialog sent something the server would not take. Reload the page and try again. |
| `Something went wrong. Please try again.` | Several things say this. Pressing a draft button again inside 15 seconds, the customer or vendor being archived since the draft was read, ticking only lines with no price on them, and having no active income account for a drafted invoice all land here. |
| `Accountant access is read-only — reviews, sign-offs and exports only.` | An outside accountant cannot attach, detach or draft. |

## Not on this page

The words the picker searches are your records, never the email you have open. There is nothing from Work or Scheduling to attach to. There is no way to attach one attachment on its own, and no way to attach several messages at once. A later reply is a new message and is never attached for you. Nothing in Documents says which conversation a filed copy came from. A drafted invoice or bill is not attached to the conversation it came from, and its customer or supplier cannot be picked in the dialog. Only invoices and bills show what is attached to them. Ask us if you need one of these.

## Who can do what

Owners and staff do the same things here. Both attach, detach and draft, including on a mailbox shared with them. What each of you finds in the picker is only what you are allowed to see, so an owners-only folder does not appear for staff and nothing says it was left out. An outside accountant is refused: the draft buttons are not drawn at all, and everything else answers `Accountant access is read-only — reviews, sign-offs and exports only.`
