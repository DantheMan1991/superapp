# 0086. An assembly is an item saved at the size it was priced, and only the quantity scales

- **Status:** Accepted
- **Date:** 2026-09-18
- **Deciders:** the estimate program's slice E6, from the founder's "think speed… and yet have all of the info we need"

## Context

[ADR 0079](0079-an-estimate-groups-its-lines-into-the-items-the-client-sees-and-a-group-priced-fixed-is-the-price-not-a-cost-to-mark-up.md)
gave an estimate **items**: a name the client reads, with the lines that build
it up underneath. An estimator who has priced `Tile flooring` once has
described a thing that recurs on every job, and until now described it again
every time.

Every estimating product has an assembly library. Most of them have an EMPTY
one, because they shipped the drop-down before the way to fill it, and nobody
sits down to type a library of assemblies they might need one day.

## Decision

**AN ASSEMBLY IS A SAVED ITEM.** Not a new kind of thing: the same shape as
`job_estimate_groups` and its lines, which is why this waited for that table
rather than arriving with one of its own. Two tables, `job_assemblies` and
`job_assembly_lines`, mirroring the item and its lines column for column.

**BUILT BACKWARDS: "SAVE THIS ITEM AS AN ASSEMBLY" COMES FIRST.** The library
assembles itself out of work somebody has already priced and is looking at,
which is the only moment they know it is worth keeping. Dropping one comes
second. **The picker does not appear at all until the library has something in
it** — an empty drop-down is worse than no drop-down, because it teaches
people the feature is not for them.

Saving reads the EDITOR'S OWN STATE, not the database, so an item typed a
minute ago and not yet saved can still go in.

**IT RECORDS THE SIZE IT WAS SAVED AT, AND KEEPS EVERY QUANTITY AS IT WAS
PRICED.** An item has no quantity of its own — 320 sf of tile, 320 sf of
labour and 6 bags of thinset are three lines that happen to be one floor — so
the assembly carries `driving_quantity` and `driving_unit`, and dropping it at
another size scales by the ratio.

Storing the quantities **as they were** rather than as ratios is the decision
worth keeping: `6 bags at 320 sf` is a number the estimator recognises from
the job it came off, and `0.01875 bags per sf` is not, and would need more
decimal places than the column has to survive the round trip. The division
happens once, at the moment of dropping, in one pure function.

**ONLY THE QUANTITY SCALES. EVERY RATE IS A RATE.** A unit cost, an explicit
unit price and a markup are all *per unit* already, so a bathroom twice the
size buys twice as much tile at the same price per foot. **Scaling a rate is
the one mistake here that would produce a plausible, wrong number** — twice
the tile at twice the price per foot is four times the money and it looks
almost right — and a plausible wrong number in an estimate is worse than a
refusal, because it goes out in a proposal. Six of the nineteen tests exist
for that one sentence.

**WHAT IT IS PER IS GUESSED FROM THE LINES.** The most common (quantity, unit)
pair among the lines that have a unit: two of three lines saying `320 sf`
makes it a floor of 320 sf, and the dialog opens with the answer already in
it. Ties go to the larger quantity — the thing being measured rather than a
fitting that goes with it. An item of nothing but lump sums is `1` of nothing,
which is a useful assembly (a kitchen, a bathroom suite), not a broken one.

**THE COST CODE IS TEXT, RESOLVED AT THE DROP.** A code id belongs to one cost
code SET; an assembly saved on a job using the CSI set and dropped on a job
using another would carry an id that is not merely wrong there but
unrepresentable. So the line keeps the code AS WRITTEN — `09 30 00` — and the
drop matches it against the target job's own set, ignoring case and spacing.
**No match means NO CODE, never a near one**: an uncoded line still prices and
is merely left out of the budget, which is visible, and the editor says how
many came back uncoded. A line silently filed under somebody else's code is
not visible at all.

**AN ASSEMBLY BELONGS TO THE TENANT, NOT TO A JOB.** It is the one thing in
estimating that outlives the estimate it came from, which is the whole point
of it, and the reason its rows carry no project: a project would be a lie
about where the next one is going.

**DROPPING RETURNS LINES; IT DOES NOT WRITE THEM.** The editor holds the
estimate in its own state and saves itself ([ADR 0082](0082-an-estimate-saves-itself-unsaved-is-derived-from-the-form-and-a-save-that-changes-nothing-writes-nothing.md)),
so an action that wrote lines behind its back would be a second writer to the
same rows — which is how they come to disagree.

## Consequences

- Two tables, migrations `0379`/`0380`, **applied to dev and prod before the
  merge; 231 tables verified on each**. Member-wide to write: a library only
  an owner could add to is a library nobody adds to.
- **`0379` had to be hand-reordered.** drizzle generated every foreign key
  before every index, so the composite key to `job_assemblies (tenant_id, id)`
  landed before the unique index that makes those columns a legal target, and
  it would not have run. The same repair `0352` and `0356` needed.
- **A snapshot-chain repair came with it.** `0378`'s snapshot was a byte copy
  of `0377`'s, so both claimed the same id and `db:generate` refused to run at
  all — an RLS migration's snapshot needs its OWN id with `prevId` pointing at
  the one before, which `db:migrate` never checks and only the next person to
  generate a migration discovers.
- The library can be taken from as well as added to: removing an assembly
  leaves every line it has already made alone, because those are lines on a
  job.
- **Not built, on purpose:** an assembly that carries a waste factor of its own
  (1.05 sf of tile per sf of floor). Today the waste is priced into the line's
  own quantity the way the estimator typed it, which is how they already think
  about it; a factor is a second place for the same number to live, and the
  first business to ask for it should say why.

## Alternatives considered

- **Store ratios instead of quantities.** Mathematically identical and much
  worse to read, to check and to store: the library would be full of numbers
  nobody recognises, and rounding would live in the saved row rather than in
  one function.
- **Seed a library of standard assemblies.** Rejected outright: it would carry
  one business's prices and one trade's vocabulary into every tenant, which is
  what `tests/discovery-prompt.test.ts` exists to prevent elsewhere, and it is
  the thing that makes every other product's library an empty one.
- **Assemblies as a screen of their own.** Rejected for now — the library is
  built and used entirely from the estimate, which is where an estimator is.
  A management screen can come when there are enough of them to manage.
- **Store the cost code id.** Rejected: see above. It is the difference
  between an assembly that travels between jobs and one that does not.
