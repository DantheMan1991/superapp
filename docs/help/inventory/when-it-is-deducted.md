# When stock is deducted

> Where your accountant's decision about each category of stock is written down, and what it does to your reports.
> **Route:** /dashboard/m/inventory/tax
> **Order:** 70

Open **Inventory** and click `When it is deducted`. The tab only appears for an owner. The heading reads `What an accountant decided about each kind of thing you hold, and where it is written down.`

This page is a record of what somebody qualified decided. It is not a preference, which is why it asks who and when.

## What you see

- **`What this changes, and what it does not`.** Three paragraphs at the top, worth reading before anything else.
- **`By category`.** One row per kind of thing you hold, plus a row called `Everything else` at the top.
- **`What`.** The category. `Everything else` is the answer a new category inherits.
- **`Items`.** How many things you hold in that category. The `Everything else` row shows a dash.
- **`Deducted`.** The moment the cost lands.
- **`To`.** The expense account it lands in. A dash means none was chosen.
- **`Decided by`.** Who made the call, and when.
- **{button:Record|ghost}** or **{button:Edit|ghost}** at the end of each row.

Two badges tell you where an answer came from. {badge:inherited|outline} means the category has no answer of its own and is following `Everything else`. {badge:not decided|outline} means nobody has decided anything, so it falls back to `When it is used`, which is what the books already do.

## What the six answers mean

| The cost lands | What it means |
| --- | --- |
| `When it is used` | Stock is an asset until it is issued or used, and the cost lands then. This is what your books do today. |
| `When it is paid for` | The cost lands on the day the supplier's bill was paid. |
| `When the bill is dated` | The cost lands on the bill's date, paid or not. Not built yet. |
| `When it is sold to a customer` | The cost lands when it goes to a customer. Not built yet. |
| `The later of paid and used` | Whichever happened second. Not built yet. |
| `The later of paid and sold` | Whichever happened second. Not built yet. |

Four of the six are shown but cannot be picked, so you can see the shape of the question rather than assuming we cannot ask it.

**What actually changes.** `When it is used` leaves your reports exactly as they are. `When it is paid for` changes your cash-basis reports only: that stock stops appearing on the balance sheet and its cost lands on the day the bill was paid, under the account you named. Your accrual reports are untouched.

## How to record a decision

1. Find the category and click {button:Record|ghost}. If there is already an answer the button reads {button:Edit|ghost}.
2. Pick `The cost lands`. Read the note underneath, which changes with your choice.
3. Pick `Which expense account` when the answer is anything but `When it is used`. It is required for those, because the cost has to land somewhere you chose. Feed, seed and veterinary supplies are separate lines at return time.
4. Type `Who decided`. Nothing forces you to, but the column is called `Decided by` and a dash there defeats the point of the page.
5. Set `When`. It cannot be in the future.
6. Add `Notes` for anything they said that the columns do not carry.
7. Click {button:Record|primary}. You see `Recorded.`

To take a decision back out, open it and click {button:Remove|ghost}. It goes immediately, with no confirmation, and the category falls back to whatever covers it. You see `Removed — it falls back to whatever covers it.`

If you close the dialog without saving and open it again, it may still show the answer you were part-way through choosing rather than the one on record. Check it before saving.

## Messages

| Message | What it means |
| --- | --- |
| `Recorded.` | The decision is on record. |
| `Removed — it falls back to whatever covers it.` | The row is gone and the category inherits again. |
| `No items yet, so there are no categories to decide about. The default row above is what a new one will inherit.` | Nothing is held yet. |
| `Pick the expense account this cost should land in.` | The answer you chose moves cost off the balance sheet, so it has to say where. |
| `The reports cannot apply "when it is sold to a customer" yet` | That answer is not built. Pick one that is. The message goes on to say only `when it is used` is applied, which is out of date. `When it is paid for` is applied too. |
| `Only an owner can change stock records.` | You are signed in as staff. |

## Not on this page

- Only two of the six answers are built. The other four are shown so you can see them, and cannot be chosen.
- `Who decided` and `When` are both optional, although the page is a record of exactly that.
- Removing a decision asks for no confirmation and takes the name and date with it.
- The account list only offers expense accounts.
- If the account you chose is later made inactive, this page still shows a dash rather than saying so, and your cash-basis reports will refuse instead.
- If you need any of this, ask us.

## Who can do what

Only an owner can record, change or remove a decision, and only an owner gets the tab. Staff and your accountant can open this page by its address and read everything on it, with no buttons.
