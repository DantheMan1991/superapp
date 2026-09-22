# 0107 — A takeoff off the model is a join through the assembly, keyed by what the model calls it

- **Date:** 2026-09-21
- **Status:** Accepted
- **Affects:** Layer 2a — the `jobs` pack, the estimate editor and the assembly library (X15). Builds on [0106](0106-a-takeoff-can-be-read-off-the-models-own-schedule-and-the-boundary-is-rows.md)'s reader and [0086](0086-an-assembly-is-an-item-saved-at-the-size-it-was-priced-and-only-the-quantity-scales.md)'s assemblies; keeps [0082](0082-an-estimate-saves-itself-unsaved-is-derived-from-the-form-and-a-save-that-changes-nothing-writes-nothing.md)'s rule that the editor holds the estimate.

## Context

The founder, the day the measure-up learned to read a room schedule:

> *"I'm really looking for way more than just room schedules here. Lumber
> takeoff, drywall etc from the model."*

Right. The measurements and the rooms are what the walk ASKS for; the
takeoff is what the estimate IS. A wall schedule off the model says `Basic
Wall: Interior - 2x4 Wood Stud · 22 · 412' · 3,708 SF`; a material takeoff
says `Gypsum Wall Board · 4,464 SF`; a framing schedule says `2x10 · 46 ·
14'`. Every one of those is a thing with a quantity, and the estimator's
whole job with it is to say what the business builds that thing out of and
price it at that quantity. The dossier had described this since X1 as *"the
takeoff turns from a measurement into a join when the type names carry the
assembly keys."*

Two things were already true. The reader existed
([0106](0106-a-takeoff-can-be-read-off-the-models-own-schedule-and-the-boundary-is-rows.md)):
any schedule is a table with its columns classified. And the assembly was
already parametric ([0086](0086-an-assembly-is-an-item-saved-at-the-size-it-was-priced-and-only-the-quantity-scales.md)):
priced at `320 sf`, dropped at any other size, every quantity scaling and
every rate untouched — the division done once, in `explodeAssembly`. What
was missing was the join itself: which assembly a name in the model means,
and which of the row's figures it is dropped at.

## Decision

**A takeoff off the model is the schedule grouped by the column that names
things, joined to assemblies, dropped at the figures the model states.**
`bim-takeoff.ts` groups the rows by the naming column (*Family and Type*,
*Material: Name*, *Type*, or the first word column that is not a number or
a mark), adds every quantity column up per name, and takes the count from a
*Count* column or from the rows. Nothing past the reader knows a vendor.

**The join is a table of what the model calls each assembly.**
`job_assembly_keys`: one row per name the model has used, pointing at the
assembly it means, unique per tenant on the reduced name. A name means ONE
assembly per business, so confirming a different one later is a correction
written on the slug, not a second row. The names are the business's — a
Revit type name, a material, a keynote, whatever its schedules carry — and
they are shown and edited on the assembly's own page under *What the model
calls it*.

**A remembered name maps itself; the words only suggest.** A name the
business has mapped before comes up already chosen and marked *remembered*.
A name that contains every significant word of an assembly's name — *Wood
stud* in *Basic Wall: Exterior - 2x6 Wood Stud* — is suggested, ticked to be
remembered, and waits to be confirmed. Anything else waits for the person,
because a takeoff that guessed which assembly a wall type meant would price
the wrong wall with perfect confidence.

**The figure is the row's, in the assembly's own dimension.** An assembly
per `sf` is dropped at the row's area, per `lf` at its length (its *Length*
before its *Unconnected Height*), per `ea` or per nothing at the count;
metres and square metres are converted into the assembly's unit. A row with
no figure in the dimension cannot drive the assembly and is refused by name
— *Wood stud is per lf and the schedule has no length for it* — never
dropped at a guess.

**A thing no assembly makes can still come in as a line**, by whichever of
its figures the person picks: the model's name as the description, the
figure as the quantity, priced from the price book when the book has it and
by hand when it does not. A model takeoff on a business with no assemblies
yet is a spreadsheet takeoff that typed itself.

**Every line says where its figures came from.** An assembly's lines carry
`basis = 'assembly'` and a `basis_detail` of the whole story — *Drywall,
hang and finish at 3,708 sf · off the model: Wall Schedule · Basic Wall:
Interior - 2x4 Wood Stud · Area 3,708 sf*; a plain line carries `memory` or
`none` with the same clause. The editor's line drafts learned to carry a
basis for this and post it only when they have one, so a typed line's basis
stays whatever it was.

**Nothing here writes an estimate line.** The action returns items and the
editor appends them, exactly as *Add an assembly* does
([0082](0082-an-estimate-saves-itself-unsaved-is-derived-from-the-form-and-a-save-that-changes-nothing-writes-nothing.md)). The
one thing written on confirmation is the memory of what a name means.

## Consequences

- The estimate editor gains a **From the model** button beside *Paste a
  takeoff* and *Add an assembly*, always shown: with no assemblies the
  takeoff comes in as lines, and the dialog says so. The assembly page
  gains *What the model calls it*, a list of names with an add box.
- The measure-up's dialog and this one share one `ScheduleInput`, so there
  is one decoder for a UTF-16 file to keep right.
- Migrations 0418 (the table) and 0419 (its RLS), applied to both databases
  before the merge and verified at 244 tables; the isolation suite gained
  the table's case.
- **The figures are what the cells say.** A schedule exported grouped by
  type with *Calculate totals* on carries the total in the row; one exported
  itemised carries each element and the sum is taken here; one grouped
  WITHOUT totals carries a single element's figure beside a count of many,
  and this cannot tell that from the first case. The guide says which way to
  export; the preview shows the count beside the figure so the eye can.
- Not built, on purpose: an assembly driven by two figures at once (a wall's
  length AND its height — an assembly per lf of 9' wall is the founder's own
  answer to that today); a takeoff that also opens the walk's phases (the
  reckoning already names what has lines); waste as a separate factor (it
  lives in the assembly's own quantities, as it always has).

## Alternatives considered

**Read the material takeoff into lines directly, no assemblies.** It would
give *Gypsum Wall Board 4,464 sf* and nothing for the screws, the mud, the
labour or the lumber — the model holds a stud LAYER's volume, not studs.
The business's own assembly is where that knowledge lives, and it was
already parametric. This is why the join is through the assembly.

**Key the join on Revit's Uniformat assembly code rather than the type
name.** Cleaner in principle and absent in practice: the pilot's types carry
none, and a key the business has to go and set in the model before the first
takeoff works is a feature that never gets its first use. The name is what
the schedule already carries; a business that keys by code exports the code
column and it is a name like any other.

**Match names with a model.** It would map *Basic Wall: Interior - 2x4 Wood
Stud* to *Drywall, hang and finish* nine times in ten and to *Exterior wall
framing* the tenth, with the same confidence. The remembered key maps it
right every time after the first, and the first is one click.

**Store the key on the assembly as an array.** A key must mean one assembly
per business, and a uniqueness rule across the elements of arrays on
different rows is not a rule Postgres can hold. A table with a unique index
is.
