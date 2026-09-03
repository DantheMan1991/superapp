# A close

> One close: the checklist as it stood on the day, sign-off and review notes between the owner and the accountant, and the AI-written narrative of the month.
> **Route:** /dashboard/m/accounting/close/*
> **Order:** 330
> **Area:** Close

Open **Close** in the accounting menu and click a period end in the history. This page is the record of one close, and where the owner and the accountant agree the month is done. An owner or accountant signs it off with {button:Sign off this close|primary|pen-line}.

## What you see

- **The top of the page.** The line above the title reads `Close / 2026-08-31`, with the company's name after it when you keep more than one; `Close` goes back to the Close page. The title is `Close through 2026-08-31`, or `Maple Street LLC — close through 2026-08-31`. Under it: `Completed by Dan on 2026-09-01`, and, if the close was reopened, ` · reopened by Dan on 2026-09-03`. Two badges at the right: {badge:Completed|success} or {badge:Reopened|secondary}, and {badge:Signed off · Dan|outline} once somebody has signed off.
- **`Checklist snapshot`.** `As recorded when the books were closed (2026-09-01).` The eight checklist items as they stood at the moment of the close, each with a green check or an amber alert and a count in brackets. It is a record, not a to-do list, so there are no Review links. The live checklist is on the Close page. See [Close](close.md).
- **`Review`.** `Sign-off and notes — the owner ↔ accountant dialogue.` {button:Sign off this close|primary|pen-line} at the top right, for an owner or an accountant while the close is completed and not yet signed off. Notes listed under it, each with who wrote it and the date, such as `Dan · 2026-09-02`, and the note as written. A box, `Leave a review note for this close…`, with {button:Add note|primary}.
- **`Close narrative`.** A plain-English summary of the month, written by AI for you to read. The card reads `A plain-English summary of the period, written by AI.` until one exists, then `Generated 2026-09-01 · [model] — AI-written, review before relying on it.` Owners and accountants see {button:Generate narrative|outline|sparkles} at the top right of a completed close, or {button:Regenerate narrative|outline|sparkles} when one exists. The narrative opens with up to five highlights in bold, each with a short detail, then a few short paragraphs.
- **{button:Back to Close|outline}** at the bottom.

## How to sign off a close

1. Read the snapshot and the narrative, and the notes if there are any.
2. Click {button:Sign off this close|primary|pen-line}. It reads `Signing…`, then you see `Close signed off.` The badge {badge:Signed off · [your name]|outline} appears at the top of the page and in the close history.

A close is signed off once. Signing off is a separate click by a person; the narrative never signs off anything.

## How to leave a note

1. Write in the box, up to 2,000 characters.
2. Click {button:Add note|primary}. It reads `Adding…`, then the note appears in the list. A note cannot be edited or deleted, so the conversation stays as it happened.

## How to get the narrative

1. Click {button:Generate narrative|outline|sparkles}, or {button:Regenerate narrative|outline|sparkles} to write it again. It reads `Writing…`, then you see `Narrative generated.`
2. Read it as a reviewer's first draft. The period it covers runs from the day after the previous close, or from the start of the fiscal year for a first close, to the period end. The AI is given this company's profit and loss for the period with the previous period beside it, its cash activity, its balance sheet at the period end, the checklist items still open, the ten largest posted entries, and the names of vendors and customers added in the period. It is told never to invent a number and to flag open items plainly. It never posts, changes or signs off anything.

## Messages

| Message | What it means |
| --- | --- |
| `No notes yet.` | Nobody has left a note on this close. |
| `No narrative yet. Generate one to get the month in plain English.` | The summary has not been written. Click {button:Generate narrative|outline|sparkles}. |
| `This close is already signed off.` | A second sign-off was attempted. |
| `That close was reopened — complete a new close first.` | A reopened close cannot be signed off or given a new narrative. It keeps the narrative it has. |
| `This entry changed since you opened it — reload and try again.` | The close changed while your page was open. |
| `Suggestions were just requested — try again in a moment.` | You clicked the narrative button twice within a few seconds. |
| `The AI service didn't return usable suggestions. Try again.` | The AI did not answer usefully. Try again. |

## Not on this page

Notes cannot be edited or deleted. The narrative is a review aid, not a figure in the books.

## Who can do what

Owners and accountants sign off, add notes and generate the narrative. Staff read the page.
