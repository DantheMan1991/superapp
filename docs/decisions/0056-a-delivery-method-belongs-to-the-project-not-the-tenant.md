# 0056 — A delivery method belongs to the project, not the tenant

- **Date:** 2026-09-13
- **Status:** Proposed
- **Affects:** Layer 2b (industry profiles), the construction pack family, `tenants.industry`

## Context

Construction names four flavours of itself, and the market uses the words as if
they were four industries: **production residential** (a builder releasing homes
from a book of plans), **semi-custom** (a plan the buyer modifies against
allowances), **luxury full custom** (architect-led, cost-plus or GMAX), and
**commercial** (hard bid or CM-at-risk, AIA pay applications, retainage, lien
waivers, certified payroll).

Three facts forced a decision before any code:

1. **A real company does several at once.** The pilot tenant — the founder's
   employer, named in [construction.md](../modules/construction.md) — does
   luxury full custom residential, semi-custom and commercial. It is one
   company with one set of books, not three.
2. **`tenants.industry` holds exactly one slug.** Two profiles on one tenant is
   mechanically possible (run both installers) but label resolution would have
   to pick a winner, which
   [packs-and-profiles.md](../modules/packs-and-profiles.md) records as an open
   item and the first thing to revisit per
   [ADR 0009](0009-packs-are-modules-profiles-install-them.md).
3. **The four flavours share almost all of their capabilities.** Of eighteen
   packs the family needs, **twelve are wanted by all four unchanged**
   ([construction.md](../modules/construction.md) carries the matrix). Only six
   vary at all: `selections` and `warranty` are wanted by three of the four, and
   `submittals`, `land`, `certified-payroll` and `bonding` by one. Making the
   flavour a pack axis would fork twelve identical packs to vary six.

The naive reading — "construction is four industries, so four profiles" — fails
on (1) and (2) together: the pilot would install three of them and land
immediately on the unresolved single-slug problem, making the first real
customer the awkward case rather than the ordinary one.

## Decision

**One `construction` industry profile.** The flavour is not an industry axis; it
is a `delivery_method` on the project — an open taxonomy column (P1) with a
format check and no value constraint, exactly the shape
[`ps_engagements.kind`](../../src/db/schema/professional-services.ts:104) already
has.

A delivery method selects a **project template**: a row in a `jobs`-pack-owned
table carrying which workflows are switched on, which documents a job of this
kind must collect, how the budget locks, how revenue is recognised, and which
contract kinds typically apply in what order. The profile seeds starter
templates at install; from that moment the rows are the tenant's and it edits
them and adds its own.

**No pack branches on delivery method.** The single code-shaped difference is
the billing method, of which the `progress-billing` pack ships five or six
(draw schedule, schedule-of-values percent, monthly progress draw,
cost-plus-fee with and without GMAX, unit price, time and materials) and **the
contract** names one. A billing method is not an industry — a professional
services firm bills fixed-fee and T&M too — so naming one breaks no boundary.

### Two corrections the pilot forced, recorded because the wrong versions are the intuitive ones

This ADR's first draft put the **contract type**, the **billing method** and the
**cost code structure** on the project template. The pilot's answers on
2026-09-13 disproved all three, before any code was written:

- **A contract is a table, many per project, and they are often sequential.** The
  pilot's five kinds include a Concept Design → Construction Drawings → New Home
  ladder: three contracts for one house, each with its own value and its own way
  of billing, and the first two may be the only two that ever exist. A template
  field cannot hold a house that is on its second contract of three. So
  `contracts` is a table with its own kind, value, billing method, counterparty,
  role and direction — and **a project's `delivery_method` is nullable**, because
  a project may begin as a design engagement before anyone knows what gets built.
  **Counterparty and direction are also how subcontracting works**: a subcontract
  the company *receives* is its prime contract on that project, same table,
  retainage held from it rather than by it. `commitments` stays what the company
  issues outward.
- **The cost code set is tenant-level, not flavour-level.** The pilot runs one
  custom list across all three delivery methods. The range is CSI MasterFormat,
  NAHB's chart, or a list the company invented, and one set is probably the
  majority case — so `costCodeSetId` on a template defaults to null meaning "the
  tenant's default", and a company with one list is never asked which.

What survives untouched is this ADR's actual claim: the flavour is a property of
the project, not the tenant. What moved is only what hangs off it, and the
delivery method is **thinner** than the first draft thought.

### Multi-company was already decided, at three levels

The pilot's real structure is a **group** (Shrock Family of Companies) over three
**legal entities** (Shrock Premier Custom Construction LLC, Rainbow Restoration,
Shrock Prefab), one of which contains three **divisions** (Construction,
Excavation, Cabinet Shop — the last two subbing out to other GCs).

The platform already has exactly three levels and they map without invention:
the **tenant** is the group ([ADR 0010](0010-entities-inside-a-tenant.md): the
tenant is the client relationship, and billing is per tenant, so three companies
is one subscription), **`entities`** are the companies, **`enterprises`** are the
divisions. The schema's own test settles each case: *does the trial balance have
to balance within it?* **Construction must not invent a second notion of company,
or of division.**

**A correction, recorded rather than patched.** An earlier draft of this ADR said
the company's own cabinet shop subcontracting to its own custom home is ADR 0010's
intercompany pair. It is not — both are divisions of one LLC, so the books balance
within it and there is nothing to eliminate. It is an **allocation between
dimension members**, following the house rounding rule in
[cash-basis-allocate.ts](../../src/modules/accounting/core/cash-basis-allocate.ts),
and the founder confirms the work is shared rather than invoiced today.
Intercompany is still real, for a different pair: Shrock Prefab selling to Shrock
Premier crosses two entities.

### The consequence one level up: a group can span industries

The pilot's group spans custom construction, restoration and prefab, and
`tenants.industry` holds one slug — so the problem this ADR dissolves at the
delivery-method level returns at the entity level. **It is narrower than it
looks**: packs are per-tenant and switching on the union is fine, so *capability*
survives and only *vocabulary* breaks (one word list for three industries) with
seeds a mild third case, being additive and idempotent.

**The designed answer is this ADR's own claim one level up: the industry belongs
to the entity, not the tenant.** `entities.industry`, with label resolution
reading the active entity and falling back to the tenant — the shape label
resolution already has, one level deeper.

**Deliberately not built, and now formally deferred.** The founder scoped the
other two companies out on 2026-09-13 — different industries, *"not going to
worry about right now"* — so construction's first customer is one entity with
three divisions. The design is recorded with a **trigger rather than a date: the
day Prefab or Restoration is put into the platform.** It does promote
[packs-and-profiles.md](../modules/packs-and-profiles.md)'s
two-profiles-on-one-tenant open item from hypothetical to observed, which is
worth more than building it early.

**Consolidated financials needed nothing.** The group does prepare them, and
[consolidation.ts](../../src/modules/accounting/core/consolidation.ts) is ADR 0010
slice 3, live, with `combined` and `consolidated` report scopes and a deliberate
refusal on anything filed per entity. One caveat came from reading its header
rather than assuming: it is **explicitly not full GAAP consolidation**, assuming
*"commonly owned LLCs rather than a parent holding subsidiaries"* — so whether the
group is brother-sister (combined statements, exactly right) or a true holding
company (needs eliminations it does not do) is an accounting question to settle
before a second entity goes in. **Construction's design changes not at all for
any of it**: `entity_id` on a project, one entity, a report above it that already
exists. That is ADR 0010 doing its job.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| Four profiles, one per flavour | The pilot needs three at once, so it hits the single-slug problem on day one. And the flavours would *still* have to be per-project data inside each profile, because a company running two kinds of job needs both on the same project list — so four manifests buy nothing the templates were not already providing. |
| Two profiles, `residential-builder` + `commercial-contractor` | Same failure, one step further out: the pilot installs both. Sharing by spreading a constant is sanctioned, but the sharing was never the problem — the tenant column was. |
| The flavour as a pack axis (`estimating-commercial`, …) | Forks twelve identical packs to vary six, and forking is the one outcome the extension model exists to prevent ([extension-model.md §2](../extension-model.md)). |
| Delivery methods in `packConfig` only, read live | Then the company cannot edit its own. Per-company tailoring is the *same* variation as per-flavour difference, one authored by us and one by the client, so both must live in a store the client can write. `packConfig` is read-only to the tenant by construction. |
| A `delivery_method` enum with a check constraint | Closes the list against the company that has a fifth kind of job. The house pattern is a format check only, and the pilot is unlikely to be the last word on how many kinds of work a contractor does. |

## Consequences

**What it buys.**

- A multi-type company is an *ordinary* tenant. The pilot needs no special case,
  and the hardest customer shape is the default one.
- Per-flavour difference and per-company difference are one mechanism with two
  authors. There is no second machinery to build for Layer 3, and no per-tenant
  branch in code, which is the outcome
  [extension-model.md §5](../extension-model.md) names as the point of the whole
  model.
- Reversible in the cheap direction. If a production-only builder later objects
  to paying for submittals it never opens, add `residential-production` as a
  second profile listing a subset of the same packs. No pack changes, because no
  pack knows which profile listed it.
- The costing seam works unchanged: a project syncs into `dimension_members`
  like any other cost object, so every accounting report slices by job with no
  change to accounting.

**What it costs, honestly.**

- **One SKU for a builder who uses half of it.** The profile is the price
  ([packs-and-profiles.md](../modules/packs-and-profiles.md), decided
  2026-08-13), so a production builder pays the construction price and switches
  `submittals` and `bonding` off. That is the empty-slot discipline working as
  intended, but it is a real objection a prospect may raise before the second
  profile exists.
- **Vocabulary stays tenant-wide, and the pilot confirms that is enough.** It says
  **client**, one word, commercial and custom alike, so the worry that a company
  needs "Owner" on one job and "Homeowner" on another is closed and
  label-per-delivery-method must not be built on speculation. **But the answer
  exposed a real gap: no core module declares a single label key.** All fifteen in
  the registry come from packs, and the only `client` belongs to
  `professional-services`, so on install the pilot's invoice says "Customer" and
  nothing can rename it. Core declaring `customer`, `invoice`, `vendor` and
  `estimate` is a prerequisite of this profile, not a follow-up — it is slice 0a
  in [construction.md](../modules/construction.md), and it is the gap
  [packs-and-profiles.md](../modules/packs-and-profiles.md) already calls "the
  bigger gap".
- **`IndustryProfile.seed` grows a third kind.** It takes `accounts` and
  `folders` today. Project templates make it three, and the first seed kind that
  is a pack-owned table rather than a core one.
- **A template is copied at install, so a profile improvement does not reach
  installed tenants.** ADR 0009 accepted that cost for seeds; this widens the
  surface, because a starter template we later realise is wrong is wrong on
  every tenant that already installed. The mitigation is the same one ADR 0009
  names and nobody has built: a re-apply action and a drift report.

- **The pilot is an instance, and saying so is part of the design.** The founder's
  instruction, in his words: *"don't narrow the software to just me — remember
  other companies will do it differently."* So every fact the pilot supplies is
  recorded in [construction.md](../modules/construction.md) **beside the range it
  sits in**, three columns wide, and a fact with no range recorded is treated as
  a narrowing waiting to happen. The failure mode is not shipping the pilot's
  cost codes; nobody would. It is shipping a *shape* only the pilot's process
  fits — which this ADR's first draft did twice in one pass, and which is the same
  rule [`tests/discovery-prompt.test.ts`](../../tests/discovery-prompt.test.ts)
  already enforces for prompts.

## Notes

**The lesson worth keeping:** the founder asked how to handle four flavours and
the useful move was to stop treating "flavour" as one variable. It was four —
what the software can do (packs), what kind of company this is (the profile),
what kind of work *this job* is (the project), and how *this company* does it
(its own templates) — and three of the four already had a home. Only the third
was missing, and it was a column.

**The second lesson, from the same day:** the design was written, then the pilot
was asked for its real contracts and cost codes, and **two of the answers broke
it** — before a migration existed. Both corrections cost an hour of editing. Had
the first draft been built, the contract one would have cost a table, a
migration on two databases and every screen that read the field. The cheap
version of "ask the client first" is asking before slice 0, not after it.

**What would make us revisit:** a prospect refusing the price because it does
one flavour only (add a narrower profile, cheap); or the pilot genuinely using
two different words for the client in front of two different customers, which
would force label resolution to grow a scope it does not have.
