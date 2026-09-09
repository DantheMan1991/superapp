# Onboarding

> Getting an existing business into Yosher without overwhelming the person
> doing it: what to load and in what order, what to do about the numbers
> nobody kept, how the books get a start, and how the daily habit stays light
> afterwards. Three pieces, not one wizard. The pilot is the founder's own
> farm, whose money is mixed with personal — which the plan treats as the
> normal case, because most small farms are the same.
> Status: partial — slice 1 (the derived "Getting set up" card) built; the rest is planned below · Scope: `platform` <!-- keep Status on ONE line — /admin/docs parses it -->

## The plan (agreed with the founder 2026-09-08)

### Three problems, three pieces

Onboarding is three different problems, and the tool is built as three pieces
rather than one wizard that tries to be all of them:

1. **Standing data.** Who and what exists: companies, bank accounts,
   customers, vendors, kinds of stock, animals, places, paddocks, prices,
   team. No dollars attached. Most of it can be pasted in from a list, and
   much of it makes itself (a new name on an invoice creates the customer; a
   payee on a bank line is a vendor waiting to be confirmed).
2. **The opening position.** The money as of ONE chosen date: bank balances,
   what customers owe, what is owed to vendors, equipment and its book value.
   Everything before that date stays where it was.
3. **The daily habit.** What happens on day two and every day after. This is
   where overwhelm actually lives, and it is mostly solved by the bank feed
   doing the money side and one sentence box doing the farm side.

### The answers every farm will ask for, settled

- **Cost that was never tracked stays BLANK.** Never zero, never a guess. The
  inventory pack already keeps "no cost recorded" apart from zero on every
  screen and reports how many batches are uncosted instead of pretending
  ([inventory.md](inventory.md), slice 3a). A guess would land on a balance
  sheet; a zero says the freezer holds nothing worth anything. From the start
  date, cost arrives by itself: every delivery recorded with a price, every
  bill matched to it.
- **Animals have no cost either, and that is correct.** Raised stock has no
  purchase basis ([livestock.md](livestock.md)). Enter what is there with the
  date each joined the farm; record a purchase price only where one is known.
- **The books do not get history keyed in. They get a start date.** Enter
  balances as of that date and leave the past alone. For Hilltop the proposed
  start is **2026-01-01**, not today: the 2026 return needs the whole year,
  and on a cash-basis farm the bank statement plus the till IS the books, so
  importing the CSVs from January 1 and letting rules and the sweep code them
  gives a cash-basis year without typing one old invoice. Only invoices and
  bills still open on the start date are entered by hand.
- **Customers and vendors mostly make themselves.** A vendor is created when a
  new name is typed on a bill or when the Inbox finds none; a customer when a
  new name is typed on an invoice. A direct-to-consumer farm does not create a
  customer for every dozen eggs sold at market — only for who owes money or
  buys halves. Everyone else is the till.
- **Commingled money is the default case, not an edge case.** Hilltop's bank
  account and expenses are mixed with personal. The plan's answer is in slice
  3 below, and the setup interview's first question is *"Is the farm's money
  in its own account?"*.

### Three gaps the plan has to close, found while grounding it

1. **There is no books-start date anywhere.** `accounting_settings` holds the
   fiscal year start, the default basis and the inventory treatment, and
   nothing says "before this date is not ours".
2. **Opening balances exist for bank accounts only** (`createBankAccount` →
   Opening Balance Equity). Open invoices and bills as of the start date have
   no path but a hand journal, and `isCodableAccount` refuses OBE on a bill
   or invoice line by design.
3. **An asset owned before the start date cannot carry the depreciation
   already taken.** `postedToDateCents` (`src/packs/assets/depreciation-ops.ts`)
   reads only entries with `source = depreciation` and `sourceId = the asset`,
   so an opening journal line to accumulated depreciation is invisible to the
   asset page and it shows full book value.

### Slice order

| # | Slice | Status |
| --- | --- | --- |
| 1 | **The derived "Getting set up" card** on the Overview: each switched-on tool says what it is waiting for, rows vanish as the data appears, nothing stored ([ADR 0033](../decisions/0033-a-setup-step-is-a-prerequisite-the-data-proves-missing.md)) | **shipped 2026-09-08** |
| 2 | **Paste anything**: one dialog, reused — paste a list or a spreadsheet, or upload a photo of the herd book; the model proposes rows; the owner sees every row before it saves; duplicates checked against what exists (the CRM "From a note" shape, under the packs' rule that AI never writes a row without a human seeing it first). Targets in order of value: vendors, customers, kinds of stock, animals with tag and dam and sire where known, places, paddocks, prices | planned |
| 2b | **Vendors from the bank import**: after an import, "eight payees you have no vendor for" with a checkbox each | planned |
| 3 | **The mixed account**: a register kind whose ledger leg is owner's equity (3100/3200 exist) rather than a bank asset; lines default to excluded/personal; rules that can say "personal" (today they only assign a category); the sweep asks "is this the farm's?" before it codes (today it must pick one chart code for every line); owners-only visibility of that register (`bank_transactions` RLS is `member_all`). Exclude, the Excluded tab and Split already exist. Needs its own ADR when built | planned — **Hilltop cannot be loaded without it** |
| 4 | **The books-start date**, stored once beside the fiscal year, and an import that refuses or flags a line before it | planned |
| 5 | **The opening position**: open invoices and bills as of the start date as real documents with their income or expense leg to OBE, so they age and get paid like any other; equipment with "depreciation already taken through", posted as that asset's own entry; the opening trial balance on one screen with the equity plug visible; an export for the accountant | planned |
| 6 | **Tell it things**: one sentence box on the phone — "fed two bags to the broilers", "three chicks dead in pen two", "moved cows to paddock seven" — parsed into proposed record cards, one tap each to confirm, refusing where the packs already refuse. Rides the Ask thread ([livestock.md](livestock.md), PR #451) | planned, after #451 |
| 7 | **The setup interview**: the health-check machinery turned inward — a conversation that produces the plan for THIS business (which packs, what to load, the start date), opening on "Is the farm's money in its own account?" | planned |

Two users for all of it: the founder, running a paid Tier 1 onboarding in an
hour instead of a day, and the client, who needs to see what is next without
calling. The Overview's first screen says the modules get switched on "as
part of onboarding, we'll take it from here", and installing a profile is a
superadmin act — so slice 1 serves both.

### Hilltop as the test script

| Step | What goes in | How today |
| --- | --- | --- |
| Profile and settings | Homestead Farm installed; fiscal year January; default basis cash; inventory posting left OFF until the accountant answers [the brief](../briefs/inventory-tax-treatment.md) | Admin page for the install; Business settings for the rest |
| Companies and banks | One company; a farm-only account opened NOW so the mixed window is bounded (2026-01-01 to the day it opens) | Banking, exists; the mixed window needs slice 3 |
| Places | Garage with three freezers, barn with the walk-in, the two parcels, twenty paddocks | Assets, then Land (Find my parcels where the county service is connected) |
| Vendors and customers | Feed store, hatchery, each butcher, the plant; half-beef buyers only | By hand, or from the bank import (2b) |
| Kinds of stock | Feed by pound, chicks, broilers, eggs by dozen, cuts as packages, cartons | Items page, unit chosen once |
| Animals | Cattle as individuals with tags; pigs as one lot; layers as one flock; broilers one lot per pen | Add animals, exists |
| Stock on hand | One count per place, no costs | Counting, exists |
| Prices | Per channel on the market stall | Retail, exists |
| Bank history | CSVs from 2026-01-01 for every account the farm touched (checking, any card, Square, Venmo, PayPal), coded by rules and the sweep, reconciled | Import wizard, exists; personal lines need slice 3 |

Two things for the accountant rather than the software: cash from market
spent as cash is still income on a cash basis (the till records the sale; the
cash that never reached a bank is a draw), and the truck and four-wheeler used
partly for the farm are a business-use decision, so nothing personal goes on
the farm's asset list until they say so.

## Build log

Newest first. One entry per session/PR that touched this area.

### 2026-09-08 — Slice 1: Getting set up, derived (`claude/getting-set-up`)

**The card.** Owners see `Getting set up` on the Overview, above `Your
modules`, while any switched-on tool is waiting for something: one row per
prerequisite, with the tool's name, the ask, a line on what it is for, a
`Guide` link to the guide for the screen where it is done, and a button that
names the act and opens that screen. A row goes away when the thing exists.
When nothing is left the card is not rendered, and never returns. Staff and
accountants see nothing — every step is an owner's act.

**The seam.** `src/lib/setup-sources/` is `attention-sources` with the dates
and the person taken out: `types.ts` (the contract, imports no module),
`registry.ts` (the composition root, the only file that names modules),
`resolve.ts` (gates on enabled modules, runs sources concurrently behind a
four-second guard, REPORTS a failure rather than folding it). `has-any.ts`
is the one query every step asks — `LIMIT 1` on the tenant index, never a
COUNT. eslint.config.mjs bans modules from the registry and resolver the way
it does for attention.

**The rule, and it is the slice** ([ADR 0033](../decisions/0033-a-setup-step-is-a-prerequisite-the-data-proves-missing.md)):
a step is a PREREQUISITE the data proves missing, asked as *ever*, not *now*.
That is what lets the card have no dismiss button. "Invite your team" failed
the test — a solo operator would see it forever — and so did "record your
first sale"; nothing that failed it is on the card.

**What each tool contributes**, in card order:

| Section | Step | Appears while |
| --- | --- | --- |
| Accounting | Add your bank account | no `bank_accounts` row has ever existed |
| Accounting | Bring in your transactions | an account exists and no `bank_transactions` row ever has — points at the one account's import page, or at Banking when there are several |
| Assets | Add your equipment and buildings | no `assets` row |
| Inventory | Add what you hold | no `inventory_items` row |
| Inventory | Add somewhere to keep it | an asset exists and none has `is_storage_location` — waits for the first asset so it never stands beside the assets step asking about the same page |
| Livestock | Add your animals | no `livestock_lots` row (a named animal is a lot of one) |
| Land | Add your ground | no `land_parcels` row |
| Retail | Add where you sell | no `retail_channels` row |
| Retail | Set your prices | a channel exists and no `retail_prices` row — points at the one channel's page, or at Retail |
| CRM | Add the people you work with | no `parties` row — so a customer typed onto an invoice clears it too, which is right |
| Mail | Set up your mailboxes | no `mailboxes` row |

Not contributing, each deliberately: `production` (a run needs animals, which
is livestock's step), `documents` and `scheduling` (their first rows are
provisioned), `work`, `marketing` (the brand kit is layer 0 and a site is
optional). Each is an open item below with what its step would be if one is
ever wanted.

**Guide links are static slugs, checked by a test.** The Overview is not
traced to read `docs/help` at request time (`outputFileTracingIncludes` in
next.config.ts covers `/dashboard/guides` and `/api/help`), so the card must
not go looking. Each source declares the slug of the guide for the screen it
points at, and `tests/setup-sources-db.test.ts` asserts every slug it sees is
a file. A renamed guide fails that test rather than a link on the first page.

**The words avoid the packs' renameable labels.** `item`, `channel`, `parcel`
and `zone` are vocabulary a profile may rename in the guides; the card is
plain text on the Overview and does not run that machinery, so the titles say
"what you hold", "where you sell", "your ground".

**Tests.** `tests/setup-sources.test.ts` (pure): order, sections, a throwing
source reported, a timeout reported, one failure not stopping the rest, an
empty list with a failure NOT complete. `tests/setup-sources-db.test.ts`
(db-backed, as an owner through real RLS): a fresh tenant with eight modules
on is asked for exactly eight things in card order; each clears on the first
record and raises its second-order step where there is one; a switched-off
tool contributes nothing and is not a failure; every guide slug is a file.

**Guide.** `docs/help/workspace/getting-around.md` gains the card, every row,
every button, the two messages, and the owners-only line.
`docs/extension-model.md` records the fifth use of a declared extension point.

## Data model

None. The card is a fold over tables the modules already own; nothing is
stored, and nothing may be ([ADR 0033](../decisions/0033-a-setup-step-is-a-prerequisite-the-data-proves-missing.md)).

| Table | Purpose | Notes |
| --- | --- | --- |
| — | — | Every step is a `LIMIT 1` over a module's own table, under the caller's RLS context |

## Key files & seams

- `src/lib/setup-sources/types.ts` — the contract. **Read the header before
  adding a step**: prerequisite not nudge, ever not now, caller's `tx` only
- `src/lib/setup-sources/registry.ts` — the composition root and the card's
  order, with the reasoning for the order
- `src/lib/setup-sources/resolve.ts` — gating, the timeout, the failure report
- `src/lib/setup-sources/has-any.ts` — the one query
- `src/modules/{accounting,crm,email}/setup/source.ts`,
  `src/packs/{assets,inventory,livestock,land,retail}/setup/source.ts` — what
  each tool is waiting for, and in each header what it deliberately is not
- `src/app/dashboard/getting-set-up.tsx` — the card; `page.tsx` renders it
  above the tiles, owners only
- `tests/setup-sources.test.ts` · `tests/setup-sources-db.test.ts`
- `docs/help/workspace/getting-around.md` — the guide, `## Getting set up`

## Decisions & gotchas

- **Derived, never stored; prerequisite, never nudge; ever, not now.**
  [ADR 0033](../decisions/0033-a-setup-step-is-a-prerequisite-the-data-proves-missing.md)
  has the alternatives and the costs. The one that will be asked about first:
  a business that retires its only bank account is not asked again.
- **Not attention items.** A step has no date and no person, and putting it in
  the morning digest would email "add your bank account" to staff who cannot,
  every day, until muted. The card lives on the Overview only.
- **Owners only, decided in the card, not in the sources.** A source's context
  is the tenant and nothing else; there is no role for it to reason with.
- **A failure renders as a warning, not as nothing.** An absent card must mean
  set up. If `Inventory could not be checked just now` appears with no rows
  under it, that is the design working.
- **`inventory.place` waits for the first asset** so two rows never point at
  the same page with the same ask. The cost: a tenant with Inventory on and no
  assets is asked for equipment before it is asked for a freezer, which is the
  order the assets step already imposes.
- **The transactions step is the one that is almost advice.** Accounting can
  write an invoice with no register at all. It is a step because a register
  with nothing in it has not started, and because the feed is the single most
  valuable thing a converting business can switch on. It clears on the first
  row of any kind and never returns.
- **Static guide slugs.** See the build log; the reason is tracing. If a guide
  is renamed, the db-backed test fails and names the slug.

## Open items

- **Slices 2–7 above are unbuilt.** Slice 3 (the mixed account) is the
  blocker for loading Hilltop and comes before the opening position, because
  on 2026-01-01 the farm had no account of its own to open a balance in.
- **Steps that could exist and do not**, if a tenant ever needs them:
  `production` — a processing plant recorded as a vendor before its first bill
  can be matched; `marketing` — a site started; `scheduling` — a calendar
  shared beyond the provisioned one. Each would be one `setup/source.ts` and a
  registry line.
- **The card does not reach the founder's admin view.** A concierge onboarding
  would want the same list on `/admin/tenants/[id]` — "what is this tenant
  still missing" — read under `requireSuperAdmin()` and `withSystem`. Not
  built; the sources take a `tx`, so it is a page, not a change to them.
- **No retry.** A failed source is stated; nothing re-asks until the next load.
- **The accountant's brief on inventory treatment is still unanswered**
  ([docs/briefs/inventory-tax-treatment.md](../briefs/inventory-tax-treatment.md)),
  and the Hilltop script keeps inventory posting off until it is.
