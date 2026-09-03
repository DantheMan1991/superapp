# Write a journal entry

> A hand-written entry: the date and memo, the lines with their debits and credits, keeping it balanced, and saving it as a draft or posting it.
> **Route:** /dashboard/m/accounting/journal/new
> **Order:** 200

Open **Journal** in the accounting menu and click {button:New entry|primary}. Most of the books write themselves from invoices, bills and the bank feed. A journal entry is for the rest: a correction, a transfer, depreciation you record by hand, a loan drawdown. The line under the title reads `Debits on the left, credits on the right — they must match to post.`

## What you see

- **`Company`.** Only when you keep more than one. `Which company's books?` Fixed once the entry exists.
- **`Date`**, today to begin with, and **`Memo`**, `What is this entry for?`
- **The lines.** Two rows to begin with. Each has `Account`, any active account, including receivables and payables, but not a bank account that belongs to another company; `Debit` or `Credit`, where typing in one clears the other; `Line memo`; {button:Tag|outline} under the row when your business has tags; and {button:Remove line|ghost|trash} once there are more than two rows. {button:Add line|outline|plus} adds a row.
- **The balance bar.** Under the lines, the two sides totaled, `Dr 1,250.00` and `Cr 1,250.00`, and `Balanced` or `Off by 250.00`.
- **{button:Save draft|outline}** and **{button:Post entry|primary}.**

## How to write an entry

1. Set `Date` and `Memo`.
2. On each line, pick the `Account` and type the amount in `Debit` or `Credit`. Add a `Line memo` or a tag if you want them. Click {button:Add line|outline|plus} for another.
3. Watch the balance bar until it reads `Balanced`.
4. Click {button:Post entry|primary} to write it into the books. It needs the entry balanced with at least two lines. Or click {button:Save draft|outline} to keep it without touching the books; a draft needs at least one complete line.
5. You land back on the journal with `Entry posted` or `Draft saved`.

Owners post. Staff save drafts for an owner to post. Someone with accountant access can open the form, but a save does not go through.

## Messages

| Message | What it means |
| --- | --- |
| `Debits and credits must be equal before posting.` | The bar reads `Off by`. Fix a line. |
| `A journal entry needs at least two lines.` | Add a second line. |
| `Every line needs a non-zero amount.` | A line has no amount. Fill it in or remove the line. |
| `That date falls in a closed period. Use a reversal, or reopen the period first.` | The month has been closed for this company. |
| `That bank account belongs to a different company. Use one of this company's own accounts — money moving between two of your companies is a transfer, and recording it properly needs both sides.` | Record money between companies with Move money on the Companies page instead. |
| `One of the selected accounts is inactive.` | An account on a line was deactivated. Pick another. |
| `One of the selected tags is invalid or inactive.` | A tag on a line has been retired. Pick another. |

## Not on this page

Attachments are added on the entry's page once it exists. See [A journal entry](entry.md).

## Who can do what

Owners post. Staff save drafts. Accountants can look at the form, and a save does not go through.
