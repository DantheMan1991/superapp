# One {{zone|lower}}

> A {{zone|lower}}'s own page: what is on it now, how long it has rested, what it has been for, and the stays that every rest figure is worked out from.
> **Route:** /dashboard/m/land/*/zones/*
> **Order:** 40

## The top of the page

The link at the top carries the {{parcel|lower}}'s name and takes you back to its page. The title is the {{zone|lower}}'s name, and the line under it shows its area, what it is currently for, a `not productive` badge for ground that is not expected to earn, and `retired` if it has been retired.

On an active {{zone|lower}}, everyone sees the buttons. Recording what is on the ground is a chore, not an owner's decision.

## The three panels

**Rested**, or **Currently** while something is on it. The large figure is `Occupied now`, `Never used`, or the days since the last stay ended, for example `18 days`. Under it: what is on it and since when, `Nothing has been recorded on it yet.`, or `Since [date]`. If the {{parcel|lower}} has a rest target, a line compares: `Target on this parcel is 21 days — met.` or `— 3 short.` It is a comparison only. Nothing is refused for being short.

**Grazing days.** The total days something has been on it, `Across 6 stays, all time.`

**What it is for.** The last five uses with their dates, or `Nothing declared yet.` A use is set from the {{zone|lower}}'s menu on the {{parcel|lower}}'s page.

## Boundary

The same reading as on the {{parcel|lower}}'s page: the measured area against the recorded one. The boundary itself is traced on the {{parcel|lower}}'s site plan; **the site plan** in this section is a link there. Owners can also paste a boundary as GeoJSON, with **Add a boundary** or **Replace boundary**.

## Recording a stay

Click **Record a stay**. The dialog is `What is on this {{zone|lower}}?`. While nothing is on it, the description reads `Leave the end date blank while it is still there. Rest is counted from the day it moves off.` While something is already on it: `Something is already here — move it off first, or record a stay that has already finished.`

- **What is on it.** Required. A name you type, such as `Cow herd`. It is a name, not a pick list. Something recorded from Livestock arrives here with its own name.
- **On.** The first day. Today to begin with.
- **Off.** The last day. Leave it blank while it is still there.
- **Area used, in acres** (or hectares). Leave blank for the whole {{zone|lower}}. `Running polywire? Put the strip size here — it is recorded against this stay, not as a place of its own.`
- **Notes.**

Click **Record**. You see `Recorded`.

The same name cannot be on two places at once. If it is still recorded somewhere else, the dialog says so: `Cow herd is already somewhere and has not been moved off. Move it off first.` A stay in the past that overlaps an old one is fine.

A stay recorded for a future date counts for nothing until that day arrives. A stay with an end date in the future means they are still there.

## Moving off

While something is on it, **Move off** appears at the top. The dialog is `Move [name] off?`, `Rest is counted from this day. It went on [date].` Set **Last day on it**, today to begin with, and click **Move off**. You see `Moved off — the rest clock starts now`.

The day it moves off counts as a day on this {{zone|lower}}. On Monday and off Monday is one grazing day.

To move something from one {{zone|lower}} to another, move it off here and record a stay on the other one. There is no single move button in Land. A move made from Livestock does both in one act.

## The stays table

Headed **Stays** with a count. Columns: **What**, with any notes underneath; **On**; **Off**, which shows `still on it` for an open stay and `not yet` for one that has not started; **Days**, counted with both ends included, or a dash while open; **Area used**, or `all of it`; and **Remove**.

**Remove** asks `Remove this stay?` and repeats what it was and when, then: `Every rest and rotation figure for this area is computed from these records, so remove it only if it did not happen.` Click **Remove**.

A stay cannot be edited. A wrong date is fixed by removing the stay and recording it again.

Before any stay is recorded the table reads **Nothing recorded yet** and `Every rest and rotation figure is computed from these, so the first one is what makes the rest of the page work.`
