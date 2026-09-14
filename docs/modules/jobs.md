# Jobs (capability pack)

> Projects with a number and a cost code list, each one a **cost object** every
> bill and every hour can be charged to. The spine the whole construction family
> hangs off, the way `inventory`'s lot is the spine of the farm one — and, like
> every pack, industry-blind: the word "construction" appears nowhere in it.
> Status: `available` · Scope: `module` <!-- keep Status on ONE line — /admin/docs parses it -->

Listed by the `construction` profile ([construction.md](construction.md)), which
is the industry that forced it. Nothing here is construction-shaped: a project
has a number, a client, a company, a division and a kind of work, and a fit-out,
a software engagement and a house are the same row.

## Build log

### 2026-09-14 — Slice 0: the project spine (`claude/jobs-the-project-spine`)

Three tables, the dimension sync, and the two screens that make them usable.
**No contracts, no budget, no commitments** — those are slices 1 and 2 in
[construction.md](construction.md), and a project with actual cost against it is
already the thing a spreadsheet does worst.

**THE DIMENSION SYNC IS THE POINT, not the screen.** `createProject` writes
`dimension_members` in the SAME transaction, so from the first project every bill
line and every timecard can be charged to a job and every accounting report that
already exists groups by it — with no change to accounting, which must never
learn this pack exists. A project that existed without its cost object would be
an entity no report can group by, which is the failure
[packs-and-profiles.md](packs-and-profiles.md) names when it says a pack that
tracks activity without syncing a dimension member "has built a to-do list".

**The three coordinates are deliberately not the delivery method:** `entity_id`
(whose books — required, ADR 0010), the enterprise (which division — optional,
and a different question), and the cost code set (which chart it is budgeted
against). The pilot's Construction, Excavation and Cabinet Shop are three
enterprises inside ONE entity.

**`delivery_method` is nullable, and that is the feature.** A project may begin
before anyone knows what gets built — the pilot's first contract on a custom home
is a Concept Design agreement, and the client may look at the number and walk.
Most software in this market requires a build to exist before a job can, which is
exactly why pre-construction revenue ends up in a spreadsheet. ADR 0056.

**DRIVEN ON THE DEV BRANCH, by hand.** A project was created through the form,
its cost object confirmed in `dimension_members` (`24-108 · Oak Row residence`,
active), a cost code list added and the first-list-becomes-the-default rule
watched working, and a code (`03 30 00 Cast-in-place concrete`) added to it. The
conditional pickers behaved as designed: Hilltop Farm has one company and no
divisions, so neither picker appeared, and with no profile installed the kind of
work was a free-text box rather than an empty dropdown.

**Those rows are still on the dev branch, deliberately.** A farm tenant with a
custom home on it reads oddly; it is the only way to exercise this pack before
the `construction` profile exists, and slice 1 will want a project to hang a
contract off.

**A BUILD ERROR THAT `tsc` AND `eslint` BOTH MISSED**, found only by opening the
page: `export const PACK = "jobs"` in a `"use server"` file. Such a file may
export nothing but async functions, and neither the typechecker nor the linter
says so — `npm run build` had passed too, because the pages that import it did
not exist yet when it ran. `PACK` now lives in `vocabulary.ts`, which is where
the other packs keep theirs. **A green `tsc`, a green lint and a green build are
not a rendered page**, and this pack cost one browser load to learn it again.

**Three more things found while building it, worth more than the code:**

- **`PackDefinition` has no `dimensionTypes` field.** The "shapes" section of
  [packs-and-profiles.md](packs-and-profiles.md) shows one, and every pack that
  syncs a dimension does so without declaring it. Not added here: nothing reads
  it, and a field nothing reads is worse than an honest absence. Recorded in that
  file's open items instead.
- **The icon registry catches nobody.** `getIcon` falls back to a generic box
  rather than throwing, and its own header records that five packs once shipped
  showing that box because their key was never added. `hard-hat` was added in the
  same commit as the pack, which is what the header asks for — there is still no
  test.
- **A composite FK needs its unique index to exist FIRST**, and drizzle-kit emits
  every `ADD CONSTRAINT` before every `CREATE INDEX`. That is fine when the
  referenced table is older and fatal when both are new in one file, which is the
  case here: `0325_jobs.sql` is hand-reordered, with the reason written into the
  file, because regenerating it would silently undo the move.

## Data model

| Table | Purpose | Notes (RLS, invariants, FKs) |
| --- | --- | --- |
| `job_cost_code_sets` | A named list of cost codes. One or several per tenant. | FORCE RLS, member-wide. `job_cost_code_sets_one_default_idx` is a PARTIAL unique index, so **two defaults fail at the database** rather than depending on the action having cleared the first. |
| `job_cost_codes` | One line of the chart of cost. | Composite FK to `(tenant_id, set_id)`, **cascade** — deleting a list deletes its codes. `code` is free text, never a number: CSI writes `03 30 00`, NAHB writes `1000`, a builder writes `CONC-SLAB`. `sort_order` is what orders the list, so a code never has to be sortable to be right. |
| `job_projects` | The spine. | FOUR composite FKs, each certified in `tests/isolation/jobs.test.ts`: company, division, client, cost code list. `delivery_method` is an open taxonomy (P1) with a **format check and no value check**, and is nullable. `metadata` is the P2 extension bag. |

Migrations `0325_jobs.sql` (tables) and `0326_jobs_rls.sql` (policies), applied to
dev and prod on 2026-09-14 before the merge, per
[ADR 0014](../decisions/0014-migrations-are-applied-before-the-merge.md).
`db:verify-rls` reports 195 tables, all enabled, forced and with policies, on
both.

## Key files & seams

- `src/packs/jobs/ops.ts` — the write surface. Owner-only, and forced from below:
  `upsertDimensionMember` calls `requireOwnerRole`, so a staff-created project
  could not sync its cost object.
- `src/packs/jobs/actions.ts` — `requireTenant()` + `requireModuleEnabled()` +
  `withTenant(..., { role })`, the three things AGENTS.md asks of a pack.
- `src/packs/jobs/vocabulary.ts` — **ships no list of delivery methods and no
  list of cost codes**, on purpose. Both would make the pack know its industry.
  `deliveryMethodsFrom(config)` reads the profile's suggestions, total by
  construction like `speciesFrom` and `runKindsFrom`.
- `src/packs/jobs/JobsModule.tsx` — the job list. One statement with four left
  joins, not a lookup per row.
- `src/app/dashboard/m/jobs/[id]/page.tsx` — one project. **Says on the face of
  the page whether the cost object exists**, because nothing else in the product
  would, and the alternative is discovering it from a report quietly missing a
  column.
- `src/app/dashboard/m/jobs/cost-codes/page.tsx` — the chart of cost.

## Decisions & gotchas

- **[ADR 0056](../decisions/0056-a-delivery-method-belongs-to-the-project-not-the-tenant.md)** —
  the flavour of construction is a property of the PROJECT. A pack must never
  branch on `delivery_method`; it is data a project TEMPLATE reads, and a pack
  that said `if (deliveryMethod === "commercial")` would have re-created the
  industry branch with a new spelling.
- **The first cost code set becomes the default**, whether or not anybody asked.
  A business with one list must never be asked which list a project uses, and a
  first set that was not the default would make every project carry an explicit
  choice forever.
- **A project's cost code set is resolved ONCE at creation**, not read through.
  A tenant that later changes its default must not silently re-chart a job
  already underway — the same reasoning as a profile seed being copied rather
  than resolved live (ADR 0009).
- **Cancelling a project archives its cost object; completing one does not.**
  Closing a job does not stop bills arriving against it — retainage and the last
  subcontractor invoice turn up months later — whereas a job that never happened
  should not be offered on a bill line at all. Archiving keeps every tag already
  made reporting.
- **The whole project is visible to every member**, including its client and its
  dates. On a construction job those are the numbers people are most often told
  not to discuss. A business wanting them hidden from its own field staff needs a
  per-project visibility model, which is a bigger question than this pack and one
  nobody has asked; Documents' owners-only folder is where a contract with a
  price in it belongs today. Said out loud in `0326_jobs_rls.sql` too.

## Open items

- **No contracts, no budget, no commitments.** Slices 1 and 2. A project today
  collects actual cost and nothing compares it to anything.
- **Nothing edits a project yet.** `updateProject` and `updateProjectAction`
  exist and are tested through the ops layer, but no screen calls them — the
  detail page is read-only. The next slice that needs an edit form gets one.
- **A cost code cannot be renamed, reordered or retired from the UI.** The rows
  and the ops support it; the screen only adds.
- **Nobody has clicked any of it.** Written, typechecked, built and certified
  against a real database — but the screens have not been driven by a person.
  The construction profile does not exist yet either, so `deliveryMethodsFrom`
  has never returned a non-empty list outside a test.
- **`job_projects.number` is not generated.** Every business numbers its jobs its
  own way and the pilot's scheme is unknown, so the field is free text and the
  form suggests nothing. A generator is worth building only once a real scheme is
  in front of us.
