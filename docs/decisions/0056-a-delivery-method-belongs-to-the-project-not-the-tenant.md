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
3. **The four flavours share almost all of their capabilities.** Of seventeen
   packs the family needs, thirteen are wanted by all four
   ([construction.md](../modules/construction.md) carries the matrix). Only
   `submittals`, `certified-payroll`, `bonding` and `land` differ. Making the
   flavour a pack axis would fork thirteen packs to vary four.

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
table carrying the contract type, the billing method, the cost code structure,
which workflows are switched on, and the default document requirements. The
profile seeds four starter templates at install; from that moment the rows are
the tenant's and it edits them and adds its own.

**No pack branches on delivery method.** The single code-shaped difference is
the billing method, of which the `progress-billing` pack ships about five
(milestone, schedule-of-values percent, cost-plus-fee, unit price, time and
materials) and the template names one. A billing method is not an industry — a
professional services firm bills fixed-fee and T&M too — so naming one breaks no
boundary.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| Four profiles, one per flavour | The pilot needs three at once, so it hits the single-slug problem on day one. And the flavours would *still* have to be per-project data inside each profile, because a company running two kinds of job needs both on the same project list — so four manifests buy nothing the templates were not already providing. |
| Two profiles, `residential-builder` + `commercial-contractor` | Same failure, one step further out: the pilot installs both. Sharing by spreading a constant is sanctioned, but the sharing was never the problem — the tenant column was. |
| The flavour as a pack axis (`estimating-commercial`, …) | Forks thirteen packs to vary four, and forking is the one outcome the extension model exists to prevent ([extension-model.md §2](../extension-model.md)). |
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
- **Vocabulary stays tenant-wide, so a company with two client words gets one.**
  `tenants.labels` cannot say "Owner" on the commercial job and "Homeowner" on
  the custom home in the same week. Construction is the first industry where
  vocabulary might not be tenant-wide. Deliberately not solved here — most
  companies have one internal vocabulary, and label-per-delivery-method is new
  machinery nobody has yet proven they need.
- **`IndustryProfile.seed` grows a third kind.** It takes `accounts` and
  `folders` today. Project templates make it three, and the first seed kind that
  is a pack-owned table rather than a core one.
- **A template is copied at install, so a profile improvement does not reach
  installed tenants.** ADR 0009 accepted that cost for seeds; this widens the
  surface, because a starter template we later realise is wrong is wrong on
  every tenant that already installed. The mitigation is the same one ADR 0009
  names and nobody has built: a re-apply action and a drift report.

## Notes

**The lesson worth keeping:** the founder asked how to handle four flavours and
the useful move was to stop treating "flavour" as one variable. It was four —
what the software can do (packs), what kind of company this is (the profile),
what kind of work *this job* is (the project), and how *this company* does it
(its own templates) — and three of the four already had a home. Only the third
was missing, and it was a column.

**What would make us revisit:** a prospect refusing the price because it does
one flavour only (add a narrower profile, cheap); or the pilot genuinely using
two different words for the client in front of two different customers, which
would force label resolution to grow a scope it does not have.
