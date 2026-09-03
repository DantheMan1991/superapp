# A document in the Inbox

> One bill or receipt: the preview, what Yosher read off it and how sure it is, what it is attached to, and the same buttons as its row in the Inbox.
> **Route:** /dashboard/m/accounting/receipts/*
> **Order:** 60

Open **Inbox** in the accounting menu and click a document's name. This page shows the document itself, what Yosher read off it, and what it is attached to. The buttons at the right are the same as on its row in the Inbox. See [The Inbox](inbox.md) for what each does.

## What you see

- **The top of the page.** `← Inbox` takes you back. The title is the vendor's name as it was read, or the file name. The line under it says how the document arrived: `Emailed by [sender] · “[subject]”` or `Uploaded`, then the date, and `· in trash` if it has been trashed. At the right: {button:Read|outline}, {button:Create bill|primary}, {button:Attach|outline|paperclip}, {button:Record expense|primary}, the {icon:trash}, or {button:Restore|outline} for a trashed document.
- **The preview.** The left-hand card shows the document itself: the image, or the PDF in your browser's own viewer with its own zoom and page controls. An email that arrived with nothing readable attached shows `This email arrived with no readable attachment — kept for the paper trail.`
- **`What we read`.** The right-hand card, six rows: `Vendor`, `Date`, `Total`, `Tax` (when it was itemized), `Currency` and `Number`, the invoice, bill or receipt number. Beside each value is a percentage, how sure the reading is. A row Yosher could not read shows a dash and no percentage. Under the rows, `Line items` lists up to 25 lines with their amounts, when the document had them.
- **`Attached to`.** The lower right-hand card lists what the document is attached to, such as `Bill — Ridgeline Feed · INV-4471`, `Invoice 1042`, `Journal entry · 2026-08-14 · Fuel` or `Bank transaction · 2026-08-14 · TRACTOR SUPPLY`, each with an {icon:x} to detach.

Nothing on this page goes into your books on its own. The values only fill in the form when you create a bill or record an expense, and you can change any of them there.

## How to read a document again

1. If the card says `Not read yet — use the Read button.` or `We couldn't read this document automatically.`, click {button:Read|outline}.
2. You see `Document read.` and the six rows fill in. If it still cannot be read, file it by hand with {button:Create bill|primary} and type the values.

## How to detach a document

1. Click the {icon:x} beside the record in `Attached to`. You see `Detached.`
2. Detaching the last attachment sends the document back to `To file`.

## Messages

| Message | What it means |
| --- | --- |
| `Not read yet — use the Read button.` | Reading has not been tried. |
| `We couldn't read this document automatically.` | Reading failed. Try {button:Read|outline} again, or file it by hand. |
| `Not attached to anything yet.` | The document is still waiting to be filed. |
| `Detach this file from its transactions before trashing it.` | A document that is attached to something cannot be trashed. |

## Not on this page

Nothing in the Inbox is ever deleted for good. A trashed document can always be restored.

## Who can do what

Owners and staff read, create bills, attach, detach and trash. Only owners see {button:Record expense|primary}. Accountants can read the page, and any change answers `Accountant access is read-only — reviews, sign-offs and exports only.`
