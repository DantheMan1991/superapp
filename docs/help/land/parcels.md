# Your {{parcel|plural|lower}}

> The Land list: every {{parcel|lower}} the business holds, the buttons for adding and combining them, and the shortcut that tells you which paddock you are standing in.
> **Route:** /dashboard/m/land
> **Order:** 10

## The title line

The page is titled **Land**. Under it is a count and a total, for example `5 parcels · 142.5 acres`. If some {{parcel|plural|lower}} have no area recorded it says so, `142.5 acres (2 not recorded)`, and if none do it reads `not recorded`. Before anything is added the line reads `The ground the business holds, and what each part of it is for.`

## The buttons

Owners see up to three buttons at the right of the title. Staff see none.

**Which paddock am I in?** appears once at least one {{zone|lower}} has a boundary traced. Press it on your phone while standing in a field. The button reads `Finding you…`, then opens the page of the {{zone|lower}} you are standing in. If you are between two, the smaller one wins, so a strip inside a paddock finds the strip.

If nothing is found you see `You are not inside any mapped paddock. Trace its boundary and this will find it.` Other messages: `Location is blocked for this site. Allow it in the browser to use this.` if the phone is refusing to share its position, and `Could not get a location. Under trees it can take a moment — try again.` if it could not get a fix. Nothing is recorded when you use this.

**Find my parcels** opens the county parcel search. See the guide **Find my parcels**.

**Add parcel** opens the dialog **Add a parcel**, described as `A deed or a lease — the unit the business holds ground by.`

- **Name.** Required.
- **Tenure.** `Owned`, `Leased` or `Crop share`. There is no fourth option, because each of these has a defined meaning in the books.
- **Area in acres** (or hectares). Optional. `Leave blank if unknown`. Leave it blank rather than typing zero; blank means not recorded.
- **Deed or lease reference.** Optional. The parcel number from the tax bill, or the lease.
- **Notes.** Optional.

Click **Add parcel**. You see `Parcel added` and the new row appears in the table.

## Combining two deeds

When the list holds more than one {{parcel|lower}}, owners see a strip above the table headed **Combine**, with a tick box for each {{parcel|lower}} and its area. Tick two or more and the button at the right reads `Combine 2 parcels`.

The dialog, **Combine into one parcel**, explains: `The county still knows these as separate deeds and always will — both parcel numbers are kept on the result. Nothing is deleted.`

- **Keep the record for.** Which of the ticked {{parcel|plural|lower}} survives. `This one keeps its id, so every cost and every journal line already tagged to it follows the combined parcel. The others are retired.`
- **Call it.** The combined name. Starts as the survivor's name.

A box headed **What happens** spells out the result: how many become one and at what area, that the boundaries are kept as separate pieces of the same {{parcel|lower}} so the acreage stays exact whether or not they touch, how many {{zone|plural|lower}} move across, and that the others are retired, not deleted. A retired {{parcel|lower}} cannot be brought back, so combining cannot be undone.

Click **Combine**. You see `Combined into [name].`, with the number of {{zone|plural|lower}} that moved when there were any.

## The table

Four columns:

- **{{parcel}}.** The name, which opens the {{parcel|lower}}'s page. Under it, in small text, the deed or lease reference when one is recorded.
- **Tenure.** `Owned`, `Leased` or `Crop share`.
- **{{zone|plural}}.** How many active {{zone|plural|lower}} it holds. Proposed and retired ones are not counted.
- **Area.** The recorded area, or a dash when none is recorded.

Retired {{parcel|plural|lower}} are hidden. To see them, add `?retired=1` to the end of the page's address. Each shows a `retired` badge. There is no button for this yet.

## When the list is empty

Owners see **No ground recorded yet** and `Add the first {{parcel|lower}} — a deed or a lease. Divide it into {{zone|plural|lower}} and everything that happens on the ground has somewhere to land.` Staff see `An owner adds the parcels the business holds. Once they do, they show up here.`
