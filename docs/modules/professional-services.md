# Professional services

> What a services business sells: an **engagement** — one agreement with one
> client, with a scope, a fee, a rate and a number of hours a month — and the
> time logged against it. A bookkeeping firm's monthly close, a law practice's
> matter, a design studio's retainer and a consultancy's project are one
> shape; the words come from `kind`, which the tenant supplies, and from two
> declared labels. Listed by the [agency](agency.md) profile, whose pilot is
> the platform's own operator tenant ([ADR 0041](../decisions/0041-a-tenant-is-a-workspace-and-a-client-is-a-party-in-the-operator-tenant.md)).
> Status: `available` · Scope: `module` <!-- keep Status on ONE line — /admin/docs parses it -->

**Read [packs-and-profiles.md](packs-and-profiles.md) first** if you are
touching the pack machinery rather than engagements, and
[extension-model.md](../extension-model.md) §2–§3 before adding anything that
names an industry. **Nothing in this pack is named after the business that
pilots it**, and `tests/packs.test.ts` fails if it ever is.

## Build log

### 2026-09-10 — Slice 7b: engagements and time (`claude/back-office-7b-engagements-and-time`)

The pack's first slice. Migrations **0295** (tables) and **0296** (RLS).

- **Three tables**, prefixed `ps_` because `professional_services_` would push
  the index names past what Postgres allows: `ps_engagements`,
  `ps_engagement_allotments` (retainer hours agreed from a month onward) and
  `ps_time_entries`.
- **An engagement is a COST OBJECT** from the moment it exists — a
  `dimension_members` row of type `engagement`, synced in the SAME transaction
  as the write, which is the rule `assets` set for every pack since. Named
  `Client · Engagement`, because a report reads a list of members with no idea
  what an engagement is. Ending ARCHIVES the member (nothing new should be
  tagged to finished work; what already was keeps reporting) and reopening
  brings it back.
- **The client is a PARTY**, through the shared door — picked from the
  organizations the workspace already knows, or minted by
  `createPartyForRole`. Fixed at creation: an engagement for somebody else is
  a different engagement, and moving one would take its whole time log with
  it. **The FK carries NO cascade**, and that is load-bearing — see Decisions.
- **The month's math is composed, not copied.** `core/meter.ts` reuses
  `allotmentForMonth` and `usedByMonth` from the platform retainer's pure
  helpers (`src/lib/retainer-core.ts`), because a retainer is a retainer on
  either side of the platform. What it does NOT reuse is that meter's
  all-time overage: the platform sells hour blocks that soak overage up across
  months, while an engagement bills its overage at a rate and each month
  stands alone.
- **Retainer hours are month-keyed history.** `retainer_minutes_monthly` on
  the engagement is display; the math reads `ps_engagement_allotments`, so
  raising a client's hours in October never rewrites September's overage. The
  same call `retainer_allotments` made in 2026-07.
- **Owner decides, member records.** Agreeing an engagement, changing terms
  and moving it along are `owner` (a money consequence, and
  `upsertDimensionMember` requires an owner anyway); logging, correcting and
  deleting time are `member` — the person who did the work knows how long it
  took, and a slip is fixed by whoever made it.
- **The duration box reads what people type**: `1:30`, `1.5`, `1.5h`, `90m`,
  `90 minutes`. A bare number under 16 is hours, 16 or more is minutes —
  nobody logs two minutes, everybody logs ninety.
- **Three guides** (`docs/help/professional-services/`), and the two labels
  the pack declares mean they are written in each business's own words.
- **Not driven** — another session holds the checkout. What to try by hand:
  agree one, log `1:30` against it, watch the month go over, edit the terms
  and check the earlier month did not move.

## Data model

| Table | Purpose | Notes (RLS, invariants, FKs) |
| --- | --- | --- |
| `ps_engagements` | One agreement with one client: kind, status, scope, dates, fee, rate, retainer hours | superadmin_all + member_all (0296). Composite FK `(tenant_id, party_id) → parties`, **no cascade**. `kind` is an open taxonomy with a format CHECK only; `status` is text + CHECK (`proposed`/`active`/`paused`/`ended`), never a pgEnum. `version` for optimistic concurrency |
| `ps_engagement_allotments` | Retainer hours agreed from a calendar month onward | Unique `(tenant, engagement, effective_month)`. Cascades from the engagement. Month format CHECK |
| `ps_time_entries` | Minutes against an engagement, on a bookkeeping day, by one person | Cascades from the engagement. `minutes > 0` CHECK; the action caps a single entry at 24 h. `version` for optimistic concurrency |
| `dimension_members` | The cost object, type `engagement` | Core's table, written through `upsertDimensionMember` in the same transaction. Core never learns this pack exists |
| `parties` | The client | The shared identity — never a name on the engagement |

## Key files & seams

- `src/db/schema/professional-services.ts` — the three tables, and why each column is shaped as it is.
- `src/packs/professional-services/ops.ts` — every read and write; takes the caller's `Tx` so the write and its dimension sync share one transaction.
- `src/packs/professional-services/core/meter.ts` — PURE. The month, the rounding, the history.
- `src/packs/professional-services/vocabulary.ts` — import-free: kinds, statuses, the transition table, `parseDuration`.
- `src/packs/professional-services/actions.ts` — the four gates, the tenant's own today, audited.
- `src/packs/professional-services/ProfessionalServicesModule.tsx` — the list; `src/app/dashboard/m/professional-services/[id]/page.tsx` — one engagement.
- `drizzle/0295_professional_services.sql` (**hand-reordered**), `drizzle/0296_professional_services_rls.sql`.

## Decisions & gotchas

- **The party FK has no cascade, on purpose.** The CRM's merge deletes the
  losing identity LAST (`src/modules/crm/merge-ops.ts` step 8) precisely so a
  reference it did not know to re-point fails on the key and rolls the whole
  merge back. A cascade here would instead let a merge quietly take a client's
  engagements and their entire time log. `tests/engagements-ops.test.ts`
  certifies the refusal. **Whoever teaches the merge about this pack must
  re-point these rows, not rely on the database.**
- **Migration 0295 is hand-reordered.** drizzle-kit emits every
  `ADD CONSTRAINT` before every `CREATE INDEX`, which cannot work when a
  composite FK points at a table born in the same migration — Postgres refuses
  an FK whose referenced columns have no unique index yet. The unique index
  moves above the two constraints. Migration 0276 paid for this first.
- **`requires: []`.** A client is a party and the party door is Layer 0, so
  the CRM being on makes a client easier to find, not an engagement possible.
  A dependency on `crm` would stop a bookkeeping firm that bought only
  Accounting from using this at all.
- **A month is the tenant's calendar month**, resolved in `actions.ts` from
  `tenant.timezone` and passed down. `ops.ts` never asks what day it is, which
  is what makes the ops testable against fixed months.
- **Rounding divides once, on the month's total.** A rate is per hour and time
  is minutes. Rounding per entry and summing invents cents: at $100.10 an
  hour, sixty one-minute entries come to $100.20.
- **Time may be logged against a `proposed` or `paused` engagement**, and only
  an `ended` one refuses. Discovery hours before the agreement is signed are
  real, and so is finishing something off during a pause.
- **Nothing is invoiced or posted automatically.** The figures say what to
  bill; the invoice is raised in Accounting by a person. Posting revenue from
  an engagement is a decision nobody has taken — see Open items.

## Open items

- **Nothing bills from it.** `Extra this month` is a figure to read, not an
  invoice. The obvious next step is a *Bill this month* action that drafts an
  invoice against the client's customer role — deliberately not built until
  running the agency on it has said what the line should read.
- **Time is not marked as billed**, and an entry in a month you have already
  invoiced can still be edited. A `billed_at` stamp, or a lock at the month,
  wants the billing step above to exist first.
- **No revenue or WIP posting.** `1220 Work in Progress` and `4030 Retainer
  Revenue` exist in the agency chart (slice 7a) and nothing posts to them.
  ADR 0041's Notes record this and the client-facing meter question together.
- **No cross-client view**: no report of hours by client, by person or by
  month, and nothing totals what is unbilled.
- **No setup step.** The pack contributes no `setup-sources` entry, so a new
  services business is not walked to its first engagement from the Overview's
  *Getting set up* card. One line in `src/lib/setup-sources/registry.ts` when
  the ordering comment there is revisited.
- **No timer.** The platform's own retainer has one; this does not, because
  nobody has asked and the duration box takes `1:30`.
- **Onboarding lists (7c) and Discovery (7d)** — the rest of the slice order
  in [agency.md](agency.md).
