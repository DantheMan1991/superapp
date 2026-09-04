# Production at a glance

> What went in, what came out, and the yield between them. This guide is the map of the Production pages. Each page has its own guide.
> **Route:** /dashboard/m/production/**
> **Order:** 0

Open **Production** in the sidebar. Five tabs run along the top of every screen: `Overview`, `Every {{cutSheet|lower}}`, `Booked dates`, `Processing not invoiced` and the {{processor|lower}} directory.

## What you see

- **A {{productionRun|lower}}.** One pass of turning things into other things. A processing day, a bake, a milling. What goes in leaves stock and takes its cost with it; what comes out lands in stock when you finish.
- **A {{processor|lower}}.** An outside business that does part of a {{productionRun|lower}} for you. The one you book a date with and send the work to.
- **A {{cutSheet|lower}}.** What you are asking that outside business to do with one lot of work. You print it and hand it over. **It is not a customer order.** One animal can carry two, because a half sold to a customer is cut to their instructions and the retained half to yours.
- **A {{killSheet|lower}}.** What the plant found between the animal and the box: what hung, what was condemned, and why.
- **`Overview`.** Every {{productionRun|lower}} with its yield and what it cost. See [Your {{productionRun|plural|lower}}](runs.md).
- **One {{productionRun|lower}}'s page.** Everything about one. See [One {{productionRun|lower}}](run.md).
- **`Every {{cutSheet|lower}}`.** All of them, and whether they have been printed. See [Every {{cutSheet|lower}}](orders.md) and [One {{cutSheet|lower}}](order.md).
- **`Booked dates`.** Dates you have booked with an outside business. See [Booked dates](bookings.md).
- **`Processing not invoiced`.** What a plant has done and not yet billed you for. See [Processing not invoiced](billing.md).
- **The {{processor|lower}} directory.** Who they are, what they take, what they charge. See [Your {{processor|plural|lower}}](processors.md).

## The idea the whole tool rests on

**A ratio is measured or it is refused.** Every yield on every screen is worked out from this {{productionRun|lower}}'s own weights, never from a stored factor, because the next one will differ. And where a weight is missing, the app shows a dash and tells you why rather than working the ratio out over part of the animals. A ratio over half the carcasses reads as a far better kill than you had.

That is why `Live weight` is worth filling in. Head is a count, not a weight, and there is no ratio until something goes on a scale.

## How a processing day goes

1. Book the date with the plant under `Booked dates`, months ahead.
2. Start a {{productionRun|lower}} on the day, naming the {{processor|lower}} who did the work.
3. Write a {{cutSheet|lower}} for each half or each customer, and print it to send with the animals.
4. Record what went in. It leaves stock immediately and carries its cost onto the {{productionRun|lower}}.
5. Record what came out as the boxes come off.
6. Transcribe the {{killSheet|lower}} when it arrives, which may be days later by post.
7. Finish the {{productionRun|lower}}, typing what the plant actually charged. The boxes land in stock carrying the cost.
8. Match the plant's bill under `Processing not invoiced` when it arrives.

## Where the meat may be sold

When you finish, the app stamps how the work was inspected onto every box, so it travels with the meat: `USDA inspected`, `State inspected`, `Custom exempt`, `Not inspected` or `Not established`.

That is taken from the {{processor|lower}} you named. Work you did yourself is not inspected. **Custom exempt meat is stamped not for sale and may only be eaten by whoever owned the animal live, which is why halves are sold before the kill and never after.**

If your profile sets an exemption limit, the `Overview` page counts what you have done on the farm this year against it.

## Not on this page

- A {{productionRun|lower}} has two states only, open and finished. There is no cancelling one.
- Once finished, the outputs cannot be edited here. The receipt in stock becomes the record.
- Crew and hours are recorded but never turned into money. That needs a decision about what an hour is worth.
- Nothing here prints a {{killSheet|lower}}. The printable page is the {{cutSheet|lower}}.
- If you need any of this, ask us.

## Who can do what

The processing day is open to everyone. Any member can record what went in and what came out, transcribe the paperwork, and write a {{cutSheet|lower}}.

The decisions belong to the owner. Only an owner can start or finish a {{productionRun|lower}}, add or change a {{processor|lower}}, record what one charges, book or change a date, or match a bill.
