# Everything you hold

> The list of what the business holds, what is on hand and where, what nobody has costed, and what is going off soon.
> **Route:** /dashboard/m/inventory
> **Order:** 10

Open **Inventory** in the sidebar. The heading reads `What the business holds, where it is, and which batch it came from.` To add something new, click {button:Add item|primary}. To add many at once, click {button:Paste a list|outline|sparkles}. On a phone each {{item|lower}} is a card with its figure on the right. On a wide screen the same list is a table.

## What you see

- **{button:Add item|primary}.** Opens the dialog that adds a new kind of thing you hold. Owners only.
- **{button:Paste a list|outline|sparkles}.** Reads a pasted list, or a photo of one, and proposes a row per kind of thing for you to check before anything is added. Owners only. See how to paste a list, below.
- **The five tabs.** `Items` is this page. `Counting`, `What it is worth` and `Deliveries & invoices` are the other screens. `When it is deducted` only appears for an owner. The strip scrolls sideways on a narrow screen.
- **`What it is worth`.** The cost standing in stock right now. Click the card to open the full valuation. Underneath it tells you whether every batch carries a cost, or how many are `Short by 2 batches nobody has costed`. A minus in front of the figure means more stock has left some batch than ever went into it; the valuation page shows which.
- **`Not costed`.** How many batches nobody ever put a price on. `None` is the good answer. This card is also a link to the valuation.
- **`Going off soon`.** How many batches are past their date or within six weeks of it. It turns red when any batch is already past its date, and takes the accent color when something is close. The line under it says which: `2 past their date, 3 more within six weeks`. Click the card to jump to the list below.
- **`Going off soon` list.** Soonest first, so anything past its date comes first. On a phone, one card per batch: the name, the batch, how much is on hand, and a badge reading `past its date`, `goes off today`, `goes off tomorrow` or `goes off in 5 days`, with the date beside it. On a wide screen the same as a table: `What`, `Batch`, `On hand` and `Good until`. Tap or click anywhere on a card or row to open the {{item|lower}}. The first twelve are shown, and the line under the list reads `12 of 27 shown` when there are more.
- **The filter rows.** Pills for each kind, pills for each line of business, pills for each place, a search box, and a link that shows or hides retired things. The line-of-business row only appears once something is tagged. The place row only appears once something has been recorded in a place.
- **The list.** On a phone, one card per {{item|lower}}: the name, the kind and how it has to be kept, the figure on the right, a going-off badge when one of its batches is dated, and `running low` or `out` when it has fallen to its reorder point. That badge always counts everything you hold, so with a place picked it can sit beside a healthy figure for that one place. Retired things never carry it. Tap anywhere on the card to open it. On a wide screen: `{{item}}`, `Kind`, `Keeps` and `On hand`. Click anywhere on a row to open it.
- **`Keeps`.** Whether it has to be `Frozen`, `Refrigerated`, `Dry` or `Ambient`. A dash means it does not matter.
- **`On hand`.** How much there is, in the unit it is counted in. A dash means nothing has ever been recorded, which is not the same as zero. With a place picked, the column reads `On hand at Market truck` and shows only what is there.
- **`managed in Livestock`.** Beside an {{item|lower}} whose kind is `Livestock`, when you have Livestock switched on. Animals are one thing seen from two pages; this is the pointer to the other one.

The three cards only appear once you hold something. The `Going off soon` list only appears when something actually is.

## How to add something you hold

1. Click {button:Add item|primary}. The dialog reads `Something you hold a quantity of — feed, cartons, ground beef.`
2. Type a `Name`, up to 200 characters.
3. Pick a `Kind` from `Feed`, `Produce`, `Meat`, `Egg`, `Supply`, `Livestock`, `Seed` or `Medicine`. To use a word of your own, pick `Something else…` and type it. Lowercase letters and numbers only, starting with a letter.
4. Pick `Counted in`. **Choose carefully.** The help reads `Every balance for this item is kept in that unit, and it cannot be changed once anything has moved.` Count meat in packages, not pounds, because a package is what gets handed over.
5. Fill in `Bought in` and `How many, each` if you buy it in a different unit from the one you count it in. `Bought in` is free text, such as `bag`, and `How many, each` is how many of the counted unit are in one of those.
6. Type `Reorder at` if you want to be told when it runs low. The help reads `You are told on What needs you when on hand falls to this, in the unit you count it in. Blank for no reminder.` Nothing stops you using stock below it; it is a reminder, not a limit.
7. Pick a line of business if you keep them. Batches inherit it.
8. Pick `Needs to be kept` if it has to be kept cold or dry. It starts on `Doesn't matter`.
9. Add `Notes` if you want. Up to 5,000 characters.
10. Click {button:Add item|primary}. You see `Item added` and the row appears in the list.

The button stays grayed until you have picked both a `Kind` and a `Counted in`, and nothing on the screen says which one is missing. There is no cancel button, so close the dialog with the X.

The `Kind` and `Counted in` you picked stay selected the next time you open the dialog, even though the text boxes clear. Check them both before adding a second thing.

**Animals are started in Livestock, not here.** Pick `Livestock` as the kind and the dialog says so and stops you, with a link across. That only happens when you have Livestock switched on.

## How to see what is in one place

1. In the `Place` row, tap the place: a freezer, a barn, the truck. The pills show how many things have stock in each.
2. The list narrows to what has stock there, and the figure beside each {{item|lower}} is what is in that place, not the total. On a wide screen the column reads `On hand at Market truck`.
3. Tap `No place` to see stock that was recorded without saying where it went. It only appears when there is some.
4. Tap `All` to see everything again.

A place is an asset with `Things are kept here` turned on, under [Assets](../assets/overview.md). The row only appears once something has been recorded in one.

## How to find something

1. Type into the box marked `Find by name` and press Enter, or tap {button:Find|outline}. On a phone the box takes the whole row.
2. To narrow by kind, tap one of the pills. `All` puts them back. The number on a pill is how many are in the list under it.
3. To narrow by line of business, tap one of those pills. `Not set` finds things you never tagged.
4. To narrow by place, tap one in the `Place` row.
5. Tap {button:Show retired|ghost} to include things you have retired. They carry a `retired` badge, and the counts on the pills then include them. The link then reads {button:Hide retired|ghost}.
6. Tap {button:Clear filters|ghost} to drop all of it at once. The line beside it says how many rows the filters left.

The search looks at names only. A bag of feed for the beef herd is not called beef, and the empty state says so. Kind, line of business, place and search combine, so `Meat` with the truck picked is the meat on the truck.

## How to paste a list of what you hold

1. Click {button:Paste a list|outline|sparkles}. `Paste a list of kinds of stock` opens and reads `Paste a list, columns from a spreadsheet, or add a photo of one. You'll see every row it found and can change anything before it saves.`
2. Paste into `The list`, or click `Or a photo of it` and choose a photo or a PDF of up to 4 MB. A shelf list, a feed-store invoice, or the left-hand column of a spreadsheet all work. The counter under the box reads `0 / 20,000` and counts up. Only what you paste or attach is sent, and nothing else about your business.
3. Click {button:Read it|primary}. Its label turns to `Reading…` while it works. The line under the title then reads `9 kinds of stock found. Untick what you don't want, fix what's wrong, then add them.`
4. Check the rows. Each has `Name`; `Kind`, a pick list of feed, produce, meat, egg, supply, livestock, seed, medicine and any kind you already use; `Counted in`, a pick list of the units, which must be chosen; `Bought in`, such as `bag`; `How many, each`, such as `50` for a 50 lb bag; `Kept`, frozen, refrigerated, dry or ambient; and `Notes`. On a wide screen it is a table, on a phone one card per row. When the list said a unit it does not have, the cell is left empty and an amber line reads `The list said “boxes” for counted in — pick one, or leave it blank.`; while a ticked row has no unit, `Counted in is missing.` shows under it and the button stays gray. A row that names something you already hold comes back unticked and reads `Already here as “Layer pellets”. Unticked — tick it to add another.`
5. Click {button:Add 9 kinds of stock|primary}. It reads `Adding…`, then you see `Added 9 kinds of stock`, the dialog closes and the page refreshes. Nothing is saved until you click it. If any ticked row is refused, nothing is saved at all, and the message names the row.

No quantities and no costs are read. What is on the shelf is recorded as a count or a delivery, and a cost nobody ever tracked stays blank rather than guessed. {button:Start over|ghost} clears the rows and the list you pasted; closing the dialog does the same. Leave ten seconds between readings. At most 200 rows come back from one reading.

## Messages

| Message | What it means |
| --- | --- |
| `Nothing to add from that.` | The reading found nothing of this kind in what you pasted or attached. |
| `Row 3 (Fence staples): Counted in is missing.` | The third ticked row has no unit. Pick one, or untick the row. |
| `Row 3 (Fence staples): …` | The third row was refused for the reason given after the colon. Nothing was added. Fix the row and add again. |
| `Give it a few seconds, then try again.` | Two readings inside ten seconds. |
| `That file is too large. 4 MB at most.` and `A photo (JPEG, PNG, WebP or GIF) or a PDF.` | The photo is too big, or not a kind it can read. |
| `It could not read that. Try a cleaner copy, or fewer rows at a time.` | The reading came back in a shape it could not use. |
| `Item added` | It worked. The new row is in the list. |
| `Nothing tracked yet` | Nothing has been added. An owner adds the first one. |
| `Nothing matches` | Your filter or search found nothing. Click {button:Clear filters|outline} to start again. |
| `Nothing has stock at Market truck.` | The place you picked holds nothing that matches the other filters. |
| `Everything with stock has a place recorded.` | You picked `No place` and nothing is left unplaced. |
| `Every batch on hand carries a cost` | Nothing is missing a price. The valuation is complete. |
| `Short by 2 batches nobody has costed` | Two batches have no price, so the total is understated by an unknown amount. |
| `Nothing within six weeks` | No batch is past its date or close to it. |
| `2 past their date, 3 more within six weeks` | Two batches are already past their date and three are close. Both are in the list below. |
| `Check the details and try again.` | Something in the dialog is not right. Most often `How many, each` was left at zero. |
| `Use lowercase letters, numbers and underscores.` | Your own kind has a capital, a symbol, or starts with a digit. |
| `Only an owner can change stock records.` | You are signed in as staff and pressed something an owner keeps. Recording stock and counting are not among them. |
| `Something went wrong saving that.` | Something unexpected. Try again, and tell us if it keeps happening. |

## Not on this page

- You cannot edit, retire or record anything from a row. Open it first.
- The list cannot be sorted. It is always kind first, then name.
- The figure on a card is the count in its unit. What it weighs is on the {{item|lower}}'s own page.
- Nothing warns you at the moment you record something that it will take stock below zero.
- Nothing can be brought in from a spreadsheet. Ask us if you have a long list.

## Who can do what

Only an owner can add anything here, and only an owner sees the `When it is deducted` tab. Everyone else sees the same list, the same cards, the same filters and the same figures, with no button in the corner.
