# Your {{parcel|plural|lower}}

> The Land list: every {{parcel|lower}} the business holds, the buttons for adding and combining them, and the shortcut that tells you which paddock you are standing in.
> **Route:** /dashboard/m/land
> **Order:** 10

Open **Land** in the sidebar. This page lists every {{parcel|lower}} the business holds. To add one, click {button:Add parcel|primary}. To bring your ground in from the county's records instead, click {button:Find my parcels|outline|search}. See [Find my parcels](find-my-parcels.md). To bring in your {{zone|plural|lower}} from a list, click {button:Paste a list|outline|sparkles}.

## What you see

- **The line under the title.** A count and a total, such as `5 parcels · 142.5 acres`. If some {{parcel|plural|lower}} have no area recorded it says so, `142.5 acres (2 not recorded)`, and if none do it reads `not recorded`. Before anything is added it reads `The ground the business holds, and what each part of it is for.`
- **The buttons.** Owners see up to four at the right of the title. Staff see none. {button:Which paddock am I in?|outline} appears once at least one {{zone|lower}} has a boundary traced. {button:Find my parcels|outline|search} opens the county parcel search. {button:Paste a list|outline|sparkles} reads a list of {{zone|plural|lower}}, or a photo of one, and proposes a row each for you to check before anything is added; see how to paste your {{zone|plural|lower}}, below. {button:Add parcel|primary} opens the dialog.
- **`Combine`.** When the list holds more than one {{parcel|lower}}, owners see a strip above the table with a check box for each {{parcel|lower}} and its area. Check two or more and the button at the right reads {button:Combine 2 parcels|primary}.
- **The table.** `{{parcel}}`, the name, which opens the {{parcel|lower}}'s page, with the deed or lease reference in small text under it when one is recorded; `Tenure`, which is `Owned`, `Leased` or `Crop share`; `{{zone|plural}}`, how many active {{zone|plural|lower}} it holds, not counting proposed or retired ones; and `Area`, or a dash when none is recorded.
- **Retired {{parcel|plural|lower}}.** Hidden. To see them, add `?retired=1` to the end of the page's address. Each carries {badge:retired|outline}. There is no button for this yet.

## How to add a {{parcel|lower}}

1. Click {button:Add parcel|primary}. The dialog is `Add a parcel` and reads `A deed or a lease — the unit the business holds ground by.`
2. Fill in `Name`. Required.
3. Pick `Tenure`: `Owned`, `Leased` or `Crop share`. There is no fourth option, because each of these has a defined meaning in the books.
4. Fill in `Area in acres` if you know it. `Leave blank if unknown`. Leave it blank rather than typing zero, because blank means not recorded.
5. Fill in `Deed or lease reference` if you have it: the parcel number from the tax bill, or the lease. Add `Notes` if you want them.
6. Click {button:Add parcel|primary}. It reads `Saving…`, then you see `Parcel added` and the new row in the table.

## How to find out which paddock you are standing in

1. On your phone, standing in a field, click {button:Which paddock am I in?|outline}. It reads `Finding you…`.
2. The page of the {{zone|lower}} you are standing in opens. If you are between two, the smaller one wins, so a strip inside a paddock finds the strip.

Nothing is recorded when you use this.

## How to combine two deeds that are one block of ground

1. Check the {{parcel|plural|lower}} in the `Combine` strip and click {button:Combine 2 parcels|primary}. The dialog is `Combine into one parcel` and reads `The county still knows these as separate deeds and always will — both parcel numbers are kept on the result. Nothing is deleted.`
2. Pick `Keep the record for`, the {{parcel|lower}} that survives: `This one keeps its id, so every cost and every journal line already tagged to it follows the combined parcel. The others are retired.`
3. Fill in `Call it`, the combined name. It starts as the survivor's name.
4. Read the box headed `What happens`. It spells out how many become one and at what area, that the boundaries are kept as separate pieces of the same {{parcel|lower}} so the acreage stays exact whether or not they touch, how many {{zone|plural|lower}} move across, and that the others are retired, not deleted.
5. Click {button:Combine|primary}. You see `Combined into [name].`, with the number of {{zone|plural|lower}} that moved when there were any.

A retired {{parcel|lower}} cannot be brought back, so combining cannot be undone.

## How to paste your {{zone|plural|lower}}

1. Add at least one {{parcel|lower}} first. Until there is one, the dialog reads `Add a parcel first, so a paddock has somewhere to be.` and stops there.
2. Click {button:Paste a list|outline|sparkles}. `Paste a list of {{zone|plural|lower}}` opens and reads `Paste a list, columns from a spreadsheet, or add a photo of one. You'll see every row it found and can change anything before it saves.`
3. Paste into `The list`, or click `Or a photo of it` and choose a photo or a PDF of up to 4 MB. A rotation sheet, a fence map's key, or the names down the side of a spreadsheet all work. Only what you paste or attach is sent, together with the names of your {{parcel|plural|lower}}, and nothing else about your business.
4. Click {button:Read it|primary}. Its label turns to `Reading…` while it works. The line under the title then reads `20 {{zone|plural|lower}} found. Untick what you don't want, fix what's wrong, then add them.`
5. Check the rows. Each has `Name`, which must be filled; `Parcel`, a pick list of your {{parcel|plural|lower}}; `Acres`; and `Notes`. With one {{parcel|lower}} the pick list may be left blank and that one is used. With more than one it must be chosen, and a {{parcel|lower}} the list names that is not one of yours leaves the cell empty with an amber line reading `The list said “the back 40” for parcel — pick one, or leave it blank.` A row that names a {{zone|lower}} you already have comes back unticked and reads `Already here as “North 40”. Unticked — tick it to add another.`
6. Click {button:Add 20 paddocks|primary}. It reads `Adding…`, then you see `Added 20 paddocks`, the dialog closes and the list refreshes. Nothing is saved until you click it. If any ticked row is refused, nothing is saved at all, and the message names the row.

A {{zone|lower}} added this way has no boundary. Draw it on the [site plan](site-plan.md) afterwards; until then its acreage is whatever the list gave. {button:Start over|ghost} clears the rows and the list you pasted; closing the dialog does the same. Leave ten seconds between readings. At most 200 rows come back from one reading.

## Messages

| Message | What it means |
| --- | --- |
| `Add a parcel first, so a paddock has somewhere to be.` | You clicked {button:Paste a list|outline|sparkles} with no {{parcel|lower}} yet. |
| `Nothing to add from that.` | The reading found no {{zone|plural|lower}} in what you pasted or attached. |
| `Row 3 (Pen 3): Parcel is missing.` | You have more than one {{parcel|lower}} and the third ticked row does not say which. Pick one, or untick the row. |
| `Row 3 (Pen 3): …` | The third row was refused for the reason given after the colon. Nothing was added. Fix the row and add again. |
| `Give it a few seconds, then try again.` | Two readings inside ten seconds. |
| `That file is too large. 4 MB at most.` and `A photo (JPEG, PNG, WebP or GIF) or a PDF.` | The photo is too big, or not a kind it can read. |
| `No ground recorded yet` and `Add the first {{parcel|lower}} — a deed or a lease. Divide it into {{zone|plural|lower}} and everything that happens on the ground has somewhere to land.` | The list is empty. Owners see this with the button. |
| `An owner adds the parcels the business holds. Once they do, they show up here.` | The list is empty and you are staff. |
| `You are not inside any mapped paddock. Trace its boundary and this will find it.` | Your position is not inside any {{zone|lower}} with a traced boundary. |
| `Location is blocked for this site. Allow it in the browser to use this.` | The phone is refusing to share its position. Allow it in the browser. |
| `Could not get a location. Under trees it can take a moment — try again.` | The phone could not get a fix. Try again in the open. |

## Not on this page

There is no button for seeing retired {{parcel|plural|lower}}, only the address trick above. Ask us if you need one.

## Who can do what

Owners add, combine and find {{parcel|plural|lower}}. Staff see the list and no buttons.
