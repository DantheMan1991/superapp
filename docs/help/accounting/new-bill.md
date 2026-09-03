# Record a bill

> The bill form: every field, the lines and their accounts, the assistant's suggestions, and what Save draft does. The same form appears on a draft bill's own page.
> **Route:** /dashboard/m/accounting/purchases/bills/new
> **Order:** 20

Open **Purchases** in the accounting menu and click {button:New bill|primary}. Use this form for a bill you are keying in by hand. If the bill arrived as a document, start from the Inbox instead: {button:Create bill|primary} there fills this form in for you and attaches the document. The line under the title reads `Record what a vendor billed [your business]. Approval posts it to the ledger.` Saving here never touches the ledger. Approval does, on the bill's page afterwards.

## What you see

- **`Company`.** Only when your books hold more than one company, and only when creating. `Which company owes this?` Once the draft is saved the company cannot change, because it decides whose books the bill lands in.
- **`Vendor`.** A list of your active vendors, and a box under it, `…or type a new vendor name`, to create one on the spot. Typing clears the pick and picking clears the box. A vendor made this way has a name and nothing else. Add their email or default account later on the Vendors page.
- **`Vendor invoice #`.** `As printed on the bill`. Optional.
- **`Bill date`.** Required. Starts as today.
- **`Due date (optional)`.** Type it. It is not worked out from terms.
- **`Memo`.** Optional.
- **The lines.** One row to begin with. Each has `Description` (`What was billed`), `Amount`, a `Credit` check box, and `Account`. Check `Credit` for a vendor credit or a discount, and the amount counts against the bill instead of adding to it. `Account` offers your ordinary expense and asset accounts. It leaves out bank and card accounts, because a bill line is never coded to the bank, and the accounts that only a stock receipt or another company may touch. A line can be left as `Uncoded` in a draft. {button:Add line|outline|plus} adds a row and {button:Remove line|ghost|trash} at the end of a row removes it. The last row cannot be removed.
- **`Tag`.** Under each line, when your business has {{enterprise|plural|lower}} or other tags set up, {button:Tag|outline} opens a small panel with one list per kind of tag. It is not shown otherwise.
- **A line set by a stock match.** When a line has been matched to a delivery in Inventory, the row is grayed out and marked `Set by a match — undo the match to change it`. You can keep it or remove it, but not change it. Its tag can still be changed.
- **The foot of the form.** `Total`, and, when any line has no account, `2 uncoded lines — fine for a draft; approval requires accounts on every line.` Then {button:Save draft|primary}, or {button:Save changes|primary} on an existing draft.

There is no tax field. Purchase tax is part of what you were charged, so it goes in the line amounts.

## How to record a bill

1. Pick the `Vendor`, or type a new name in the box under the list.
2. Fill in `Bill date`, and `Vendor invoice #` and `Due date (optional)` if you have them.
3. On each line, fill in `Description` and `Amount`, and pick the `Account` the line is charged to. Check `Credit` on a credit or a discount. Click {button:Add line|outline|plus} for the next line.
4. Click {button:Save draft|primary}. It stays gray until there is a vendor, a bill date and an amount on every filled line. Rows with nothing in them are ignored.
5. You see `Draft saved` and land on the bill's page, where an owner approves it. See [A bill's page](bill.md).

If the vendor already has a bill with the same invoice number, or the same total within three days, you see `Saved — this may be a duplicate of an existing bill.` and a banner on the form: `Possible duplicate: this vendor already has INV-4471 (2026-08-14). Nothing is blocked — just double-check before approving.`

## How to use the assistant's suggestions

1. On a draft bill's page, click {button:Suggest coding|outline|sparkles}. Chips appear on the lines, each reading the account and how sure the assistant is, such as {button:Use 6100 · 87%|outline|sparkles}. Hover one to see the reason.
2. Click a chip to set that line's account. Or click {button:Use all suggestions ≥ 70%|outline|sparkles}, which sets every line that is still uncoded to its suggestion when the assistant is at least 70% sure. It never changes an account a person chose.
3. Click {button:Save changes|primary}. Nothing is saved until you do. The chips disappear when the draft is saved, because a suggestion made against lines that have since been edited is stale.

## Messages

| Message | What it means |
| --- | --- |
| `Pick or create a vendor.` | The vendor is missing. |
| `Not a real calendar date` | The date does not exist. |
| `That vendor is inactive — reactivate them first.` | The vendor was deactivated on the Vendors page. |
| `A line is coded to an account that cannot be chosen by hand. Pick an ordinary account — or, if a match set it, undo the match first.` | A line names an account only a match may set. |
| `One of the selected tags is invalid or inactive.` | A tag on a line has been retired. Pick another. |
| `Only draft bills can be changed this way.` | Someone approved this bill while you were editing it. |
| `This entry changed since you opened it — reload and try again.` | Someone else saved it first. Reload. |
| `Accountant access is read-only — reviews, sign-offs and exports only.` | You have accountant access, which can read but not change. |

## Not on this page

Attachments are added on the bill's page, or come along automatically from the Inbox. Submitting for approval, approving and paying all happen on the bill's page. There is no tax field on a bill.

## Who can do what

Owners and staff record and save drafts. Accountants can open the form, and a save answers with the read-only message.
