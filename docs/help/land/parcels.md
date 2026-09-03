# Your {{parcel|plural|lower}}

> The Land list: every {{parcel|lower}} the business holds, the buttons for adding and combining them, and the shortcut that tells you which paddock you are standing in.
> **Route:** /dashboard/m/land
> **Order:** 10

Open **Land** in the sidebar. This page lists every {{parcel|lower}} the business holds. To add one, click {button:Add parcel|primary}. To bring your ground in from the county's records instead, click {button:Find my parcels|outline|search}. See [Find my parcels](find-my-parcels.md).

## What you see

- **The line under the title.** A count and a total, such as `5 parcels · 142.5 acres`. If some {{parcel|plural|lower}} have no area recorded it says so, `142.5 acres (2 not recorded)`, and if none do it reads `not recorded`. Before anything is added it reads `The ground the business holds, and what each part of it is for.`
- **The buttons.** Owners see up to three at the right of the title. Staff see none. {button:Which paddock am I in?|outline} appears once at least one {{zone|lower}} has a boundary traced. {button:Find my parcels|outline|search} opens the county parcel search. {button:Add parcel|primary} opens the dialog.
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

## Messages

| Message | What it means |
| --- | --- |
| `No ground recorded yet` and `Add the first {{parcel|lower}} — a deed or a lease. Divide it into {{zone|plural|lower}} and everything that happens on the ground has somewhere to land.` | The list is empty. Owners see this with the button. |
| `An owner adds the parcels the business holds. Once they do, they show up here.` | The list is empty and you are staff. |
| `You are not inside any mapped paddock. Trace its boundary and this will find it.` | Your position is not inside any {{zone|lower}} with a traced boundary. |
| `Location is blocked for this site. Allow it in the browser to use this.` | The phone is refusing to share its position. Allow it in the browser. |
| `Could not get a location. Under trees it can take a moment — try again.` | The phone could not get a fix. Try again in the open. |

## Not on this page

There is no button for seeing retired {{parcel|plural|lower}}, only the address trick above. Ask us if you need one.

## Who can do what

Owners add, combine and find {{parcel|plural|lower}}. Staff see the list and no buttons.
