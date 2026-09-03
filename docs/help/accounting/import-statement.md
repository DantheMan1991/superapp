# Import a statement

> Bringing transactions in from the CSV your bank exports: choosing the file, mapping its columns, the preview, what happens to duplicates, and the summary afterwards.
> **Route:** /dashboard/m/accounting/banking/*/import
> **Order:** 30
> **Area:** Banking

Open an account from **Banking** and click {button:Import CSV|outline}. Owners only. The title reads `Import statement — [account]` and the line under it `Upload the CSV your bank exports. Re-importing an overlapping file is safe — duplicates are skipped automatically.` Export the statement from your bank's website first. Any date range is fine.

## What you see

- **{button:Choose a CSV file|outline}.** Files up to about 1 MB and 10,000 rows are accepted.
- **The mapping card.** Once a file is chosen: `84 rows found (header detected) — check the mapping, then import.`, then `Date column`, `Description column`, `Date format` (`MM/DD/YYYY`, `DD/MM/YYYY` or `YYYY-MM-DD`), `Amount style` (`One signed column`, where money out is negative, or `Separate in/out columns`, which then asks for `Money out column` and `Money in column`), and the check box `Flip signs (my bank shows money out as positive)`.
- **The preview.** The first ten rows as Yosher reads them.
- **{button:Import transactions|primary}** and **{button:Start over|outline}.**
- **The summary.** After the import, for example `12 transactions imported · 3 duplicates skipped. 5 matched a rule, 4 posted automatically, 1 left for review because the period is closed.`, with {button:Go review them|outline}.

## How to import a statement

1. Click {button:Choose a CSV file|outline} and pick the export.
2. Check the mapping. Yosher reads the header row and works out which column is which. If the dates could be read either way, a note asks you to double-check month against day. Check `Flip signs (my bank shows money out as positive)` if your bank writes spending as a positive number.
3. Check the preview. The dates and amounts should look right before you go on.
4. Click {button:Import transactions|primary}. {button:Start over|outline} clears the file and goes back to the picker.
5. Read the summary, then click {button:Go review them|outline} to open the account's transactions.

Each transaction is remembered by its date, amount and description, so importing the same file twice adds nothing, and an overlapping export only adds what is new. Two genuinely identical charges on one day both come in. Blank rows and rows with an amount of zero are skipped quietly. Your bank rules then run over everything waiting for review on this account, not only this file: a rule set to post automatically posts its matches, and a match dated in a closed month, or on a closed account, is left for review instead.

## Messages

| Message | What it means |
| --- | --- |
| `File is too large (max ~1 MB). Export a shorter date range.` | The file is over the limit. Export less. |
| `That file doesn't look like a valid CSV.` | The file is not a CSV. Export again from the bank. |
| `Rows 4, 17, 33 couldn't be read (bad date or amount). Fix the file or the mapping.` | Those rows stopped the import. Check the date format and amount style, or fix the file. |
| `Only the business owner can import statements.` | You are staff or an accountant. |

## Not on this page

Only CSV is accepted. A live bank feed, when it is switched on for your deployment, is connected from the Banking page instead.

## Who can do what

Owners only.
