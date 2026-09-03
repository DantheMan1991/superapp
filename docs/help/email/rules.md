# Rules

> Rules sort mail into folders as it arrives, mark it read, or flag it, before you ever open the page. Build them here, put them in the order they should run, then publish them to your mail server.
> **Route:** /dashboard/m/email?rules=1
> **Order:** 80
> **Area:** Rules and replies

Open **Mail** in the sidebar, then click `Rules` at the top of the page. The pane opens where you read messages, and your folders and message list stay beside it. Rules run on your mail server rather than in Yosher, so they sort mail that arrives overnight, and they sort the same mailbox on your phone and in Outlook. Click {button:Add a rule|outline|plus} to start one, then {button:Save and publish|primary} when the list is right. Click `Close` to go back to your mail. Copying attachments into Documents is a separate job, in [Automatic filing](filing.md). Answering mail while you are away is in [Automatic reply](away.md). Moving mail by hand is in [Sorting mail](sorting.md).

## What you see

- **The line above the list.** Tells you the rules run on the mail server as messages arrive, and that they run top to bottom.
- **`No rules yet.`** A dashed box, before you have made one.
- **A rule card for each rule.** They run in the order shown, starting at the top.
- **The checkbox at the left of a card.** Checked means the rule runs. Clear it and the rule stays in the list but sorts nothing once you save.
- **The name box.** Placeholder `Name this rule`, up to 120 characters. The name is only for you and never appears on a message.
- **{button:Move up|ghost} and {button:Move down|ghost}.** Swap the card with the one above or below it. Grayed out on the first and the last card.
- **{button:Delete rule|ghost|trash}.** Takes the card off the list at once, with no question asked. Nothing reaches the mail server until you save.
- **The `If` rows.** One row per thing the rule looks at. The first reads `If`. Every row after it reads `and`, or `or` when you set the rule to match any condition.
- **The field box in a row.** Three choices: `From`, `To or Cc`, and `Subject`. `To or Cc` covers both, so mail sent to a shared address still matches when you were copied in.
- **`contains`.** Fixed between the field and the value. Every test is a match on part of the text, and there is no other kind.
- **The value box.** Placeholder `acme.com`, up to 200 characters. `From` and `To or Cc` check the address itself. The name shown on the message is never checked, because anyone can put any name on a message.
- **{button:Remove condition|ghost|trash}.** Takes that row out. It only appears once a rule has two rows, so a rule can never be left with none.
- **{button:Condition|ghost|plus}.** Adds a row set to `From` with an empty value. Grayed out once the rule has ten rows.
- **The match box beside it.** Appears once a rule has two rows. `Match all conditions` means every row has to be true. `Match any condition` means one is enough.
- **The `Then` row.** What happens to a message the rule matches. You can pick more than one.
- **The folder box.** `Leave in place` to start. Under it, `Move to ` and the folder's name, one for every folder you can read, in the order your folder list uses. `Trash`, `Junk`, `Drafts` and `Sent` are offered like any other folder, and nothing warns you. A rule pointed at `Trash` throws the mail away as it arrives.
- **`Mark read`.** The message lands already read, so it never adds to your unread count.
- **`Flag`.** The message lands flagged. The `Flagged` filter above the message list finds them.
- **`Stop here`.** Checked on every new rule. When this rule matches, no rule below it runs on that message.
- **Red text under a card.** What is unfinished on that rule. {button:Save and publish|primary} stays grayed out until every card is clean.
- **{button:Add a rule|outline|plus}.** Adds a card at the bottom: no name, checked on, one `From` row, `Leave in place`, and `Stop here` already checked. Grayed out once you have fifty rules.
- **{button:Save and publish|primary}.** Sends the whole list to the mail server. Beside it, `Replaces the rules running on the mail server.`
- **The message list beside the pane.** It stays where it is. Clicking a message while this pane is open does not open the message, and {button:Write|outline|pen-square} does not open a new one. Click `Close` first.

## How to send one sender's mail straight to a folder

1. Click {button:Add a rule|outline|plus}. A card appears with one `If` row.
2. Type a name in the name box, such as `Acme invoices`.
3. Leave the field box on `From`. Type the sender in the value box, such as `acme.com`. Any address containing those letters matches, so one line covers everybody at that company.
4. In the `Then` row, open the folder box and pick the folder, such as `Move to Suppliers`.
5. Click {button:Save and publish|primary}. You see a message such as `3 rules are running.` The pane stays open, with your rules still in it.
6. The rule works on the next message that arrives. Mail already sitting in your mailbox is left exactly where it is.

## How to make a rule test more than one thing

1. Click {button:Condition|ghost|plus} on the card. A second `If` row appears, and a match box appears beside the button.
2. Set the field and type the value in the new row.
3. Choose `Match all conditions` if every row has to be true, or `Match any condition` if one is enough. The word at the left of each row changes to `and` or `or` so you can read the rule back to yourself.
4. Add up to ten rows on one rule. The button grays out at ten.
5. Click {button:Save and publish|primary}.

## How to change the order rules run in

1. Rules run from the top down. Every rule that matches does its part, and a rule with `Stop here` checked ends the run for that message.
2. Click {button:Move up|ghost} or {button:Move down|ghost} on a card to swap it with its neighbor.
3. Order changes where mail lands. A rule for `acme.com` with `Stop here` checked, sitting above a rule for `Subject` `invoice`, means an invoice from Acme never reaches the second rule.
4. Click {button:Save and publish|primary}. The new order is running the moment you see the message.

## How to turn a rule off, or delete it

1. To stop a rule without losing what you built, clear the checkbox at the left of its name.
2. Click {button:Save and publish|primary}. The rule is left out of what runs on the mail server. Check the box and save again to bring it back.
3. To remove a rule for good, click {button:Delete rule|ghost|trash}. The card goes at once.
4. A delete is not real until you save. Click `Close` and leave without saving, and the rule you deleted is still there when you come back.
5. Click {button:Save and publish|primary} to make it stick.

## Messages

| Message | What it means |
| --- | --- |
| `No rules yet.` | You have not made a rule. Click {button:Add a rule|outline|plus}. |
| `Give it a name.` | The name box on that card is empty. Type a name. |
| `Fill in what to look for, or remove the condition.` | A condition row has nothing in its value box. Fill it in, or click {button:Remove condition|ghost|trash}. |
| `Choose what happens when it matches.` | That rule would do nothing to a message it matched. Pick a folder, or check `Mark read` or `Flag`. `Stop here` on its own is not enough. |
| `3 rules are running.` | Saved and live. The number counts the rules whose box is checked. |
| `That's more rules than the mail server will accept. Remove a few.` | The list is too big for the mail server. Delete a rule, or shorten what you are matching, then save again. Nothing on the server changed. |
| `That mailbox isn't connected.` | The mailbox is no longer linked to your account. See [Connecting your mailbox](connect.md). |
| `This mailbox needs to be reconnected before it can be read again.` | Reconnect the mailbox, then open `Rules` again. Your rules are still running in the meantime. |
| `Couldn't reach the mail server. Your mail is safe — try again shortly.` | The mail server did not answer. Nothing was published. Try again in a minute. |
| `Invalid input` | Something in the form is past a limit, or a rule has no condition rows at all. Nothing was published. Check the rule and save again. |
| `Accountant access is read-only — reviews, sign-offs and exports only.` | An accountant cannot change rules. |
| `Something went wrong. Please try again.` | Nothing was published. Try again, and tell us if it keeps happening. |

The mail server can also answer in its own words, sometimes with a line and column number. Nothing is published when it does, and the rules already running carry on. Send us what it said.

## Not on this page

There is no way to run a rule over mail that is already in your mailbox, and no preview that shows which messages a rule would catch. There is no record of what your rules have done. A rule can only look at `From`, `To or Cc` and `Subject`, and only for text inside them. There is no test for an attachment, a size, a date, or for words a message does **not** contain. A rule can move, mark read, flag and stop, and nothing else: it cannot delete, forward, reply, or tell anyone. It never touches mail you send. Nothing warns you before a rule sends arriving mail to `Trash` or `Junk`. There is no undo after you save, so write down anything you are about to delete. On a narrow phone screen the `Rules` link at the top is not shown. Ask us if you need one of these.

## Who can do what

Owners and staff do exactly the same things here. Your rules are your own: nobody else in the business can see them, and they only ever sort your own mailbox. A mailbox shared with colleagues shows `Shared` at the top of the page and has no `Rules` link, and typing the web address by hand does not open the pane either. The mail server keeps one set of rules per mailbox, so yours would sort everyone's mail and quietly replace whatever a colleague had set. Ask us if a shared mailbox needs sorting. An accountant who reaches this pane is answered `Accountant access is read-only — reviews, sign-offs and exports only.`
