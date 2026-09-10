# Agency (industry profile)

> The platform's second industry profile (Layer 2b), and the first whose pilot
> is the business that runs the platform: the operator tenant of
> [ADR 0041](../decisions/0041-a-tenant-is-a-workspace-and-a-client-is-a-party-in-the-operator-tenant.md).
> It lists one pack — `professional-services` — and contributes what a
> services business keeps beyond the general chart of accounts. Nothing in it
> is named after that business; clients, engagements, retainers, discovery
> and onboarding are any services firm's.
> Status: partial — the profile, its seed and the pack's first slice are built (back-office 7a and 7b); onboarding lists and Discovery are not · Scope: `platform` <!-- keep Status on ONE line — /admin/docs parses it -->

**Pilot tenant: the operator tenant.** The plan in
[back-office.md](back-office.md) says the pack is worth more once a fortnight
of running the agency inside the product has said what an engagement
actually is, and that is the order the slices take: the profile and the
platform gap it exposed first (7a), the engagement model once it has been
lived with (7b), and the screens that hang off it after that.

## Build log

### 2026-09-10 — Slice 7b: the pack ships its first slice (`claude/back-office-7b-engagements-and-time`)

`professional-services` is built: engagements, the month's meter and the time
log — full dossier in [professional-services.md](professional-services.md),
migrations 0295 and 0296. The profile's manifest did not change except to
gain `packConfig["professional-services"].kinds`, which is the three shapes an
agency bills in; the pack has no list of its own, for the reason
`livestock.species` lives in a profile and not in the pack.

**What this profile still contributes and the pack does not:** the chart
(slice 7a) has `1220 Work in Progress` and `4030 Retainer Revenue` waiting,
and nothing posts to them yet. That is the open item the pack's dossier
carries, and it is deliberately unanswered until running the agency on this
has said what a line should read.

### 2026-09-10 — Slice 7a: seeds land, and the profile exists (`claude/back-office-7a-seeds-and-the-agency-profile`)

- **The profile seed applier is built** — the largest gap
  [packs-and-profiles.md](packs-and-profiles.md) recorded in the installer.
  `IndustryProfile.seed` had been declared and read by nothing since Layer 2
  shipped. `src/app/admin/profile-seed.ts` applies it: the chart of accounts
  through `provisionAccounting` (as the tenant), the folders through
  `provisionDocuments` (under `withSystem`, as that provisioner requires),
  each only when its module is ON, and the report names what still waits.
  Both doors call it — `installProfile`, with the modules the tenant has on,
  and `toggleModule`, for the one module being switched on, reading the
  installed profile off `tenants.industry` — so installing the profile a
  week before switching Accounting on loses nothing. Additive and
  re-runnable: every provisioner already skips a code or a root folder the
  tenant has.
- **`seed.accounts` is a `CoaTemplate`, not a slug.** It was typed as a
  string, which would have meant registering an industry's chart in core's
  `COA_TEMPLATES` — the inversion the extension model exists to prevent. The
  manifest carries the data; `provisionAccounting` accepts a template as well
  as a slug. **`seed.docKinds` is gone**: `documents.doc_kind` is an open
  taxonomy typed freely and nothing lists its values, so a seeded list would
  have had no reader.
- **The profile's chart is ADDITIONS to the general one**
  (`src/industries/agency/accounts.ts`), twelve accounts every retainer-and-
  project business keeps: Work in Progress, Client Retainers Held under
  Unearned Revenue, five income lines under Sales, two direct-cost lines, and
  three expenses. Every parent it names is a general account; every code is
  one the general chart does not use. Folders: *Clients* and *Proposals*,
  beside the platform's starter cabinet.
- **`professional-services` is declared and unbuilt** in `src/packs/index.ts`
  and seeded `coming_soon` — the arrangement `crops` has, so the profile's
  manifest is complete before the pack's own slices land and the install
  order is exercised now.
- **The installer says what it will add** — *"Adds 12 accounts to the chart
  and 2 folders, when those modules are on"* — and the toast reports what it
  added; the audit row carries the counts. `profile.seeded` is written when a
  module switched on later receives its seed.
- **Tests.** `tests/packs.test.ts`: the profile is registered, lists only the
  pack, its chart collides with no general code and names only general
  parents, parents precede children. `tests/profile-seed.test.ts`
  (db-backed): waits for a module that is off, lands the chart on top of the
  general one with parents resolved, adds nothing on a re-run, keeps the
  tenant's own account when a code is already theirs, adds the folders once.
- **Not driven** — same reason as every back-office slice. What to try by
  hand after the merge: *Install profile → Agency* on the operator tenant's
  page; Accounting's chart gains the twelve; Documents gains two folders.

## The manifest

| What | Value |
| --- | --- |
| `packs` | `professional-services` (declared, unbuilt) |
| `labels` | none — the pack's fallbacks are this industry's words; a law practice's profile would say `engagement: "Matter"` |
| `seed.accounts` | `AGENCY_COA` — twelve additions over the general chart, below |
| `seed.folders` | Clients, Proposals |
| `packConfig` | `kinds` (retainer, project, hourly) and `onboarding` — six steps a new retainer or project starts with (slice 7c) |
| `display.currencySymbol` | `$` — a card reading *Retainer · 2500.00* has no column header to say it is money |

## The chart additions

| Code | Account | Type | Under |
| --- | --- | --- | --- |
| 1220 | Work in Progress | asset · other current | — |
| 2410 | Client Retainers Held | liability · other current | 2400 Unearned Revenue |
| 4030 | Retainer Revenue | income | 4000 Sales |
| 4040 | Project Revenue | income | 4000 Sales |
| 4050 | Hourly Billing | income | 4000 Sales |
| 4060 | Reimbursed Expenses | income | 4000 Sales |
| 4070 | Software & Licensing Revenue | income | 4000 Sales |
| 5300 | Client Software & Tools | expense · direct | — |
| 5400 | Reimbursable Client Expenses | expense · direct | — |
| 6060 | Payment Processing Fees | expense | 6050 Bank Fees & Charges |
| 6310 | Software Subscriptions | expense | 6300 Office Supplies & Software |
| 6320 | Professional Development | expense | — |

`4010 Service Revenue` stays the catch-all, and it is where the platform's own
subscription and hour-block charges post (ADR 0043); moving those to a line of
their own is a posting-rule change for the day the accountant asks.

## The pack it lists — `professional-services`, slice order

Declared in `src/packs/index.ts`; each slice below is its own PR and gets the
pack's own dossier when the first one lands.

- ~~**7c — Onboarding as a Work list.**~~ **BUILT 2026-09-10** — see
  [professional-services.md](professional-services.md). It landed as designed
  and cost NO migration: the profile names the steps, they become ordinary
  work items linked to the engagement, and the links themselves are the
  record of what has been raised. This profile contributes six steps, for
  retainers and projects only.
- ~~**7b — Engagements and time.**~~ **BUILT 2026-09-10** — see
  [professional-services.md](professional-services.md). It landed as
  designed: the engagement is a cost object synced in the same transaction,
  the client is a party, time is a member-level chore, and the month's math
  is composed from `src/lib/retainer-core.ts` rather than copied. One thing
  the plan did not anticipate: retainer hours needed their own month-keyed
  history table, for the reason the platform's `retainer_allotments` has one.
- **7c — Onboarding as a Work list.** A profile's `packConfig` names the
  lists an engagement starts with; starting one raises the items through the
  Layer 0 work verbs, linked to the engagement (P3), never a task engine of
  the pack's own (extension-model.md §4b).
- **7d — Discovery leaves the console.** `/admin/audits` becomes the pack's
  screen, in the tenant's own context, so the operator's staff run discovery
  without being superadmins — and any services business runs an intake
  interview with the same copilot. The health check keeps landing where it
  does; `audits` is already the operator tenant's table.

## Decisions & gotchas

- **A seed applies when it CAN, and again later.** The alternative — apply at
  install only — silently loses the chart for every tenant that installs the
  profile before switching Accounting on, which is the order the console
  suggests (profile on the tenant page, modules above it). Two doors, one
  applier, a report that says what waits.
- **Additions, never a replacement.** `accounting_settings.coa_template` keeps
  recording `general`; the profile's template is not a second chart but
  twelve rows on top of the first, so a tenant that installs the profile
  after a year of bookkeeping gets twelve new accounts and nothing renamed.
- **The tenant's own rows win.** A code the tenant already uses is skipped —
  the test that renumbers 6320 to *Conferences* proves it — which is the
  discipline `provisionAccounting` has always had and the seed inherits.

## Open items

- **The pack is part-built** — 7b and 7c shipped; 7d above.
- **Core modules declare no vocabulary**, so *Client* cannot yet replace
  *Customer* on an invoice; the profile's `labels` is empty until they do
  (the open item [packs-and-profiles.md](packs-and-profiles.md) already
  carries).
- **The operator tenant has not installed the profile yet.** It is a console
  button on its page; the founder presses it, or asks for it to be pressed.
