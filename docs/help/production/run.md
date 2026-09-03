# One {{productionRun|lower}}

> What went in, what came out, the paperwork the plant sent back, and the three ratios between them.
> **Route:** /dashboard/m/production/*
> **Order:** 20

Open **Production** and click a name. The heading is the name, with the kind, the dates and who did it beneath.

Beside it sit badges: {badge:Open|primary} or {badge:Finished|outline}; `Done here` or `Sent out · Miller's`; and, **once it is finished**, how it was inspected. An open {{productionRun|lower}} never shows an inspection badge, because that is decided when you finish.

## What you can do

- **{button:What went in|outline}.** Takes stock out and carries its cost onto the {{productionRun|lower}}. Open ones only.
- **{button:What came out|outline}.** Records boxes as they come off. Open ones only.
- **{button:Finish|primary}.** Lands the boxes in stock. Owners only, and greyed until something has come out.
- **{button:Read a photo|outline}** and **{button:Add a line|outline}** on the {{killSheet|lower}} panel. Anyone, on a finished {{productionRun|lower}} too.

## The three panels

- **`Yield`.** Pounds packaged over pounds that went in, measured on this one and never a stored factor. Over 100% you get a warning, because that cannot be right and usually means an input nobody weighed or an output weighed in its packaging.
- **`Cost in`.** What the batches that went in had accumulated, stamped as they left, plus what the plant charged once you record it. Inputs that carried no price are counted and named, never invented.
- **`Held by this run`.** What is off the shelf and not yet on another one. Once finished it reads `Landed in stock` and tells you how the cost was split: `By weight.`, `By count.`, or `Not split.`

`Not split.` is a real answer, not a failure. If the outputs are in different units and not all were weighed, they land with no cost and nothing has invented one.

## How to record what went in

1. Click {button:What went in|outline}. The dialog reads `This takes it out of stock straight away and carries its cost onto the run. A batch is required — the cost and the clock are both properties of a batch, not of a stock line.`
2. Pick `What` and `Which batch`. A batch that is blocked is greyed out with the reason printed under it, usually a withdrawal period that has not cleared.
3. Type `How much` and set `When`.
4. **Fill in `Live weight (lb)` if you can.** The help reads `Optional, and the yield is refused without it. Head is a count, not a weight, so there is no ratio to state until somebody puts them on a scale.`
5. Add `Notes`. Click {button:Record|primary}. You see `Recorded in — it has left stock`.

An input cannot be removed or edited here. It is a stock movement, and the way back is a correction in Inventory.

## How to record what came out

1. Click {button:What came out|outline}. The dialog reads `Nothing lands in stock yet. The cost split across the outputs cannot be worked out until they have all come off the line.`
2. Pick `What`, or `Something new...` to create a stock line. That option is owners only.
3. Type `How much`, and the `Weight (lb)` if it is counted rather than weighed.
4. `Batch name` starts as the {{productionRun|lower}}'s own name. It becomes a made-here batch, so traceability follows back to here.
5. Pick `Where it goes`. Add `Notes`. Click {button:Record|primary}.

You see `Recorded out — it lands in stock when the run finishes`. While the {{productionRun|lower}} is open you can remove an output freely, because nothing has been posted.

## The {{killSheet|lower}}

This is what the plant found. It usually arrives days later, sometimes by post, and **filling it in long after the boxes have landed changes nothing about the cost**.

- **The reconciliation line** compares head on the sheet against head that went in, and says in amber when they disagree.
- **`Why they were condemned`** groups the causes, largest first. A cause nobody wrote down is still a condemnation and is counted as its own group rather than dropped.
- **`Dressing percentage`** is hanging weight over live weight. When the plant weighed every carcass, condemned animals come out of both sides properly. When only your own trailer weight covers them, they stay in and the caveat says so.
- **`Cutting yield`** is packaged over hanging.

Both ratios refuse rather than mislead. `The kill sheet accounts for fewer head than went in` means finish the sheet and it becomes answerable.

**A condemned line never carries a hanging weight.** Nothing off it can be sold, so it is out of both sides of the cutting yield rather than dragging it down. The form removes the box when you mark a line condemned.

### How to fill it in

1. Click {button:Add a line|outline}. One line per outcome, not per animal. `A hundred birds with three condemned is two lines: ninety-seven that passed and three that did not.`
2. Pick `Came out of`, set the `Outcome`, and type `Head on this line`.
3. Add a `Tag` for a beef. Seventy broilers do not have one, and the help says inventing identities for them would be a worse record than none.
4. Fill in `Live weight at the plant (lb)` and `Hanging weight (lb)`. These are the plant's scale, not yours.
5. For a condemned line, give the `Cause, as the sheet gives it`. It is optional, because a sheet can be smudged or silent.
6. Click {button:Record|primary}.

To read it off a photo instead, click {button:Read a photo|outline}, say which input the carcasses came out of, and choose the file. It reads it and shows you every line to check. **Nothing is recorded until you press {button:Record these|primary}**, an empty box means it could not read that number and would not guess, and you can untick any line.

## How to finish

1. Click {button:Finish|primary}. Owners only.
2. Set `Finished`.
3. Type `What Miller's charged`. It starts from the {{cutSheet|lower}} quote if there is one. **Leaving it empty records that nobody has said, which is not the same as zero.**
4. Click {button:Finish and land|primary}.

You see something like `4 batches landed in stock · $1,431.20 carried across, $235.00 of it processing · by weight`.

The boxes land in stock as made-here batches, sharing what the {{productionRun|lower}} took on. **Their cost is stamped as they land and is never recalculated**, so buying dearer feed next month will not change what this one cost. The inspection is frozen onto every box at the same moment.

## Messages

| Message | What it means |
| --- | --- |
| `Recorded in — it has left stock` | The input is on the {{productionRun|lower}} and out of stock. |
| `Recorded out — it lands in stock when the run finishes` | The box is recorded. It has not landed yet. |
| `Carcass recorded` / `Condemnation recorded` | The {{killSheet|lower}} line is in. |
| `More came out than went in, which cannot be right` | Check for an unweighed input or an output weighed in its packaging. |
| `Nothing that went in was weighed.` | No yield. Put them on a scale and it becomes answerable. |
| `Every carcass on this sheet was condemned.` | No yield to state. The whole of what went in is a loss. |
| `Nobody has recorded how this {{processor|lower}} is inspected` | Nothing can say where the meat may be sold. Ask them, and record it. |
| `Only an owner can change this.` | Starting and finishing are owners only. |

## Not on this page

- An input cannot be removed or edited. Correct it in Inventory.
- Once finished, outputs cannot be edited. The receipt in stock is the record.
- A {{productionRun|lower}} cannot be reopened, cancelled or deleted.
- Nothing here prints. The printable page is the {{cutSheet|lower}}.
- Crew and hours are recorded and never costed.
- If you need any of this, ask us.

## Who can do what

Everyone can record what went in and what came out, transcribe the {{killSheet|lower}}, correct a line, remove one, and write a {{cutSheet|lower}}. A processing day is two or three people, and transcribing somebody else's paperwork decides nothing.

Only an owner can start one, finish one, or create a new stock line from the `What came out` dialog.
