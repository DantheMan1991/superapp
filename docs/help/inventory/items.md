# Everything you hold

> The list of what the business holds, with what it is worth, what nobody has costed, and what is going off soon.
> **Route:** /dashboard/m/inventory
> **Order:** 10

Open **Inventory** in the sidebar. The heading reads `What the business holds, where it is, and which batch it came from.` To add something new, click {button:Add item|primary}.

## What you see

- **{button:Add item|primary}.** Opens the dialog that adds a new kind of thing you hold. Owners only.
- **The five tabs.** `Items` is this page. `Counting`, `What it is worth` and `Deliveries & invoices` are the other screens. `When it is deducted` only appears for an owner. The strip scrolls sideways on a narrow screen.
- **`What it is worth`.** The cost standing in stock right now. Click the card to open the full valuation. Underneath it tells you whether every batch carries a cost, or how many are `Short by 2 batches nobody has costed`.
- **`Not costed`.** How many batches nobody ever put a price on. `None` is the good answer. This card is also a link to the valuation.
- **`Going off soon`.** How many batches are within six weeks of their date. It turns red when there are any. Unlike the other two cards this one is not clickable, and the list it points at is below.
- **`Going off soon` table.** The soonest first: `What`, `Batch`, `On hand` and `Good until`. A date already past is in red. Only the first twelve are shown.
- **The filter row.** Pills for each kind, pills for each line of business, a search box, and a link that shows or hides retired things.
- **The table.** `{{item}}`, `Kind`, `Keeps` and `On hand`. Click a name to open it.
- **`Keeps`.** Whether it has to be `Frozen`, `Refrigerated`, `Dry` or `Ambient`. A dash means it does not matter.
- **`On hand`.** How much there is, in the unit it is counted in. A dash means nothing has ever been recorded, which is not the same as zero.

The three cards only appear once you hold something. The `Going off soon` panel only appears when something actually is.

## How to add something you hold

1. Click {button:Add item|primary}. The dialog reads `Something you hold a quantity of — feed, cartons, ground beef.`
2. Type a `Name`, up to 200 characters.
3. Pick a `Kind` from `Feed`, `Produce`, `Meat`, `Egg`, `Supply`, `Livestock`, `Seed` or `Medicine`. To use a word of your own, pick `Something else…` and type it. Lowercase letters and numbers only, starting with a letter.
4. Pick `Counted in`. **Choose carefully.** The help reads `Every balance for this item is kept in that unit, and it cannot be changed once anything has moved.` Count meat in packages, not pounds, because a package is what gets handed over.
5. Fill in `Bought in` and `How many, each` if you buy it in a different unit from the one you count it in. `Bought in` is free text, such as `bag`, and `How many, each` is how many of the counted unit are in one of those.
6. Pick a line of business if you keep them. Batches inherit it.
7. Pick `Needs to be kept` if it has to be kept cold or dry. It starts on `Doesn't matter`.
8. Add `Notes` if you want. Up to 5,000 characters.
9. Click {button:Add item|primary}. You see `Item added` and the row appears in the list.

The button stays greyed until you have picked both a `Kind` and a `Counted in`, and nothing on the screen says which one is missing. There is no cancel button, so close the dialog with the X.

The `Kind` and `Counted in` you picked stay selected the next time you open the dialog, even though the text boxes clear. Check them both before adding a second thing.

**Animals are started in Livestock, not here.** Pick `Livestock` as the kind and the dialog says so and stops you, with a link across. That only happens when you have Livestock switched on.

## How to find something

1. Type into the box marked `Find by name` and press Enter, or click {button:Find|outline}.
2. To narrow by kind, click one of the pills. `All` puts them back.
3. To narrow by line of business, click one of those pills. `Not set` finds things you never tagged.
4. Click {button:Show retired|ghost} to include things you have retired. They carry an `archived` badge. The link then reads {button:Hide retired|ghost}.
5. Click {button:Clear filters|ghost} to drop all of it at once.

The search looks at names only. A bag of feed for the beef herd is not called beef, and the empty state says so.

The count of kinds on each pill includes retired things even when the list below is hiding them, so a pill reading `Feed 5` can produce four rows. We are fixing that.

## Messages

| Message | What it means |
| --- | --- |
| `Item added` | It worked. The new row is in the list. |
| `Nothing tracked yet` | Nothing has been added. An owner adds the first one. |
| `Nothing matches` | Your filter or search found nothing. Click {button:Clear filters|outline} to start again. |
| `Every batch on hand carries a cost` | Nothing is missing a price. The valuation is complete. |
| `Short by 2 batches nobody has costed` | Two batches have no price, so the total is understated by an unknown amount. |
| `Check the details and try again.` | Something in the dialog is not right. Most often `How many, each` was left at zero. |
| `Use lowercase letters, numbers and underscores.` | Your own kind has a capital, a symbol, or starts with a digit. |
| `Only an owner can change stock records.` | You are signed in as staff and pressed something an owner keeps. Recording stock and counting are not among them. |
| `Something went wrong saving that.` | Something unexpected. Try again, and tell us if it keeps happening. |

## Not on this page

- You cannot edit, retire or record anything from a row. Open it first.
- The list cannot be sorted. It is always kind first, then name.
- The `Going off soon` list stops at twelve and does not say so, and it includes things that went off before today as well as things about to.
- Nothing warns you at the moment you record something that it will take stock below zero.
- Nothing can be brought in from a spreadsheet. Ask us if you have a long list.

## Who can do what

Only an owner can add anything here, and only an owner sees the `When it is deducted` tab. Everyone else sees the same list, the same cards, the same filters and the same figures, with no button in the corner.
