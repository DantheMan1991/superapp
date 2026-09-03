# Processing not invoiced

> What a plant has done for you and not yet billed, and how to tie their bill to the work when it arrives.
> **Route:** /dashboard/m/production/billing
> **Order:** 60

Open **Production** and click `Processing not invoiced`.

**This is the plant billing you**, not you billing a customer. When you finish a {{productionRun|lower}} and record what they charged, the app puts that amount aside as something you owe. This page is where their bill gets tied to it.

## What you see

Three sections, each only when it has something in it.

- **`Nobody has invoiced this yet`.** Work you have put aside money for and not been billed for, with a running total.
- **`Their bills, and what they are for`.** Bills you have received and matched.
- **`They charged something other than what was put aside`.** Where the bill and your figure disagree.

If your business has no books yet, the page says so instead.

## Before a plant's bill can appear here

**The plant has to be a vendor.** A {{processor|lower}} that has never sent you a bill simply does not appear in the second section, with no error and no explanation.

The empty state says `A bill has to name a vendor, so a {{processor|lower}} that has never sent one does not appear here.` — but that message disappears as soon as any other plant has a draft bill, so on a busy page you get no clue at all.

**Adding the vendor the ordinary way makes it worse**, because it creates a second record of the same business. If a plant's bill is not showing up here, tell us rather than adding them again.

## How to match a bill

1. Find the line under `Nobody has invoiced this yet`.
2. Match it to the bill the plant sent.
3. What you owe clears against what you put aside.

Where the bill differs from your figure, the difference shows in the third section.

**A difference is shown without a minus sign**, so a bill that came in *under* what you put aside looks the same as one that came in over. Check the two figures rather than the difference.

## Messages

| Message | What it means |
| --- | --- |
| `Nobody has invoiced this yet` | Work is done and no bill has come. Normal, for a while. |
| `A bill has to name a vendor, so a {{processor|lower}} that has never sent one does not appear here.` | Set the plant up as a vendor. Ask us rather than adding them again. |
| `Only an owner can change this.` | Matching a bill is owners only. |
| `That no longer exists.` | The bill or the line has gone. Reload. |
| `Something went wrong saving that.` | Something unexpected. Tell us if it keeps happening. |

## Not on this page

- Nothing here bills a customer. This is what you owe the plant.
- A plant that is not a vendor is silently absent, with no message once any other plant is on the page.
- Differences are shown without a sign, so an under-charge and an over-charge look alike.
- Nothing chases a bill that has not arrived. Watch the first section.
- If you need any of this, ask us.

## Who can do what

Only an owner can match a bill, unpick a match, or correct what a {{productionRun|lower}} cost. Everyone else sees all three sections and every figure.
