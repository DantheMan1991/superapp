# Record a bill

> The bill form: every field, the lines and their accounts, the assistant's suggestions, and what Save draft does. The same form appears on a draft bill's own page.
> **Route:** /dashboard/m/accounting/purchases/bills/new
> **Order:** 20

## Before you start

Have the vendor's bill in front of you. If it arrived as a document, start from the Inbox instead: **Create bill** there fills this form in for you and attaches the document. Use this page for a bill you are keying in by hand.

The title is **New bill** and the line under it reads `Record what a vendor billed [your business]. Approval posts it to the ledger.` Saving here never touches the ledger. Approval does, and that happens on the bill's page afterwards.

## The top fields

- **Company.** Only when your books hold more than one company, and only when creating. `Which company owes this?` Once the draft is saved the company cannot change, because it decides whose books the bill lands in.
- **Vendor.** Pick one from the list of active vendors, or type a name in the box underneath, `…or type a new vendor name`, to create one on the spot. Typing clears the pick and picking clears the box. A vendor made this way has a name and nothing else; add their email or a default account later on the Vendors page.
- **Vendor invoice #.** `As printed on the bill`. Optional.
- **Bill date.** Required. Starts as today.
- **Due date (optional).** Type it; it is not worked out from terms.
- **Memo.** Optional.

There is no tax field. Purchase tax is part of what you were charged, so it goes in the line amounts.

## The lines

One row is there to begin with. **Add line** adds another, and the bin icon at the end of a row removes it. The last row cannot be removed.

- **Description.** `What was billed`.
- **Amount.**
- **Credit.** A tick box. Tick it for a vendor credit or a discount, and the amount counts against the bill instead of adding to it.
- **Account.** Which account the line is charged to. The list offers your ordinary expense and asset accounts. It leaves out bank and card accounts, because a bill line is never coded to the bank, and the accounts that only a stock receipt or another company may touch. A line can be left as `Uncoded` in a draft.
- **Tag.** Under each line, when your business has lines of business or other tags set up, a **Tag** button opens a small panel with one list per kind of tag. It is not shown otherwise.

**A line set by a stock match.** When a line has been matched to a delivery in Inventory, the row is greyed out and marked `Set by a match — undo the match to change it`. You can keep it or remove it, but not change it. Its tag can still be changed.

## Suggested accounts

Suggestions appear on a draft bill's page after **Suggest coding** has been pressed there. On each line with a suggestion, a small chip reads the account and how sure the assistant is, `Use 6100 · 87%`. Hover it to see the reason. Click it and that line's account is set. Nothing is saved until you save the draft.

**Use all suggestions ≥ 70%** sets every line that is still uncoded to its suggestion, when the assistant is at least 70% sure. It never changes an account a person chose. The chips disappear when the draft is saved, because a suggestion made against lines that have since been edited is stale.

## The total and saving

The foot of the form shows **Total** and, when any line has no account, `2 uncoded lines — fine for a draft; approval requires accounts on every line.`

Click **Save draft** on a new bill, or **Save changes** on an existing draft. The button stays greyed out until there is a vendor, a bill date and an amount on every filled line. Rows with nothing in them are ignored.

When it saves you see `Draft saved` and land on the bill's page. If the vendor already has a bill with the same invoice number, or the same total within three days, you see `Saved — this may be a duplicate of an existing bill.` and a banner on the form: `Possible duplicate: this vendor already has INV-4471 (2026-08-14). Nothing is blocked — just double-check before approving.`

## Messages you may see

- `Pick or create a vendor.` The vendor is missing.
- `Not a real calendar date` for a date that does not exist.
- `That vendor is inactive — reactivate them first.` The vendor was deactivated on the Vendors page.
- `A line is coded to an account that cannot be chosen by hand. Pick an ordinary account — or, if a match set it, undo the match first.`
- `One of the selected tags is invalid or inactive.`
- `Only draft bills can be changed this way.` Someone approved this bill while you were editing it.
- `This entry changed since you opened it — reload and try again.` Someone else saved it first.
- `Accountant access is read-only — reviews, sign-offs and exports only.` You have accountant access, which can read but not change.

## What is not on this form

Attachments are added on the bill's page, or come along automatically from the Inbox. Submitting for approval, approving and paying all happen on the bill's page. See **A bill's page**.
