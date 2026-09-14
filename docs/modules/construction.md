# Construction (industry profile)

> The platform's third industry profile (Layer 2b) and its first for the
> founder's actual market. Construction names four flavours of itself —
> production residential, semi-custom, luxury full custom, commercial — and the
> market talks about them as if they were four industries. They are not. They
> are four **delivery methods** inside one industry, and a delivery method is a
> property of the project, never of the tenant
> ([ADR 0056](../decisions/0056-a-delivery-method-belongs-to-the-project-not-the-tenant.md)).
> Status: `coming_soon` · Scope: `platform` <!-- keep Status on ONE line — /admin/docs parses it -->

**Pilot tenant: the founder's employer.** Shrock Premier Custom Construction LLC
does luxury full custom residential, semi-custom and commercial on one set of
books, with Construction, Excavation and Cabinet Shop as divisions inside it — and
it sits under Shrock Family of Companies beside Rainbow Restoration and Shrock
Prefab. That is deliberately the test case, because **a multi-type company inside
a multi-company group is the case a naive design breaks on** — and if the design
makes it an ordinary tenant rather than a special one, the design is right. Which
it does, for everything except one industry slug: see
[One tenant, three industries](#one-tenant-three-industries).

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

### 2026-09-13 (third pass) — Three levels of company, and the group spans three industries (`claude/construction-industry-design`)

The pilot's real structure, given by the founder:

```
Shrock Family of Companies                      ← the GROUP
├── Shrock Premier Custom Construction, LLC     ← a legal entity
│   ├── Construction                            ← a division
│   ├── Excavation                               ← a division  } both sub out
│   └── Cabinet Shop                             ← a division  } to other GCs
├── Rainbow Restoration                          ← a legal entity
└── Shrock Prefab                                ← a legal entity
```

**Three levels, and the platform already has exactly three.** The mapping is
clean and it is [ADR 0010](../decisions/0010-entities-inside-a-tenant.md)'s own
vocabulary, not an invention:

| The pilot's level | The platform's | Why |
| --- | --- | --- |
| Shrock Family of Companies | **the tenant** | ADR 0010: the tenant *is* the client relationship, "manage ten LLCs in one place", and **billing is per tenant, so three companies is one subscription** |
| the three companies | **`entities`** | Each owns a set of books and files a return. The trial balance must balance within it |
| Construction · Excavation · Cabinet Shop | **`enterprises`** | Divisions inside one LLC's books. The trial balance does *not* balance within one |

**A correction to the second pass.** That entry said the cabinet shop
subcontracting to one of the pilot's own homes is ADR 0010's intercompany pair.
**It is not** — the founder's answer puts both inside Shrock Premier Custom
Construction LLC, so it is *inter-division within one set of books*: an allocation
between dimension members, not a linked pair of entries. Much simpler, and the
house rules for it already exist ([packs-and-profiles.md](packs-and-profiles.md):
"Allocation belongs to the pack, and follows the house rounding rule"). The
intercompany pair becomes real only **between entities** — Shrock Prefab selling
to Shrock Premier. Both mechanisms are needed; they are needed for different
pairs of parties than the second pass claimed. The founder also answered that the
cabinet shop's work is **shared, not invoiced**, today — which is exactly what an
inter-division allocation is.

**The new hard problem, and it is the one I had avoided one level down.**
`tenants.industry` holds one slug, and this group spans **three industries**:
custom construction, restoration (insurance-driven emergency work, a genuinely
different business), and prefab. ADR 0056 dissolved two-profiles-on-one-tenant at
the *delivery method* level; the group brings it back at the *entity* level. See
[One tenant, three industries](#one-tenant-three-industries) — it is narrower than
it first looks, and the designed answer is a one-line symmetry with ADR 0056.

**Vocabulary is answered, and it exposed a prerequisite.** The pilot says
**client**, one word, for both commercial and custom — so the tenant-wide
`tenants.labels` fits and the concern recorded in the first two passes is closed.
But **no core module declares a single label key.** All fifteen declared keys come
from packs ([packs/index.ts](../../src/packs/index.ts)), and the only `client` is
`professional-services`', a pack a construction tenant will not have on. So the
pilot's invoice says "Customer" and nothing can rename it. That is now
[slice 0a](#proposed-slice-order).

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
[Three levels of company](#three-levels-of-company-and-which-mechanism-each-one-is).

> **Partly corrected by the third pass above.** The divisions turned out to be
> inside ONE LLC, so the cabinet shop's work on a Shrock home is an
> inter-division **allocation**, not the intercompany pair. `entities` is still
> the right mechanism — for the three companies, one level up.

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
| **Divisions of one company.** Construction, Excavation and Cabinet Shop all sit inside Shrock Premier Custom Construction LLC — and that LLC sits under Shrock Family of Companies beside Rainbow Restoration and Shrock Prefab | **Three levels**: a group, its legal entities, their divisions | A sole trader has one of each. A single LLC with divisions has no group. A holding company over ten LLCs has no divisions. **The platform's tenant / `entities` / `enterprises` are exactly these three**, so all shapes fit — but a company-under-a-company would not, because `entities` is flat |
| **Sharing it, not invoicing it** — the cabinet shop's work on a Shrock home is a cost share today, and they have tried both | Whether internal work is **allocated** or **invoiced** | Within one LLC it can only be an allocation (the books balance within it). Between entities it can be either, and invoicing is ADR 0010's intercompany pair. Some companies invoice internally *on purpose*, to hold a division to a market price |
| **Pre-con costs roll in** — Concept Design and Construction Drawings land in the home's job cost | Whether a phase's cost is **the project's** or its own P&L | Rolling in is what lets margin on the house be true. A design practice billing outside would not roll in. The contracts-as-phases model gives both for free: same project, same cost codes, one contract each |
| **A Misc Proposal gets a job number and cost codes** | Whether **all** revenue lands on a project | Here, yes — which simplifies slice 0 a great deal, because nothing bills outside a project. A company doing counter-sales or service calls would need revenue with no project, and the design should not assume against it |
| **Fixed price billed monthly** for the custom homes — not cost-plus | What a **billing method** actually is here | All three of the pilot's methods are percent-or-milestone against a **fixed** value. **So cost-plus-fee is a market requirement, not a pilot one** — it moves out of the first billing slice. Cost-plus and GMAX are normal in luxury custom elsewhere; T&M is normal for a sub |
| **"We call our customers clients"** — one word, both markets | Tenant-wide vocabulary is **enough** | The word varies (client, customer, owner, homeowner, buyer) but a company generally has one. The two-vocabularies worry from the first two passes is **closed for this pilot**, and the design should not build per-delivery-method labels on speculation |

Everything the pilot was asked is now answered. What remains is in
[Open items](#open-items), and the largest is Rainbow Restoration's industry
rather than anything about construction.

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

## Three levels of company, and which mechanism each one is

The pilot's org chart looked like a new structural problem. It is
[ADR 0010](../decisions/0010-entities-inside-a-tenant.md) plus `enterprises`,
both already in the tree.

[`entities`](../../src/db/schema/ledger.ts:286) is "a LEGAL ENTITY inside the
tenant — the thing that owns a set of books", and the tenant is the *client
relationship*. **The test is written down in the schema comment itself: does the
trial balance have to balance within it?** An LLC always; a division never. So:

- **Shrock Family of Companies is the tenant.** Not an entity, unless it files
  its own return — see Open items. The chart of accounts, vendors, customers and
  contacts stay tenant-wide and shared, which ADR 0010 says is "most of what
  manage-it-in-one-place means".
- **The three companies are `entities`.** Each has its own books, bank accounts,
  invoices, bills and period closes.
- **Construction, Excavation and Cabinet Shop are `enterprises`** — dimension
  members inside Shrock Premier's books.

**The correction, stated plainly because the second pass got it wrong.** The
cabinet shop working on one of the pilot's own homes is **not** intercompany. Both
are divisions of one LLC, so the books balance within it and there is nothing to
eliminate: it is an **allocation between dimension members**, and the founder
confirms it is shared rather than invoiced today. The allocation rules already
exist and construction does not get its own — `progress-billing` and `jobs` follow
[cash-basis-allocate.ts](../../src/modules/accounting/core/cash-basis-allocate.ts),
"THE ONE PLACE IN REPORT MATH THAT DIVIDES", with its exact remainder rule.

**Intercompany is still needed, for a different pair.** Shrock Prefab selling to
Shrock Premier crosses two entities, and that is ADR 0010's linked pair sharing an
`intercompany_id`, written together or not at all. Both mechanisms are real; the
second pass simply pointed the wrong one at the wrong pair.

**A project therefore carries three coordinates**, none of which is the delivery
method: which **entity**'s books it belongs to, which **enterprise** (division)
runs it, and which **cost code set** it is budgeted against. All three already
have mechanisms. Note the dependency: `enterprises` is only partly built —
profit-per-division for this pilot needs that roadmap finished
([enterprises.md](enterprises.md)).

**What construction must not do:** invent a second notion of company, or a second
notion of division. If a slice finds itself wanting either, it has missed
`entities` or `enterprises`.

## One tenant, three industries

The problem ADR 0056 dissolved at the delivery-method level, returning one level
up. Shrock Family of Companies spans **custom construction**, **restoration**
(insurance-driven emergency work — a different business with different money) and
**prefab**. `tenants.industry` holds one slug.

**It is narrower than it looks.** Three things are per-tenant and one of them is
not a problem:

| What | Per what | Does the group break it? |
| --- | --- | --- |
| Which packs are switched on | `tenant_modules.enabled`, per tenant | **No.** A restoration job and a custom home can both exist; the union is simply on |
| Vocabulary | `tenants.labels`, per tenant | **Yes.** One word list for three industries |
| Profile seed (accounts, folders, templates) | applied once at install | **Yes**, mildly — it is additive and idempotent, so a second profile's seed can be applied on top |

So **capability is fine and words are not.** That is the whole of it, and it is
the open item [packs-and-profiles.md](packs-and-profiles.md) has carried since
2026-08-14 — **now with a real customer behind it rather than a hypothetical.**

**The designed answer, when it is needed, is a one-line symmetry with ADR 0056:
the industry belongs to the ENTITY, not the tenant.** The flavour was not the
tenant's and neither is the industry. `entities.industry`, with label resolution
reading the active entity and falling back to the tenant — which is the shape
label resolution already has (a tenant override on a profile default), one level
deeper. **Not built, and not built on speculation:** the first question below
decides whether it is needed at all.

## The prerequisite the vocabulary answer exposed

The pilot says **client**, one word, both markets — so tenant-wide labels are
enough and the two-vocabularies worry is closed. But there is nothing to override.

**No core module declares a single label key.** All fifteen in the registry come
from packs ([packs/index.ts](../../src/packs/index.ts)): `parcel`, `zone`, `lot`,
`item`, `asset`, `structure`, `channel`, `marketDay`, `livestockLot`,
`productionRun`, `killSheet`, `cutSheet`, `processor`, `engagement`, `client`. The
only `client` belongs to `professional-services` — a pack a construction tenant
will not have switched on.

So on the day the pilot installs, **Accounting's invoice says "Customer", CRM's
record says "Customer", and no profile can change it.** This is exactly the gap
packs-and-profiles.md names as "the bigger gap" and it is now blocking a paying
client's first impression.

The fix is small and it is a ratchet: core declares `customer`, `invoice`,
`vendor` and `estimate` as `LabelDefinition`s and calls `labelFor` where it
renders them. `tests/vocabulary.test.ts` fails if a key is rendered without being
declared, so the sweep can only tighten. **It is slice 0a, ahead of anything
construction-specific**, and it is worth more than any pack in this file to every
industry the platform will ever have.

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
| `projects` | The spine. Every other pack hangs off it, the way every pack hangs off `inventory`'s lot. | `delivery_method` text, **format check only, no value constraint** (P1) — the shape [`ps_engagements.kind`](../../src/db/schema/professional-services.ts:104) already has, and **nullable**, because a project may start as a design engagement before anyone knows what gets built. **Carries three coordinates that are not the delivery method**: `entity_id` (whose books), the enterprise/division it runs under, and the cost code set it is budgeted against. Syncs into `dimension_members` itself. |
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
- **Vocabulary is tenant-wide and that is ENOUGH — the pilot settled it.** It says
  **client**, one word, commercial and custom alike, so label-per-delivery-method
  is machinery nobody needs and must not be built on speculation. What the answer
  did expose is that **no core module declares a label at all**, so there is
  nothing to rename. See
  [the prerequisite](#the-prerequisite-the-vocabulary-answer-exposed) — slice 0a.
- **One tenant can span industries even when one profile covers its flavours.**
  ADR 0056 dissolved that at the delivery-method level; the pilot's group brings
  it back at the entity level, and capability survives while words do not. The
  designed answer is `entities.industry`, unbuilt on purpose — see
  [One tenant, three industries](#one-tenant-three-industries).
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

**Every question put to the pilot has been answered** (see the three-column
table). These are what the answers opened, in priority order:

- **Does Rainbow Restoration need to be in the platform at all?** It is a
  franchise brand, and franchises often mandate their own software. If it does,
  `entities.industry` is needed and restoration is a second profile to design. If
  it does not, the group is construction plus prefab and prefab may be a fifth
  delivery method rather than another industry. **This is the largest open
  question in this file and none of it is construction.**
- **Is Shrock Family of Companies itself a filing entity?** If it files a
  consolidated return it wants an `entities` row of its own, and `entities` is
  **flat** — no parent column — so a company-under-a-company would be the first
  thing to break. If it is only an umbrella name, it is the tenant's name and
  nothing is needed.
- **Is Shrock Prefab a separate industry or a delivery method?** Modular and
  panelised construction is arguably a fifth flavour — a plant building assemblies
  against a schedule, which is `production` plus `inventory` — rather than another
  industry. Cheaper if it is a delivery method, and the answer is the founder's.
- **Does the cost share between divisions need to become an invoice later?** The
  founder says they have tried both and are sharing today. An allocation and an
  internal invoice are different builds, and a company that wants a division held
  to a market price wants the invoice.
- **Which cost codes do the pre-con phases use?** They roll into the home's job
  cost, so they share the project — but whether Concept Design posts to its own
  codes or to a design code inside the build's set changes what the budget looks
  like at contract two of three.

**Structural, carried forward:**

- **Core declares no vocabulary** — slice 0a above, and the reason the pilot's
  invoice would say "Customer" on day one.
- **`enterprises` is only partly built** and profit-per-division is what the
  pilot's three divisions are for. That roadmap is a dependency of this one
  ([enterprises.md](enterprises.md)).

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
off it. Revised on the third pass: **slice 0a added ahead of everything**, and
cost-plus-fee dropped out of slice 4 because the pilot bills fixed price monthly.

| # | Slice | Why here |
| --- | --- | --- |
| **0a** | **Core declares vocabulary** — `customer`, `invoice`, `vendor`, `estimate` as `LabelDefinition`s, with `labelFor` at every render site | **Not construction, and ahead of it.** Without this the pilot's invoice says "Customer" and no profile can change it. Worth more to every future industry than any pack below, and `tests/vocabulary.test.ts` makes it a one-way ratchet. |
| 0 | `jobs` — project, cost code sets, budget, `delivery_method`, seeded templates, **dimension sync**, plus `entity_id` and the division | The spine. The dimension sync alone makes labor and every bill sliceable by job. Three coordinates, none of them the delivery method. |
| 1 | `contracts` — many per project, the ladder, counterparty, role, direction | A project has no value without one. Carries the sub case and the pre-con phases from the start rather than retrofitting both. |
| 2 | `commitments` — POs and subcontracts issued, committed vs actual | Committed cost is the number a budget is useless without. |
| 3 | `change-orders` — PCO → CO → approved, against a contract | The original contract value must stop being editable before anything trusts it. |
| 4 | `progress-billing` — SOV, pay applications, retainage, draws | **Three methods, not six.** The pilot bills fixed price monthly, AIA pay application and a home draw schedule — all percent-or-milestone against a fixed value. Cost-plus-fee, GMAX and T&M are market requirements for later. |
| 5 | `wip` — percent complete, earned revenue, over/under billing | What the bank and the surety ask for, and the credibility slice. |
| 6 | `field` — daily log, photos, manpower, punch list, via `tell-sources` | The first slice somebody on a site touches. |
| 7 | `selections` — option catalogue, allowances, selection deadlines | Covers the production option book and the custom selection process with one mechanism. |
| 8 | `drawings` — sheet sets, versions, markups, measurements | The Documents industry layer already on the roadmap. |
| 9 | `estimating` — takeoff, assemblies, unit costs, bid | Wants units of measure settled and a cost code set to estimate into. Unit-price billing for the excavation side lands here. |
| 10 | `compliance` — COI expiry, lien waivers, W-9 | Work raised where it lives; no new task engine. |
| 11 | `submittals` — submittals, RFIs, ASIs, transmittals | Commercial-weighted, so it waits for a commercial job run in anger. |
| 12 | `warranty`, `bonding`, `certified-payroll` | Last, and `certified-payroll` may not belong in software at all. |
