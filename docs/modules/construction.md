# Construction (industry profile)

> The platform's third industry profile (Layer 2b) and its first for the
> founder's actual market. Construction names four flavours of itself —
> production residential, semi-custom, luxury full custom, commercial — and the
> market talks about them as if they were four industries. They are not. They
> are four **delivery methods** inside one industry, and a delivery method is a
> property of the project, never of the tenant
> ([ADR 0056](../decisions/0056-a-delivery-method-belongs-to-the-project-not-the-tenant.md)).
> Status: `coming_soon` · Scope: `platform` <!-- keep Status on ONE line — /admin/docs parses it -->

**Pilot tenant: the founder's employer.** It does luxury full custom
residential, semi-custom and commercial, in one company on one set of books.
That is deliberately the test case, because **a multi-type company is the case a
naive design breaks on** — and if the design makes it an ordinary tenant rather
than a special one, the design is right.

**But the pilot is an INSTANCE, never the axis.** The founder's instruction on
2026-09-13, in his words: *"don't narrow the software to just me — remember other
companies will do it differently."* That is the standing rule for this whole
family, and it is not a courtesy. It is the same rule
[`tests/discovery-prompt.test.ts`](../../tests/discovery-prompt.test.ts) already
enforces against one business's name or price list reaching a pack. Every fact
the pilot supplies goes in the table below **beside the range it sits in**, and
the design serves the range. A row in that table with no range recorded is a
narrowing waiting to happen.

**Nothing below is built.** This is the design, recorded so the first pack does
not improvise — the same status
[packs-and-profiles.md](packs-and-profiles.md) held on 2026-08-13.

## Build log

### 2026-09-13 (second pass) — The pilot answered, and a contract is not a field (`claude/construction-industry-design`)

The founder answered the gating questions and **two of them broke the design's
first draft.** Both corrections are recorded in full below rather than quietly
patched, because the wrong versions are the obvious ones and a future session
will re-derive them.

1. **A contract is not a field on the project. It is a table, many per project,
   and they are often SEQUENTIAL.** The pilot has five kinds — Concept Design,
   Construction Drawings, New Home, Misc Proposal, AIA — and the first three are
   *phases of one house*. The first draft put `contractType` and `billingMethod`
   on the project template, which cannot represent a house that is on its second
   contract of three, each with its own value and its own way of billing. See
   [A contract is not a field on the project](#a-contract-is-not-a-field-on-the-project).
2. **The cost code set is not a per-delivery-method difference.** The first
   draft's table listed "cost code structure" as varying by flavour. The pilot
   runs **one custom list across all three**, which disproves it. It is a
   tenant-level choice, and the range is wide: CSI MasterFormat, NAHB, or a list
   the company invented.

A third answer opened a structural question the first draft did not have, and
the answer was already built: the pilot has **a cabinet shop and an excavation
division that both work as subs**, so one client relationship spans a GC, a
design practice and two trade subcontractors. `entities` and ADR 0010's
intercompany pair are exactly that shape — see
[The seam that was already waiting](#the-seam-that-was-already-waiting).

### 2026-09-13 — Design settled, no code yet (`claude/construction-industry-design`)

The founder asked how to handle four flavours of construction when a real
company does three of them at once, and separately needs per-company tailoring
on top. The useful move was refusing "flavour" as one variable. It is four, and
three of them already had a home in the existing model:

| Variable | Lives at | Example |
| --- | --- | --- |
| What the software can do | Layer 2a packs | `jobs`, `estimating`, `progress-billing` |
| What kind of company this is | Layer 2b profile | `construction`, one of them |
| **What kind of work THIS job is** | **per-project column** | luxury custom / commercial / semi-custom |
| How THIS company does it | Layer 3, tenant-owned rows | its cost codes, its contract ladder |

The third was the only one missing, and it is a column. The fourth is the *same
store* as the third with a different author, which is why per-company tailoring
needs no separate machinery — see [The project template](#the-project-template).

Two findings from reading the tree that changed the plan:

- **Labor to the job is already built.**
  [`time_entry_dimensions`](../../src/db/schema/time.ts:699) tags an hour with
  "one dimension member per dimension type, per entry". The moment `jobs` syncs
  a project into `dimension_members` like any other pack, a timecard posts to a
  job with no change to the Time module at all. This is the single most-wanted
  construction feature and it is a sync function.
- **Percent-complete revenue recognition is NOT a basis lens.** A lens provider
  may drop an entry whole and re-point a line and explicitly "may not change an
  amount, invent a line, or move a date"
  ([basis-lens/types.ts:22](../../src/lib/basis-lens/types.ts:22)). Over- and
  under-billing is an *invented* entry. So WIP is a computed schedule plus a
  period journal entry the pack posts itself. Recorded here because reaching for
  the lens is the obvious wrong first move.

## What the pilot answered, and what each answer is an instance of

**Read this table as three columns wide, always.** The middle column is what the
software is built to, the right column is the proof the middle column is not the
pilot in disguise.

| The pilot's answer (2026-09-13) | The axis it is an instance of | The range other companies sit in |
| --- | --- | --- |
| **One cost code list**, custom, they invented it, used across all three delivery methods | A **cost code set** is tenant-owned data, and a tenant has one or several | CSI MasterFormat (commercial norm), NAHB's chart (resi norm), a list the company invented, or a customer's list imposed per job. One set is the common case; two is normal for a GC that does both markets; the design must not *push* toward either |
| **Five contract kinds** — Concept Design, Construction Drawings, New Home, Misc Proposal, AIA. The first three are phases of one house | A project has **many contracts over its life**, sometimes sequential | A production builder: one purchase agreement per home, no pre-con. A commercial GC: one prime contract plus change orders. This pilot: a design → drawings → build ladder. A design-build firm: design and build under one contract. All four must be one model |
| **Monthly progress draw · AIA pay application · draw schedule for homes** | A **billing method belongs to the contract**, not the project | Plus cost-plus-fee (with and without GMAX), unit price (excavation bills by the yard), and time and materials. Five to six methods, and a company may use three at once — this pilot does |
| **Yes, works as a sub occasionally.** A **cabinet shop** and an **excavation division** sub out a lot | The company's **role on the project**, per project and per contract | GC, subcontractor, CM-at-risk, design-only, owner-builder, and a company that is several of these at once. A sub *receives* the contract it bills against, and has retainage held **from** it rather than **by** it |
| A cabinet shop "business" and an excavation "division" under one roof | How many **legal entities** the client relationship contains | One LLC with divisions; several LLCs; or a mix, which is what this pilot sounds like. **Already built** — see below |

Still unanswered and still gating, carried from the first pass: what the PMs
actually call the client (the tenant-wide vocabulary question), and the five new
questions in [Open items](#open-items).

## A contract is not a field on the project

The correction that matters most, because the wrong version is the intuitive one
and every off-the-shelf product in this market makes it.

A luxury custom home at the pilot runs:

```
Concept Design Contract   →  Construction Drawings Contract  →  New Home Contract
  own value, own billing        own value, own billing            own value, own billing
  may end here and die          may end here and die              the build
```

Three contracts, one house, in sequence, each billed its own way, **and the first
two may be the only two that ever exist** — a client can pay for a concept, look
at the number, and walk. So:

- **`contracts` is a table, many per project**, each with its own value, billing
  method, counterparty, role and status. Not a field, not a template setting.
- **A project's early life may be a design engagement that never becomes a
  build.** Its `delivery_method` may be unknown at creation. The software must
  not require a build to exist in order to hold the work — most construction
  software does, which is why pre-construction revenue ends up in a spreadsheet.
  This is a differentiator, not an edge case.
- **Revenue recognition is per contract.** A design contract completes and earns
  while the build contract has not started.
- **The delivery method gets thinner, and that is correct.** It no longer carries
  contract type or billing. What is left is real and is not contract-level: which
  workflows are on (selections versus submittals), which document kinds a job of
  this kind must collect, how the budget locks, and how revenue is recognised.
  ADR 0056's claim is unchanged; what moved is what hangs off it.
- **The ladder itself is data.** A template lists which contract kinds typically
  apply and in what order. The pilot's three-step ladder, a production builder's
  single agreement and a design-build firm's combined contract are three values
  of one field.

**Counterparty and direction are how the sub case works, and it needs no second
model.** A subcontract the pilot *receives* from another GC is its prime contract
on that project — same table, the counterparty is a GC rather than an owner, and
retainage is held from it. `commitments` stays what the company issues *outward*;
`contracts` is what it bills *against*, whichever direction it faces.

## The seam that was already waiting

The cabinet shop and the excavation division looked like a new structural
problem. It is [ADR 0010](../decisions/0010-entities-inside-a-tenant.md), shipped
and live.

[`entities`](../../src/db/schema/ledger.ts:286) is "a LEGAL ENTITY inside the
tenant — the thing that owns a set of books", and the tenant is the *client
relationship*. So a cabinet shop that is its own LLC is an entity beside the GC,
with the chart of accounts, vendors and customers shared tenant-wide. A cabinet
shop that is a division of the same LLC is an `enterprises` row instead. **The
test is already written down in the schema comment: does the trial balance have
to balance within it?** An LLC always; a division never.

And the case that should be hardest is the one ADR 0010 was built for: **when the
pilot's own cabinet shop subcontracts to the pilot's own custom home**, that is
revenue in one entity and job cost in the other. ADR 0010 makes it a linked
**pair** of entries sharing an `intercompany_id`, written together or not at all,
with consolidation eliminating them by following the link rather than matching
amounts. Nothing needs building for it.

**What construction must not do:** invent a second notion of company. If a slice
finds itself wanting one, it has missed `entities`.

## One profile, four delivery methods

The argument, because it is the thing a future session will be tempted to undo.
Eighteen packs, and **twelve are wanted by all four flavours unchanged**:

| Pack | Prod resi | Semi | Luxury | Commercial |
| --- | :-: | :-: | :-: | :-: |
| `jobs` — project, cost codes, budget, WIP | ● | ● | ● | ● |
| `contracts` — many per project, any direction | ● | ● | ● | ● |
| `estimating` — takeoff, assemblies, bid | ● | ● | ● | ● |
| `commitments` — POs and subcontracts issued | ● | ● | ● | ● |
| `change-orders` | ● | ● | ● | ● |
| `progress-billing` — SOV, draws, retainage | ● | ● | ● | ● |
| `field` — daily logs, photos, punch list | ● | ● | ● | ● |
| `drawings` — sheet sets, versions, markups | ● | ● | ● | ● |
| `compliance` — COI, lien waivers, W-9 | ● | ● | ● | ● |
| `selections` — options and allowances | ● | ● | ● | |
| `warranty` | ● | ● | ● | ○ |
| `submittals` — submittals, RFIs, ASIs | | | ○ | ● |
| `certified-payroll` | | | | ● public work |
| `bonding` | | | | ● |
| `assets` **(exists)** — equipment | ● | ● | ● | ● |
| `inventory` **(exists)** — materials, yard | ● | ● | ● | ● |
| `land` **(exists)** — lots, phases, site plan | ● | ○ | | |
| `time` **(exists, core)** — labor to a cost code | ● | ● | ● | ● |

Twelve of the eighteen carry four solid marks. **Six vary at all**: `selections`
and `warranty` are wanted by three of the four, and `submittals`, `land`,
`certified-payroll` and `bonding` by one. So making the flavour a pack axis would
**fork twelve identical packs in order to vary six** — and the pilot needs the
union of all eighteen regardless, so the flavour ends up per-project either way. The multi-type company is what proves the design rather than what
strains it.

Two of these serve the pilot's subcontracting side before any GC feature does:
an excavation division bidding by the cubic yard is `estimating` plus a unit-price
billing method, and a cabinet shop is a **`production` run** against materials
`inventory` — the pack the farm profile already paid for.

## What differs per delivery method, and it is all values

Revised on the second pass. **"Cost code structure" was removed** — it is
tenant-level, not flavour-level, and the pilot's one-list-for-everything
disproved it. Contract type and billing method moved to the contract.

| | Prod resi | Semi | Luxury | Commercial |
| --- | --- | --- | --- | --- |
| Budget locked | at release | at contract | never, runs | at buyout |
| Change flow | option change before a cutoff | change order | change order, constant | PCO → CO → owner |
| Revenue recognition | at closing | at closing | percent complete | percent complete + WIP |
| Workflows on | option catalogue | selections + allowances | selections + allowances | submittals + RFIs |
| Required documents | inspection sign-offs | selection sheets | selection sheets, allowance reconciliation | submittals, COIs, waivers, certified payroll |
| Who decides the scope | buyer picks from a book | buyer modifies a plan | client and architect | owner bids it out |

**Not one row is a code branch. Every row is a value.** That is the test this
table exists to pass, and a future slice that adds a row which is *not* a value
has found something worth an ADR rather than an `if`.

The one genuinely code-shaped difference is the **billing method**, of which
`progress-billing` ships five or six — milestone or draw schedule,
schedule-of-values percent (AIA), monthly progress draw, cost-plus-fee with and
without GMAX, unit price, and time and materials — and **the contract** names
one. A billing method is not an industry: a professional services firm bills
fixed-fee and T&M too, so naming one breaks no boundary.

## The project template

**The single mechanism that answers both of the founder's questions.** A
delivery method selects a template; a template is a row; the row is the
tenant's.

```ts
// Shape only. Lives in the jobs pack, not in core.
// Revised second pass: contract type and billing method are NOT here.
interface ProjectTemplate {
  slug: string;               // "luxury_custom", or whatever this company calls it
  name: string;               // shown when starting a project
  costCodeSetId: string | null;   // null = the tenant's default set (the common case)
  contractLadder: string[];   // contract kinds typically used, in order.
                              // The pilot: ["concept_design", "construction_drawings", "new_home"]
                              // A production builder: ["purchase_agreement"]
  budgetLocksAt: "release" | "contract" | "buyout" | "never";
  revenueRecognition: "completion" | "percent_complete";
  workflows: string[];        // "selections" | "submittals" | "allowances" | …
  requiredDocs: string[];     // doc_kind values a job of this kind must collect
}
```

The profile seeds starter templates at install. **From that moment the rows are
the tenant's** and it edits them, renames them and adds its own. So:

- *"Each flavour handles tools differently"* → seeded templates.
- *"Every company handles some things differently"* → the same rows, edited.

There is no second machinery for Layer 3 and no per-tenant branch in code, which
is the outcome [extension-model.md §5](../extension-model.md) names as the whole
point. **A template is copied, not read through** — the `seed` semantics of
[ADR 0009](../decisions/0009-packs-are-modules-profiles-install-them.md), not the
`labels` semantics — because a row the tenant may edit cannot also be a row the
profile owns.

`costCodeSetId` defaults to null on purpose. **A tenant with one list must never
be asked which list**, which is the pilot's case and probably the majority one.

## Data model

Proposed. Nothing exists. Pack-owned tables follow the ordinary rules:
`tenant_id`, FORCE RLS, a `--custom` policy migration and isolation-test
coverage ([security.md §4](../security.md)).

| Table | Purpose | Notes |
| --- | --- | --- |
| `projects` | The spine. Every other pack hangs off it, the way every pack hangs off `inventory`'s lot. | `delivery_method` text, **format check only, no value constraint** (P1) — the shape [`ps_engagements.kind`](../../src/db/schema/professional-services.ts:104) already has, and **nullable**, because a project may start as a design engagement before anyone knows what gets built. Syncs into `dimension_members`. |
| `contracts` / `contract_lines` | **Many per project.** Kind, value, billing method, counterparty, role, direction, status, retainage terms. | Added on the second pass. `kind` and `billing_method` are open taxonomies with format checks. `role` says GC or sub; `direction` says whether the pilot bills it or is billed on it. A received subcontract is a row here, not in `commitments`. |
| `project_templates` | The seeded flavours, then whatever the company adds. | Tenant-owned after install. First seed kind whose target is a pack table rather than a core one. |
| `cost_code_sets` / `cost_codes` | The real spine of a construction business. | **Tenant-level, one or several.** Profile seeds a CSI-shaped set, an NAHB-shaped set and an empty one; the company picks, edits or pastes its own. Sync as a second dimension type. |
| `project_budgets` / `budget_lines` | Original, revised, committed, actual, projected — by cost code. | The five columns every construction report is made of. |
| `commitments` / `commitment_lines` | What the company issues **outward**: POs and subcontracts. | Billing against a commitment is what `payables` matching already does for a bill. Contrast `contracts`, which is what it bills against. |
| `change_orders` / `change_order_lines` | PCO → CO → approved, with its budget effect. | Belongs to a **contract**, not a project — a change order changes one agreement. An approved CO revises the budget; it does not edit the original. |
| `pay_applications` / `sov_lines` | Schedule of values, percent complete, retainage held and released. | Per contract. The AIA G702/G703 shape, which is also a draw request with different words. |
| `wip_snapshots` | Percent complete, earned revenue, over/under billing, per period. | Computed, then posted as an ordinary journal entry. Per contract, summed per entity. See the basis-lens finding above. |

## Key files & seams

Every seam this family needs already exists. Listed so the first slice reaches
for them rather than inventing a sixth primitive.

| Seam | Where | What construction does with it |
| --- | --- | --- |
| `entities` | [ledger.ts:286](../../src/db/schema/ledger.ts:286) | **The cabinet shop and the excavation division, if they are their own LLCs.** ADR 0010, already live, intercompany pair included. Construction must never invent a second notion of company. |
| `dimension_members` | [ledger.ts:501](../../src/db/schema/ledger.ts:501) | **The costing seam and the reason any of this is worth building.** A project is a cost object; every existing accounting report slices by job with no accounting change. |
| `time_entry_dimensions` | [time.ts:699](../../src/db/schema/time.ts:699) | Labor to a job and a cost code, **already built**. Needs a `jobs` sync, nothing more. |
| `enterprises` | [enterprises.ts](../../src/db/schema/enterprises.ts) | A division that is **not** its own LLC. "Excavation Division" is an enterprise; "commercial" is a delivery method; an LLC is an entity. Three different things, and this pilot may use all three. |
| `documents.doc_kind` + `.metadata` | [documents.ts:101](../../src/db/schema/documents.ts:101) | P1 + P2. `submittal`, `rfi`, `lien_waiver`, `coi`, `drawing` are values a pack supplies. |
| `work_item_links` | [work.ts:315](../../src/db/schema/work.ts:315) | A punch item, an RFI and an overdue COI are all work raised where it lives (§4b) — never a second task engine. |
| `production` **(pack, exists)** | [packs/production](../../src/packs/production) | **The cabinet shop's shop orders.** A run against materials inventory is what this pack already is. |
| `src/lib/paste-targets/` | [types.ts](../../src/lib/paste-targets/types.ts) | **How a custom cost code list arrives.** The pilot's list is in a spreadsheet today, and so is every other company's. |
| `src/lib/tell-sources/` | [types.ts](../../src/lib/tell-sources/types.ts) | "poured the garage slab at Oak Row, four guys, six hours" is one sentence and four screens. The field tool that beats a clipboard. |
| `src/lib/setup-sources/` | [types.ts](../../src/lib/setup-sources/types.ts) | "You have no cost codes yet" is a prerequisite the data proves missing. |
| `src/lib/site-blocks/` · `src/lib/site-templates/` | [types.ts](../../src/lib/site-blocks/types.ts) | A project gallery and a contractor's five-page website, as data the site draws (ADR 0028, ADR 0030). |
| `src/lib/leads/` | [types.ts](../../src/lib/leads/types.ts) | A bid invitation arriving through the site is a lead the CRM fills in. |

## Decisions & gotchas

- **[ADR 0056](../decisions/0056-a-delivery-method-belongs-to-the-project-not-the-tenant.md)** —
  one profile, the flavour is per-project, the template is tenant-owned. Read
  the consequences before proposing a second construction profile; it is cheap
  to add and expensive to retrofit the other direction.
- **[ADR 0004](../decisions/0004-capability-packs-and-industry-profiles.md) and
  [ADR 0009](../decisions/0009-packs-are-modules-profiles-install-them.md)** are
  the ground rules. No pack may know which industry it is in, and a profile
  installs rather than binds. **[ADR 0010](../decisions/0010-entities-inside-a-tenant.md)**
  is the third, and it already answers multi-company.
- **THE PILOT IS AN INSTANCE.** Every fact it supplies belongs in the
  three-column table above beside its range. The failure mode is not shipping
  the pilot's cost codes — nobody would — it is shipping a *shape* that only its
  process fits, which is what the first draft did twice in one pass.
- **`jobs` is the lot spine of this family.** Nothing can start before the
  project, its cost codes and its budget exist, for the same reason
  [inventory.md](inventory.md) records about the lot. Build it first and resist
  building anything alongside it.
- **A pack must not branch on `delivery_method` either.** The column is data the
  *template* reads, and the template's fields are what a pack switches on. A
  pack that says `if (deliveryMethod === "commercial")` has re-created the
  industry branch with a new spelling — the failure mode this whole file exists
  to prevent, one level down. The same goes for `contracts.kind`: a pack reads
  the billing method, never the kind.
- **Percent complete is not a basis lens.** See the build log. A lens may not
  invent an entry, and over/under billing is an invented entry.
- **Vocabulary is tenant-wide, and this is the first industry that may not fit.**
  "Owner" on the commercial job and "Homeowner" on the custom home, same week,
  same component, same company. `tenants.labels` holds one. Not solved, because
  most companies have one internal vocabulary and label-per-delivery-method is
  machinery nobody has proven they need. **Still unanswered by the pilot.**
- **`jobs` is the repo's own name for this pack** ([extension-model.md
  §2](../extension-model.md) uses it), but "Job" is exactly the word §8 flags as
  failing the neutrality test — electrical says Job, plumbing says Service Call,
  a GC says Project. The pack slug is `jobs`; **every rendered word comes from a
  label**, and the construction profile sets it to Project.
- **Core's construction leaks become live the day this installs.**
  [extension-model.md §8](../extension-model.md) lists them: the trades folder
  list in `documents/templates/defaults.ts`, `"5100" Subcontractor Expense` in
  the *general* chart of accounts, the lien-waiver copy on the templates page,
  and the client form defaulting to `"construction"`. Each one is content this
  profile should ship and core should not. **Fixing them is part of this work,
  not a side quest** — they are the reason the profile has anything to seed.

## Open items

Everything here is open; these are the ones that change the design rather than
fill it in.

**New after the pilot's answers, in priority order:**

- **Are the cabinet shop and the excavation division separate LLCs, or divisions
  of one company?** Entities versus enterprises, and possibly one of each. The
  schema's own test settles it once known: does the trial balance have to balance
  within it?
- **When the cabinet shop subs to one of the pilot's own homes, is that
  invoiced?** If yes it is ADR 0010's intercompany pair and nothing is needed.
  If the cost is simply shared, that is a different and simpler thing, and
  knowing which avoids building the wrong one.
- **Do the Concept Design and Construction Drawings costs roll into the home's
  job cost?** Margin on the house depends on the answer, and it decides whether
  pre-con contracts share the build's cost codes or have their own.
- **Does a Misc Proposal get a job number and cost codes, or is it just an
  invoice?** If some work never becomes a project, `projects` is not the only
  place revenue lands, and the design should know that before slice 0.
- **Is "monthly progress draw" cost-plus, or fixed price billed monthly?** This
  decides whether cost-plus-fee is a pilot requirement or only a market one — and
  therefore whether it is in the first billing slice or the second.
- **What do the PMs call the client**, in commercial and in custom? Carried from
  the first pass, still the tenant-wide vocabulary question.

**Structural, carried forward:**

- **`IndustryProfile.seed` must grow a third kind** (`projectTemplates`), and it
  is the first seed kind whose target is a pack table. Decide whether
  [profile-seed.ts](../../src/app/admin/profile-seed.ts) learns about pack tables
  or whether packs register a seed applier. The cost code starter sets make it a
  fourth.
- **Re-apply and drift**, inherited from ADR 0009 and now with more surface: a
  starter template or cost code set we later get wrong is wrong on every tenant
  that already installed. No re-apply action exists.
- **Units of measure** arrive here and harder than on the farm: SF, LF, CY, SY,
  EA, TON, SQ, MBF, and a takeoff converts between them. **The excavation
  division makes this urgent rather than eventual** — unit-price work bills by
  the cubic yard, so the number is on an invoice, not just an estimate. A day-one
  decision for `estimating`, a rewrite if deferred.
- **Where production residential's lots live.** `land` already owns parcels,
  zones and a site plan. A subdivision phase with 40 lots may be `land` used
  unchanged — the fourth pack the farm profile paid for that the contractor
  market gets free — or different enough to need its own. Worth an hour with
  `land`'s dossier before assuming either.
- **Prevailing wage and certified payroll are a legal surface, not a feature.**
  Davis-Bacon reporting is wrong-answer-is-a-fine territory. Last in the slice
  order for that reason, and it may want to stay a document the company produces
  elsewhere and files here. **The excavation division doing public work is what
  will force the question.**

## Proposed slice order

Money spine first, because that is the part a spreadsheet does badly and the
part the pilot can check against its own books. Field and document régime
second. Nothing here is committed to.

Revised on the second pass: **`contracts` moved to slice 1**, ahead of
commitments, because a project has no value until it has one and billing hangs
off it.

| # | Slice | Why here |
| --- | --- | --- |
| 0 | `jobs` — project, cost code sets, budget, `delivery_method`, seeded templates, **dimension sync** | The spine. The dimension sync alone makes labor and every bill sliceable by job. |
| 1 | `contracts` — many per project, the ladder, counterparty, role, direction | A project has no value without one. Carries the sub case and the pre-con phases from the start rather than retrofitting both. |
| 2 | `commitments` — POs and subcontracts issued, committed vs actual | Committed cost is the number a budget is useless without. |
| 3 | `change-orders` — PCO → CO → approved, against a contract | The original contract value must stop being editable before anything trusts it. |
| 4 | `progress-billing` — SOV, pay applications, retainage, draws | Five or six billing methods, one named per contract. |
| 5 | `wip` — percent complete, earned revenue, over/under billing | What the bank and the surety ask for, and the credibility slice. |
| 6 | `field` — daily log, photos, manpower, punch list, via `tell-sources` | The first slice somebody on a site touches. |
| 7 | `selections` — option catalogue, allowances, selection deadlines | Covers the production option book and the custom selection process with one mechanism. |
| 8 | `drawings` — sheet sets, versions, markups, measurements | The Documents industry layer already on the roadmap. |
| 9 | `estimating` — takeoff, assemblies, unit costs, bid | Wants units of measure settled and a cost code set to estimate into. Unit-price billing for the excavation side lands here. |
| 10 | `compliance` — COI expiry, lien waivers, W-9 | Work raised where it lives; no new task engine. |
| 11 | `submittals` — submittals, RFIs, ASIs, transmittals | Commercial-weighted, so it waits for a commercial job run in anger. |
| 12 | `warranty`, `bonding`, `certified-payroll` | Last, and `certified-payroll` may not belong in software at all. |
