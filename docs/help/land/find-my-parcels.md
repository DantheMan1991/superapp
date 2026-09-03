# Find my parcels

> Bringing your ground in from the county's own parcel records, with the boundary and acreage already drawn.
> **Route:** /dashboard/m/land/find
> **Order:** 50

## What it does

The page is described as `The county has already drawn your boundaries. Take the ones that are yours, with their acreage, and trace paddocks inside them afterwards.` Owners only.

It searches a public parcel service. Today that is `Ohio statewide parcels`. Ground in another state cannot be found here yet; it is added by hand and traced on the site plan.

Before your first search, the box in the middle reads `The county already drew your boundaries.` and `Search for them and they arrive with their acreage, ready to have paddocks traced inside them. Nothing is added until you tick it.`

## Searching

- **Search by.** `Tax mailing address`, the default, or `Parcel number`.
- **County.** The county the ground is in, for example `Knox`. It may already be filled in for you.
- **Mailing address** or **Parcel number**, depending on what you chose. For an address, type the street address the tax bill goes to, such as `11729 Leedy Rd`. For a parcel number, type it as it appears on the bill; dashes and spaces are ignored.

Click **Search**, or press Enter. It needs at least three characters.

Searching by mailing address is the usual way, because that is how the county groups a holding: `Every parcel whose tax bill goes to this address, from Ohio statewide parcels. That is how the county groups a holding, so it usually finds the whole farm at once.`

If nothing comes back: `Nothing matched. Check the county, and try fewer words — the county stores addresses in its own way and a partial one matches more.`

## What comes back

A heading counts the results, `6 found`, and once you tick some, `· 2 chosen, 84.1 acres`. Up to 50 are shown. The table has:

- A tick box.
- **Parcel.** A suggested name, usually the street address, or `Parcel [number]` when there is none, with the county's parcel number underneath.
- **Where.** The mailing address.
- **County acres.** The acreage the county has on record.
- **Measured.** The acreage measured from the county's drawn boundary.

Nothing is ticked for you. Under the table: `Tick only the ground that is yours. This searches by where the tax bill goes, which groups a holding well and is not proof of ownership — a shared address pulls in a neighbour's field.`

A note under the results says how current the county's records are, for example `County records here are as of 2023-05-16. Anything split, sold or re-parcelled since then will be missing, or will still show its previous owner — search the parent parcel number and adjust the boundary, or trace it on the map.` A recent split can be invisible here for that reason.

## Adding them

Tick the ground that is yours and click **Add 2 parcels**. You see `2 parcels added` and land back on the Land list.

Each one arrives as a {{parcel|lower}} named as suggested, with `Owned` tenure, the county's acreage as its recorded area, the county parcel number as its deed reference, and the county's boundary already traced. Its page then shows the measured area against the recorded one straight away. Change the tenure or the name with **Edit** on the {{parcel|lower}}'s page.

Adding the same parcel twice makes a second {{parcel|lower}}. Nothing checks the county number for you, so tick each one once.
