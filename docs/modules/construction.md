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
than a special one, the design is right. Every number, list and process in this
file is to be replaced by that company's real ones before any code is written;
what is written here is the shape, not the content.

**Nothing below is built.** This is the design, recorded so the first pack does
not improvise — the same status
[packs-and-profiles.md](packs-and-profiles.md) held on 2026-08-13.

## Build log

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
| How THIS company does it | Layer 3, tenant-owned rows | its cost codes, its draw schedule |

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

## One profile, four delivery methods

The argument, because it is the thing a future session will be tempted to undo.
Seventeen packs, and **thirteen are wanted by all four flavours**:

| Pack | Prod resi | Semi | Luxury | Commercial |
| --- | :-: | :-: | :-: | :-: |
| `jobs` — project, cost codes, budget, WIP | ● | ● | ● | ● |
| `estimating` — takeoff, assemblies, bid | ● | ● | ● | ● |
| `commitments` — POs and subcontracts | ● | ● | ● | ● |
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

Four rows differ. **Making the flavour a pack axis would fork thirteen packs to
vary four** — and the pilot needs the union of all of them regardless, so the
flavour would end up per-project anyway. The multi-type company is what proves
the design rather than what strains it.

## What differs per delivery method, and it is all values

| | Prod resi | Semi | Luxury | Commercial |
| --- | --- | --- | --- | --- |
| Contract type | fixed | fixed + allowances | cost-plus or GMAX | lump sum, GMP, unit price |
| Cost code structure | builder's own | same | same | CSI-shaped |
| Budget locked | at release | at contract | never, runs | at buyout |
| Retainage | none | none | sometimes | held, released at a threshold |
| Billing trigger | inspection milestone | milestone | monthly cost + fee | monthly SOV percent |
| Change flow | option change before a cutoff | change order | change order, constant | PCO → CO → owner |
| Revenue recognition | at closing | at closing | percent complete | percent complete + WIP |
| Who decides the scope | buyer picks from a book | buyer modifies a plan | client and architect | owner bids it out |

**Not one row is a code branch. Every row is a value.** That is the test this
table exists to pass, and a future slice that adds a row which is *not* a value
has found something worth an ADR rather than an `if`.

The one genuinely code-shaped difference is the **billing method**, of which
`progress-billing` ships about five — milestone, schedule-of-values percent,
cost-plus-fee, unit price, time and materials — and the template names one. A
billing method is not an industry: a professional services firm bills fixed-fee
and T&M too, so naming one breaks no boundary. Everything else is config.

## The project template

**The single mechanism that answers both of the founder's questions.** A
delivery method selects a template; a template is a row; the row is the
tenant's.

```ts
// Shape only. Lives in the jobs pack, not in core.
interface ProjectTemplate {
  slug: string;               // "luxury_custom", or whatever this company calls it
  name: string;               // shown when starting a project
  contractType: string;       // open taxonomy, format check only
  billingMethod: BillingMethod;   // one of ~5 the pack ships
  costCodeSetId: string;      // which cost code list this kind of job uses
  retainage?: { percent: number; releaseAt?: number };
  budgetLocksAt: "release" | "contract" | "buyout" | "never";
  workflows: string[];        // "selections" | "submittals" | "allowances" | …
  requiredDocs: string[];     // doc_kind values a job of this kind must collect
}
```

The profile seeds four starter templates at install. **From that moment the rows
are the tenant's** and it edits them, renames them and adds a fifth. So:

- *"Each flavour handles tools differently"* → four seeded templates.
- *"Every company handles some things differently"* → the same rows, edited.

There is no second machinery for Layer 3 and no per-tenant branch in code, which
is the outcome [extension-model.md §5](../extension-model.md) names as the whole
point. **A template is copied, not read through** — the `seed` semantics of
[ADR 0009](../decisions/0009-packs-are-modules-profiles-install-them.md), not the
`labels` semantics — because a row the tenant may edit cannot also be a row the
profile owns.

## Data model

Proposed. Nothing exists. Pack-owned tables follow the ordinary rules:
`tenant_id`, FORCE RLS, a `--custom` policy migration and isolation-test
coverage ([security.md §4](../security.md)).

| Table | Purpose | Notes |
| --- | --- | --- |
| `projects` | The spine. Every other pack hangs off it, the way every pack hangs off `inventory`'s lot. | `delivery_method` text, **format check only, no value constraint** (P1) — the shape [`ps_engagements.kind`](../../src/db/schema/professional-services.ts:104) already has. Syncs into `dimension_members`. |
| `project_templates` | The four flavours, then whatever the company adds. | Seeded at install, tenant-owned thereafter. First seed kind that is a pack table rather than a core one. |
| `cost_code_sets` / `cost_codes` | The real spine of a construction business. | Per-company, possibly more than one set (a CSI-shaped one for commercial, a builder's own for resi). Sync as a second dimension type. |
| `project_budgets` / `budget_lines` | Original, revised, committed, actual, projected — by cost code. | The five columns every construction report is made of. |
| `commitments` / `commitment_lines` | POs and subcontracts. One concept: a committed cost to a vendor against a scope. | Billing against a commitment is what `payables` matching already does for a bill. |
| `change_orders` / `change_order_lines` | PCO → CO → approved, with its budget effect. | An approved CO revises the budget; it does not edit the original. |
| `pay_applications` / `sov_lines` | Schedule of values, percent complete, retainage held and released. | The AIA G702/G703 shape, which is also a draw request with different words. |
| `wip_snapshots` | Percent complete, earned revenue, over/under billing, per period. | Computed, then posted as an ordinary journal entry. See the basis-lens finding above. |

## Key files & seams

Every seam this family needs already exists. Listed so the first slice reaches
for them rather than inventing a sixth primitive.

| Seam | Where | What construction does with it |
| --- | --- | --- |
| `dimension_members` | [ledger.ts:501](../../src/db/schema/ledger.ts:501) | **The costing seam and the reason any of this is worth building.** A project is a cost object; every existing accounting report slices by job with no accounting change. |
| `time_entry_dimensions` | [time.ts:699](../../src/db/schema/time.ts:699) | Labor to a job and a cost code, **already built**. Needs a `jobs` sync, nothing more. |
| `documents.doc_kind` + `.metadata` | [documents.ts:101](../../src/db/schema/documents.ts:101) | P1 + P2. `submittal`, `rfi`, `lien_waiver`, `coi`, `drawing` are values a pack supplies. |
| `work_item_links` | [work.ts:315](../../src/db/schema/work.ts:315) | A punch item, an RFI and an overdue COI are all work raised where it lives (§4b) — never a second task engine. |
| `src/lib/site-blocks/` | [types.ts](../../src/lib/site-blocks/types.ts) | A project gallery on the company's own website, as data the site draws. |
| `src/lib/site-templates/` | [types.ts](../../src/lib/site-templates/types.ts) | A contractor's five-page website, one data file, per ADR 0030. |
| `src/lib/tell-sources/` | [types.ts](../../src/lib/tell-sources/types.ts) | "poured the garage slab at Oak Row, four guys, six hours" is one sentence and four screens. This is the field tool that beats a clipboard. |
| `src/lib/paste-targets/` | [types.ts](../../src/lib/paste-targets/types.ts) | A cost code list and a sub list arrive as a paste from a spreadsheet on day one. |
| `src/lib/setup-sources/` | [types.ts](../../src/lib/setup-sources/types.ts) | "You have no cost codes yet" is a prerequisite the data proves missing. |
| `src/lib/leads/` | [types.ts](../../src/lib/leads/types.ts) | A bid invitation arriving through the site is a lead the CRM fills in. |
| `enterprises` | [enterprises.ts](../../src/db/schema/enterprises.ts) | **A division is not a delivery method.** "Commercial Division" is an enterprise; "commercial" is how one job is run. Two dimensions, and a company may use both. |

## Decisions & gotchas

- **[ADR 0056](../decisions/0056-a-delivery-method-belongs-to-the-project-not-the-tenant.md)** —
  one profile, the flavour is per-project, the template is tenant-owned. Read
  the consequences before proposing a second construction profile; it is cheap
  to add and expensive to retrofit the other direction.
- **[ADR 0004](../decisions/0004-capability-packs-and-industry-profiles.md) and
  [ADR 0009](../decisions/0009-packs-are-modules-profiles-install-them.md)** are
  the ground rules. No pack may know which industry it is in, and a profile
  installs rather than binds.
- **`jobs` is the lot spine of this family.** Nothing can start before the
  project, its cost codes and its budget exist, for the same reason
  [inventory.md](inventory.md) records about the lot. Build it first and resist
  building anything alongside it.
- **A pack must not branch on `delivery_method` either.** The column is data the
  *template* reads, and the template's fields are what a pack switches on. A
  pack that says `if (deliveryMethod === "commercial")` has re-created the
  industry branch with a new spelling — which is the failure mode this whole
  file exists to prevent, one level down.
- **Percent complete is not a basis lens.** See the build log. A lens may not
  invent an entry, and over/under billing is an invented entry.
- **Vocabulary is tenant-wide, and this is the first industry that may not fit.**
  "Owner" on the commercial job and "Homeowner" on the custom home, same week,
  same component, same company. `tenants.labels` holds one. Not solved, because
  most companies have one internal vocabulary and label-per-delivery-method is
  machinery nobody has proven they need. **Ask the pilot what its PMs actually
  say before building anything.**
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

- **The pilot's real data is the gating item.** In rough priority: its **cost
  code list** (one set or two?), its contract types and what each is called
  internally, its draw or pay-application schedules per type, its retainage
  terms, and which of the four delivery methods actually behave differently
  *there* versus merely in the trade press.
- **A fifth axis the founder did not name: the company's role on the project.**
  GC, sub, CM-at-risk, owner-builder. If the pilot ever works as a sub,
  subcontracts flip direction — it *receives* one and bills against it. Per
  project, same as the delivery method, but it wants confirming before
  `commitments` is designed around issuing only.
- **`IndustryProfile.seed` must grow a third kind** (`projectTemplates`), and it
  is the first seed kind whose target is a pack table. Decide whether
  [profile-seed.ts](../../src/app/admin/profile-seed.ts) learns about pack tables
  or whether packs register a seed applier.
- **Re-apply and drift**, inherited from ADR 0009 and now with more surface: a
  starter template we later realise is wrong is wrong on every tenant that
  already installed. No re-apply action exists.
- **Units of measure**, the open item
  [packs-and-profiles.md](packs-and-profiles.md) records for `inventory`, arrives
  here too and harder: SF, LF, CY, SY, EA, TON, SQ, MBF, and a takeoff converts
  between them. A day-one decision for `estimating`, a rewrite if deferred.
- **Where production residential's lots live.** `land` already owns parcels,
  zones and a site plan. A subdivision phase with 40 lots may be `land` used
  unchanged, which would be the fourth pack the farm profile paid for that the
  contractor market gets free — or it may be a different enough thing to need
  its own. Worth an hour with `land`'s dossier before assuming either.
- **Prevailing wage and certified payroll are a legal surface, not a feature.**
  Davis-Bacon reporting is wrong-answer-is-a-fine territory. It is last in the
  slice order for that reason, and it may want to stay a document the company
  produces elsewhere and files here.

## Proposed slice order

Money spine first, because that is the part QuickBooks and a spreadsheet do
badly and the part the pilot can check against its own books. Field and document
régime second. Nothing here is committed to.

| # | Slice | Why here |
| --- | --- | --- |
| 0 | `jobs` — project, cost code sets, budget, `delivery_method`, seeded templates, **dimension sync** | The spine. The dimension sync alone makes labor and every bill sliceable by job. |
| 1 | `commitments` — POs and subcontracts, committed vs actual | Committed cost is the number a budget is useless without. |
| 2 | `change-orders` — PCO → CO → approved, budget revision | The original budget must stop being editable before anything trusts it. |
| 3 | `progress-billing` — SOV, pay applications, retainage, draws | The invoice side. Five billing methods, one per contract type. |
| 4 | `wip` — percent complete, earned revenue, over/under billing | What the bank and the surety ask for, and the credibility slice. |
| 5 | `field` — daily log, photos, manpower, punch list, via `tell-sources` | The first slice somebody on a site touches. |
| 6 | `selections` — option catalogue, allowances, selection deadlines | Covers the production option book and the custom selection process with one mechanism. |
| 7 | `drawings` — sheet sets, versions, markups, measurements | The Documents industry layer already on the roadmap. |
| 8 | `estimating` — takeoff, assemblies, unit costs, bid | Wants units of measure settled and a cost code set to estimate into. |
| 9 | `compliance` — COI expiry, lien waivers, W-9 | Work raised where it lives; no new task engine. |
| 10 | `submittals` — submittals, RFIs, ASIs, transmittals | Commercial-weighted, so it waits for a commercial job to be run in anger. |
| 11 | `warranty`, `bonding`, `certified-payroll` | Last, and `certified-payroll` may not belong in software at all. |
