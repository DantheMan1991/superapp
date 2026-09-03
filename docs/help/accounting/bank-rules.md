# Bank rules

> Telling the books how to categorise a transaction once so it happens every time: writing a rule, its conditions, what it sets, posting automatically, the order rules run in, and the rules Yosher suggests from what you do.
> **Route:** /dashboard/m/accounting/banking/rules
> **Order:** 170

## What a rule does

**Rules** on the Banking page. The line under the title reads `Tell the books how to categorize a transaction once, and it happens every time. Rules run before the AI suggestion and win where both have an opinion.`

When a transaction arrives, the first rule that matches it fills in its category, and its payee if the rule sets one. The transaction then waits for review with the rule's choice already made, or, if the rule posts automatically, goes straight into the books. A rule always beats the assistant's suggestion.

Before any exist: `No rules yet. Categorize a few transactions the same way and one will be suggested for you — or write one now.`

## The list

Rules are listed in the order they run. Owners can move one with the **Move up** and **Move down** arrows.

- **Rule.** The name, then which accounts it applies to, `All registers` or one account, whether it applies to money in or money out only, and `posts automatically` where set.
- **Conditions.** For example `Description contains "WESTFIELD" and Amount is more than "50.00"`.
- **Sets.** `Set category to "6300 · Insurance"`, and the payee where one is set.
- **Status.** `Active`, `Off`, or `Suggested` for a rule Yosher proposed.
- **Actions.** **Turn off** or **Turn on**, **Edit**, and the bin. The bin deletes at once, with no confirmation and no undo. A suggested rule shows **Keep** and **Dismiss** instead.

## Writing a rule

Click **New rule**. The dialog reads `Matching rows are pre-filled with this category. Rules are checked in list order and the first match wins.`

- **Rule name**, for example `Westfield as Insurance`.
- **Apply to.** `Money in and out`, `Money in only` or `Money out only`.
- **In register.** `All registers`, or one account.
- **When** `all of these` or `any of these` **are true**, followed by the conditions. Each condition is a field, an operator and a value. For **Description**: `contains`, `doesn't contain`, `is exactly`, `starts with`. For **Amount**: `is more than`, `is less than`, `equals`. **Add condition** adds another, up to ten.
- **Set category to.** The account to charge.
- **Set payee to (optional).** A vendor, or `Leave the payee alone`.
- **Memo (optional).** `Leave blank to keep the bank description`.
- **Post automatically.** `Matching transactions post to the ledger without review. Rows dated inside a closed period are always left for review instead.`

Click **Create rule**. You see `Rule created`. A missing name, category or condition value is pointed out before anything is sent.

A new rule applies to transactions that arrive from now on. To run it over what is already waiting, use **Apply to unreviewed** at the top of the page, which runs every rule over every waiting transaction in every account and reports, for example, `18 matched · 11 posted · 2 left for review (period closed)`. A statement import does the same on its own.

## Rules Yosher suggests

After you have categorised transactions with the same words the same way three times on one account, a suggested rule appears in the list, named like `(Suggested) Westfield Ins as Insurance`, switched to fill in but not to post. **Keep** makes it a normal rule. **Dismiss** turns it off and keeps it in the list, so the same suggestion is not made again.

## Who can do this

Everyone can read the rules. Writing, ordering, keeping, dismissing and deleting are the owner's.
