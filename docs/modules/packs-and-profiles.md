# Packs & profiles (Layer 2 machinery)

> The mechanism that lets an industry exist without an industry module: how a
> capability pack is registered and switched on, how an industry profile
> installs a set of them, and where vocabulary comes from. This is the plumbing
> under [extension-model.md](../extension-model.md) — read that first for *why*,
> read this for *how*.
> Status: live — registry, dependency enforcement, profile install and seed application are built; P5 nav contributions are not · Scope: `platform` <!-- keep Status on ONE line — /admin/docs parses it -->

## Build log

### 2026-09-14 — A pack registers a seed applier, and the third profile arrives (`claude/the-construction-profile`)

The `construction` profile ([construction.md](construction.md)) is the first
one whose seed has to land in a PACK's tables — starter cost code lists into
`job_cost_code_sets` / `job_cost_codes`, every code synced as a cost object —
and [ADR 0057](../decisions/0057-a-pack-registers-a-seed-applier-and-the-profile-carries-the-data.md)
is how: `IndustryProfile.seed.packs` is a map from pack slug to an `unknown`
value; the pack owns the shape (`src/packs/jobs/seed-shape.ts`, no server
imports) and the applier (`src/packs/jobs/seed.ts`, through the pack's own
ops); `src/packs/seeds.ts` is the registry, kept apart from `src/packs/index.ts`
because an applier imports `server-only` code and the registry is data the
shell reads. `applyProfileSeed` walks the map, hands each entry to its applier
as the tenant's owner attributed to the superadmin who pressed the button, and
reports in the pack's own words — the console's install button now says *"2
cost code lists (61 codes)"* before it is pressed and *"…with 61 codes added"*
after. `toggleModule` asks the applier for ANY module switched on, not only
Accounting and Documents.

**The console learned nothing about cost codes**, which was the point of the
fork the construction dossier had named: the rejected alternative was a
`costCodeSets` branch in `profile-seed.ts`, a branch per pack table from then
on.

**A profile label cannot be an uncountable noun.** The construction profile
wanted `asset → Equipment` and would have rendered "Equipments" on the assets
list: a profile label is a bare string and `pluralOf` appends an "s" to a
tenant's own word. Left as the pack's word, and logged below.

**A ratchet the profiles lacked:** `tests/vocabulary.test.ts` now refuses a
profile label for a key nothing declares — a rename nobody will ever see — with
one named exception, `enterprise`, the Layer 0 word with no home yet.

### 2026-09-13 — Core declares its first words, and a provider carries them to the client (`claude/core-declares-its-party-words`)

**The oldest open item in this file is closed.** It read *"Core modules declare
none at all, which is the bigger gap: 'customer' and 'invoice' are exactly the
words an industry renames."* Accounting now declares `customer` and `vendor`, and
every screen in Accounting and CRM renders the tenant's word for them.

The forcing function was a real business: the construction pilot
([construction.md](construction.md)) says **client**, and nothing in the product
could make its invoice say so. `client` itself could not be the key —
`professional-services` owns it and `collectLabelDefinitions` reports a second
claim as a conflict — so core declares `customer` and a profile renames it, which
is the mechanism working rather than a workaround.

**A CLIENT-SIDE PROVIDER, which is new.** Packs thread one resolved word into one
component as a prop, and that is right at their size. Core's two words are a
different shape: about fifty sites across thirty-five files, and the worst case is
`SalesNav` — one client component rendered by eight server pages, so a prop would
have meant eight identical plumbing edits for one navigation label.
[`LabelProvider`](../../src/components/app/label-provider.tsx) mounts in the
dashboard layout beside `FeedbackProvider`, whose own comment already made this
argument for itself: *"the provider rather than the button, because the button is
rendered by `PageHeader` deep inside `children` and this layout is the only thing
that knows the count."* Words are rendered deeper still. `useLabel` /
`usePartyWords` for client components; `labelsForTenant` + `partyWords` for server
ones, and **it costs no query** — `requireTenant()` already returns the row
carrying `industry` and `labels`.

**One plural rule, extracted.** It existed twice already — inlined in the layout
for the sidebar's one word, and in `buildVocabulary` for the guides — and the
party words would have been a third. Three copies of a rule about what the
product CALLS things is how a nav item comes to read "Clients" beside a page
headed "Customers", so `pluralOf` in
[resolve.ts](../../src/lib/packs/resolve.ts) is now the only copy and
`LabelDefinition` carries an optional `plural`. **An earlier draft of this slice
declared `customerPlural` and `vendorPlural` as keys of their own** so an
irregular plural could be overridden; it was dropped because it put four rows in
the admin editor where two belong and disagreed with the rule the guides already
used, so a guide could have printed a different plural from the screen it
describes.

**Four screens said "Supplier" while twelve said "Vendor".** Found by doing the
sweep, not by looking for it: the recurring form, the recurring list's fallback,
Mail's draft-a-record label and Inventory's matching table each said Supplier,
against a `vendors` table, a Vendors page and a `VENDOR_INACTIVE` error code. It
was drift rather than a distinction. All of them now say whatever the business
calls one — which is strictly better than the old state, where four screens said
Supplier no matter what the business called it.

**Every other rendered string is byte-identical for a tenant that has renamed
nothing.** That was held to deliberately, and one empty state had to be rewritten
to keep it (`No customers yet. Add them on the Customers page first.`). It is why
the 61 remaining "Customer"/"Vendor" mentions in `docs/help/` are not stale and
did not have to be swept in this PR — only three guides named a control whose
label actually changed, and those three were fixed.

**A hole in the ratchet, found and recorded rather than fixed.**
`tests/vocabulary.test.ts` proves every rendered key is declared by scanning the
source for `labelFor(x, "literal")` — so **a key passed as a CONSTANT is
invisible to it**, and `enterprise` has been going through that hole since the
sidebar shipped: rendered on every dashboard page via `ENTERPRISE_LABEL_KEY`,
declared by nothing at all. The scan now also covers `useLabel`, and the party
keys are checked by name because they use constants too. `enterprise` is left
alone here — `enterprises` is Layer 0 with no registry entry to declare a label
on, which is a question about where Layer 0 subsystems declare vocabulary, not
about construction. See Open items.

**DRIVEN, and the rendered HTML is what proved it.** `tenants.labels` was set to
`{customer: "Client", vendor: "Supplier"}` on Hilltop Farm on the DEV branch
(`ep-silent-base`, which is what `.env.local` points localhost at — never
`ep-little-fog`), and every Accounting and CRM route was fetched and scanned for
the un-renamed words. Zero occurrences across sixteen routes; the pages read
"Clients", "Add client", "Suppliers", "New supplier", and the A/P Aging tile read
"What the business owes suppliers". The plurals derived correctly from the
singular in every case. The labels were then cleared and both pages checked back
to "Customers" and "Vendors".

**Scanning the OUTPUT rather than the source is the technique worth keeping**, and
it is what caught the one real bug in this slice. Four greps over the source had
each assumed a delimiter — `"Customer`, `>Customer<`, a case-sensitive capital —
and the Add button is none of those: it is a bare JSX text node, `<Plus /> Add
customer`, so all four missed it. The page rendered a heading reading **Clients**
above a button reading **Add customer**, which is exactly the half-swept look this
slice set out to prevent. Three more hid the same way (`New vendor`, the Add
dialog's title, and the Companies dialog's prose, which is wrapped across lines).
A grep proves what a pattern can see; the rendered page proves what a person can.

**Deliberately NOT swept**, with the line stated so the next slice does not have
to re-derive it: static descriptor maps that would each need a new tenant-aware
contract (`core/errors.ts`'s sentences, `mail/extension.ts`'s entity labels,
`paste/targets.ts`, `setup/source.ts`, `history/format.ts`); CSV export headers
and sheet names, which are closer to an API than to copy — somebody's spreadsheet
keys off them; AI prompt text, which is its own question; Payments' card-reader
status strings, outside Accounting and CRM; the `Suppliers` seed folder, whose fix
is the one [extension-model.md §8](../extension-model.md) already names; and
illustrative example values like `customer@example.com`.


### 2026-09-10 — A profile's `packConfig` reaches a pack nobody farmed for (`claude/back-office-7b-engagements-and-time`)

`professional-services` ships ([professional-services.md](professional-services.md)),
and it is the first pack whose market is not the founder's farm — which is
the claim [ADR 0004](../decisions/0004-capability-packs-and-industry-profiles.md)
makes and the fifth independent test of it. Nothing in Layer 0 or Layer 1
changed to admit it: a slug in `src/packs/index.ts`, a row in
`scripts/seed.ts`, an icon key, a schema file, and two declared labels.

**Two words are declared for the first time by a pack a CORE tool also has
opinions about.** `client` is what Accounting calls a customer and CRM calls
a record, and this pack renames neither — it declares its own word for its
own screens, which is exactly the boundary. The open item below about core
modules declaring no vocabulary is unchanged, and is now more visible: an
agency's invoice still says "Customer".

### 2026-09-10 — Seed application is built (`claude/back-office-7a-seeds-and-the-agency-profile`)

The largest gap in the installer, open since Layer 2 shipped on 2026-08-14,
closed by the first profile that needed it: [agency](agency.md), back-office
slice 7a. `IndustryProfile.seed` had been declared and read by nothing.

- **`src/app/admin/profile-seed.ts` applies it** — the chart through
  `provisionAccounting` as the tenant, the folders through `provisionDocuments`
  under `withSystem` — beside the console's actions rather than in `src/lib`,
  because it calls two modules' provisioners and a lib may not.
- **A seed lands only in a module that is ON, and is not lost when it is
  off.** Two doors call the applier: `installProfile`, with every module the
  tenant has on, and `toggleModule`, for the one module being switched on,
  reading the installed profile off `tenants.industry`. Install the profile a
  week before Accounting: the chart arrives with Accounting. The report names
  what waits, the toast says so, the audit row carries the counts, and a seed
  landing later writes `profile.seeded`.
- **`seed.accounts` became a `CoaTemplate`, not a slug.** A slug would have
  meant registering an industry's chart in core's `COA_TEMPLATES` — the
  inversion the extension model forbids. The manifest carries the data and
  `provisionAccounting` accepts a template as well as a slug. A profile's
  chart is written as ADDITIONS over the general one (parents it names are
  general accounts; codes it uses are ones general does not), because
  Accounting is provisioned with `general` when switched on and the profile
  lands on top. **`seed.docKinds` is gone**: `documents.doc_kind` is an open
  taxonomy nothing lists, so a seeded list would have had no reader.
- **Additive and re-runnable, and the tenant's rows win** — inherited from the
  provisioners, which skip a code or a root folder the tenant has. Proved in
  `tests/profile-seed.test.ts` by a tenant that numbered 6320 *Conferences*
  first and kept it.
- The "needs a farm chart of accounts written first" reasoning in the older
  entries was the wrong dependency: it needed a profile whose pilot would
  notice the chart missing. The homestead profile still carries no seed, and
  writing its chart is the farm's accountant's question, not this slice's.

### 2026-09-04 — A switched-off feature stops its work (`claude/a-switched-off-feature-stops-its-work`)

The other half of the header's principle, closed the same day as the first. Until
now only `addEntityWorkAction` checked that the owning feature is switched ON;
`setEntityWorkDoneAction`, `setEntityWorkAssigneeAction` and
`setEntityWorkDueAction` never had, so a follow-up raised on a CRM record stayed
tickable after CRM was switched off.

**IT IS A BACKSTOP, NOT A VISIBLE CHANGE, and the caution in the previous entry
was wrong.** That entry said turning this on "would silently stop work somebody
can see today". It would not: every surface that renders `WorkItemRow` — the CRM
record timeline, CRM's follow-up list and the asset maintenance panel — already
sits behind `requireModuleEnabled` for the feature that owns the item, so a
reader whose module is off cannot reach the control in the first place. Checked
by reading all three route files rather than assumed. What this closes is the
stale tab and the direct call.

**`owningCategories` became `owningFeatures`**, returning slug, category and
enabled together — one row set, two questions, and a second LEFT JOIN onto
`tenant_modules` for the same reason as the first: a tenant with no row for a
module must read as OFF rather than vanish from the result and take the
objection with it.

**Enabled is reported before role.** When both fail, "that part of the product is
not switched on" is the more useful sentence and the one an owner can act on.

**An unlinked item gets the role rule and no enabled check**, deliberately: it is
the Work module's own, and Work being off does not orphan an item nobody raised
from a record — the header above already says what Work being off does and does
not mean.

**The fixture in `assets-maintenance-work.test.ts` never switched the pack on.**
Every test in that file passed without a `tenant_modules` row, because the ops
layer does not require one — only the actions do. It does now, and the new test
flips it off and back to prove the join reads the tenant's own answer rather than
a constant. Worth knowing before writing the next pack fixture.

### 2026-09-04 — The guard is the owning feature, roles included (`claude/the-guard-is-the-owning-feature`)

`src/lib/work/actions.ts` is Layer 0: one set of verbs so a follow-up on a CRM
record and a job raised off a tractor are ticked off by the same action. Its
header states the principle — *"THE GUARD IS THE OWNING FEATURE, NOT WORK"* — and
applied it to whether the feature is switched ON. **It never applied it to the
ROLE, and those verbs asked no role question at all.** So an accountant could
tick off, hand over and re-date a CRM follow-up, in a module where every other
write refuses them; `docs/help/crm/tasks.md` had documented that as the one part
of CRM which was not read-only. Found writing the CRM gate sweep (#379), which
hid the row and left the seam as an open item.

**THE TWO OWNERS DISAGREE ON PURPOSE, WHICH IS WHY THE SEAM COULD NOT JUST PICK
ONE.** A core module has no read-only-safe write and refuses `expert` outright. A
capability pack admits one at `member` level, settled 2026-09-03: recording that
something happened to a thing that already exists is a chore. Both are right
about their own records, and a shared verb has to honour whichever owns the
record in front of it.

**THE DATABASE ALREADY KNEW WHICH IS WHICH.** `modules.category` is `core`,
`pack` or `system` and has been since the packs were seeded — `scripts/seed.ts`
even says so above the Layer 2a block. So `ownerFeatureAllowsWrite(category,
role)` in `authorize.ts` needs no registry, no new column, no migration, and no
import from a module into `src/lib/`, which `src/lib/packs/resolve.ts` already
refuses for the same reason.

Three decisions inside it, each of which could have gone the other way:

- **Every owner must allow it, not any.** An item linked to a CRM record AND a
  tractor is refused if either says no. "Any owner is enough" would make
  attaching a second record a way to widen who may change the first — a
  permission granted by a link.
- **Anything unrecognised is treated as CORE**, the stricter rule. A slug nobody
  registered is a question nobody can answer, and answering it permissively is
  how a dropped registry row becomes a permission. `owningCategories` LEFT JOINs
  for the same reason: an inner join would drop the unanswerable row entirely,
  and a dropped row reads as "no owner objected".
- **An item with NO links gets Work's own rule.** No links means nobody raised it
  from a record, which makes it the Work module's, and Work refuses the
  accountant. Without that line an empty list would vacuously pass.

`addEntityWorkAction` asks the same question the cheap way — it is TOLD its
`extensionSlug`, so it reads one category instead of looking up an item's links.

**What did NOT change, and is now an open item**: only `addEntityWorkAction`
checks that the owning feature is switched ON. The other three never have, so a
follow-up on a record whose module was later turned off is still workable. That
is the same header's other half and wants deciding on its own — turning it on
silently would stop work somebody can see today.

Newest first. One entry per session/PR that touched this area.

### 2026-08-19 — A profile can ask for a dollar sign (`claude/money-that-looks-like-money`)

Founder, seeing *"Fed · 85.00"* on a livestock card: *"this should be a feature
that you can turn on for the industry selection. for farming i definitely want
it to show the dollar."*

**`IndustryProfile.display` is a new third kind of thing a profile carries**,
and it is worth being clear how it differs from the two that already existed:

| What | How it reaches a tenant |
| --- | --- |
| `labels` | Resolved LIVE, every render. Fixing one helps every tenant at once |
| `packConfig` | Handed to packs, read by the pack that owns the key |
| **`display`** | **COPIED onto the tenant at install**, and never put back |

The copy is the point. A label is presentation the profile owns; a display
default is a suggestion the tenant may overrule, and a profile that re-asserted
it on the next install would make "change the symbol" impossible to explain.
`installProfile` therefore reads what is there first and only fills a null.

**`tenants.currency_symbol` is platform-level, for the same reason `timezone`
is.** Money shown two ways inside one workspace is worse than either way
consistently, and a per-module setting guarantees exactly that — see
[timezone.md](timezone.md) for the argument the first time it was made. It is
presentation only: not a currency code, not a rate, and nothing converts
anything.

**`formatCents` stays symbol-free and stays right.** It was written for
debit/credit columns whose headers carry the currency, where a symbol on every
row is noise a bookkeeper reads past. `formatMoney(cents, symbol)` is for
everywhere else — a card, a toast, a sentence — where there is no header and a
bare number reads as a quantity. Applied across the farm packs (`assets`,
`inventory`, `livestock`); accounting's grids are untouched, which was the
founder's call when asked.

**Existing tenants were backfilled** (`0161`). The installer runs at install,
and the farm that wanted this most installed months ago — leaving it would have
meant re-installing a profile to change a symbol.

### 2026-08-16 — The vocabulary editor was showing the wrong words (`claude/vocabulary-truth`)

Both admin surfaces from the registry PR were driven for the first time. Both
work; both said something untrue.

**The editor showed the PACK's word, not the client's.** A homestead farm whose
every Land screen says *Paddock* had a field headed **Zone**, placeholder
**Zone**, under a heading reading *"The words this client sees."* Its help text
then promised that clearing the box would give you "Zone" — clearing it gives
you *Paddock*. Confirmed live by typing `Block`, watching the whole Land module
say "blocks", clearing it, and watching it go back to **Paddock** rather than
Zone.

- **Vocabulary has THREE layers** — the pack declares `zone`, the profile
  renames it to `Paddock`, the tenant may rename it again — and the editor knew
  only the first and the third. The middle one is the one an industry profile
  exists to supply.
- **`labelRows` in `resolve.ts`, beside `resolveLabels`.** The page was doing
  this arithmetic inline, which is how it drifted from the renderer.
  `resolveLabels` answers *"what word do I render?"*; `labelRows` answers *"and
  where did it come from?"* — the question an editor must answer and a renderer
  never does. Same file so they cannot disagree twice, including on the rule
  that an empty string is not a rename.
- The field now shows the effective word, and says *"Homestead Farm calls this
  Paddock; the built-in word is Zone"* when a profile is overriding.

**The installer claimed work it had not done.** Re-running an install on a
tenant with all seven packs already on reported *"Installed — 7 packs switched
on"*. Nothing was switched on. `enableRow` now returns whether it changed
anything, and the toast reports *"nothing to change, all 7 packs were already
on"* or *"3 of 7 packs switched on"*. The audit entry records `switchedOn`
alongside the full list, so the log distinguishes them too.

Neither is a data bug — both would have gone on quietly misinforming the only
person who reads these screens.

### 2026-08-15 — Is it a decision, or is it a chore? (`claude/pack-write-levels`)

Every pack shipped owner-only, as four private copies of `requireOwner`. That
was survivable while the packs were registers of things you buy. The next slice
is livestock's daily log, and **a daily-entry surface only the owner can use is
built for the wrong person** — at ten times the pilot's size there are two or
three people doing chores and none of them signs cheques.

- **The rule, in one question: is this a decision, or is it a chore?** Declaring
  that North Pasture is hay ground this year is a decision. Recording that four
  birds died is a chore, and the person doing it is standing in the pen. Every
  pack write now says which, and the four copies collapse into one
  `allowsWrite(role, level)` in `src/lib/packs/authorize.ts`.
- **The line is not taste — it is forced from below.** `upsertDimensionMember`
  in accounting core calls `requireOwnerRole`. Anything that CREATES a cost
  object must be owner-only, or the write succeeds while its cost object does
  not, leaving an entity no report can group by. That constraint lands exactly
  on the decision/chore line, which is why this was a small change rather than a
  negotiation with the ledger.
- **Where it fell.** Owner: parcels, zones, zone uses, items, lots, assets,
  maintenance schedules and raising due maintenance, creating/editing/splitting
  a livestock lot. Member: occupancy, inventory movements and merges, placing
  and losing head, moving a lot, tagging, meter readings and service records.
- **Splitting stayed with the owner deliberately**, against its feel. It is a
  chore in the yard and a decision in the books — it makes a lot, therefore a
  cost object. It also happens a handful of times a season, at batch placement,
  not thirty times a day, so nobody is blocked in the middle of a chore.
- **`expert` does not clear the owner level.** The platform's own bookkeeper
  reviews and reconciles; they do not decide the farm has bought a parcel.
  Accounting already gives them `requireReviewRole` for what is genuinely
  theirs.
- **This is not a security boundary and the doc says so.** RLS is member-wide by
  design — what the business owns and where its animals are is not private
  correspondence, and whoever is sent to fetch something has to be able to find
  it. The database decides whose rows these are; this decides who may change
  them. Weakening it cannot leak another tenant's data, only let a colleague
  record something.
- **The UI moved with it**, which is the half that would otherwise rot: the
  livestock detail page no longer hides place/lose/move/tag behind `isOwner`,
  and the zone page no longer hides the occupancy controls. `SplitHerdForm` and
  inventory's `LotForm` are still gated, and now say why in a comment.
- **Tests state the rule from both sides.** Three old "refuses staff writes"
  tests asserted the rule being replaced — a reminder from earlier this week
  that a test locks in a mistake as firmly as it prevents one. Each became a
  pair: what staff may now do, and what they still may not.

### 2026-08-15 — Vocabulary becomes declarable, and installing a profile becomes a button (`claude/vocabulary-registry`)

Founder: *"how do I control the terminology used in the homestead farm profile?
I should be able to customize it even further at the tenant level."* The honest
answer was that the mechanism existed and the controls did not, and that the
mechanism was barely used.

- **The state this replaced:** three label keys declared in one profile, **one**
  of them read by any code, every other noun in every pack hardcoded English,
  and no way to answer *"what words can I change?"* except grepping for
  `labelFor`. Setting up a profile meant invoking a server action directly.
- **`LabelDefinition` — features declare their own words**, with a fallback and
  a sentence describing what the word names. That one declaration serves three
  purposes at once: the admin screen has something to LIST, the test has
  something to CHECK, and the next pack has somewhere to put its vocabulary.
- **`tests/vocabulary.test.ts` scans the source**: every key rendered through
  `labelFor` must be declared. A declaration nothing verifies drifts back to
  decoration within a slice or two — this is the ratchet.
- **Two admin surfaces**, both on the tenant page: install a profile (naming the
  packs it will switch on *before* the button), and edit vocabulary (a field per
  declared word, with its description beside it).
- **LABELS MOVED TO `tenants.labels`, and that is a correction.** They were on
  each pack's `tenant_modules.config` row, on the reasoning that renaming a word
  for one pack should not silently rename it in another. Backwards: `zone` is
  `land`'s word that `livestock` also displays, so a per-pack override would
  have changed one screen and not the other. A paddock is a paddock everywhere.
  Moved while there was still no data in the wrong shape.
- **Written through `withSystem` after a superadmin check**, because `tenants`
  is SELECT-only for members and must stay so — RLS is row-level, and a member
  UPDATE policy permissive enough for `labels` would also expose `status`.

### 2026-08-15 — A pack declares a dependency on another pack for the first time (`claude/inventory-lot-spine`)
- **`inventory` slice 0** ships the lot spine — full dossier in
  [inventory.md](inventory.md).
- **`requires: ["assets"]` is the first pack-to-pack dependency that exists
  because of a FOREIGN KEY** rather than a conceptual ordering. A storage
  location IS an asset, so `inventory_movements` points at `assets` with a
  composite `(tenant_id, location_asset_id)` FK. That makes the dependency
  enforced by Postgres as well as by `toggleModule`, which is a stronger
  guarantee than the graph alone — and it is the shape every later pack should
  copy rather than inventing a soft reference.
- **Three dimension types now exist across three packs** (`asset`, `parcel`,
  `zone`, `lot`) and core has still never changed. That is the fourth
  independent test of ADR 0004's claim.
- **A pack read another pack's TABLE for the first time**, and deliberately: the
  location picker selects from `assets`. That is allowed precisely because the
  dependency is declared — `requires` is what makes the difference between a
  legitimate read and the leak extension-model.md §4 forbids. A pack must never
  read the tables of something it does not require.

### 2026-08-15 — Second pack ships, and vocabulary finally has a reader (`claude/land-places`)
- **`land` slice 0** — parcels, zones and dated zone use, full dossier in
  [land.md](land.md). The substrate `livestock` and `crops` declare in
  `requires` now exists.
- **`resolveLabels` has a caller**, three weeks after it was built and tested.
  It stayed unread because `assets` had no word worth overriding; `land` does, so
  the seam was wired the moment a pack had a surface that needed it. Verified
  live: the same page renders "Paddocks" for a tenant with the override and
  "Zones" for one with no profile at all.
- **`packConfig` has its first real reader too** — `land.areaUnit` flips the
  whole surface to hectares. That is half of what P5 is for, arriving through
  configuration rather than a new primitive.
- **New Layer 0 file: `src/lib/packs/tenant-context.ts`.** `packContext(tx,
  tenantId, industry, slug)` returns `{ labels, config }`, merging profile
  defaults with `tenant_modules.config`. It lives in Layer 0 rather than in the
  pack because every later pack needs exactly this and none of them should
  re-derive it. **Per-tenant labels live under a `labels` key on the pack's own
  row**, so renaming a word for one pack does not silently rename it in another.
- **`config` is typed `unknown` on the way out**, deliberately. A pack parses its
  own key with its own tolerance for nonsense; typing it here would mean this
  file knowing what every pack's settings look like, which is the coupling packs
  exist to avoid.
- **Two dimension types from one pack** for the first time (`parcel`, `zone`).
  Nothing in core needed to change, which is the claim ADR 0004 makes and this is
  the second independent test of it.

### 2026-08-14 — First pack ships: `assets` (`claude/layer2-pack-machinery`)
- **The machinery is now proved by something using it.** `assets` renders, owns
  a table under FORCE RLS, and syncs cost objects — full dossier in
  [assets.md](assets.md).
- **`upsertDimensionMember` has its first caller**, three weeks after the seam
  was opened. The pattern the next pack copies: the entity write and its
  dimension sync share one transaction, so a cost object can never point at a
  rolled-back row.
- `Component` on a `PackDefinition` went from "all seven absent" to "one
  present", exercising the empty-slot path and the renderable path at once.
- **P5 is now genuinely blocked on something real:** the asset kind suggestions
  are hardcoded in the pack, and they should come from profile `packConfig`.
  That is the extension point ADR 0004 predicted, and it now has a caller
  waiting for it rather than a hypothetical one.

### 2026-08-14 — Layer 2 exists: registry, dependencies, profile install (`claude/layer2-pack-machinery`)
- **`src/packs/` and `src/industries/` now exist.** Seven capability packs are
  declared with a real dependency graph, and `homestead-farm` is the first
  profile manifest. **Zero new tables**, as ADR 0009 predicted.
- **A declared pack is not a placeholder.** `PackDefinition.Component` is
  optional, so a pack participates fully in dependency resolution and profile
  installs while having no renderer — the same arrangement `scheduling` and
  `work` used before they shipped. All seven are in that state today.
- **One registry at runtime, two source trees.** `src/lib/features.ts` merges
  core and packs at Layer 0; neither `src/modules/index.ts` nor
  `src/packs/index.ts` imports the other. A slug registered in both throws at
  module load rather than silently shadowing.
- **Dependency enforcement lives in `toggleModule`**, before provisioning, so a
  refused toggle leaves no trace. Enabling checks requirements; disabling checks
  dependents. Never checked at runtime — a request that has reached a pack's
  page is too late.
- **`installProfile` is additive and re-runnable.** It enables packs in
  topological order inside one transaction and stamps `tenants.industry`. It
  never switches anything off: a pack the tenant disabled is a decision, not
  drift.
- **Nav groups by `category`**, with the pack group taking the installed
  profile's name. Nothing changes for a tenant with no profile.
- **Extracted `enableRow`** from `toggleModule` so the action and the installer
  share one upsert. Its `enabledAt` restamping behaviour is deliberately
  unchanged — the admin matrix renders that value.
- 39 pure tests in `tests/packs.test.ts` covering the resolver, plus invariants
  over the real registries (no cycles, no unregistered requirements, no profile
  missing a transitive dependency, no industry noun in a pack name).
- **Not done: seed application.** `IndustryProfile.seed` is declared and unused;
  it needs a farm chart of accounts written first. Shipped in two steps rather
  than half-seeding.

### 2026-08-13 — Design settled, no code yet (`claude/packs-and-profiles-design`)
- Answered the two mechanism questions ADR 0004 left open, as
  [ADR 0009](../decisions/0009-packs-are-modules-profiles-install-them.md): a
  pack is a `modules` row with `category = 'pack'`, and a profile is a one-time
  installer rather than a live binding.
- Audited what already exists. The result is the headline of this document:
  **most of the machinery is built.** `modules.category`, `tenant_modules.config`,
  `tenants.industry`, `requireModuleEnabled()` and `dimension_members` were all
  put in place for this and have been waiting.
- Scoped what is genuinely missing: the manifest layer, dependency enforcement,
  install-time seeding, and the P5 extension points ADR 0004 predicted would be
  forced first.
- Driven by the first real profile,
  [homestead-farm.md](homestead-farm.md), which has a pilot tenant.

## What already exists

Nothing in this table needs building. It is listed because the natural instinct
when starting Layer 2 is to build a parallel set of all of it.

| Piece | Where | What it already does |
| --- | --- | --- |
| `modules.category` | [platform.ts:268](../../src/db/schema/platform.ts:268) | Defaults to `'core'`. `'pack'` is the second value. |
| `tenant_modules.enabled` | [platform.ts:281](../../src/db/schema/platform.ts:281) | Per-tenant on/off. Works for packs unchanged. |
| `tenant_modules.config` | [platform.ts:281](../../src/db/schema/platform.ts:281) | jsonb. Layer 3 tailoring, per pack. **Not** labels — those are tenant-wide. |
| `tenants.labels` | [platform.ts](../../src/db/schema/platform.ts) | jsonb, tenant-wide vocabulary overrides. Keys come from the registry. |
| `tenants.industry` | [platform.ts:78](../../src/db/schema/platform.ts:78) | text, `default 'general'`. The installed profile slug. |
| `requireModuleEnabled()` | [modules.ts:52](../../src/lib/modules.ts:52) | 404s when off. Works for packs unchanged. |
| `getActiveModules()` | [modules.ts:13](../../src/lib/modules.ts:13) | Builds the nav, ordered by `sortOrder`. |
| `moduleRegistry` | [modules/index.ts:16](../../src/modules/index.ts:16) | slug → renderer. Packs merge into this at runtime. |
| `dimension_members` | [ledger.ts:189](../../src/db/schema/ledger.ts:189) | **The costing seam.** Packs sync entities here in their own transaction; core never imports pack tables. See [dimensions.ts:9](../../src/modules/accounting/core/dimensions.ts:9). |
| `work_item_links` | [work.ts:301](../../src/db/schema/work.ts:301) | Open `entity_type` + `extension_slug` (P3). A pack entity becomes linkable with no core migration. |
| `documents.doc_kind` / `.metadata` | [documents.ts:101](../../src/db/schema/documents.ts:101) | P1 open taxonomy and P2 extension bag. |

**Consequence worth stating loudly: Layer 2 v1 needs zero new tables.** Manifests
and dependency declarations are code-side. Enablement, config, seed data and
cost dimensions all land in tables that already exist and already have RLS.

## What has to be built

| # | Thing | Status |
| --- | --- | --- |
| 1 | `src/packs/` + merged runtime registry | **built** — `src/packs/index.ts`, merged in `src/lib/features.ts` |
| 2 | `src/industries/<slug>.ts` manifests | **built** — `homestead-farm` is the first |
| 3 | Dependency declaration + enforcement | **built** — declared in `PackDefinition.requires`, enforced in `toggleModule` |
| 4 | The install action | **built** — `installProfile` enables packs, stamps `tenants.industry` and applies the seed; `toggleModule` applies it for a module switched on later (2026-09-10, `src/app/admin/profile-seed.ts`) |
| 5 | Label resolution | **built, in use, and now DECLARED** — see the vocabulary registry below. Was: **built and in use** — `resolveLabels` / `labelFor` in `src/lib/packs/resolve.ts`, reached through `packContext` in `src/lib/packs/tenant-context.ts`. First caller: `land`, 2026-08-15 |
| 6 | Nav grouping by `category` | **built** — the pack group takes the installed profile's name |
| 7 | **P5 extension points** | **not built.** Two packs now hardcode a suggestion list that should come from profile `packConfig` (`assets.kind`, `land`'s zone uses). Config-shaped tailoring already works via `packContext`; what is still missing is a pack CONTRIBUTING nav or registering an entity type |

## The shapes

Built as described below. The original planning note read *"not yet written,
recorded so the first pack doesn't improvise"* — it is kept in this shape
because it is still the contract a new pack is written against.

```
src/modules/      Layer 1 — core tools. Industry-blind.
src/packs/        Layer 2a — capability packs. Also industry-blind.
  land/  assets/  inventory/  livestock/  crops/  production/  retail/
src/industries/   Layer 2b — profiles. Manifests only, no components.
  homestead-farm.ts
```

A pack declares what it needs; it never declares who uses it:

```ts
export interface PackDefinition extends ModuleDefinition {
  /** Packs that must be enabled first. Enforced at enable time, not runtime. */
  requires: string[];
  /** Dimension types this pack syncs into dimension_members. */
  dimensionTypes?: string[];
  /** Entity types this pack registers for work/mail/schedule links (P3). */
  entityTypes?: string[];
}
```

A profile is data, per [extension-model.md §5](../extension-model.md):

```ts
export interface IndustryProfile {
  slug: string;                    // "homestead-farm"
  name: string;                    // "Homestead Farm"
  packs: string[];                 // installed, then owned by the tenant
  labels: Record<string, string>;  // resolved LIVE, overridable per tenant
  seed: {
    accounts?: CoaSeedRow[];
    folders?: DefaultFolder[];
    docKinds?: string[];
    packs?: Record<string, unknown>;  // slug → the pack's own seed shape (ADR 0057)
  };
  packConfig: Record<string, unknown>;  // packs read their own key, never the slug
}
```

Sharing between profiles is by **spreading a constant**, never inheritance.

## Data model

No new tables. Existing columns take on new values:

| Table | Column | Change |
| --- | --- | --- |
| `modules` | `category` | Gains the value `'pack'`. Was already text with no constraint. |
| `tenant_modules` | `config` | Gains an optional `labels` key for per-tenant vocabulary overrides. |
| `tenants` | `industry` | Becomes meaningful — it is the installed profile slug, not a descriptive tag. |

Pack-owned tables follow the ordinary rules: `tenant_id`, FORCE RLS, a
`--custom` policy migration, and isolation-test coverage
([security.md §4](../security.md)).

## Decisions & gotchas

- **[ADR 0009](../decisions/0009-packs-are-modules-profiles-install-them.md)** —
  a pack is a module row; a profile installs rather than binds. Read the
  consequences section before assuming a profile edit reaches live tenants. It
  does not.
- **[ADR 0004](../decisions/0004-capability-packs-and-industry-profiles.md)** —
  packs are industry-blind. No `if (industry === …)`, ever, in a pack or in core.
- **Naming is load-bearing.** "The farm module" grants permission to build farm
  things inside it. Say "the `livestock` pack, listed by the homestead-farm
  profile" in code, commits and conversation.
- **`tenants.industry` currently defaults to `'general'`**, so the
  no-profile-installed path is the common one. Label resolution must degrade
  silently rather than throw — it will run on every request for every tenant
  that has never installed a profile.
- **The costing seam is the point.** A pack that tracks activity without syncing
  a dimension member and posting to the ledger has built a to-do list. The
  reason this platform's version of an industry is worth anything is that every
  activity lands on a cost object and rolls into the books.
- **Allocation belongs to the pack, and follows the house rounding rule.** Any
  pack at scale hits the same problem: one cost serves many cost objects (feed
  from a shared bin across pens; overhead across jobs), so it must be allocated
  by a rule rather than assigned. The pack computes the split and posts ordinary
  dimension-tagged journal lines — **core needs no allocation concept and must
  not grow one**, or it stops being neutral. The arithmetic is not free-form:
  [cash-basis-allocate.ts](../../src/modules/accounting/core/cash-basis-allocate.ts)
  is the house precedent — "THE ONE PLACE IN REPORT MATH THAT DIVIDES",
  quarantined, with an exact remainder rule so no cent is invented or lost. A
  pack allocator does not get its own rounding.
- **The SKU is the profile, never the pack** (decided 2026-08-13). A tenant buys
  "Homestead Farm", not seven line items. The rejected alternative was per-pack
  pricing, which fails on two counts: packs have hard dependencies, so a cart of
  parts can be assembled into a broken product; and a pack listed by two
  profiles (`assets` is in both homestead-farm and any trades profile) would
  either be double-sold or need cross-profile entitlement logic. Pricing the
  profile makes `assets` reach the trades market with no pricing change at all.
  **Therefore packs must never appear in a client-facing catalogue.** Today that
  is free — no such catalogue exists, and the tenant nav is built only from
  enabled modules ([layout.tsx:31](../../src/app/dashboard/layout.tsx:31)). If a
  store page is ever built, it filters on `category = 'core'`.

## Open items

- ~~**Only one of Layer 0's four work verbs checks that the owning feature is
  switched ON.**~~ — **closed 2026-09-04**, the same day as the role half. The
  caution recorded here was wrong and the build log says why: every surface that
  renders the control is already behind `requireModuleEnabled` for the same
  feature, so nothing a reader can see was stopped.

- ~~**Seed application is not built.**~~ — **closed 2026-09-10** by the agency
  profile (back-office slice 7a); see the build log. What remains of it: the
  homestead profile carries no seed, and a farm chart of accounts is its
  accountant's question.
- **A profile label cannot be an uncountable noun.** `LabelDefinition` declares
  a `plural` for its fallback, but a profile's override is a bare string and
  `pluralOf` appends an "s" to it — so `asset → Equipment` would read
  "Equipments" on a list page, and the construction profile had to leave the
  pack's word. The fix is a `{ singular, plural }` form for an override, read by
  `resolveLabels` and `pluralOf`; nobody has needed it badly enough yet.
- **`PackDefinition` has no `dimensionTypes` or `entityTypes` field**, though
  "The shapes" above still shows both. Found 2026-09-14 while registering `jobs`,
  which syncs a `project` dimension: every pack that syncs one — `assets`,
  `land`, `inventory`, `livestock` — does so without declaring it, and nothing
  anywhere reads such a field. Not added on discovery, because a field nothing
  reads is worse than an honest absence; the shapes block is kept as written
  because it is the contract a new pack is read against, and this is the note
  saying which half of it is real.

- **P5 extension points** (#7 above) — the primitive ADR 0004 named and nobody
  has built. Nothing has forced it yet because no pack renders; the first pack
  that ships will.
- ~~**Nothing asserts a pack in code has a seed row in `scripts/seed.ts`.**~~ —
  **closed 2026-09-14**, by exactly the fix this entry named: the array now lives
  in `scripts/seed-catalogue.ts`, which imports the schema for TYPES only and so
  can be read without opening a database connection.
  `tests/module-catalogue.test.ts` fails if a registered pack or core module has
  no row, if a pack is miscategorised (which would silently refuse an
  accountant's writes, per `authorize.ts`), or if a pack is `available` with no
  `Component` — a dead row in a client's nav.

- **A CATALOGUE ROW IN CODE IS NOT A CATALOGUE ROW IN A DATABASE**, and the gap
  between those two is how `jobs` shipped invisible. Every table migrated, RLS
  verified on 198 tables, four merged PRs — and no row in production's `modules`,
  so nobody could switch it on. [ADR 0014](../decisions/0014-migrations-are-applied-before-the-merge.md)
  makes applying a migration a conscious pre-merge ritual with its own
  verification, and the seed had neither, so the schema landed reliably and the
  catalogue row did not. **`npm run db:verify-modules`** is the missing half —
  `verify-rls`'s sibling, same `--dev` flag, same exit code — and AGENTS.md's
  Commands section now carries the seed in the same before-the-merge list as the
  migration. The test above proves the code agrees with itself; the script proves
  a database agrees with the code.
- ~~`resolveLabels` has no caller~~ · ~~no UI for a per-tenant override~~ ·
  ~~no UI for `installProfile`~~ — **all closed 2026-08-15.** Both surfaces are
  on the admin tenant page, and the words they offer come from the registry.
  ~~Neither has been driven~~ — **driven 2026-08-16**, and both were wrong in
  the way only clicking shows. See the build log.
- **The sweep is partial**, and each pack declares only the words on its list
  pages; plenty of nouns further in are still hardcoded English ("Species",
  "Tag", "Batch code"). Adding one is a `LabelDefinition` plus a `labelFor` call,
  and `tests/vocabulary.test.ts` fails if a key is rendered without being
  declared — so the ratchet only turns one way.
  ~~**Core modules declare none at all**, which is the bigger gap: "customer" and
  "invoice" are exactly the words an industry renames.~~ — **half closed
  2026-09-13.** Accounting declares `customer` and `vendor`, swept across every
  Accounting and CRM screen; see the build log. **`invoice` is still not
  renameable** and is the obvious next one, though it is less clear it should be:
  a construction contract bills by pay application or draw request per CONTRACT,
  which is a `progress-billing` concern rather than one tenant-wide word.

- **A KEY PASSED AS A CONSTANT IS INVISIBLE TO THE RATCHET.**
  `tests/vocabulary.test.ts` scans the source for `labelFor(x, "literal")` and
  `useLabel("literal")`, so a key held in a constant is never checked — and
  `enterprise` has been through that hole since the sidebar shipped: rendered on
  every dashboard page through `ENTERPRISE_LABEL_KEY`, declared by no feature at
  all. The party words use constants too and are checked by name instead, which
  is the pattern any subsystem doing the same should copy. **`enterprise` itself
  is unfixed**, and the reason is worth stating: `enterprises` is a Layer 0
  subsystem with no `moduleRegistry` or `packRegistry` entry, so there is nowhere
  for it to declare a label. Deciding where Layer 0 declares vocabulary is the
  actual open question — `feedback` and `work` have their own `vocabulary.ts`
  files and will hit it next.
- **Re-apply and drift** — a profile edit does not reach installed tenants. No
  action to re-run an installer, and no report of how a tenant differs from its
  manifest. Accepted cost in ADR 0009; revisit when it bites.
- ~~Billing granularity~~ — **settled 2026-08-13: the SKU is the profile.** See
  Decisions above. What remains is the mechanism: `subscriptions` is per-tenant,
  so nothing needs to change until a second profile is priced differently.
- **Two profiles on one tenant** is mechanically fine (run both installers) but
  `tenants.industry` can only record one, so label resolution would pick a
  winner. First thing to revisit per ADR 0009.
- **Units of measure.** Farms, and any pack touching `inventory`, need
  conversions (head, lb, bushel, dozen, bale, ton, gallon, acre). Only
  `invoicing` has any quantity notion today. This is a day-one decision for the
  `inventory` pack and a rewrite if deferred.
- **Cleanup of the known core leaks** in
  [extension-model.md §8](../extension-model.md) — the trades vocabulary sitting
  in core folders, the general chart of accounts and the client-creation form's
  `"construction"` default. The first profile install makes these visible.
