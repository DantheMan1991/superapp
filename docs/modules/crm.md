# CRM

> The people and organizations a business deals with, the work in front of them,
> and every touch in between: contacts, companies, pipelines, deals, activity and
> follow-ups. Layer 1 — industry-blind. The trade-specific vocabulary a plumbing
> contractor or a dental practice sees comes from a Layer 2b profile, never from
> this module.
> Status: `coming_soon` · Scope: `module` <!-- keep Status on ONE line — /admin/docs parses it -->

The module is `coming_soon` while its foundation ships. Slice 0 is a **platform**
change that adds no CRM surface at all — read "The party spine" below before
anything else, because it is the decision the whole module rests on and it
touches accounting's live AR/AP tables.

## Build log

### 2026-09-04 — CRM reads, and says so (`claude/crm-reads-and-says-so`)

**Twelve screens rendered every control enabled for an `expert` and refused
every press.** All nine `gate()`s in this module have failed closed for the
accountant since it shipped, and they were the only things that knew — not one
screen asked, so `Add a record`, Save, Archive, Move stage, Add a deal, Add a
connection, the timeline's four buttons, Save view, pin, delete and Save report
all drew normally and each one came back
`accountant access is read-only`.

**`roleMayWrite` now lives in `core/errors.ts`** — pure, import-free, already
the home of `CrmErrorCode` and already imported by every screen that renders an
error. All nine gates call it instead of comparing the role themselves, and every
screen calls it too.

**Read-only is a rendering, and the rendering differs by screen.**

- **Where the values are the point** — the record form, the deal form — the
  controls stay and go `readOnly`, which browsers honour on text inputs and which
  does NOT fade them. `disabled` was rejected: the UI kit puts
  `disabled:opacity-50` on Input and Textarea, and fading a record's own values
  at half opacity punishes the one reader who is here only to read them. The
  pickers, which cannot be read-only, take `disabled` — there are two.
- **Where the control is the point** — Archive, Move stage, Add, Remove, the
  timeline buttons, Save view — it is not drawn.
- **Where the whole page exists only to create** — `records/new` and
  `records/[partyId]/deals/new` — the accountant gets a `Lock` panel instead of
  the form, the way `duplicates` refuses a non-owner. A read-only rendering of a
  create form is a form with nothing to do. This closes the recorded item
  *`/dashboard/m/crm/records/new` has no role check at all*.
- **Reads that look like writes stay.** Choosing a saved view, filtering, paging
  and changing what a report asks are all just the address of the page, and all
  keep working. Only KEEPING the question is a write.

The four screens that were already owner-only — automations, duplicates, fields,
pipelines — needed nothing: an accountant is not an owner and was already
getting their non-owner branch.

**ONE CONTROL IS NOW STRICTER THAN ITS SERVER, ON PURPOSE, AND IT IS THE NEXT
THING TO FIX.** `WorkItemRow` — the shared follow-up row, on the record timeline
and on `/tasks` — calls Layer 0's `setEntityWorkDoneAction`,
`setEntityWorkAssigneeAction` and `setEntityWorkDueAction`
(`src/lib/work/actions.ts`), and **those three apply no role rule at all**. So an
accountant really could tick a CRM follow-up off, hand it over and re-date it;
`docs/help/crm/tasks.md` documented it as *"the one part of CRM where accountant
access is not read-only"*. It is hidden here, because a banner saying nothing can
be changed above a control that changes something is worse than a control nobody
knew they had. **The proper fix is in the seam, not here**, and it is not
mechanical: that file's own header says *"THE GUARD IS THE OWNING FEATURE, NOT
WORK"*, and the owning features disagree — CRM refuses an expert, a capability
pack admits one at `member` level. See Open items.

Guides swept in the same PR: all fifteen that mention the accountant.

### 2026-09-03 — A custom number field can be typed into (`claude/crm-number-field`)
- **The number control could not be filled in on any screen that renders it**:
  the record page, `/dashboard/m/crm/records/new` and the deal form.
  `FieldControl` stored the raw string its `onChange` was handed (deliberately,
  so the client holds no second opinion about what a number is) but read it
  back with `value={typeof raw === "number" ? String(raw) : ""}`. The two
  expressions did not agree, so the first keystroke rendered the box empty and
  React reset the DOM input on every keystroke after it. Reported 2026-09-03,
  after the tenant guides were written against the real screens and the writer
  could not fill the field in.
- **Fixed by making the pair agree, NOT by parsing on the client.**
  `fieldInputValue` in `core/custom-fields.ts` hands back whatever is held;
  `parseFieldValue` is still the only thing that decides what a number is, and
  it still runs server-side on the write. A client-side parse would also have
  destroyed the half-finished states a number is typed through — `-`, `0.` and
  `1e` survive no round trip through `Number`, so the control has to hold the
  string, which is what it was already doing.
- **It renders blank for anything that is neither a string nor a finite
  number.** `custom` is jsonb, so a value of the wrong shape for its definition
  can be read back, and `String(["north", "south"])` sitting in a box somebody
  is about to type over would be worse than an empty one. It also stops a
  stored `NaN` from rendering as the word `NaN`.
- **The regression test is the pair of expressions, not a React tree.**
  `tests/crm-custom-fields.test.ts` drives the control's loop a keystroke at a
  time and hands what it holds to the real validator. Rendering the component
  would have cost a jsdom and testing-library stack this repo does not have, to
  cover two expressions; the two expressions are what disagreed. Confirmed red
  against the old `value` before it was confirmed green against the new one.
- **The four tenant guides that warned readers off the type now describe what
  it takes.** `docs/help/crm/fields.md`, `new-record.md`, `record.md` and
  `new-deal.md` all carried `A number field cannot be filled in today`, which
  the guides PR above added on the same day. It merged while this fix was in
  review, so the correction lands here with the fix rather than trailing it,
  and the `Open items` bullet it opened is closed in the same commit.

### 2026-09-03 — Sixteen tenant guides, and what writing them found (`claude/crm-guides`)

CRM now has a guide per screen in `docs/help/crm/` (see [guides.md](guides.md)
for the set and the method). Six agents inventoried the module control by
control first — 4,685 lines of notes, 131 recorded gaps — and a second agent
checked each guide against the source. The guides describe what the code does,
so what follows is written down here rather than smoothed over there.

**The records list and views**

- Paging drops every filter condition but the first. `pageHref` collapses the
  repeated `f` params with `Array.isArray(value) ? value[0] : value`, so
  `Next` on a two-condition filter silently asks a different question.
- The search box and the four toggles keep the page number, so searching from
  page 4 can land on an empty page. The filter panel's own apply drops it.
- A filtered-to-zero saved view shows `Add your first record`, because
  `isFiltered` counts only q/kind/worked/archived, not view conditions.
- Nothing in the UI sorts the list. `ViewSort`, `SORT_FIELDS` and `compileSort`
  all work and nothing renders them, so a sort can only arrive from a built-in
  view.
- The `Assigned to` filter takes a raw Clerk user id typed by hand, and
  `Assigned to me` prints that id in the filter sentence.
- A view cannot be renamed, shared or unshared after it is made:
  `updateViewAction` accepts both and nothing sends them. Deleting one is a
  single menu click with no confirmation, and an owner cannot delete a
  leaver's shared view although the policy allows it.
- `Active is No` can never match, because the list always adds
  `is_active = true` unless the separate `Archived` toggle is on.
- `Visibility is Restricted` is offered to everybody and answers only for an
  owner.
- Custom fields are filterable by nothing, sortable by nothing and searched by
  nothing. The search box is name-only.
- `Not worked in CRM yet` shows for records that have been worked, because
  `lifecycle_stage` defaults to the empty string.

**One record**

- A contact point cannot be edited: `updateContactPointAction` has no caller.
  Removing one is a single unconfirmed click, and re-adding a value the record
  already has toasts `Added` while adding nothing.
- An unusable email or phone reports `Something went wrong. Please try again.`
  because `PartyError` escapes untranslated, while the written refusal
  `That does not look like a usable email, phone or website.` is never shown.
- Switching a restricted record back to everyone hides the access panel and
  keeps the grant rows, so restricting it again silently lets the same people
  back in.
- Nobody owns a record. `owner_clerk_user_id` exists, the action accepts it,
  and only an automation can set it.
- Nothing from the rest of the product appears on a record: no mail threads, no
  documents, no invoices, no payments, though the mail extension links
  conversations to records from the other end.
- Deal amounts on the record and on the board hard-code `# CRM

> The people and organizations a business deals with, the work in front of them,
> and every touch in between: contacts, companies, pipelines, deals, activity and
> follow-ups. Layer 1 — industry-blind. The trade-specific vocabulary a plumbing
> contractor or a dental practice sees comes from a Layer 2b profile, never from
> this module.
> Status: `coming_soon` · Scope: `module` <!-- keep Status on ONE line — /admin/docs parses it -->

The module is `coming_soon` while its foundation ships. Slice 0 is a **platform**
change that adds no CRM surface at all — read "The party spine" below before
anything else, because it is the decision the whole module rests on and it
touches accounting's live AR/AP tables.

 and ignore
  `tenants.currency_symbol`, which `formatMoney` exists to honour. Deal and
  stage-history dates print in UTC, ignoring `tenants.timezone`.
- `Cancel` on an existing record navigates to the page already open, so
  unsaved edits stay on screen and the button looks broken.
- Any value over its length cap fails the whole save with a bare
  `Invalid input`, naming no field. No input carries `maxLength`.

**Deals**

- A deal can never be deleted or archived. A mistyped one can only be parked in
  a Lost stage.
- `Also involved` is read-only: both stakeholder actions have no caller. The
  primary contact prints in the header with no control to choose it.
- A second pipeline cannot be created from the UI, so the pipeline picker can
  never render, and stages cannot be reordered despite the heading
  `Stages, in order`.
- Changing a stage's outcome does not restamp `closed_at` on the deals already
  in it, so a card can sit in a Won column with no badge and no closed date.
- Nothing provisions the default pipeline except an owner opening Board or
  Pipelines, so a tenant whose first act is `Add a deal` gets
  `That pipeline could not be found.` with no guidance.
- The Likelihood help text claims it weights the pipeline total; the weighted
  total is computed and never rendered.
- The board has no filter, search or sort, is capped at 1,000 deals, and says
  so in one line.

**The timeline and follow-ups**

- A logged activity cannot be edited from any screen. `updateActivityAction`
  is complete, versioned and unreachable; the only control on the row is
  delete.
- A follow-up cannot be deleted or reworded in CRM, and the
  `A follow-up is completed` automation trigger never fires from the UI,
  because the Done button goes through the shared work action instead.
- The Follow-ups page names no record: every row links with the literal words
  `On this record`, and `resolveTaskParties`, written to supply the labels, has
  no caller. It has no urgency grouping and no overdue badge, contrary to this
  dossier — `groupTasks`, `dueBucket` and `DueBadge` are used only by tests.
- A deal has no timeline at all: `loadDealTimeline`, `listActivitiesForDeal`
  and `listTasksForDeal` are built and unused, and nothing in the UI can file
  an activity or a follow-up against a deal.

**Fields, automations, duplicates and reports**

- Only party fields can be created. The page and the schema hard-code `party`,
  so the deal form's own `listFieldDefs(tx, tenantId, "deal")` can never
  return anything, while the page's copy says `Fields on every record` and
  `This appears on every record in the CRM.`
- A field cannot be deleted or reordered, the Reference help says
  `Used for imports.` and no CRM import exists, and the archive control is an
  icon button with no label, no aria-label and no tooltip.
- The reports list promises `You can group and filter it once it opens.` and
  no report screen filters anything.
- An ungrouped report prints its own total a second time as a row labelled
  `Not set`, and the save dialog reports a money total as a record count.
- The built-in `Who is carrying what?` counts every work item in the tenant,
  not only what CRM raised, and counts an item twice when it is linked to both
  a contact and a company.
- The `none` chart option is unreachable, and the detail list has no empty
  state.
- Across the module the outside accountant sees every control live and is
  refused only on submit, and `/dashboard/m/crm/records/new` has no role check
  at all.

### 2026-08-15 — Follow-ups is a CRM page again (`claude/crm-followups-tab`)
- **`/dashboard/m/crm/tasks` was a redirect into Work; it is a page again**, and
  the tab is back in the CRM strip.
- **Slice 5b's reasoning still holds — it just did not mean what it was taken to
  mean.** A CRM-filtered list would silently drop unattached follow-ups ("ring
  the accountant back"), so **Work** is the complete list of what somebody owes.
  That does not imply CRM may not have a view of its own work, and the two
  claims were thrown out together. Working a record and then being ejected into
  another module to see what is outstanding on it is the friction the founder
  reported.
- **It scopes deliberately and says so.** Follow-ups attached to a record, with
  standing copy pointing at Work for everything else — the link only renders if
  Work is switched on, because a dead link to a module a tenant does not have is
  worse than none.
- Rows are the shared `WorkItemRow`, so the verbs here are the same ones on the
  record page and on an asset ([extension-model.md §4b](../extension-model.md)).
- `listOpenTasksOnRecords` filters in JS rather than SQL: `toFollowUp` already
  resolves the CRM link out of `row.links`, and a join would give two
  definitions of "is this a CRM follow-up" to keep in step. Noted as revisitable
  if open-work volume ever makes the round trip matter.

### 2026-08-15 — Follow-ups gain the shared work verbs (`claude/shared-entity-work`)
- **The complaint that started it:** raising a follow-up on a record felt like
  leaving CRM. Investigating showed the record page never navigates — the add
  dialog is inline and the follow-up renders in the timeline. What was missing
  were the VERBS: `TaskToggle` could tick and untick, and nothing else, so
  reassigning one or moving its date meant opening Work.
- `TaskToggle` is gone, replaced by the shared `WorkItemRow`
  (`src/components/app/work-item-row.tsx`), which carries done, reopen,
  reassign and re-due. The timeline keeps its own layout — it interleaves notes
  and follow-ups, which is better for CRM than a generic panel — and shares only
  the verbs.
- **The optimistic `version` survived the move.** The shared action takes an
  optional `expectedVersion` and the timeline passes it, so the concurrency
  guarantee follow-ups have carried since slice 1 is unchanged.
- The record page now passes the assignable members it already loaded for the
  add dialog through to each row.

### 2026-08-12 — Merge follows the recurrence tables (branch `claude/accounting-recurring-converge`)

Accounting folded `recurring_invoices` into `recurring_entries`, and
`merge-ops.ts` is the one place in CRM that writes accounting's tables, so it
had to move with them.

- **A vendor merge would have FAILED on a recurring bill.** `absorbRole`
  re-pointed `invoices`, `recurring_invoices` and `bills`, then deleted the
  losing role row — but recurring bills arrived after that was written, and
  `recurring_entries_vendor_fk` is `NO ACTION`. Two vendors that both had one
  would have hit a foreign-key violation on the delete. Both party columns are
  re-pointed now.
- The preview counter is `recurringEntries`, one query covering whichever side
  is being absorbed. `touchesLedger` still reads it, so the accounting-writes
  warning appears for a schedule exactly as it does for a posted invoice.

### 2026-08-10 — UI: CRM gets a sub-nav it never had (branch `claude/ui-crm`)

Presentation and IA — no query, action, schema or policy changed. Vocabulary in
[design-system.md](design-system.md);
[ADR 0008](../decisions/0008-warm-neutrals-and-layered-elevation.md) has the why.

- **`CrmNav` is new** (`components/crm-nav.tsx`), a `CategoryStrip` over the
  module's sections. This module had **no sub-nav at all**: the hub carried
  **six outline buttons** — Follow-ups, Board, Fields, Reports, Automations,
  Duplicates — sitting where a page's actions go, so navigation was dressed as
  actions and the one real action (Add a record) was the seventh button in the
  row. And no sub-page carried anything, so once you were on Duplicates the only
  way back was the browser's back button. This is therefore an **IA change**, not
  only a restyle.
- **Follow-ups is deliberately absent from the strip.** `/dashboard/m/crm/tasks`
  is a redirect into Work (slice 5b) and its own header says the route survives
  "in the CRM nav until every link is chased down" — this is that link, chased
  down. A strip tab that lands you in another module, with the strip gone and no
  active state to match, is worse than no tab; Work is already its own row in the
  rail.
- **Every page converted.** `text-2xl font-semibold tracking-tight` appears
  **zero** times under `src/app/dashboard/m/crm/` and `src/modules/crm/`, and the
  strip renders on all ten real pages. Record rows and the three report lists
  moved onto `Panel` + `--divider`; the person/company glyphs onto the violet
  `--module-accent`, so CRM reads violet the way accounting reads emerald and
  documents amber.
- **Back links kept only where they mean something.** `pipelines` is reached from
  the Board and `deals/[dealId]`, `records/[partyId]/deals/new` and
  `reports/[reportId]` all sit under a section, so their contextual "up" link
  survives alongside the strip — the same arrangement accounting's bill and
  invoice detail pages use. The lone "All records" links on the *top-level*
  sections were removed, because there the strip is the way back.
- **`tasks` deliberately has no strip.** It is a `redirect()` and renders no UI
  at all.

### 2026-08-10 — `crm_tasks` dropped (branch `claude/work-slice-5c`)

The table is gone (`drizzle/0110`). Its rows were copied into `work_items` by
0109, ids preserved and verified against production, and nothing has read it
since the slice 5b deploy.

**The one property that did not survive**: this module's task policy BRANCHED —
an attached follow-up inherited its record's visibility, so a follow-up on a
`restricted` record was hidden from staff. A work item inherits its LIST
instead, and Work has no per-record visibility to inherit. Production had zero
restricted records when this shipped, so no follow-up changed hands; a tenant
that needs the old behaviour puts that work in an owners-only list. The four
isolation tests that certified the branch are removed, with that difference
written into their place.

### 2026-08-09 — Follow-ups moved to Work (branch `claude/work-slice-5b`)

`crm_tasks` is no longer read by anything. A follow-up is a **work item linked
to the record** — see [work.md](work.md) slice 5b — and the table is dropped in
a separate PR after this deploys.

- **Nothing in CRM's UI changed.** `listTasksForParty(tx, tenantId, partyId)`
  and its siblings kept their signatures, and `groupTasks`/`TaskToggle`/the
  timeline component are now typed against a structural `GroupableTask` rather
  than the `CrmTask` row. `FollowUp` keeps CRM's words — `notes`, `completedAt`,
  `partyId`, `dealId` — over a table that spells them `description`,
  `closed_at` and two link rows.
- **`/dashboard/m/crm/tasks` redirects to Work** and does NOT filter to
  CRM-linked work. `party_id` was nullable so an unattached follow-up had a
  home; filtering would have dropped exactly those.
- **A rule that names a non-member now creates the follow-up UNASSIGNED.** This
  module's own dossier recorded the gap that any string could be written into
  an assignee column; Work validates against the roster, and the automation
  engine's savepoint would have swallowed that error and lost the follow-up
  entirely. Losing the assignment beats losing the obligation.
- **CRM's attention source is deleted.** It had to go in the same deploy as the
  data copy: with the rows copied and both sources registered, every follow-up
  would appear twice in the digest. Work's source covers the same ground and
  more.
- A merge now **relinks** a follow-up to the survivor instead of rewriting
  `party_id`.

### 2026-08-08 — Build log archived; the dossier is readable again (branch `claude/split-oversized-files-2`)

Nothing about the module changed. This dossier had reached 1,184 lines and
AGENTS.md has every CRM session read it first, so its length was a fixed cost on
every change to the module.

- Entries older than 2026-08-07 moved to `crm-build-log.md`: 20 entries before,
  5 here and 15 there, none edited. build-docs walks the whole `docs/` tree, so
  the archive renders at `/admin/docs` with no code change
- **New entries still go here**, at the top. Sweep the oldest across when this
  section outgrows a few screens

### 2026-08-08 — Slice 11: a note becomes activities and follow-ups (branch `claude/crm-note-extract`)
- **Paste a note on a record, review what was found, then save.** `NoteExtractor` on the record page; the extractor is `src/modules/crm/ai/extract-note.ts`, following accounting's house pattern (gather+gate in one tx → one injectable network call → Zod at the boundary)
- **THE MODEL NEVER WRITES.** `extractNoteAction` returns a proposal and writes nothing; `saveReviewedNoteAction` takes the reviewed list and re-validates it on its own terms, with no idea which parts came from the model. So a hallucinated follow-up cannot reach the database by any path that skips a human reading it — which matters more since #81, because a task created here routes into its assignee's morning digest
- **Dates come back as a day OFFSET, never a date string.** The model does not know what day it is for this business; the offset resolves against `tenants.timezone` (`0086`) so "by Friday" means the business's Friday. See [timezone.md](timezone.md)
- **An ambiguous assignee stays unassigned and says so.** A first-name hint matches only when exactly one person matches — two Daves means we do not know which, and guessing would put the work on the wrong person's digest while looking authoritative. The unmatched hint is shown to the reviewer rather than swallowed
- **`crm_settings`** (`0093`/`0094`) holds the cooldown, claimed inside the same transaction that checks it so two people pasting at once serialize instead of both spending a call. Member-all RLS, mirroring `accounting_settings`, because the claim has to happen in the caller's own transaction — reasoning in the migration
- **`email` is not an activity kind.** `crm_activity_kind` is note/call/meeting; correspondence lives in Mail and attaches via `mail_links`. The first draft of the tool schema invented a fourth kind and the compiler caught it
- **The extractor is TWO files, and the split is load-bearing.** `ai/note-shape.ts` is pure — schemas, `validateExtraction`, `resolveProposal`, `NOTE_MAX_CHARS` — and `ai/extract-note.ts` is the `server-only` half that gates and calls the model. They started as one file, and the dialog importing `NOTE_MAX_CHARS` from it dragged `server-only` (and the Anthropic SDK) toward the browser bundle: **four Turbopack errors that `tsc` and all 260 tests passed straight through**, because a client/server boundary violation is invisible to both. `npm run build` is the only check that sees it. Anything a client component needs from an AI module goes in the pure half
- 18 pure tests on validation and resolution, 4 isolation tests on `crm_settings`

### 2026-08-08 — Claude Opus 5, with existing behaviour pinned (branch `claude/crm-note-extract`)
- `CLAUDE_MODEL` is now `claude-opus-5`
- **The bump is behaviour-neutral for the five shipped AI features.** On Opus 5 an omitted `thinking` runs ADAPTIVE (on 4.8 it meant none), and `max_tokens` caps thinking plus response together — the interview turn's budget is 1024, so an inherited default could have truncated a forced tool call and taken the public health-check funnel down. Every pre-existing call site now pins `thinking: CLAUDE_THINKING_OFF` explicitly. Three call sites already set adaptive and were left alone
- **Turning adaptive thinking ON for the reasoning-heavy features** (Discovery copilot, close narrative) is a real improvement and deliberately NOT bundled here — it changes output on shipped features and deserves its own evaluation
- **Corrected a stale claim in five files**: "no extended thinking (incompatible with forced tools)". Verified against the live API on Opus 5 — forced `tool_choice` returns a `tool_use` block with thinking both on and off. It was a budget decision, not a compatibility one


### 2026-08-07 — A failing rule says so (branch `claude/crm-rule-health`)
- `crm_automation_rule_health` (`0091`/`0092`): the latest error, a consecutive-failure count, and when. The rules page shows a **failing** badge with the message — distinct from *needs attention*, which means the rule no longer PARSES and is being skipped. This one parses fine; the running is what keeps going wrong
- **A SEPARATE TABLE BECAUSE HEALTH IS AN OBSERVATION, NOT PART OF THE RULE.** `0083` made rule writes owner-only, and the engine runs in the transaction of whoever triggered it — usually staff. Columns on the rules table would have been unwritable exactly when a rule was failing for a staff member, which is the case this exists to catch
- **Members READ it, nobody writes it from tenant context.** Reads follow `0083`'s transparency argument — "that rule has been failing since Tuesday" is part of the answer to *what changed my record?* Writes go through `withSystem` from the engine, so a member cannot forge a failure against a rule they dislike, or clear one that embarrasses them
- **Written only on STATE CHANGE** (healthy→failing, failing→recovered). Rules fire on every record create and update, so a per-run write would put an extra transaction on the hot path of ordinary work forever, to record something only interesting when bad. A working tenant carries no rows and pays nothing
- The stored message is the error's `message`, collapsed and truncated — **never a stack**, which can carry row values through interpolated SQL into a table every member reads (S9)
- Why now: this was cosmetic while rules only nudged records around. Rules create follow-ups, follow-ups route to a daily digest, so a silently broken rule became silently missing obligations

### 2026-08-07 — The two remaining "type a Clerk user id" boxes become pickers (branch `claude/crm-member-pickers`)
- **Collaborator panel**: a picker over non-owner members who do not already have a grant, and the existing list shows names rather than ids. Owners are absent on purpose — they can already see every restricted record, so a grant to one is a control that does nothing
- **Automation rule builder**: both assignees are pickers. `create_task` keeps "Whoever owns the record" first (an empty assignee is meaningful there); `assign_record` has no such option, because that is the thing being set and empty would be a rule that does nothing
- **The rule SENTENCE resolves names too.** `describeRule`/`describeAction` take an optional `NameResolver`, threaded into the renderer rather than substituted into its output — applying it afterwards would be a second renderer, and the preview and the list would eventually disagree. Falls back to the raw id for somebody who has left, because "assign the record to " hides that the rule points at nobody
- Both were blocked on the same thing — "no module-readable member roster" — which stopped being true when `listAssignableMembers` landed a few hours earlier. Neither needed new data
- Six tests on the resolver, all on the fallback behaviour

### 2026-08-07 — Follow-ups get an assignee (branch `claude/crm-task-assignee`)
- The dialog now asks **who is doing it**, defaulting to the person adding it, with "Nobody yet" available for work that genuinely has no owner
- **Backend needed no changes at all** — `assignee_clerk_user_id`, `createTask`, the Zod schema and the digest's per-person scoping all already handled it. The only missing piece was a UI that set the value, which is exactly the kind of gap a dossier open-item hides in plain sight
- Found by taking the app for a spin rather than by reading code: a follow-up added through the dialog landed in the digest's "not assigned to anyone" section, because every follow-up did. See the open item this closes
- `listAssignableMembers` (`src/lib/team.ts`) takes the caller's `tx`, so the picker can only offer people the caller could already see. **Experts are excluded** — the outside accountant is refused by every CRM action, so assigning them work would create an obligation they are barred from discharging

## Data model

| Table | Purpose | Notes (RLS, invariants, FKs) |
| --- | --- | --- |
| `parties` | The shared identity spine — one row per person or organization a tenant deals with | **Written by two modules**, so it lives at `src/lib/parties/` and not inside either. FORCE RLS, `member_all` policy scoped by `app_current_tenant()`: ordinary business data, ordinary tenant scoping. Composite unique `(tenant_id, id)` so every referencing FK can be tenant-aware. `kind` is `person` \| `organization`; `given_name`/`family_name` are NULL for organizations. `display_name` is authoritative, never derived — see Decisions |
| `customers.party_id` | The AR role's link to its party | Nullable → backfilled → `NOT NULL`. Composite FK. `UNIQUE (tenant_id, party_id)`: a party may hold the customer role at most once |
| `vendors.party_id` | The AP role's link to its party | Same shape. A party that is both customer and vendor holds two role rows, which is correct and is not a duplicate |
| `party_contact_points` | How to reach a party — **shared, not CRM's**, and since `0075` the ONLY store for an email or a phone | Tenant-scoped and member-writable like `parties`, NOT visibility-bearing. That was argued from "the same address is also on `customers.email`, where staff read it"; the column is gone and the argument is now stronger rather than weaker — it is one row, rendered on the CRM record page AND on the customers page, so a visibility term here would blank the address on the invoicing screen for every staff member. `normalized_value` is written only by `src/lib/parties/contacts.ts` and is what the duplicate check compares. Partial unique gives one primary per party **per kind**; `(tenant, party, kind, normalized)` unique stops the same address twice; `(tenant, kind, normalized)` indexes the duplicate lookup |
| `crm_automation_rules` | "When this happens, do that" | `trigger` is a COLUMN because the engine's only query is "which rules watch this?"; conditions and the action are jsonb, read once the row is in hand and never queried into. Partial index on `(tenant, trigger) WHERE is_active` — the lookup that runs on every write that could fire one. **Readable by every member, writable by owners**, with the role test in USING as well as WITH CHECK (0067: staff could otherwise DELETE every automation and the business would quietly stop having the ones it thought it had). No `last_run_at`/`run_count`: both would make a busy rule a serialization point, and `audit_log` answers "is it working?" better |
| `crm_reports` | A saved report: a question somebody wanted to keep asking | **Deliberately the same four policies as `crm_saved_views`** — read that row first, and if you change one table change the other or say why. `definition` is one jsonb column validated by `parseDefinition` on every read, rather than four columns with a fifth state where they disagree. Unique on `(tenant, owner, name)`, so two people may each keep their own "My pipeline" |
| `crm_saved_views` | A saved list question: filter, sort, and who else can use it | **Not visibility-bearing, and does not need to be** — a view is the QUESTION and the answer is computed in the reader's own transaction, so two people running one shared view correctly get different rows. That is why `is_shared` is a boolean rather than an access list. Read policy is `is_shared OR owner = app_current_user()`; write is the owner alone, with WITH CHECK carrying the same test so a view cannot be created in somebody else's name or reassigned by updating the owner column. A separate `FOR DELETE … USING` lets a tenant owner remove any view, so a leaver's shared views are not permanent. `filter` jsonb is validated by `parseFilter` on **every read**. No `version` column: one editor, so there is no concurrent-edit problem to solve |
| `crm_view_pins` | Which view a person lands on | Per user in both directions — nobody reads or writes anybody else's. `view_id` is TEXT with **no foreign key** on purpose: it holds either a saved view's uuid or a built-in id like `builtin:mine`, and `resolveView` falls back to the default when it names nothing. That covers a deleted view, a shared view made private, and a built-in a later release retires, with no cleanup job for any of them |
| `crm_record_collaborators` | Named people who may see a `restricted` record | The one table `crm_party_details`' policy reads, which is why **its own policy must never read `crm_party_details`** — see Decisions. Owners see every grant, everybody else only their own, so the table cannot be used to enumerate which records are confidential. Writes are owner-only with the role test in **USING** as well as WITH CHECK (0067's DELETE trap, where it would mean silent revocation). `ON DELETE CASCADE` on the party, which is why the merge tool has to move grants explicitly rather than leave them |
| `crm_party_details` | What CRM knows about a party — 1:1, created when CRM is first asked about the record | FORCE RLS with a **visibility term**: `visibility = 'members' OR app_current_tenant_role() = 'owner' OR a collaborator grant to `app_current_user()`, in USING **and** WITH CHECK. `owner_clerk_user_id` is an attribution and grants nothing — see Decisions. `custom` jsonb is the slice 2 extension bag (P2), `lifecycle_stage`/`source` are open taxonomies (P1) with no CHECK. Composite FK to `parties`, ON DELETE CASCADE. Unique on `(tenant, party)` is what makes "the CRM record for this party" a lookup |
| `crm_affiliations` | A person's connection to an organization, current or former | **Inherits visibility** through a positive `EXISTS` against `crm_party_details` at both ends — no second copy of the flag, so no drift. The positive spelling is load-bearing; see Decisions. Two partial uniques: one current connection per pair, one primary per person. CHECK that the two ends differ |
| `crm_pipelines` / `crm_pipeline_stages` | The steps a deal moves through | **Configuration**: member-read + owner-write, same two-policy split as `crm_field_defs`. One default per tenant enforced by a partial unique. `outcome` (`open`/`won`/`lost`) is where terminal semantics live — there is no status column on the deal |
| `crm_deals` | One piece of work in front of a record | **Inherits the party's visibility** through a positive `EXISTS` against `crm_party_details`. `amount_cents` is NULLABLE on purpose — "not priced yet" and "worth nothing" are different facts and a forecast must not conflate them. `closed_at` denormalized from the history; `custom` holds slice 2's `entity_type = 'deal'` fields |
| `crm_deal_stage_events` | Append-only stage history | **Inherits through the deal** — a two-link chain. Member-writable because the same action that moves a deal records the move; nothing UPDATEs or DELETEs these rows, which is a code property in the same standing as `audit_log` being append-only by convention. No `version` column |
| `crm_deal_parties` | Additional stakeholders beyond the primary contact | Inherits through the deal. Unique on `(tenant, deal, party)` |
| `crm_activities` | What was said — a note, a call, a meeting | Inherits the party's visibility positively, like deals. `occurred_at` is separate from `created_at` so writing up Friday's visit on Monday reads as Friday. No `email` kind: Mail already holds those and two records of one conversation disagree the moment either is edited. **Deletable**, unlike everything else here — see Decisions |
| `crm_tasks` | A follow-up | **The policy BRANCHES**: `party_id IS NULL` is plain tenant-scoped, otherwise it inherits. Completion is a timestamp pair guarded by a CHECK — `completed_at` and `completed_by` are one fact and a row with half of it is uninterpretable. `due_on` is a DATE; follow-ups are due on a day |
| `crm_field_defs` | Per-tenant custom field definitions | **Read/write split, not a visibility term**: a `FOR SELECT` member-read policy plus a `FOR ALL` owner-write policy. Two policies because **WITH CHECK is not consulted for DELETE** — a single `FOR ALL` with a permissive USING would let staff delete every definition in the tenant. `entity_type` is an open taxonomy (P1) so slice 3's deals need no migration. Key format enforced by CHECK; the `(tenant, entity_type, key)` unique is **partial on `archived_at is null`**, so archiving frees the name |

Migrations: `0059` (tables/columns), `0060_parties_rls.sql` (custom: policies),
`0061_parties_compat.sql` (custom: the compatibility triggers),
`0062_parties_contract.sql` (custom: NOT NULL, uniques, triggers dropped).
Contact points: `0072` (table), `0073_party_contacts_rls.sql` (policies),
`0074_party_contacts_backfill.sql` (values copied off the accounting columns),
`0075_accounting_contacts_contract.sql` (catch-up backfill, verification, then
the columns dropped — **apply this one after the deploy**).
Slice 10: `0082` (the rules table) and `0083_crm_automation_rls.sql` (policies), additive.
Saved reports: `0080` (the table) and `0081_crm_reports_rls.sql` (policies), additive.
Slice 8: `0078` (saved views and pins) and `0079_crm_saved_views_rls.sql` (their policies) — both ordinary additive migrations that go ahead of the deploy.
Slice 6: `0076` (the collaborators table) and `0077_crm_collaborators_rls.sql` (its policies, plus the one change to the details policy that makes a grant mean anything). Slice 7 added **no migration**: merging is code over the tables that already
exist. A `crm_party_merges` table was considered and refused — `audit_log`
already records the event, and a second store for the same fact is the drift
this dossier keeps warning about.

## Key files & seams

- `src/lib/parties/` — the platform subsystem. `create`, `update`, `load`,
  version enforcement, and the normalization rules. Takes the caller's `tx`;
  never opens its own scope and never `withSystem`. **Deliberately has no
  `requireModuleEnabled` call** — it serves tenants who bought Accounting and
  not CRM. `names.ts` is pure and free of `server-only`, so the normalization
  rules are tested without a database (`tests/parties.test.ts`).
- `src/lib/parties/role-sync.ts` — the "both names exist" bridge while
  `customers.name` and `parties.display_name` are both stored. Temporary by
  design; the header says what has to move before it goes.
- `src/modules/crm/core/automation.ts` — pure. Triggers, actions and the
  validator. Its header carries the "runs as the triggering person" argument.
- `src/modules/crm/automation-ops.ts` — the engine. **Read the savepoint note
  before touching it**: it executes inside somebody else's transaction.
- `src/modules/crm/core/reports.ts` — pure. The five report types, each a
  declared join shape, plus the summariser and the built-in reports. Read it
  before adding a sixth type: the other half is `report-ops.ts`.
- `src/modules/crm/report-ops.ts` — one hand-written base query per type. Every
  identifier in its SQL is a literal in that file; keys are looked up in
  whitelists and values are bound.
- `src/modules/crm/core/views.ts` — pure. The field registry IS the whitelist
  that keeps a column name out of user input, plus the operator vocabulary, the
  relative-date rules, the URL codec and the built-in views. Read it before
  touching `crm_saved_views.filter`.
- `src/modules/crm/view-ops.ts` — the compiler, the view store and the pins.
  Every value it puts in a predicate is bound; nothing here builds SQL text.
- `src/modules/crm/components/view-controls.tsx` — the picker and filter panel.
  Filters go into the URL, so a filtered list is a link.
- `src/modules/crm/core/merge.ts` — pure, and the whole integrity of a merge.
  `buildMergePlan` is the single description both the preview and the executor
  use. Read its header before changing any rule in it; every one of them is a
  judgement about data nobody can get back.
- `src/modules/crm/merge-ops.ts` — the candidates query and `applyMerge`. **Step
  order is load-bearing** and the header says which constraint each step is
  avoiding. The only place in CRM that writes accounting's tables.
- `src/modules/crm/merge-actions.ts` — owner-only, all three actions including
  the listing.
- `src/lib/parties/contacts.ts` — contact points, and `normalized_value` is
  written nowhere else. **`setPreferredContactValue` is the write path behind
  every single-field contact box**, in Accounting today and anywhere else that
  shows one address per kind; its header carries the four cases and the reason
  clearing deletes. `preferredContact` / `preferredContactValue` live in the
  pure `contact-values.ts` because a CSV builder and two pages read them and
  must stay free of `server-only`.
- `src/modules/accounting/invoicing/customers.ts` and `payables/vendors.ts` —
  create paths route through the service so a role row and its party are born in
  one transaction; a rename carries onto the party, and the form's email and
  phone go straight to `party_contact_points` because there is no longer a
  column to put them in. Note the deliberate asymmetry: `updateCustomer` takes a
  PATCH so `undefined` means "not edited", `updateVendor` takes a whole record
  so `undefined` means "the box was empty".
- `src/modules/crm/party-ops.ts` — CRM's operations. Never writes `parties`
  itself; identity goes through the shared service and CRM's own tables are
  written here.
- `src/modules/crm/actions.ts` — every `withTenant` passes `{ role: ctx.role }`
  without exception, because `crm_party_details` is visibility-bearing.
- `src/modules/crm/CrmModule.tsx` — the records list, and it IS the module home
  rather than an overview linking to one.
- Routes: `/dashboard/m/crm`, `/dashboard/m/crm/records/new`,
  `/dashboard/m/crm/records/[partyId]`.

## Decisions & gotchas

**The spine is shared, not CRM-owned, and the constraint that forced it is
entitlement.** A tenant can buy Accounting without CRM, so accounting can never
FK into a `crm_*` table — but two customer lists is the failure this module
exists to prevent. `documents` already solved this shape once: one table, two
surfaces, `origin` discriminating. `parties` is the same answer, and it lives in
`src/lib/` for the reason `eslint.config.mjs` states — genuinely shared code
moves there rather than being imported across a module boundary.

**`customers` and `vendors` become role records, and no existing foreign key
moved.** `invoices.customer_id` and `bills.vendor_id` still point exactly where
they pointed. The alternative — promoting `customers` into a universal entity —
would have relocated live AR foreign keys for no gain the role model does not
already give.

**`parties` carries NO contact information, and that absence is the design.** A
company has several offices, billing addresses and numbers; a person has a work
address and a personal one. A single `parties.email` would be canonical within a
week of shipping and would then have to be unpicked from every read site.
**Do not add an email column here as a convenience** — `party_contact_points`
is the answer, and it arrived on 2026-08-04. The unpicking that was predicted
then happened for real one slice later, on `customers.email`, and cost five
files: it is a description of work somebody has now done, not a hypothetical.

**CONTACT VALUES ARE STORED TWICE, AS TYPED AND AS MATCHABLE.**
`Bob@Example.COM ` and `bob@example.com` are one address; `(555) 123-4567` and
`+1 555 123 4567` are one phone. The person sees what they typed and the machine
compares something that can actually be compared. `normalizeContactValue` is the
only place that computes the matchable form — normalizing at each call site
would be the same class of mistake as formatting money in two places, and the
symptom is not an error but the duplicate check quietly finding nothing. The
backfill migration (0074) mirrors those rules in SQL with the correspondence
written out line by line; **if you change one, change the other in the same
commit.**

**THE ACCOUNTING CONTACT SYNC WAS ADDITIVE, AND `0075` DELIBERATELY REVERSED
THAT.** Read both halves before changing either, because each is right about its
own world and neither generalizes.

While `customers.email` and the contact point both existed, the accounting field
was a MIRROR of a different store. A mirror cannot tell "the invoice should go
elsewhere" from "we no longer have this address", so clearing it removed
nothing — otherwise an invoicing edit would silently delete the mobile a
colleague added in CRM last week. A name behaved the opposite way in the same
file, and correctly: a name is one fact with an authoritative copy, so a rename
overwrites.

The column is now gone, and the box IS the contact point — it renders
`preferredContact` and writes back to that row. Direct manipulation is not
mirroring, so every edit means what it appears to mean: a corrected address
edits the row in place rather than adding a second, and an emptied box deletes
the address it was showing and nothing else (a colleague's second email is a
different row, survives, and inherits primary). Keeping the additive rule here
would have turned a safeguard into a form that silently discards what somebody
typed, which is a bug users report rather than one they are protected by. There
are tests for all four cases in `tests/invoicing.test.ts`.

**THE COMPOSER NEVER OFFERED THE ADDRESS TWICE, and the previous entry here was
wrong.** Both Accounting's contact source and CRM's arrive with
`origin: "records"`, and `rankContacts` deduplicates by lowercased address
before anything reaches the screen — so the overlap was always one row. What it
actually decided was the SUBLABEL, and by registry order rather than by which
query finished first: `mailExtensions` lists accounting before crm, so a
business address reads "Customer" rather than "Company", which is the more
useful of the two true answers. Both sources are kept — deleting accounting's
would leave a tenant who never bought CRM with no suggestions at all, because an
extension whose module is off contributes nothing. Pinned in
`tests/mail-contacts.test.ts` so the claim cannot rot again.

**AN AUTOMATION RUNS AS THE PERSON WHO TRIGGERED IT, AND THAT IS WHY IT HAS NO
PERMISSION MODEL.** Mail's auto-filing is the other shape and the comparison is
what settled this one: that rides a cron, because the thing it reacts to happens
in somebody else's system, and a cron has no Clerk session — so it runs as
`staff` and can never reach an owners-only folder. CRM's triggers are our own
writes, with a real person, a real role and an open transaction at the moment
each fires, so the rule simply borrows them. **A staff member's edit cannot
cause a rule to touch a restricted record**, because the transaction is theirs
and RLS removed the row before the engine saw it. There is a test asserting
exactly that. Nothing in `automation-ops.ts` re-implements a permission check,
because there is nothing left to check.

**A SAVEPOINT PER RULE, AND IT IS NOT OPTIONAL.** The engine runs inside the
transaction that triggered it, so a failing action would take the person's own
work with it — and **catching the exception in TypeScript is not enough**, because
Postgres aborts the whole transaction on any error and the caller's commit then
fails with "current transaction is aborted". `SAVEPOINT` / `ROLLBACK TO
SAVEPOINT` is the only construct that lets one statement fail without poisoning
the rest. Tested by breaking a rule on purpose and then writing in the same
transaction.

**ONE HOP, NEVER A CASCADE.** An action does not re-trigger rules, so a rule
that creates a follow-up cannot wake a rule that watches follow-ups. That is
enforced by where the calls are — the actions write tables directly rather than
through `createTask` — and not by a depth counter. Two reasons for writing the
tables directly, and the second would bite immediately: the ops functions
contain the trigger calls, and routing through them would also make
`automation-ops` import `timeline-ops` import `party-ops` import
`automation-ops`. If a future action ever must go through a triggering path, a
depth counter is the thing to add first. Cascades are what make an automation
engine fun to demonstrate and impossible to debug.

**`parseRule` RETURNS NULL RATHER THAN A DEGRADED RULE**, which is deliberately
the opposite of `parseFilter` and `parseDefinition`. A dropped filter condition
widens a LIST, and somebody sees it. A dropped condition on a RULE widens what
it does to their data, silently and every time it fires. So a rule that no
longer entirely makes sense stops running and is shown as needing attention,
rather than running on a subset of its own instructions.

**NOTHING SENDS ANYTHING.** No email, no notification, no webhook — not an
oversight but the only defensible position while the module has no notification
machinery at all. An automation that quietly emailed a customer is the most
damaging thing a half-built rules engine could do. When notifications exist,
"notify somebody" becomes a fourth action and this paragraph comes out.

**Rules are readable by every member and writable only by owners**, which is
wider on the read side than the merge tool or the collaborator grants. A rule
changes other people's data, so somebody who finds a follow-up they did not
create is owed the ability to discover which rule made it — a rules engine
nobody can inspect is indistinguishable from a haunted database. The rows carry
no data about anybody; a rule is an instruction, not a record.

**A REPORT TYPE IS A JOIN WHITELIST, AND THAT IS THE WHOLE OF SLICE 9'S
DESIGN.** A report does not choose a table and join outward; it chooses one of
five declared shapes, each of which is a hand-written base query in
`report-ops.ts`. The two whitelists now stack:

    core/views.ts    decides which COLUMNS a filter may name.
    core/reports.ts  decides which JOINS a report may reach across.

Neither lets an identifier arrive from outside the codebase — a type a browser
sent but `REPORT_TYPES` does not declare has no base query, so it cannot run at
all. **Adding a sixth type is a code change in two places**, and a test fails if
only one of them happens. The alternative was a generic join planner over this
schema, which is a database console with a nicer skin: it would hand every
tenant the ability to write a query nobody can index for, and it would make RLS
the only thing standing between a curious user and a cartesian product.

**AGGREGATION HAPPENS IN POSTGRES, NEVER IN TYPESCRIPT.** `core/reports.ts`
orders and totals what the database already grouped; it never sums rows.
Summing in the application means fetching every row to count it, which is the
mistake that makes a reporting feature collapse on the first tenant with real
data — and it would do so silently, because it works perfectly on the tenant a
developer tests with.

**A REPORT IS A QUESTION ABOUT THE ROWS YOU MAY SEE, and the totals differ per
reader on purpose.** Reports run in the caller's transaction, so a staff
member's pipeline report omits deals on restricted records. There is a test
asserting exactly that over one definition. This is the same property that makes
a shared saved view safe, and it is why neither feature needed an access model
of its own.

**Nulls are kept and labelled "Not set".** "12 records with no stage" is usually
the most actionable line in a report, and dropping it would make the groups
silently fail to add up to the total printed above them. A summary that does not
add up is worse than no summary, because it gets believed.

**One grouping level, and one chart type.** Salesforce allows three groupings;
almost every question a small business asks needs one, and each extra level
multiplies the rendering, the chart's meaning and the empty-group cases. A donut
chart was drafted and removed: it had no renderer, and an enum value nothing can
draw is a definition somebody saves and then finds broken.

**THE FILTER COMPILER'S SAFETY IS TWO PROPERTIES, AND NEITHER IS OPTIONAL.** A
filter is jsonb a browser once sent that ends up in a WHERE clause. First, **the
column comes from the registry in `core/views.ts`, never from the input** — a
condition names a field key, an unknown key has no column, and the condition is
dropped, so a column name cannot arrive from outside the codebase. Second,
**every value is bound as a parameter**; the one place that builds a LIKE
pattern escapes the wildcards first, and there is a test filtering on a literal
`%` that asserts it matches nothing rather than everything. If either property
is ever weakened, the whitelist stops being a whitelist.

**A DROPPED CONDITION WIDENS, NEVER NARROWS — and that is only safe because the
filter is not the security boundary.** `parseFilter` and `decodeConditions` both
discard anything they cannot validate, so a view saved when a field existed
still loads once the field is gone. For a *visibility* rule the safe direction
would be the opposite, and the reason it is safe here is one sentence: RLS has
already removed the rows the caller may not see before any filter applies. A
filter is a convenience over rows already permitted. **If a condition is ever
made to narrow the permitted set rather than the displayed set, this rule has to
be revisited first.**

**Negative operators keep the unknowns.** `<>` is NULL for a NULL column, so a
plain `ne` would drop every record CRM has never been asked about from "stage is
not lead" — silently, and it reads as data loss rather than as a filter. Spelled
`ne(...) OR IS NULL`, with a test. The mirror of this is inherent and stays:
filtering on a details column *positively* excludes unworked records, because a
LEFT JOIN gives them no value to compare.

**Relative dates are INSTANTS, not calendar days**, which departs from the
follow-ups page deliberately. `crm_tasks.due_on` is a DATE and "is this overdue"
is a question about the user's timezone, which is why that page compares
yyyy-mm-dd strings. `created_at` is a timestamptz, and "added in the last 7
days" is 7×24 hours with no timezone in it, so none is invented. A view whose
dates froze at save time would make every built-in stale the day after it
shipped.

**Built-in views are code, not seeded rows.** Seeding means a migration every
time a default is added or its wording improved, a backfill for tenants that
already exist, and an awkward question the first time somebody edits one. As
code they are identical for everybody and improve for everybody at once. The
cost is that a tenant cannot delete one, which is fair for four views that are
each one obvious question — and a saved view can be pinned over the top.

**WHAT THE SALESFORCE AFTERNOON WAS ACTUALLY WORTH.** The mechanics taken:
explore-then-name (filters apply immediately, saving is a later decision), a
pre-seeded set so the feature is not an empty box, a per-user pin, a plain
sentence stating the list's own state, a closed nine-operator vocabulary, and
AND-by-default. The mechanics deliberately declined: filtering across related
objects, which implies a join planner; inline table editing, against
visibility-bearing fields; a console tab strip, against
[conventions §8](../conventions.md)'s one-handed-in-the-field rule; and charts
on a list, which is slice 9. **The one idea worth more than the rest is that a
view and its RENDERING are orthogonal** — Salesforce draws one saved view as a
table, a kanban or a split view. Our board and our records list are still
separate pages, and unifying them is the shape slice 9 should consider rather
than a thing slice 8 half-did.

**SLICE 6 SPENT 0064'S PROMISE THAT `crm_party_details`' POLICY READS NO OTHER
TABLE, AND IT CANNOT BE SPENT TWICE.** The details policy now reads
`crm_record_collaborators`, which is safe in exactly one direction: **the
collaborators policy must never read `crm_party_details`**. Postgres evaluates
policies inside policy subqueries, so two tables naming each other recurse —
`infinite recursion detected in policy for relation`, on the first SELECT, taking
the whole module down. Loud, but total. The collaborators policy is therefore
self-contained: `app_current_tenant()`, `app_current_tenant_role()`,
`app_current_user()`, nothing else. If a later slice wants grant rows to inherit
record visibility properly, the answer is a SECURITY DEFINER helper, not an
EXISTS. Verified against the dev branch as `app_user`: all six CRM tables query
cleanly.

**A GRANT IS NOT AN ASSIGNMENT, still.** `owner_clerk_user_id` plays no part in
visibility, exactly as 0064 insisted — slice 6 added the middle ground without
touching that separation. Making assignment imply access would have been the
cheaper feature and it is the wrong one: a rep's name lands on a record for a
dozen reasons and none of them is a decision about confidentiality.

**EVERY CRM TRANSACTION NOW PASSES `userId` AS WELL AS `role`.** The details
policy consults `app_current_user()`, which returns NULL when unset — so
`clerk_user_id = NULL` is NULL and a forgetful call site does not leak a
confidential record, it silently denies a collaborator the record they were
granted. Fail-closed, and invisible to anybody debugging "why can't Aoife see
this?". Fourteen files were changed to add it; a scripted rewrite mangled four
of them first, and the failed attempt is what surfaced two call sites the file
list had missed. **Read the diff, never the match count.**

**Grant reads are narrow, and that is an anti-probe property rather than
politeness.** Owners see every grant; everybody else sees only their own. A staff
member who could list grants could ask "which records have collaborators?" and
get back precisely the set of confidential records — the question `restricted`
exists to refuse, and the same probe the mail template values are designed
against.

**A MERGE RE-POINTS POSTED INVOICES, AND THE LEDGER IS UNTOUCHED BY IT.** When
both records hold the same role, `invoices.customer_id`, `bills.vendor_id` and
**both** party columns of `recurring_entries` move onto the surviving role row
and the emptied one is deleted. That is CRM writing accounting's
tables, decided by the founder on 2026-08-04 over the alternative of a merge
tool that cannot fix the commonest duplicate there is — the one 0062's backfill
guaranteed exists in every tenant. Two facts make it defensible and both are
worth checking before anybody widens it: `journal_entries` carries **no**
customer or vendor reference, so double-entry balances and every posted total
are untouched and only the AR/AP sub-ledger's attribution consolidates onto the
same business; and `document_links` reaches documents through `invoice_id` /
`bill_id`, whose rows survive with their ids intact, so nothing filed comes
loose. The preview counts invoices **only when the role is genuinely absorbed** —
a role only the loser holds is re-pointed whole and moves no posted record, and
saying "42 invoices will move" about an operation that moves none is how a
confirmation screen stops meaning anything.

**THE PLAN IS THE PRODUCT.** `buildMergePlan` returns a complete description of
the merge; the preview renders that plan and the executor re-derives and applies
the same one. There is deliberately no second code path computing "what would
happen", because the screen asking somebody to commit an irreversible operation
must not be able to describe a different operation from the one that runs. The
executor recomputes rather than accepting the plan from the caller — a record
edited between reading and confirming merges as it IS, and a plan cannot arrive
from a browser naming two records nobody chose.

**The survivor wins every contested field, with two exceptions that are the
interesting part.** Somebody chose which record survives while looking at both,
so silently preferring the other one's lifecycle stage would make that choice
mean less than it appears to. But **notes are appended, never contested** — two
people's prose about the same business are both true, and discarding one is the
most irreversible thing a merge could do — and **the more restrictive visibility
wins**, because merging must never become a way to widen who can see a record.

**`mergeCustomBags` is deliberately not `mergeCustomValues`.** The latter is the
FORM-SAVE path: it walks the live definitions and deletes any key the payload
omitted, which is exactly how archiving a field keeps its stored values. Fed two
records it would delete every field the loser answered and the survivor did not.
The merge helper consults no definitions at all, so an archived field's values
survive a merge as well; `false` and `0` are answers rather than blanks.

**Step order in `applyMerge` is load-bearing.** Contact points are
de-duplicated and demoted while they still belong to the loser, so the
one-primary-per-kind partial unique never sees two. Affiliations lose their
self-references BEFORE the ends are re-pointed, or the ends-differ CHECK fires
on a row that was about to be deleted. Both affiliation uniques are **partial on
`ended_on is null`**, so a former connection contends with nothing — "they
worked there, left, and came back" stays two rows rather than being discarded as
a duplicate. The details row goes last of the CRM tables because its unique on
(tenant, party) is the one a half-finished merge would trip.

**The losing party is HARD deleted, last, and that is a safety property.**
Everything referencing it has been re-pointed by then, so if `merge-ops.ts` ever
misses a table the DELETE fails on a foreign key and the whole transaction rolls
back — loudly, with nothing lost. A soft delete would leave a ghost in the
records list and quietly hide the missed reference. This is the one place CRM
deletes rather than archives apart from activities, and the reason is the same:
a merged-away duplicate that stayed visible would defeat the merge.

**Merging is owner-only INCLUDING the listing**, which is stricter than the
fields page next door. Fields are readable by everyone because knowing what a
field means helps a staff member fill a record in. The duplicates page is a list
of one job, and that job deletes an identity and moves posted invoices — showing
it to somebody who cannot finish it would be a page of buttons that refuse.

**Name matching folds case and whitespace and NOTHING else.** No stripping of
"Ltd", "Inc" or "LLC": those are different legal entities, and a matcher that
fused them would propose merging two real companies' books. A miss costs a
search; a false pair costs a business its records. The SQL fold in
`findMergeCandidates` and `matchableName` in TypeScript must agree, the same
arrangement `contact-values.ts` has with the 0074 backfill — there is a test
pinning them together.

**The duplicate check warns and never blocks.** Two people at one company
genuinely share `info@`, and a product that refuses the second record teaches
its users to add a full stop to get past it. Same line the merge tool and the AI
slices sit on: the machine suggests, a person commits.

**`display_name` is authoritative, not derived.** Deriving it from
`given_name`/`family_name` means a fight the first time somebody wants
"Bob Smith Plumbing" rather than "Robert Smith". The structured names exist
alongside it because a mail template saying "Dear Aoife" needs a real first
name, and it needs one with CRM switched off — which is why they are on the
shared spine rather than in CRM's own table.

**The backfill creates one party per role row and matches nothing.** A customer
named "Probe Construction" and a vendor named "Probe Construction" are left as
two parties. Fusing them on a name match would silently merge two real
businesses inside a live tenant's books, with the evidence gone by the time
anybody noticed. Slice 7's merge tool proposes candidates to a human on stronger
evidence than a string compare.

**The compatibility triggers are what make the migration converge.** Between
adding `party_id` and enforcing it, the deployed code is still inserting
customers with no party — this repo migrates a live database *ahead* of the
deploy (the 0023/0025 outage lesson in `documents.md`), so a backfill alone
never reaches a stable finish line. A trigger covers the running code with no
deploy at all, and drops in the contract migration. Triggers as structural
backstops are precedented here: the deferrable balanced-entry trigger and the
append-only `audit_log` trigger.

**Tenant-aware composite FKs everywhere**, as every relation in this schema
already does — `(tenant_id, party_id)` referencing `(tenant_id, id)`, so a
cross-tenant reference is structurally impossible rather than merely refused by
a predicate somebody has to remember.

**The single door is review-enforced, not lint-enforced.** `@/db/schema` is
deliberately unrestricted by the module-isolation zones, because tables are the
platform's. So nothing mechanically stops a module writing `parties` directly;
`src/lib/parties/` is the only supported writer by convention, the same way
`setDocumentTags` is "the single door" onto `documents.tags`. If that convention
starts slipping, the fix is a lint rule, not a comment.

**Never call an organization an "Account."** `accounts` is the chart of
accounts. That collision would be permanent and unfixable by rename.

**"Owner" means two things, and they are kept structurally apart.**
`crm_party_details.owner_clerk_user_id` is the person a record is ASSIGNED to —
an attribution that grants nothing. `app.tenant_role = 'owner'` is the
business's owner, and it is the only thing visibility consults. A rep does not
see a restricted record because their name is on it, and a colleague does not
lose an ordinary one because it is not. The visibility enum is spelled
`restricted` rather than Documents' `owners` for exactly this reason: a value
called `owners` would read as "the rep who owns it". One inconsistent word is
cheaper than the collision.

**Affiliation visibility must be inherited POSITIVELY, and the negative
spelling fails open.** The obvious policy is "hide this row if either endpoint
is restricted" — `NOT EXISTS (… WHERE visibility = 'restricted')`. That is
backwards, because **RLS applies inside policy subqueries**: a staff member
cannot see the restricted row, so the inner query finds nothing, so `NOT EXISTS`
is true, so the connection is shown to precisely the person it was hidden from.
Stated positively — visible only if BOTH endpoints resolve to a
`crm_party_details` row the caller can see — the same mechanism works for us,
and the policy never mentions `restricted` at all. Same trick
`document_versions` uses. There is a test for both directions.

**`restricted` hides what CRM knows, not that the business deals with
somebody.** The party stays visible to staff, because the identity is shared
with Accounting where the same person can already see it as a customer. Hiding
it outright would mean a visibility term on `parties`, which would hide
customers from accounting staff. The record page says this in words rather than
leaving a blank panel.

**A restricted record and a never-worked one look identical to staff**, on
purpose — `details` is null in both cases. Distinguishing them would turn the
list into a way to discover which records are restricted, which is the same
probe the mail template values are designed to refuse.

**Custom field values are keyed by definition ID, not by `key`.** This is
deliberately the OPPOSITE choice from `document_tags`, where the slug is
immutable and `documents.tags` stores slugs — and the difference is who types
the string. A tag is a label somebody picks from a list; a custom field key is
closer to a column name, invented once under time pressure and regretted later.
Keying by id means correcting a typo rewrites one definition row instead of
every record that ever held the field. The cost is that `custom` is unreadable
without joining to `crm_field_defs`, which is a fair price for a rename that
cannot lose data.

**`WITH CHECK` IS NOT CONSULTED FOR `DELETE`.** The tempting shape for an
owner-writable table is one `FOR ALL` policy with a permissive `USING` and a
role test only in `WITH CHECK`. That leaves a silent hole: staff could delete
every row while being unable to create one. `crm_field_defs` therefore splits
into a `FOR SELECT` read policy and a `FOR ALL` write policy whose **USING**
clause carries the role test. There is a test that deletes as staff and asserts
zero rows.

**Required means required to CHANGE STAGE, not to save.** A half-known record is
the normal state the moment somebody first types a name, and a form that refuses
it just moves the record into a spreadsheet. The check runs when
`lifecycle_stage` actually changes — compared against the stored value, never
asserted by the caller — which is the point at which the business commits to
something. Imports and quick captures stay usable.

**Archiving a field is not deleting it, and the write path is what makes that
true.** Stored values are keyed by definition id, so a hard delete would turn
every one of them into a number nobody can interpret. Archived definitions are
excluded from `listFieldDefs`, which means `sanitizeCustomValues` treats their
values as unknown and drops them from the *validated payload* — so
`mergeCustomValues` folds the payload onto what is stored rather than replacing
it. A straight replace would silently delete a retired field's values on the
next unrelated save, which is exactly what archiving was meant to prevent.

**`moveDealStage` is the only path that may change `stage_id`**, because it is
the only one that writes a `crm_deal_stage_events` row. A stray
`update(crmDeals).set({ stageId })` anywhere else would move the card and lose
the fact that it moved — and unlike almost every other bug in this module, that
one cannot be repaired afterwards. `updateDeal` deliberately does not accept a
stage.

**A DRIZZLE MIGRATION THAT CREATES A PARENT AND CHILD TOGETHER NEEDS ITS
STATEMENT ORDER HAND-EDITED.** drizzle-kit emits every `ADD CONSTRAINT` before
every `CREATE INDEX`. That is fine whenever a composite FK points at a table
from an earlier migration — every CRM migration before 0068 got away with it —
but `crm_deal_parties` references `crm_deals (tenant_id, id)` whose backing
unique index was still forty lines below, and Postgres refused with `42830,
there is no unique constraint matching given keys`. 0068 hoists the three
`(tenant_id, id)` uniques above the foreign keys. **Expect to do this again.**
The failure is loud rather than subtle, and drizzle wraps each file in a
transaction, so the database rolled back cleanly.

**A SERVER COMPONENT MAY IMPORT COMPONENTS FROM A `"use client"` MODULE, NEVER
PLAIN VALUES.** `centsToInput` started in `components/deal-form.tsx` and was
called from the deal page. Every export of a client module becomes a client
*reference*, so the call threw at render and production withheld the message —
while `npm run build`, `tsc` and `eslint` all stayed green, because the import
is legal and only the call is not. It reached production and took the deal page
down; nothing but opening the page could have caught it. `centsToInput` and
`EMPTY_RECORD` now live in `core/`, and the rule is in
[conventions.md §8](../conventions.md).

**THE MAIL PICKER OFFERS A RESTRICTED RECORD'S NAME BUT NOT ITS DEALS**, and
the asymmetry is deliberate rather than an oversight — pin it before "fixing"
either half. `contact` and `company` read `parties` directly, so a restricted
record's name appears exactly as it does in the records list; the identity is
shared with Accounting where the same staff member already sees it. `deal`
reads `crm_deals`, which inherits the record's visibility, so a restricted
account's deals are absent — and no predicate in the extension says so. It falls
out of using the caller's transaction, which is invariant S12 working as
designed. There is a test for both halves.

**An unattached task's `IS NULL` branch is not a hole**, and a reviewer's first
instinct is that it should be. `crm_tasks.party_id` is nullable because "ring
the accountant back" is a real task belonging to nobody in the CRM, and a
product that refuses to hold it sends that task to a sticky note. An unattached
task names no record, so there is no restricted thing to leak; its title is the
author's own words about their own work. The moment somebody attaches it, the
inheritance branch takes over — including on UPDATE, because WITH CHECK carries
the same test, so staff cannot attach a task to a record they cannot see.

**Tasks are deliberately NOT scoped to their assignee.** A follow-up is the
business's work, not private correspondence, and whoever covers for somebody on
holiday has to see what is outstanding. `app.clerk_user_id` exists and six mail
tables use it; its absence here is a decision.

**Activity is the one deletable thing in this module.** Everything else
archives. An activity is the only table holding unstructured prose about
another person — "rude on the phone, would not budge" is a note whose author may
reasonably want it gone, and leaving it readable while pretending otherwise
would be worse. Nothing references an activity, so removing one dangles nothing.

**Calendar-day comparisons are done on yyyy-mm-dd STRINGS, never Dates.**
"Is this overdue" is a question about days in the user's timezone; comparing a
`date` column against a server `Date` is wrong by up to a day for anybody not on
UTC, which surfaces as the product nagging about something due tomorrow. The
per-row badge is computed in the BROWSER; the Follow-ups page groups on the
server's today and says so — properly fixing that needs a tenant timezone in a
shared setting, because `accounting_settings` holds one and CRM may not read it.

**The board moves deals with a MENU, not drag and drop.** conventions §8 says a
real share of usage is one-handed, in the field, on a phone, and dragging a card
between columns that do not fit the screen is the one board interaction with no
good touch story. A menu also names every destination.

**A field's TYPE cannot be changed after creation.** Flipping `text` to `number`
would leave every stored value in a shape the new type rejects, so saves would
start failing on records nobody had touched. Archive and re-add instead: the old
values stay readable and the discontinuity is visible.

## Open items

- **Paging drops every filter condition but the first.** `pageHref` in
  `CrmModule.tsx` collapses the repeated `f` params, so `Next` on a
  two-condition filter silently asks a different question.
- **Nothing sorts the records list.** `ViewSort`, `SORT_FIELDS` and
  `compileSort` all work and nothing renders them.
- **A deal cannot be deleted, owned, or talked about.** No delete path
  exists, no form sets `owner_clerk_user_id`, `Also involved` is
  read-only, and the deal page has no timeline although
  `loadDealTimeline` is built.
- **A logged activity cannot be edited and a follow-up cannot be deleted**
  from any screen: `updateActivityAction`, `deleteTaskAction` and
  `updateTaskAction` have no callers.
- **Only party custom fields can be created**, so the deal form's own
  `listFieldDefs(tx, tenantId, "deal")` can never return anything, while
  the Fields page says `This appears on every record in the CRM.`
- ~~**The outside accountant is refused only on submit** across the module,
  and `/dashboard/m/crm/records/new` has no role check at all.~~ — **fixed
  2026-09-04**; see the build log.
- **`src/lib/work/actions.ts` APPLIES NO ROLE RULE, and it is a Layer 0 seam.**
  `setEntityWorkDoneAction`, `setEntityWorkAssigneeAction` and
  `setEntityWorkDueAction` check the module is enabled and nothing else, so any
  role that can see a `WorkItemRow` can work it — a CRM follow-up included, where
  every other write is refused for `expert`. CRM's screens hide the row from an
  accountant now, which makes them stricter than their server; that is a
  deliberate holding position, not the fix. **The fix needs a decision the file's
  own header points at**: it says the guard is the OWNING FEATURE, and the owning
  features disagree about this role — CRM, Documents, Scheduling and Work all
  refuse `expert`, while a capability pack admits one at `member` level
  (`src/lib/packs/authorize.ts`, settled 2026-09-03). So the seam needs to ask the
  owning feature for its rule rather than pick one, which is a registry keyed on
  `extensionSlug` and wants its own slice. The same shape as the photo gate found
  on 2026-09-04 — see [documents.md](documents.md).

- **`party_addresses` is still deferred, and now deliberately rather than by
  omission.** Contact points landed because two features needed them; nothing
  reads a postal address that `customers.address` does not already serve, and
  adding a table with no reader is the speculative build this codebase avoids.
  The shape is the same as contact points when it is wanted.
- ~~**`0075` IS NOT APPLIED TO PRODUCTION YET**~~ — **stale; it is applied.**
  Verified 2026-08-07 against production: zero `email`/`phone` columns remain on
  `customers` or `vendors`. The deploy-then-migrate ordering it warned about was
  followed. The general rule it pointed at survives in
  [conventions.md §4](../conventions.md) and was used again for `0088`.
- **Custom fields cannot become mail placeholders without changing Mail's
  contract.** `MailEntityType.templateFields` is a static array on purpose —
  its header says the vocabulary must be knowable without reading data, which is
  what keeps the placeholder enumeration closed. Per-tenant custom field
  definitions cannot satisfy that without turning `templateFields` into a
  function taking `(tx, ctx)`. The CRM mail extension therefore exposes fixed
  fields only, and reopening that enumeration is Mail's decision to make on its
  own merits.
- **Cross-linking accounting's customer list to a CRM record needs P5.**
  Accounting cannot import CRM. A record-link extension point is the sanctioned
  route; ADR 0004 already predicted nav contribution would force one.
- **`Probe Construction` is still in two files this module did not touch** —
  `src/lib/mail-extensions/types.ts` and `src/lib/email/jmap/types.ts`, both as
  comment examples. Worth knowing because CRM's own placeholders picked the name
  up from them by reading nearby code, which is the propagation mechanism
  [extension-model.md §8](../extension-model.md) describes rather than a
  coincidence. Rewrite them opportunistically when next in those files.
- **A6 was overridden deliberately.** The empty-slot rule says a module waits for
  a paying client to pull it in. The founder directed this build ahead of that on
  2026-08-03. Recorded here so a future session reads it as a decision rather
  than as precedent.
- **The duplicate warning at create time still covers contact points only.**
  Slice 7's duplicates page catches identical names as well, but the warning
  shown while somebody is typing a new record does not — they are two different
  surfaces and only the page was extended.
- **A MERGE CANNOT BE UNDONE, and the audit row is all that survives it.** It
  carries both ids, both names as they read at the time, and the counts of what
  moved, which is what somebody asking "where did that customer go?" has to work
  with. An actual reversal would need the pre-merge state stored somewhere,
  which is a real feature and not a small one.
- **`mail_links` is re-pointed by CRM, writing a table `src/modules/email` owns.**
  Leaving them would silently detach correspondence from the record it was filed
  against, which is worse; but the sanctioned answer is an "entity merged" hook
  on the extension seam — P5, the same pointer the timeline gap needs, aimed the
  same way. Documents' own links ride on `invoice_id`/`bill_id` and need nothing.
- **Nothing merges parties across the person/organization divide sensibly.** The
  planner allows it and the executor will do it, because a sole trader recorded
  once as a person and once as a company is a real duplicate — but the surviving
  `kind` is simply the survivor's, and no affiliation is rebuilt around the
  change beyond dropping self-references.
- **The candidates query scans, and is capped at 500 pairs per signal.** No
  expression index on the folded name, deliberately: at the scale the records
  list already caps itself at, a sequential scan is cheaper than an index nobody
  has asked for. Both are the same "solve it properly in slice 8" bet.
- **The warning only fires where a contact point is entered**, which is the
  record page. Creating a record from the "Add a record" form does not ask for
  an address, so nothing is checked there.
- **A rule cannot be edited, only paused or deleted and rebuilt.** Editing means
  a version question — does a change apply to what already fired? — and pausing
  covers the urgent case ("make it stop") without answering it.
- **The rule builder has no condition editor yet.** A rule with no conditions is
  the one most people want, and the engine, the storage and the validator all
  support conditions already — only the form does not. The filter UI on the
  records list is the thing to reuse when somebody asks.
- **A rule fires per event, and there is no bulk apply.** Adding "when a record
  is created, add a follow-up" does nothing to the records that already exist.
  That is the honest default, but the first person to write a rule will expect
  otherwise, and a "run this over existing records" button is a real want.
- ~~**`assignee` is a Clerk user id typed into a box**~~ — **fixed 2026-08-07.**
  Both automation assignees are pickers now, and the rule SENTENCE resolves
  names too (`describeRule` takes an optional `NameResolver`, threaded rather
  than applied to the finished string, so the live preview and the list cannot
  drift). This mattered more than the collaborator one: a mistyped id produced a
  follow-up assigned to nobody real, invisible to every digest and
  indistinguishable from work nobody had picked up.
- ~~**No per-rule failure surface.**~~ — **fixed 2026-08-07.**
  `crm_automation_rule_health` (`0091`) records the failure and the rules page
  shows a **failing** badge with the message and a count, distinct from the
  existing *needs attention* (which means the rule no longer parses). What
  remains: there is still **no history** — the row holds the latest error and a
  consecutive count, not a run log, so "it broke on Tuesday and again today"
  is not answerable. A run table is the shape if somebody needs it.
- **Reports have no folders.** `crm_reports` shares the flat, per-report
  `is_shared` boolean that `crm_saved_views` uses, where Salesforce makes the
  FOLDER the sharing unit and files every report into one. Flat is right while a
  tenant has five reports and will stop being right at fifty; the shape to copy
  when it does is theirs, not a per-report ACL.
- **Reports have no schedule and no delivery.** Salesforce subscribes you to a
  report and emails it; ours is a page you open. That is the same
  no-notifications gap the whole module has, and reporting is where somebody
  will feel it first.
- **The detail list caps at 200 rows** and says so. A report is a summary and
  the detail exists to answer "which ones?" about one group, not to be a second
  records list.
- **No cross-type reporting.** "Deals with their activities" is a sixth type,
  not a join somebody can assemble, and it stays that way until a real question
  needs it.
- **Paging is OFFSET-based**, which is right at this scale and will not stay
  right forever: a row inserted while somebody reads page 3 shifts the boundary,
  so a record can be seen twice or skipped. Keyset paging is the upgrade and it
  needs one cursor shape per sort field, which is why it was not built for a
  list that currently holds hundreds.
- **Filters are ANDed, with no OR.** The panel says so in words rather than
  leaving it to be discovered. An expression escape hatch — "1 AND (2 OR 3)" —
  is a real want and a real parser, and half-building it would have meant a
  stored `logic` string nothing honoured.
- **Custom fields are still not filterable**, for the reason recorded below:
  arbitrary jsonb filtering is expensive and the right shape is an intentional
  expression index per field somebody actually filters on. Saved views make that
  cheaper to decide now — the first tenant to ask will name the field.
- **A view does not choose its columns.** The list renders a fixed row, so
  `crm_saved_views` has no `columns` jsonb; adding one before anything reads it
  would be the speculative build this codebase avoids.
- **The board is not a view.** A saved view renders as one list and nothing else,
  while Salesforce draws the same view as a table, a kanban or a split view. Ours
  stays two pages with two queries. See Decisions — this is the idea most worth
  taking next, and it belongs to a slice that can move the board rather than to
  one bolting a second renderer onto the list.
- **Custom fields are not filterable or searchable.** Nothing indexes `custom`,
  and the records list does not offer them as facets. Deliberate for now —
  arbitrary jsonb filtering gets expensive fast, and the right shape is an
  intentional expression index per field somebody actually filters on, decided
  with slice 8's saved views rather than guessed at now.
- **No field is classified as sensitive.** A custom field can hold anything a
  tenant types, including C4 PII, and it inherits only the record's visibility.
  A per-field restriction is a real gap once somebody puts a national insurance
  number in one.
- **Field definitions cannot be reordered from the UI.** `reorderFieldDefsAction`
  exists and works; nothing calls it yet, so new fields land at the bottom.
- **A profile cannot yet seed field definitions idempotently.** `key` is
  renameable, so a Layer 2b installer upserting on it would duplicate a field a
  tenant had renamed. That needs an ownership marker on the row, and it should
  be designed with the first real profile rather than guessed at now.
- **Affiliations assume person→organization.** The kinds are checked in
  `party-ops.ts` rather than by a constraint, because the constraint would have
  to reach into another table and because a sole trader is a real edge. A
  company-to-company relationship (parent, subsidiary, joint venture) is a
  different shape and is not modelled.
- **No `updated_at` trigger anywhere in CRM** — the ops layer sets it. Consistent
  with the rest of the schema, and worth knowing before writing a raw UPDATE.
- **Deals have no per-deal probability override** — the weight comes from the
  stage. A real want, but it is one more number to keep honest and slice 9 can
  add it once a report argues for it.
- **No currency column.** Single-currency platform; a second one is a change to
  `@/lib/money` before it is a change here.
- **Stage reordering has no UI.** `reorderStagesAction` exists and works;
  nothing calls it, so new stages land at the end.
- **A deal cannot be moved between pipelines**, and `moveDealStage` refuses it
  explicitly rather than leaving a card on a board that does not draw its
  column.
- **`crm_deal_parties` has no add/remove UI** — the deal page lists
  stakeholders, and the actions exist, but nothing creates one yet.
- **THE TIMELINE STILL HAS NO MAIL IN IT, and slice 5 did not fix that.**
  Registering the entity types was the prerequisite and is done — a thread can
  now be attached to a record — but showing those threads *on the CRM timeline*
  needs the reverse read, and that is a design question rather than a query.
  "Emails on this record" is two hops through `mail_links` plus resolving the
  filed copy through the Documents extension, and all of that lives in
  `src/modules/email/links.ts` and the registry, neither of which CRM may
  import. Reimplementing the hops here would duplicate behaviour Mail owns,
  including the `is not distinct from` subtlety that keeps a disconnected
  mailbox's links alive. The real answer is either moving the reverse read into
  a shared seam or Mail declaring a timeline-contribution extension point —
  P5 again, pointing the other way. `mergeTimeline` takes items rather than
  tables so that whichever wins is a mapping function here.
- **An accounting form still edits only the MAIN address of each kind.** A party
  with three emails shows its primary in the customer dialog and the other two
  nowhere in Accounting; the record page in CRM is the only place to see or
  label the full set, and a tenant without CRM cannot reach them at all. Adding
  a proper multi-value editor to the accounting dialog would duplicate a panel
  CRM owns, so this waits for somebody who actually has the problem.
- ~~**The Follow-ups page groups against the SERVER's today**~~ — **fixed
  2026-08-05.** `tenants.timezone` (`0086`) is the shared setting this was
  waiting for, and the page now groups against the business's today. See
  [timezone.md](timezone.md). What remains: the per-row badge is still computed
  in the BROWSER, so somebody working away from the business's timezone can see
  a row badged differently from the group it sits in.
- **An activity attaches to exactly one party**, plus optionally one deal. A
  meeting with three people from the same company is currently three entries or
  one filed against the company. Multi-attendee activity is a real want with no
  UI demand yet.
- ~~**Tasks have no assignee picker**~~ — **fixed 2026-08-07.** This one turned
  out to be load-bearing: with nothing setting an assignee, every follow-up was
  unassigned, so the notifications digest — built on "each person sees their own
  work" — could only ever reach owners, via its unassigned roll-up. A staff
  member's digest was empty by construction. See [notifications.md](notifications.md).
- ~~**No reminders or notifications.**~~ — **fixed 2026-08-06.** Follow-ups due
  or overdue now reach their assignee in the daily digest, and appear on
  `/dashboard/today`. See [notifications.md](notifications.md).
- ~~**Adding a collaborator means typing a Clerk user id.**~~ — **fixed
  2026-08-07.** The blocker it named ("needs a members list the module can
  read") stopped existing when `listAssignableMembers` landed for the follow-up
  picker. The panel now offers non-owner members who do not already have a
  grant, and names the ones who do. Owners are absent deliberately: they can
  already see every restricted record, so granting one access is a control that
  does nothing.
- **A grant is all-or-nothing.** A collaborator gets the whole record: notes,
  deals, timeline, follow-ups. Field-level restriction is a different feature
  and is not modelled.
- **Nothing tells a collaborator they have been granted access**, or removed.
  There are no notifications anywhere in CRM yet, and this inherits that gap.
- ~~Slice 11 (AI) is planned and unbuilt.~~ — **built 2026-08-08** as note
  extraction. Slices 5, 6 and 7 shipped on 2026-08-04; slices 8, 9 and 10 on
  2026-08-05.
- **Nobody has run the extractor on a real note.** Every layer is tested with an
  injected model, and the one live call made during the build was a two-line
  compatibility probe. Whether it splits interactions sensibly, and whether it
  resists inventing follow-ups from notes that merely discuss options, is
  unanswered until somebody pastes a real note.
- **The extractor reads the note and nothing else.** No record name, no history,
  no contact points — deliberate data minimisation (S9), and also a ceiling: it
  cannot notice that a note contradicts what the record already says.
- **One cooldown for the whole tenant.** 15 seconds, per tenant, not per person
  — so two people working different records at the same moment can block each
  other. Fine at current scale, wrong later; per-person is the shape.
- **`assigneeClerkUserId` is never checked against the roster on write.** Noted
  while building the save action, which validates it exactly as
  `timeline-actions.ts` already did — `z.string().max(120)`, no membership
  lookup — so this is pre-existing and not something slice 11 introduced. The
  extractor's own path cannot reach it (the model returns a name hint, and
  `resolveProposal` only ever resolves to a member), but a crafted request can
  assign a task to any string. Not a leak: such a task appears in nobody's
  digest, since the digest iterates memberships. It is a data-quality hole that
  got more expensive when assignment started driving the digest, and the fix
  belongs in `createTask`, where both paths would inherit it.
