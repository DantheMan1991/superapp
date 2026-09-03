# Import a statement

> Bringing transactions in from the CSV your bank exports: choosing the file, mapping its columns, the preview, what happens to duplicates, and the summary afterwards.
> **Route:** /dashboard/m/accounting/banking/*/import
> **Order:** 150

## Before you start

Export the statement from your bank's website as a CSV file. Any date range is fine; a file you have imported before is safe to import again.

The title reads `Import statement — [account]` and the line under it `Upload the CSV your bank exports. Re-importing an overlapping file is safe — duplicates are skipped automatically.` Owners only: anyone else sees `Only the business owner can import statements.`

## Choose the file

Click **Choose a CSV file** and pick the export. Files up to about 1 MB and 10,000 rows are accepted. A larger file answers `File is too large (max ~1 MB). Export a shorter date range.` A file that is not a CSV answers `That file doesn't look like a valid CSV.`

## Map the columns

Yosher reads the header row and works out which column is which. The card reads, for example, `84 rows found (header detected) — check the mapping, then import.` Check each choice:

- **Date column** and **Description column.**
- **Date format.** `MM/DD/YYYY`, `DD/MM/YYYY` or `YYYY-MM-DD`. If the dates could be read either way, a note asks you to double-check month against day.
- **Amount style.** `One signed column`, where money out is negative, or `Separate in/out columns`, which then asks for the **Money out column** and **Money in column**.
- **Flip signs (my bank shows money out as positive).** Tick it if your bank writes spending as a positive number.

## Preview

The first ten rows as Yosher reads them. Check that the dates and amounts look right before importing.

## Import

Click **Import transactions**. **Start over** clears the file and goes back to the picker.

Rows that could not be read stop the import with their row numbers: `Rows 4, 17, 33 couldn't be read (bad date or amount). Fix the file or the mapping.` Blank rows and rows with an amount of zero are skipped quietly.

Each transaction is remembered by its date, amount and description, so importing the same file twice adds nothing, and an overlapping export only adds what is new. Two genuinely identical charges on one day both come in.

## Import complete

The summary reads, for example, `12 transactions imported · 3 duplicates skipped. 5 matched a rule, 4 posted automatically, 1 left for review because the period is closed.`

Your bank rules run over everything waiting for review on this account, not only this file. A rule set to post automatically posts its matches; a match dated in a closed month, or on a closed account, is left for review instead. **Go review them** opens the account's transactions.
