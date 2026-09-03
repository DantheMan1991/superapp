# Automatic filing

> Have attachments from a sender copied into Documents on their own, so paperwork stops sitting in your inbox. Set the rules up here, pause them, and delete them.
> **Route:** /dashboard/m/email?autofile=1
> **Order:** 90
> **Area:** Rules and replies

Open **Mail** in the sidebar, then click `Filing` in the row along the top. The pane opens where you normally read a message, and your folders and message list stay beside it. It lists every filing rule you have set up on this mailbox. To make one, click {button:New filing rule|primary|plus}.

## What you see

- **`Automatic filing`.** The heading of the pane. Click `Close` at the right to go back to your mail. Clicking a message in the list while this pane is open does nothing you can see, so close the pane first.
- **The warning, always at the top.** It reads `Filed attachments are visible to everyone in the business.` and then `A rule copies matching messages and their attachments into Documents automatically, with nobody checking each one. Only your own mailbox can be filed this way, and only you can set this up.` Read it before you set up your first rule.
- **The list of rules.** Every rule you have set up on this mailbox, in name order. There is no paging, no sorting and no search.
- **A rule row.** The name on the first line, followed by `paused` when the rule is switched off. Under it, how many messages the rule has filed, such as `12 filed`. When the last run went wrong, ` · ` and the reason follow on the same line. Click anywhere on the left of the row to open the rule for editing.
- **{icon:trash} at the right of a rule row.** Deletes that rule straight away, with no confirmation.
- **{button:New filing rule|primary|plus}.** Opens an empty rule. The form takes over the pane and the list goes away until you save or cancel.

## How to set up a filing rule

1. Click {button:New filing rule|primary|plus}, or click a rule in the list to change one you already have.
2. Type a `Name`, such as `Supplier invoices`. It is required, and 80 characters at most. It is only a label for you.
3. In `From address contains`, type any part of the sender's address, such as `accounts@supplier.co.uk`. 200 characters at most. Capitals do not matter. It matches the address the mail came from, never the name the sender chose to show. Leave it blank to take mail from anybody in the folder you pick.
4. In `Only in this mail folder`, choose which folder to watch. A new rule starts on `Inbox`, and `Archive` and the folders you made yourself are listed under it. Drafts, Sent, Trash and Junk are never offered.
5. `Inbox` in that list counts as no folder at all. Leave the sender blank with `Inbox` still showing and {button:Save rule|primary|save} is refused, even though a folder looks chosen. The note under the field reads `Set a sender, a folder, or both. A rule with neither would file everything.`, and `Inbox` is not the folder it means. Type a sender, or pick one of your own folders.
6. In `File into`, choose the Documents folder the copies land in. A new rule starts on `The Documents inbox`, and a rule you are changing opens on the folder it files into today. Only twenty folders are ever listed, the ones nearest the top of Documents first and then by name, and there is no search box. Two folders in different places with the same name look identical here.
7. Owners-only Documents folders are never in that list. The note reads `Owners-only folders aren't listed: filing runs in the background with nobody signed in, so it can't open them.` Pick one everybody can see, or file into the Documents inbox and move the file afterwards.
8. Leave `Filing is on` checked. Uncheck it to save the rule without letting it run.
9. Click {button:Save rule|primary|save}. You see `Filing rule saved.` and the list again. Click {button:Cancel|outline} instead to go back to the list and keep nothing.

The note above the buttons reads `Only mail arriving from now on is filed — turning a rule on doesn't reach back through what is already in the mailbox.` That holds for a new rule. It starts from the moment you save it, so nothing already in your mailbox is ever filed. It does not hold for a rule you pause and switch back on, which does catch up.

## How to check a rule is working

1. Wait ten minutes. Filing runs on a timer every ten minutes, not the moment mail arrives.
2. Open `Filing` again and read the rule's second line. `3 filed` means three messages have been copied since you set the rule up.
3. Open [Documents](/dashboard/m/documents/browse) and look in the folder you chose, or in the [Documents inbox](/dashboard/m/documents/inbox) when you chose none.
4. Every filed message puts the whole email there as an `.eml` file, named from its subject and cut to 80 characters. Each attachment on it becomes a file of its own beside it.
5. When something goes wrong, the reason sits on the same line after the count. Fix it, then save the rule again, which clears the message.

Each run picks up eight rules across every business we host, the ones checked longest ago first, and looks at ten messages for each. A backlog takes several runs to clear, so a heavy morning can come through over an hour or two.

Only mail with a real attachment is filed. A logo in somebody's signature does not count as one. Your own drafts are never filed. A message already in Documents is not copied a second time, so it does not add to the count.

An attachment over 20 MB does not become a file of its own, and neither does anything past the first 40 MB on one message. Nor does a type Documents will not take. All of them are still inside the `.eml`, so nothing is lost. A whole message over 25 MB is not filed at all, and neither is one whose parts add up to more than 60 MB. Either one stops that rule where it stands, with the reason on the row, until you move the message out of the folder the rule watches or delete it.

Delete the Documents folder a rule points at and the rule keeps running. It goes back to filing into the Documents inbox, and nothing on the rule says so.

## How to pause a rule

1. Click the rule in the list.
2. Uncheck `Filing is on`.
3. Click {button:Save rule|primary|save}. You see `Filing rule saved.`, and the row now reads `paused` after the name.
4. Nothing already filed is removed. Nothing new is filed while the rule is paused.

Check `Filing is on` again and the rule picks up where it stopped. It remembers its place, so mail that arrived while it was paused is filed over the next few runs.

## How to delete a rule

1. Click {icon:trash} on the row. It goes at once. There is no confirmation and no undo.
2. You see `Deleted "Supplier invoices". Anything already filed stays in Documents.`
3. Everything the rule has already put in Documents stays exactly where it is. Delete those files in Documents if you want them gone.

## Messages

| Message | What it means |
| --- | --- |
| `No filing rules. A rule is useful when the same sender keeps emailing you paperwork — supplier invoices, signed orders.` | You have no rules yet. Click {button:New filing rule|primary|plus}. |
| `Filing rule saved.` | The rule is saved and the list is back. |
| `Give the rule a name.` | `Name` held only spaces. Type a real name. |
| `Choose a folder or a sender. A rule with neither would file every attachment in this mailbox into Documents, where the whole business can read it.` | You left `From address contains` blank with `Only in this mail folder` on `Inbox`. Type a sender, or pick one of your own folders. |
| `That folder can't be used for automatic filing. Filing runs in the background with no one signed in, so it cannot reach an owners-only folder — pick one everybody in the business can see.` | The Documents folder you chose was made owners only while your form was open. Pick another. |
| `That rule no longer exists.` | The rule was deleted while your pane was open. Click `Close` and open `Filing` again. |
| `Deleted "Supplier invoices". Anything already filed stays in Documents.` | The rule is gone. The documents it made are not. |
| `That mailbox isn't connected.` | Your mailbox is no longer connected. See [Connecting your mailbox](connect.md). |
| `Invalid input` | The form could not be read. A completely empty `Name` gives you this rather than the message above. Type a name and save again. |
| `Documents is not switched on for this business.` | On a rule row. There is nowhere to file to. Ask us to switch Documents on. |
| `This mailbox needs to be reconnected.` | On a rule row. Filing stopped because the mailbox lost its connection. Reconnect it and filing carries on from where it stopped. |
| `Accountant access is read-only — reviews, sign-offs and exports only.` | You are signed in as the accountant. Nothing in Mail is open to you. |

## Not on this page

A rule matches on the sender's address and the mail folder, and on nothing else. There is no test for the subject, the file type, the file size or anything in the message body, so a rule that watches a whole folder files every attachment that lands in it.

Nothing here reports what has been filed. The `12 filed` count on each row is all you get, and nothing tells you when a rule last ran or which messages it took. To see what arrived, open Documents and look in the folder.

There is no way to file mail that is already in your mailbox. Attach those by hand, one conversation at a time, which is in [Attaching an email to your records](records.md).

The `Filing` link is hidden on a phone, so set these up on a computer.

Rules that sort mail inside your mailbox, into folders and out of your way, are a different thing and live in [Rules](rules.md). Folders, sharing and everything else about the files themselves are in the Documents guides.

Ask us if you need a rule that reads more than the sender, or a report of what filing has done.

## Who can do what

Owners and staff do exactly the same things here. Each person sets up rules on their own mailbox, and nobody else sees them, not even an owner. A rule can only ever watch the mailbox you set it up on.

Owners get no extra folders in `File into`. Filing runs with nobody signed in, so it can never open an owners-only folder, and everyone in the business can read what a rule files.

On a shared mailbox the `Shared` label appears at the top of Mail. Your filing rules there are still yours alone. A colleague reading the same address sets up their own, and a message the two of you both file is stored once.

Accountants can do nothing here. Saving a rule or deleting one answers `Accountant access is read-only — reviews, sign-offs and exports only.`
