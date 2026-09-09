# Bank rules

> Telling the books how to categorize a transaction once so it happens every time: writing a rule, its conditions, what it sets, posting automatically, the order rules run in, and the rules Yosher suggests from what you do.
> **Route:** /dashboard/m/accounting/banking/rules
> **Order:** 50
> **Area:** Banking

Open **Banking** in the accounting menu and click {button:Rules|outline|filter}. The line under the title reads `Tell the books how to categorize a transaction once, and it happens every time. Rules run before the AI suggestion and win where both have an opinion.` To write one, click {button:New rule|primary|plus}.

## What you see

- **The list.** Rules in the order they run. `Rule`, the name, then which accounts it applies to, `All registers` or one account, whether it applies to money in or money out only, and `posts automatically` where set, or `sets aside as personal` for a rule that does that instead. `Conditions`, such as `Description contains "WESTFIELD" and Amount is more than "50.00"`. `Sets`, such as `Set category to "6300 · Insurance"`, and the payee where one is set, or `Set aside as personal`. `Status`: {badge:Active|secondary}, {badge:Off|outline}, or {badge:Suggested|outline} for a rule Yosher proposed.
- **On each row.** {button:Turn off|ghost} or {button:Turn on|ghost}, {button:Edit|outline}, and a {icon:trash} that deletes at once, with no confirmation and no undo. A suggested rule shows {button:Keep|outline} and {button:Dismiss|ghost} instead. Owners also see arrows to move a rule up or down.
- **{button:Apply to unreviewed|outline}.** At the top of the page. Runs every rule over every waiting transaction in every account.

When a transaction arrives, the first rule that matches it fills in its category, and its payee if the rule sets one. The transaction then waits for review with the rule's choice already made, or, if the rule posts automatically, goes straight into the books. A rule that sets aside as personal moves the transaction to the account's `Personal` tab the moment it arrives, and posts nothing. A rule always beats the assistant's suggestion.

## How to write a rule

1. Click {button:New rule|primary|plus}. The dialog reads `Matching rows are pre-filled with this category, or set aside as personal. Rules are checked in list order and the first match wins.`
2. Fill in `Rule name`, such as `Westfield as Insurance`. Pick `Apply to`: `Money in and out`, `Money in only` or `Money out only`. Pick `In register`: `All registers`, or one account.
3. Set the conditions. `When` `all of these` or `any of these` `are true`, then each condition as a field, an operator and a value. For `Description`: `contains`, `doesn't contain`, `is exactly`, `starts with`. For `Amount`: `is more than`, `is less than`, `equals`. {button:Add condition|outline|plus} adds another, up to ten.
4. Pick `What the rule does`: `Fill in a category`, or `Set aside as personal`. Choosing the second shows `Matching transactions are set aside as not the business's the moment they arrive. Nothing posts. They sit on the account's Personal tab, and any one can be brought back from there.`, and the category, payee, memo and `Post automatically` controls are put away, because a rule that posts nothing has nothing to set.
5. For `Fill in a category`: pick `Set category to`, the account to charge. Pick `Set payee to (optional)`, a vendor, or `Leave the payee alone`. Fill in `Memo (optional)`, or leave it blank to keep the bank description. Turn on `Post automatically` if the rule should post without review: `Matching transactions post to the ledger without review. Rows dated inside a closed period are always left for review instead.`
6. Click {button:Create rule|primary}. You see `Rule created`. A missing name, category or condition value is pointed out before anything is sent.

A new rule applies to transactions that arrive from now on. To run it over what is already waiting, click {button:Apply to unreviewed|outline}. You see, for example, `18 matched · 11 posted · 2 left for review (period closed)`, or `8 matched · 8 set aside as personal`. A statement import does the same on its own.

A rule that sets aside as personal is meant for a personal account, where most of the feed is your own spending. It works on any account, but on a business account an excluded transaction is usually a duplicate, so think before writing one there. See [An account's transactions](register.md).

## How to keep or dismiss a suggested rule

After you have categorized transactions with the same words the same way three times on one account, a suggested rule appears in the list, named like `(Suggested) Westfield Ins as Insurance`, set to fill in but not to post. On a personal account, setting aside the same payee three times proposes one the same way, named like `(Suggested) Kroger as personal` and set to set aside; a suggestion you dismiss is not made again for those words.

1. Click {button:Keep|outline} to make it a normal rule.
2. Click {button:Dismiss|ghost} to turn it off and keep it in the list, so the same suggestion is not made again.

## Messages

| Message | What it means |
| --- | --- |
| `No rules yet. Categorize a few transactions the same way and one will be suggested for you — or write one now.` | The list is empty. |
| `18 matched · 11 posted · 2 left for review (period closed)` | What {button:Apply to unreviewed|outline} did. |
| `8 matched · 8 set aside as personal` | Rules that set aside as personal moved eight transactions to their account's `Personal` tab. Nothing was posted. |
| `Pick a category` | The rule fills in a category and none was chosen. A rule that sets aside as personal needs none. |

## Not on this page

Deleting a rule has no confirmation and no undo. Turn it off instead if you may want it back.

## Who can do what

Everyone can read the rules. Writing, ordering, keeping, dismissing and deleting are the owner's.
