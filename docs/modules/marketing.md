# Marketing

> How the business looks to its customers, and — as the module grows — where
> it is found. Slices 0 and 0b are the **brand kit**: logo (uploaded or
> drawn), display name, tagline and two colours, carried onto every invoice
> PDF. Slice 1 is the **website**: pages of typed sections written by the
> assistant from the kit and the business's details, published on a free
> address. The roadmap adds the editor, custom and purchased domains shared
> with the Mail module, forms that land in the CRM, and a shop block the
> `retail` pack fills. The brand kit itself is Layer 0 data
> ([ADR 0018](../decisions/0018-the-brand-kit-is-layer-0-data.md)); this
> module is the one place it is edited.
> Status: `coming_soon` · Scope: `module`

## Roadmap

| # | Slice | State |
| --- | --- | --- |
| **0** | **Brand kit at Layer 0: `brand_kits`, the Marketing screen, the invoice PDF as first consumer** | **built 2026-09-04** |
| **0b** | **Logo generation: Claude-chosen wordmarks and monograms drawn as vector paths from the shipped Noto Sans, rasterised with `sharp`; SVG upload, rasterised on the way in** | **built 2026-09-04** |
| 0c | An illustrated symbol, optionally, from OpenAI's image model (`gpt-image-1`, transparent PNG, symbol only, never the name) composed with the kit's own wordmark. Needs `OPENAI_API_KEY`; the founder has an account | next, if the wordmarks feel plain |
| **1** | **Site model and renderer — pages of typed sections, draft/publish, written by the assistant from the kit and the business's details, served at `/sites/<slug>` and at `<slug>.<SITE_DOMAIN>` through a host rewrite in `proxy.ts`, cached (ISR) and revalidated on publish.** [ADR 0019](../decisions/0019-a-website-is-pages-of-typed-sections.md) | **built 2026-09-04** — the site domain itself is still to buy |
| **2** | **The editor — sections dragged into order (dnd-kit), a form per kind beside a live preview of the draft, pages added, ordered and removed, and a history of every save, publish and restore.** Puck was evaluated and not adopted (Decisions) | **built 2026-09-04** |
| **3** | **Connect a domain the business owns — records only, through Vercel's Domains API; the proxy routes any hostname that is not the platform's to the site it names.** Purchasing designed, not built ([ADR 0020](../decisions/0020-a-connected-domain-is-records-only.md)) | **built 2026-09-04** — needs `VERCEL_API_TOKEN` + `VERCEL_PROJECT_ID` in Vercel to switch on |
| 3b | Buying a domain through Vercel's registrar into Yosher's account, held for the client; the platform publishes the mail and site records itself; the shared `domains` table with the mail module arrives here | after the terms, the transfer runbook and a billing decision |
| **4** | **Forms into CRM — a `form` section on the site; each message becomes a party (matched by email), a CRM record with `source = 'website'` when CRM is on, a Work follow-up due today, a `site_enquiries` row and an email to the business.** [ADR 0021](../decisions/0021-a-website-enquiry-lands-as-a-party.md) | **built 2026-09-04** |
| **4b** | **Page views — a first-party beacon, counters per page per day, a `Visitors` panel; and the business's own questions on the form, checked against the published definition.** [ADR 0022](../decisions/0022-page-views-are-a-first-party-beacon.md) | **built 2026-09-04** |
| — | The shop block: `retail` slice 6 (online orders + pickup windows) fills a declared slot; blocked on commitments (retail 3) and web checkout (payments) | not this module's |

## Build log

Newest first. One entry per session/PR that touched this module. Every PR
that changes this module MUST add an entry here (rule in AGENTS.md).

### 2026-09-04 — Slice 4b: who looked, and the business's own questions (`claude/marketing-site-views-and-questions`)

Two things the form slice left open: the business could not tell whether
anyone visited, and the form asked only what Yosher chose.

- **Page views** ([ADR 0022](../decisions/0022-page-views-are-a-first-party-beacon.md)).
  `src/components/site/view-beacon.tsx` is the second client island on a
  public page: after the page draws it posts `{ site, path, first }` to
  `POST /api/sites/view` (`sendBeacon`, a keep-alive fetch as fallback,
  silence on failure), where `first` is the browser's own word — it keeps a
  `yosher-site-visit:<slug>:<day>` note in `localStorage` and clears older
  days' notes. No cookie, no IP, no user agent. Not in the draft preview.
  `recordSiteView` (`src/lib/sites/views.ts`) is the write: slug → trusted
  lookup → published only → `withTenant(…, { role: "staff" })` → the path
  must be a PUBLISHED page of the site → one upsert on `site_page_views`
  (`views + 1`, `visitors + first`) keyed `(site, day, path)`, the day in
  the tenant's timezone. The route answers 204 whatever happened.
  `summarizeViews` (`views-core.ts`, pure) turns thirty days of rows into
  totals, a zero-filled day series and a per-page table; the Website screen
  gains **`Visitors`** (`components/visitors-panel.tsx`, server-rendered:
  totals, a bar a day, a row a page, and one line saying what a visitor is).
- **The business's own questions.** The `form` section gains `fields`
  (up to `FORM_FIELDS_MAX` = 6): `{ id, label, kind, required, options }`,
  kinds `text` (≤200), `long` (≤1,000), `choice` (one of up to twelve
  options) and `yesno` (a box). `id` is six base-36 characters made once in
  the editor, so a renamed question keeps its key. The editor
  (`section-forms.tsx`, `QuestionsFields`) edits label, kind, choices (one
  input each — a textarea of lines cannot be typed into while every
  keystroke re-splits it), `Must be answered`, order and removal. The public
  form renders them between the phone and the message, controlled like the
  rest. **The answers are checked against the PUBLISHED page**: the form
  posts its page path and its section index, `receiveSiteEnquiry` reads that
  section's `fields` from `site_pages.published` and runs `answersFromForm`
  (pure) — required, membership of the choices, lengths — refusing with
  per-question messages in the site's voice (`This one is needed to send.`,
  `Pick one of the choices.`, `Tick this one to send.`, `Keep this under
  200 characters.`). A form on a page that changed since has its answers
  dropped rather than trusted. Answers are stored on the enquiry as
  `{ label, value }` snapshots (`answers` jsonb, `0254`), listed in the
  follow-up's notes, the email and the `Messages` panel as `Question:
  answer` lines. They do not reach CRM's `custom` bag yet (Open items).
- Migrations `0254` (table + column) and `0255` (RLS: members read,
  members insert and update, no delete) — the custom file made with
  `db:generate -- --custom --name …` so its journal entry exists (the slice 4
  trap). Tests: `tests/site-views.test.ts`, `tests/site-enquiries.test.ts`
  (the questions block), the `site_page_views` isolation block. Guides:
  `website.md` (`Visitors`, the answers in `Messages`, the new messages),
  `page-editor.md` (`Questions`). Security row for the beacon.
- **Driven on the dev branch (Test tenant, `oak-row-farm`)**: three
  questions added in the editor (a `Pick one` with three choices, a
  required `Short answer`, a `Yes or no`), saved and published; the live
  contact page showed them between the phone and the message with
  `(optional)` on the two that were; a send with the required one blank
  came back with `Check the highlighted fields and try again.` and `This
  one is needed to send.` under it; answered, the message landed with
  `answers` as label snapshots on the row, the same three lines in the
  follow-up's notes, and `Question: answer` lines under the sender in
  `Messages`. Loading the home page once and the about page twice sent
  four beacons (`204` each); `Visitors` then read `1 visitor and 4 page
  views`, About 2 / Home 1 / Contact 1 with the one visitor on the contact
  page, which was that browser's first page of the day. The dev server's
  `x-forwarded-for` is empty, so the enquiry caps ran on the `unsalted`
  key, as documented.

### 2026-09-04 — Slice 4: the form on the site lands in the workspace (`claude/marketing-site-forms`)

A message sent through a site's form becomes what the business already works
with — a person, a thing to do, an email — instead of a mail in a box nobody
watches. [ADR 0021](../decisions/0021-a-website-enquiry-lands-as-a-party.md)
settles what a message becomes, who writes it and what a switched-off
feature means for it.

- **A `form` section** (`src/lib/sites/schema.ts`): heading, note, button
  label, whether to ask for a phone number, and the thank-you shown after
  sending. The fields a visitor fills in are fixed — name, email, phone
  (optional), message. The assembler puts one on every new contact page
  after the details; an existing site adds it from the editor's catalogue
  ({button:Enquiry form}). The renderer's one client island,
  `src/components/site/enquiry-form.tsx`, is plain elements styled by the
  site's CSS variables, controlled inputs so a validation error never
  empties the message, a honeypot, and a disabled fieldset in the draft
  preview ("Visitors can send this once the site is published").
- **The public action** `src/components/site/enquiry-action.ts`
  (`submitSiteEnquiry`): honeypot → Zod (`SiteEnquirySchema`, pure, in
  `src/lib/sites/enquiry-schema.ts`) → `receiveSiteEnquiry`. Its messages are
  the business's site talking, not Yosher's.
- **`receiveSiteEnquiry`** (`src/lib/sites/enquiries.ts`) is **the one public
  WRITE path into a tenant**: `normalizeSiteSlug` → `lookupSiteBySlug`
  (identifiers only) → refused unless `published` → caps → then
  `withTenant(tenantId, …, { role: "staff" })` with no user. Inside one
  transaction: the party (`findPartiesByContact` by email, else
  `createParty` as a person with `splitPersonName`), contact points through
  `addContactPoint` (an unusable phone is left out, never fatal), CRM's
  details row with `source = 'website'` **only when CRM is enabled**
  (`ON CONFLICT DO NOTHING`, so an existing record keeps its own source),
  the Work item via `createWorkForEntity` linked to `crm/contact` when CRM
  is on and `createUnlinkedWork` otherwise — titled `Reply to <name>`, due
  TODAY in the tenant's timezone so it reaches the digest, the whole
  message in its notes — the `site_enquiries` row, and an audit row
  (`site.enquiry.received`, identifiers only). After the transaction the
  business is emailed (`sendEmail`, new kind `enquiry`, idempotency key
  `enquiry:<id>:<recipient>`, Reply-To the sender): to the site's contact
  email if the details name one, else to every owner's profile address;
  `notify_via` on the row says which. A failed send is logged and never
  fails the message.
- **Caps**: `src/lib/public-caps.ts` now holds the `public_access_attempts`
  valve (`ipKey`, `overPublicCap`) the platform's contact form had privately;
  `src/lib/contact.ts` calls it with its old numbers. The form's kind is
  `site_enquiry`: 5 per IP per hour, 1,000 platform-wide per day, plus
  `ENQUIRY_SITE_DAILY_CAP` = 100 per site per day counted on
  `site_enquiries`.
- **`site_enquiries`** (`0252`, RLS in `0253`): members read, members
  INSERT (the public path's role), owners delete, **no UPDATE policy** — an
  enquiry is never edited. Composite FK to `sites` ON DELETE CASCADE;
  `party_id` and `work_item_id` are soft pointers (Decisions).
- **The Website screen** gains `Messages` (`components/enquiries-panel.tsx`):
  newest thirty, each with name, date, email and phone links, the page it
  came from, the message (truncated, `Show the whole message`), a badge from
  the follow-up's state (`to reply` / `replied` / `follow-up removed`),
  {button:Follow-up|outline} to the Work item, {button:Contact|outline} to
  the CRM record when CRM is on, and for owners {button:Remove|ghost|trash}
  (`deleteEnquiryAction`, audited as `marketing.site.enquiry_deleted`) —
  which removes the record of the message only; the contact and the
  follow-up stay where they live. A line under each row says where it went
  and who was emailed.
- **The editor** (`section-forms.tsx`): the form section's fields —
  `Heading`, `Note`, `Button`, `Ask for a phone number` (a switch), `After
  sending`.
- Tests: `tests/site-enquiries.test.ts` (the schema, `splitPersonName`,
  the follow-up's words, the email, the section, the assembler);
  `tests/isolation/sites.test.ts` gains the `site_enquiries` block (staff
  insert, expert cannot, nobody updates, owner deletes, cross-tenant,
  composite FK, cascade, default-deny); `sites-core` and `sites-pages`
  updated for the new section.
- Guides: `website.md` (the Messages panel, what a visitor sees, the new
  messages), `page-editor.md` (the Enquiry form kind and its fields).
- **Driven on the dev branch (Test tenant, `oak-row-farm`)**: the form
  section added from the editor's catalogue, saved (history entry), the
  site republished (`Your website is updated.`); a message sent from
  `/sites/oak-row-farm/contact` with CRM and Work OFF became a person with
  two contact points, an unlinked item `Reply to Jane Doe` due that day with
  the notes, the enquiry row (`notify_via = site_email`) and the audit row;
  with CRM and Work switched ON, a second sender became a CRM record whose
  `Where they came from` reads `website`, with the follow-up on the
  record's timeline and linked `crm/contact`; a third message from the
  first sender's email in UPPER CASE matched the same party
  (`matchedExisting: true`, one Jane Doe) and gave it a CRM record. The
  Messages panel listed all three newest first with working `Follow-up` and
  `Contact` links; the draft preview showed the form disabled with its note;
  a two-letter message came back with `Check the highlighted fields and try
  again.` under the message field and the name kept. The email said
  `not_configured` in the dev log (no `RESEND_API_KEY` locally) and the
  message still landed — the send is the same `sendEmail` door every other
  kind uses.
- **Found while driving: a `Follow-up` link to a switched-off Work is a
  404**, so the panel now takes `workOn` as well as `crmOn` and offers each
  link only where there is a page; the records exist either way.

### 2026-09-04 — Slice 3: a domain the business owns, connected by records (`claude/marketing-site-domains`)

- **`site_domains`** (`0250`, RLS `0251`): a hostname per row, unique across
  the platform, at most five per site; `status` decided by Vercel and the
  records the owner was last told to publish. Members read, owners write.
- **Vercel's Domains API** in `src/lib/vercel/domains.ts`: add to the
  project, read, verify, config, remove; every answer Zod-parsed against the
  REST reference's shapes (checked 2026-09-04). Gated on `VERCEL_API_TOKEN`
  and `VERCEL_PROJECT_ID`; the screen says when they are missing.
- **Records only, never nameservers**, and Vercel decides when a row is
  `active` (ADR 0020). `dnsInstructions` gives a subdomain a CNAME and an
  apex an A record, from Vercel's recommended values with the documented
  fallbacks, and a TXT first when Vercel asks for proof of ownership.
- **The proxy classifies every hostname** (`classifyHost`, pure): the
  platform's own pass, a free address goes to `/hosted/<slug>`, anything else
  to `/domain/<host>`, where the page resolves the host through one
  `withSystem` lookup over `active` rows or answers 404. The site's logo
  answers on the domain at `/logo`, and every address of a site names the
  live domain as canonical.
- **The screen**: `Your own domain` on the Website page — connect, the
  records table with copy buttons, `Check again`, `Remove` (Vercel first,
  then the row; the provider step is skipped without a token so a row can
  always be cleaned up), read-only for staff.
- **Purchasing designed, not built**: ADR 0020 records the ownership rule
  (bought through Vercel into Yosher's account, held for the client,
  transferred out on request) and what has to exist first.
- Verified: 20 pure tests (normalisation and refusals, apex detection, the
  records for each case, status mapping, `classifyHost` for every kind of
  host, the Vercel schemas against the documented shapes); the isolation
  suite grew a `site_domains` block (20 in the file). **Driven on the dev
  branch** with an `active` row seeded by hand, there being no Vercel token
  here: `curl -H "Host: www.oakrowfarm.example"` answered 200 for `/` and
  `/about`, 200 `image/png` for `/logo`, and 404 for a hostname nobody
  connected; the page's title carried no platform name, its nav links were
  root-relative, and both it and the free address carried the canonical
  link to the domain. The Website screen showed the row as `Live`; `Check
  again` without a token said the feature is not switched on; `Remove`
  took the row away (`Domain disconnected.`) and the hostname answered 404
  after. **Not exercised: a real call to Vercel.** The first real connect is
  the founder's, once the token and project id are set.

### 2026-09-04 — Slice 2: the page editor (`claude/marketing-site-editor`)

- **The editor** at `/dashboard/m/marketing/website/pages/[pageId]`, owners
  only: the page's title, address (not for home), menu switch and search
  description; the sections as a sortable list (dnd-kit, pointer and
  keyboard, plus arrow buttons) with a form per kind (`section-forms.tsx`)
  for the selected one; a palette that adds a section after the selected
  one; a history panel; and the draft route in an iframe as the preview,
  reloaded after each save. Every edit is local until Save; the client
  parses the content with the same Zod model the action does, so the first
  message names the section and the field.
- **`site_page_versions`** (`0248`, RLS `0249`): a version at every save
  that changed content, every publish that changed what was live, and every
  restore; the newest thirty kept per page, trimmed on write. Restore is a
  version too.
- **Pages on the Website screen** (`pages-panel.tsx`): drag to set the menu
  order (saved at once), Edit, Add a page (title, address filled from it,
  one text section to replace), and delete with confirmation, never home.
- **`ModuleDefinition.fullWidthPaths`**: the editor takes the whole viewport
  (`website/pages`) while the rest of Marketing keeps the standard column —
  a flag on the definition, applied in `app/dashboard/layout.tsx`.
- **Puck evaluated, not adopted** (Decisions). `@dnd-kit/core`, `sortable`
  and `utilities` added as direct dependencies (MIT).
- The module's gate is shared by a third actions file (`page-actions.ts`).
- Verified: 8 pure tests over the catalogue, summaries, page-path rules,
  paragraphs, moves and pruning; the isolation suite grew a
  `site_page_versions` block (14 in the file). **Driven on the dev branch:**
  the Pages panel with handles, Edit and delete; the editor for Home —
  select a section, change the headline (the list's summary follows), add
  Hours after it, move it down, Save (`Page saved…`, the preview redrawn
  with the new headline, `Saved` in history); a second save then Restore of
  the first (`Version restored into the draft.`, the headline back, `Restored`
  on top); a keyboard drag (Space, Up, Space on the handle — dnd-kit's live
  region announced the move) saved and shown in the preview's section order;
  Add a page (`Services`, straight into its editor with one text section) and
  its deletion (`Page deleted.`). **A pointer drag was not reproducible from
  the browser tooling** (synthetic pointer events and the tool's drag did
  not activate the sensor); the keyboard sensor shares the same context and
  drop handler, and a hand on a mouse is the remaining check.

### 2026-09-04 — Slice 1: the website, built from the kit and put on an address (`claude/marketing-site-model`)

- **`sites` + `site_pages`** (`0246`, RLS `0247`): one site per tenant with a
  platform-unique `slug` (a hostname label), live `settings` (phone, email,
  address, hours) and a status; pages with `draft` and `published` JSON.
  A page is a description and up to twelve typed sections
  (`src/lib/sites/schema.ts`: hero, about, offer, hours, contact, text, cta),
  validated on every write and degraded to empty on a malformed read. Members
  read, owners write, as policies. **`0246` is hand-reordered**: drizzle-kit
  emits every FK before every index, and the composite FK to `sites` needs
  `sites_tenant_id_id_idx` first — the trap `ledger.ts` has warned about since
  ADR 0010, met for the first time with the referenced table in the same file.
- **The assistant writes into fixed slots; the code assembles pages.**
  `ai/site-copy-prompt.ts` briefs it with the kit, the industry and the
  details (facts, never files); `ai/site-copy-validate.ts` parses each slot on
  its own so one bad slot costs one slot; `standardSiteCopy` fills the rest
  and stands in entirely without a key; `assembleSite` (pure) makes home,
  about and contact in a fixed order. Adaptive thinking, on purpose: this is
  the reasoning-shaped task `lib/claude.ts` says new call sites should think
  about, and the owner pressed "Build it" expecting to wait.
- **Two addresses, one renderer.** `/sites/[slug]/[[...path]]` on the platform
  host, always; `/hosted/[slug]/[[...path]]` is where `src/proxy.ts` rewrites
  `<slug>.<SITE_DOMAIN>` (locally `<slug>.localhost:3000`, no hosts-file
  edit). Both are ISR (`revalidate = 300`) and revalidated on publish by
  route-file pattern. The draft preview (`/sites/[slug]/draft/…`) is dynamic
  and session-checked; the logo (`/sites/[slug]/logo`, `/logo` on a site
  host) is the public route ADR 0018 promised, with a public cache header.
- **The public read path opens a tenant, not a hole**: `lookupSiteBySlug` is
  the one `withSystem` read (identifiers only), then everything runs in that
  tenant's context as `staff`. No public policy. `docs/security.md` §6 has the
  rows.
- **The screen** at `/dashboard/m/marketing/website` (the module grew a
  `CategoryStrip`: Brand, Website): build (address + details → "Build it"),
  status and addresses, preview, publish / publish changes / unpublish,
  rewrite the words, the details that show live, and the address change.
  The brand kit stayed at the module root so its guide's route and every link
  to it kept working.
- The module's one gate moved to `gate.ts` so `actions.ts` and
  `site-actions.ts` cannot answer "who may change how the business looks?"
  differently.
- Verified: 13 pure tests (address rules, host parsing, links, the content
  model, the standard copy and assembly, the slot merge, the writer's
  fallbacks) and `tests/isolation/sites.test.ts` (two tenants, staff vs
  owner, cross-tenant reads/writes, the platform-wide slug, the composite FK
  under `withSystem`, the CHECKs, the cascade, default-deny). **Driven on the
  dev branch against the live model:** a site for the Test tenant built in
  18 seconds with the assistant's words; `/sites/oak-row-farm` answered 404
  while a draft; the draft preview rendered with its banner, brand colour,
  logo and nav; Publish made it 200 in two seconds; and
  `http://oak-row-farm.localhost:3000/` rendered through the host rewrite
  with root-relative links and the logo at `/logo`. Not seen: an ISR cache
  hit, which the dev server never produces — it is the production build's to
  prove.

### 2026-09-04 — Slice 0b: Yosher draws a logo, and takes an SVG (`claude/marketing-logo-generation`)

- **The assistant picks, the code draws.** A logo is a `LogoSpec`
  (`src/lib/brand/logo-spec.ts`): layout, the words, weight, case,
  letter-spacing, one of eight simple marks and three colours. Claude fills
  that form six times through a forced tool (`ai/logo-prompt.ts`, validated
  by `ai/logo-validate.ts`, one bad candidate costs one slot); the renderer
  (`logo-svg.ts`) turns each into SVG paths with fontkit from the Noto Sans
  TTFs the PDF already ships — no `<text>`, no font anywhere, identical on
  every machine. Without a key, or when the call fails, the standard set
  (`logo-defaults.ts`) stands in and the dialog says so.
- **Adoption re-draws server-side.** The dialog sends back the SPEC, never a
  picture; `adoptLogoAction` re-validates it, draws it, rasterises it to a
  1200px PNG with `sharp` (`raster.ts`, through the one lazy loader in
  `vision-image.ts`) and stores the PNG like any upload, with
  `logo_source = 'generated'` and the spec in `logo_spec` (`0245`) so the
  vector can be re-drawn for the website later.
- **An SVG upload is rasterised at the door and never kept.** `isSvg` on the
  bytes → `sharp` → PNG stored → the SVG blob deleted. The Documents
  allowlist's stored-XSS reasoning holds for the brand kit: nothing in the
  store can be served as markup.
- `next.config.ts` traces `SHARP_NATIVE` and the fonts for
  `/dashboard/m/marketing`; `fontkit` and `@types/fontkit` became direct
  dependencies (they were already installed under `@react-pdf/font`).
- **The founder offered ChatGPT's API for this.** Kept for 0c, for a symbol
  only: an image model draws illustrations well and sets a business name in
  type badly, and its output is a raster that cannot be recoloured or scaled.
- Verified: 17 tests over initials, the schema and its normalisation, the
  standard set, every layout's SVG, the rasteriser (a real 1200px PNG), the
  SVG sniff, the prompt, the validator and the drafting fallbacks with an
  injected model. **Driven on the dev branch against the live model:** six
  distinct candidates in eleven seconds in the kit's deep red, the leaf
  candidate adopted (`Logo updated.`, `1200 × 355 PNG · drawn by Yosher`, the
  logo route serving it), and an SVG uploaded through the ordinary button and
  stored as a PNG.

### 2026-09-04 — Slice 0: the brand kit, at Layer 0 (`claude/brand-kit-at-layer-0`)

- **`brand_kits`** (`0243`, RLS in `0244`): one row for the business
  (`entity_id` null) and optionally one per company, resolved field by field.
  Display name, tagline, primary and accent colours as `#rrggbb` with a CHECK,
  and the logo as a private blob under `brand/<tenant>/logos/` with its
  dimensions sniffed from the bytes at registration. Members read, owners
  write — as a policy, not only as a gate.
- **`src/lib/brand/`** is the seam every consumer reads through: `core.ts`
  (pure: `resolveBrand`, colour contrast, `fitLogo`), `image-sniff.ts` (pure:
  PNG IHDR and JPEG SOF parsing, no `sharp`), `read.ts` (server: the rows, and
  the logo's bytes outside a transaction).
- **The Marketing screen** at `/dashboard/m/marketing`: preview strip, logo
  upload/replace/remove through a presigned upload to the module's own token
  route, the four fields, and a `Companies` section that appears only when
  there is a second company to tell apart. Registered in `src/modules/index.ts`
  while the seed row stays `coming_soon` — the arrangement scheduling and work
  used — so a superadmin switches it on per tenant and nobody is sold it yet.
- **The invoice PDF is the first consumer.** All three paths — the PDF route,
  the emailed invoice and the reminder sweep — read the brand through
  `invoicing/invoice-brand.ts`: the row inside the transaction, the logo's
  bytes after it. Logo top-left in a 160×56pt box, heading and rules in the
  primary colour (heading only when it reads on white), tagline under the
  name, and the display name where the tenant's name used to be. No kit
  renders exactly what rendered before.
- `--accent-marketing` took hue 320 from `hello`, which moved to 95 — the stub
  is never switched on for a client, so it is the one hue that could be given
  away without a visible module changing colour.
- Verified: 14 pure tests over the core and the sniffer, 4 model cases and a
  real PDF render with an embedded PNG logo, and `tests/isolation/brand.test.ts`
  (two tenants, two companies on one of them, staff vs owner, the composite FK
  under `withSystem`, the partial uniques, the CHECKs, the cascade). **Driven
  in the browser on the dev branch** on both Hilltop Farm (one company: no
  `Companies` section) and Test (two companies): save, upload, replace, the
  logo route serving the private blob, `Give it its own look` and `Use your
  brand instead`. A draft invoice on Test then came back from the PDF route as
  a 294KB `%PDF-1.3` with the logo embedded as an image XObject. Not driven:
  the emailed invoice and the reminder sweep, which share the renderer and are
  covered by the render test.

## Data model

| Table | Purpose | Notes (RLS, invariants, FKs) |
| --- | --- | --- |
| `brand_kits` | The business's look, one row for the business and at most one per company | FORCE RLS. `member_read`; INSERT/UPDATE/DELETE need `app_current_tenant_role() = 'owner'`. Partial uniques: one row with `entity_id IS NULL` per tenant, one per `(tenant_id, entity_id)`. Composite FK `(tenant_id, entity_id) → entities` ON DELETE CASCADE — a company's own look dies with it; the business kit is untouched. CHECKs: colours are `''` or `^#[0-9a-f]{6}$`; the logo is whole (pathname, mime, width, height, bytes all set or all empty); name ≤ 80, tagline ≤ 140 |

Resolution (`resolveBrand`, pure): each field is the company kit's where it
says something, else the business kit's, else the platform default; the
display name falls back to the tenant's name last. `sources` says where each
answer came from, so the screen can tell an owner that a company is showing
the shared logo.

Since 0b (`0245`): `logo_source` is `upload` or `generated` (CHECK), and
`logo_spec` holds the `LogoSpec` a generated logo was drawn from, `{}` for an
upload. The stored blob is always a PNG or JPEG; the spec is what makes a
generated logo re-drawable as a vector.

| Table | Purpose | Notes (RLS, invariants, FKs) |
| --- | --- | --- |
| `sites` | The business's website: its address, live details and status | FORCE RLS. `member_read`; INSERT/UPDATE/DELETE need `app_current_tenant_role() = 'owner'`. Unique on `tenant_id` (one site per tenant, this slice) and on `slug` platform-wide (it is a hostname label). CHECKs: slug shape `^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$`, `status in (draft, published)`, `copy_source in (model, standard)`, title ≤ 80. `settings` is `SiteSettingsSchema` |
| `site_pages` | One page: its path, title, nav place, `draft` and `published` content | FORCE RLS, same policies. Composite FK `(tenant_id, site_id) → sites` ON DELETE CASCADE. Unique `(site_id, path)`. CHECK: path `^/(?:[a-z0-9-]+(?:/[a-z0-9-]+)*)?$`, title 1–80. `draft`/`published` are `PageContentSchema`; `published` null = never published |
| `site_page_versions` | A page's history: the content at each `save`, `publish` and `restore` | FORCE RLS; `member_read`, owner INSERT and DELETE (no UPDATE — a version is never edited). Composite FK `(tenant_id, page_id) → site_pages` ON DELETE CASCADE. CHECK on `kind`. Trimmed to the newest `PAGE_VERSIONS_KEEP` (30) on every write by `recordVersion` |
| `site_domains` | A domain the business owns, connected to its site | FORCE RLS; `member_read`, owner INSERT/UPDATE/DELETE. Composite FK `(tenant_id, site_id) → sites` ON DELETE CASCADE. **Unique on `domain` platform-wide** (a hostname points at one site); at most five per site (`SITE_DOMAINS_MAX`). CHECKs: hostname shape, `status in (pending, active, error)`. `records` is `DnsRecordToPublish[]`, what the owner was last told to publish; `vercel_verified`/`vercel_configured_by` are Vercel's last words. **Only an `active` row routes**, and only Vercel makes a row active |
| `site_enquiries` | A message sent through the site's form: the record of what was sent | FORCE RLS; `member_read`, **member INSERT** (`owner`/`staff` — the public path writes as `staff`, ADR 0021), owner DELETE, **no UPDATE policy**. Composite FK `(tenant_id, site_id) → sites` ON DELETE CASCADE. `party_id` / `work_item_id` are **soft pointers** (no FK): the screen resolves them and says when one is gone. CHECKs: name 1–120, message 1–4000, `notify_via in (none, site_email, owners)`. `ip_hash` is the salted hash the caps use, never the IP. Capped at `ENQUIRY_SITE_DAILY_CAP` (100) per site per UTC day. Since 4b (`0254`): `answers` jsonb, `EnquiryAnswer[]` label snapshots of the business's own questions |
| `site_page_views` | How many people looked at a page: one row per `(site, day, path)`, counters only | FORCE RLS; `member_read`, **member INSERT and UPDATE** (`owner`/`staff` — the beacon upserts as `staff`, ADR 0022), **no DELETE policy**. Composite FK `(tenant_id, site_id) → sites` ON DELETE CASCADE. Unique `(site_id, day, path)`; `day` is a `date` in the tenant's timezone. CHECK: counts ≥ 0. Nothing about a person is stored; `visitors` is browsers reporting their first view of the day on that page |

## Key files & seams

- `src/db/schema/brand.ts` — the table; `src/lib/brand/{core,image-sniff,read}.ts` — the seam
- `src/lib/blob.ts` — `brandPathPrefix()`, and the prefix in `isTenantBlobPath()`
- `src/lib/brand/logo-spec.ts` (the catalogue, `LogoSpecSchema`,
  `normalizeSpec`, `initialsFor`, the palette), `logo-defaults.ts` (the
  standard set), `logo-svg.ts` (spec → SVG paths, fontkit over the PDF's
  Noto Sans), `raster.ts` (SVG → PNG, `sharp`)
- `src/modules/marketing/logo-generate.ts` — the model call, padding from
  the standard set, `drawLogoToBlob`; `ai/logo-prompt.ts` + `ai/logo-validate.ts`;
  `components/logo-generator.tsx` — the dialog
- `src/db/schema/sites.ts`; `src/lib/sites/schema.ts` (the content model),
  `slug.ts` (address rules, `hostToSiteSlug`, `siteDomainFromEnv`, links —
  dependency-free because the proxy imports it), `copy.ts` (`standardSiteCopy`,
  `assembleSite`), `read.ts` (`lookupSiteBySlug`, `loadPublishedSite`,
  `loadSiteDrafts`)
- `src/proxy.ts` — the host rewrite; `src/components/site/site-page.tsx` (the
  renderer) and `public-route.tsx` (the shared body of the two public routes)
- `src/app/sites/[slug]/[[...path]]`, `src/app/hosted/[slug]/[[...path]]`,
  `src/app/sites/[slug]/draft/[[...path]]`, `src/app/sites/[slug]/logo/route.ts`
- `src/modules/marketing/site-actions.ts`, `site-ops.ts`, `site-generate.ts`,
  `ai/site-copy-prompt.ts`, `ai/site-copy-validate.ts`, `gate.ts`;
  `components/website-controls.tsx`, `components/marketing-strip.tsx`;
  `src/app/dashboard/m/marketing/website/page.tsx`
- `docs/help/marketing/website.md` — the screen's guide; `SITE_DOMAIN` in
  `.env.example`
- Forms: `src/lib/sites/enquiry-schema.ts` (the form's Zod, the follow-up's
  and the email's words, `splitPersonName` — pure), `enquiries.ts`
  (`receiveSiteEnquiry`, the one public write path; `listSiteEnquiries`),
  `src/lib/public-caps.ts` (the `public_access_attempts` valve, shared with
  `src/lib/contact.ts`), `src/components/site/enquiry-action.ts` +
  `enquiry-form.tsx` (the public action and the client island),
  `src/modules/marketing/enquiry-ops.ts` + `enquiry-actions.ts` (an owner
  removing one), `components/enquiries-panel.tsx` (the Website page's
  `Messages`); `EmailKind` `enquiry` in `src/lib/email/send.ts`
- Views: `src/lib/sites/views-core.ts` (`ViewBeaconSchema`,
  `summarizeViews`, the storage key — pure), `views.ts` (`recordSiteView`,
  `listSiteViews`), `src/app/api/sites/view/route.ts` (the beacon's door),
  `src/components/site/view-beacon.tsx`, `src/modules/marketing/components/visitors-panel.tsx`
- Questions: `FormFieldSchema` in `src/lib/sites/schema.ts`,
  `answersFromForm` / `newFormField` / `FORM_FIELD_KINDS` in
  `enquiry-schema.ts`, `QuestionsFields` in `section-forms.tsx`
- The editor: `src/lib/sites/pages.ts` (the section catalogue, fresh
  sections, summaries, page-path rules, paragraph splitting, moves, history
  pruning — pure), `src/modules/marketing/page-ops.ts` (save with a version,
  add, delete, reorder, restore), `page-actions.ts`,
  `components/page-editor.tsx` + `section-forms.tsx` (the screen),
  `components/pages-panel.tsx` (the Website page's list),
  `src/app/dashboard/m/marketing/website/pages/[pageId]/page.tsx`;
  `docs/help/marketing/page-editor.md`. `ModuleDefinition.fullWidthPaths`
  (`src/modules/types.ts`, applied in `app/dashboard/layout.tsx`) is the seam
  that gives the editor the whole viewport without widening the module
- Domains: `src/lib/sites/domains.ts` (pure: `normalizeDomain`,
  `isApexDomain`, `dnsInstructions`, `domainStatusFrom`, `readDomainRecords`),
  `classifyHost` + `platformHostsFromEnv` in `slug.ts` (what the proxy runs),
  `src/lib/vercel/domains.ts` (the Domains API, Zod-parsed),
  `src/lib/sites/logo.ts` (the public logo for a resolved site),
  `src/modules/marketing/domain-ops.ts`, `domain-actions.ts`,
  `components/domain-controls.tsx`; `src/app/domain/[host]/[[...path]]` and
  `src/app/domain/[host]/logo/route.ts`; `VERCEL_API_TOKEN`,
  `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID` in `.env.example`
- `src/modules/marketing/` — `MarketingModule.tsx` (the screen), `actions.ts`
  (gate → Zod → withTenant + audit → revalidate; every write owner-only),
  `kit-ops.ts` (the tx-level writes), `logo-ingest.ts` (inspect the uploaded
  blob, discard a replaced one after commit), `core/errors.ts`, `components/`
- `src/app/api/marketing/brand/upload/route.ts` — presigned token issuance,
  a deliberate sibling of the Documents route; `…/brand/[id]/logo/route.ts` —
  the signed-in logo stream (RLS read first, then `streamBlobResponse`)
- `src/modules/accounting/invoicing/invoice-brand.ts` — Accounting's half of
  the seam; `invoice-pdf-model.ts` (`InvoicePdfBrand`, `INVOICE_INK`,
  `INVOICE_LOGO_BOX`) and `invoice-pdf.tsx` draw it
- `docs/help/marketing/overview.md` — the screen's guide

## Decisions & gotchas

- **The browser says whether it is a visitor** (ADR 0022). Telling
  browsers apart by hashed address would keep something about a person for
  no reason the business could name; a `localStorage` note keyed by site
  and day answers the same question and leaves nothing on our disk. The
  number can be inflated by anyone who cares to, and nothing else hangs off
  it, so nothing is lost by trusting it.
- **Answers are checked against the published page, never the request.**
  The form names its page and its section index; the definition is read
  from `site_pages.published`. A request that claims different questions
  gets nothing for them, and a form left open across a republish has its
  answers dropped rather than filed under questions that no longer exist.
- **Only a published page's path counts a view.** Without that check a
  stranger could grow `site_page_views` one row per invented path; with it
  the table is bounded by pages × days.
- **The form writes as `staff`, inside the tenant the slug names** (ADR
  0021). No third database role, no `withSystem` write: the trusted lookup
  produces a tenant id and the member policies bound everything after it.
  The `site_enquiries` INSERT policy is a member policy for exactly that
  reason, and `tests/isolation/sites.test.ts` proves an `expert` cannot use
  it and nobody can UPDATE.
- **A hand-written migration must be in `drizzle/meta/_journal.json` or the
  migrator skips it silently.** `0253_site_enquiries_rls.sql` was written
  by hand, `db:migrate -- --dev` reported "Migrations complete", and
  `db:verify-rls` then found the table with no RLS at all. `db:generate --
  --custom` writes the journal entry for you; a file created any other way
  needs the entry added by hand (`idx`, `version: "7"`, `when`, `tag`,
  `breakpoints: true`). ADR 0014's verify step is what caught it.
- **The guard is the owning feature, applied to a public write.** CRM's
  details row and the `crm/contact` link exist only when CRM is on; the
  party and the follow-up exist regardless, because parties are Layer 0
  and Work's rule is that a switched-off Work does not stop a follow-up.
- **Soft pointers on the enquiry.** `party_id` and `work_item_id` carry no
  FK: CRM merges parties and Work deletes items without knowing this table
  exists, and the message must outlive both. The screen resolves the
  pointers under the caller's context and says "removed" when one is gone.
- **The email goes to the business's own addresses.** The site's contact
  email first (it is what the business tells customers to write to), else
  the owners' profile emails, never a visitor's input; Reply-To is the
  visitor so answering is one click. Kind `enquiry` in the outbound log,
  one row per recipient, idempotency `enquiry:<id>:<recipient>`.
- **The data is Layer 0; the module is the editor.** Accounting reads the
  brand the way it reads the timezone and never learns Marketing exists. A
  new consumer is an import of `src/lib/brand/read.ts`, not a seam. ADR 0018.
- **Owner-only writes are a POLICY.** Forgetting `{ role: ctx.role }` on a
  write denies it (the GUC defaults to `staff`); it can never grant one. The
  denial is silent for UPDATE and DELETE, so `kit-ops.ts` treats an empty
  `RETURNING` as the refusal it is.
- **The bytes decide the type.** The presigned token restricts the declared
  content type and size; registration re-reads the blob and parses its header.
  A rejected upload is deleted so nothing lingers unreferenced. A replaced
  logo's old blob is deleted only AFTER the new row commits.
- **`sharp` touches the kit in exactly one file, `raster.ts`, through the one
  lazy loader.** Slice 0 kept it out on purpose (PNG/JPEG header parsing
  needs no native library); 0b brought it in for the two things only it can
  do — draw a vector to pixels — on a route traced in `next.config.ts`. An
  upload that is already a PNG or JPEG still never loads it, and a libvips
  failure surfaces as `Drawing isn't available on this deployment right now.
  Upload a PNG instead.` rather than as a broken screen.
- **A generated logo is a spec, not a picture.** The client only ever sends
  the spec back; the server re-validates and re-draws. What lands in the
  store is always this renderer's output, and the spec in `logo_spec` is what
  the website will re-draw as a vector. The typeface is the PDF's Noto Sans,
  the only face in the repo; a serif or display face would widen the set and
  arrives with the website's fonts.
- **The standard set is a feature, not an error path.** No key, a failed
  call, or fewer than six valid candidates all end in six logos on screen,
  with a line saying they are the standard set when none came from the model.
- **The name goes in type; a symbol may come from an image model later.**
  Image models set text badly and cannot be recoloured; that is why the
  founder's ChatGPT offer is 0c's symbol step, not this slice.
- **Sections are data; the renderer decides how they look.** Nothing an
  owner or the assistant writes is markup, so a public page rendered from
  what a tenant typed cannot carry a script. A new kind of section is a new
  member of the discriminated union plus a branch in `site-page.tsx` — and
  the way a pack (the shop block) will extend the site, through a declared
  slot, never by writing HTML.
- **Contact and hours read the settings live.** The sections carry a heading
  and a note only; the phone, email, address and hours come from
  `sites.settings` at render time, so a changed number changes every page
  that shows it without touching a draft or publishing.
- **The site domain is a separate purchase, never `yosherapp.com`.** Its zone
  carries the SES, Migadu and Stalwart records. Until a domain is bought and
  put on Vercel's nameservers (a wildcard needs them), `SITE_DOMAIN` stays
  unset in production and every site is a path on the platform host — which
  is also the preview and the local-dev answer.
- **`/hosted/<slug>` is reachable on the platform host too**, where its
  root-relative links point at the platform. Harmless; not an address anyone
  is given.
- **The page title is `absolute`.** The root layout's `%s · Yosher` template
  is the platform's name and leaked onto the first rendered site before the
  metadata said otherwise.
- **The proxy reads `SITE_DOMAIN` per request, not at module load**, because
  its runtime does not promise module state survives, and `hostToSiteSlug`
  lives in a dependency-free file because the proxy runs before everything.
- **Puck was evaluated against the destination and not adopted.** The
  destination is seven typed sections in one vertical list, edited by an
  owner and documented to the guide standard. Puck brings its own data
  format (a conversion layer either way), its own UI (a sidebar, an outline,
  a viewport switcher the guide would have to describe as ours), and a
  preview that re-renders components on the client, where ours are server
  components drawn by the one renderer. dnd-kit (MIT, ~40KB) gives the drag
  the founder asked for on one list; the forms are ours and derive their
  limits from the content model. Revisit when sections nest or gain columns.
- **The preview is the draft route in an iframe, reloaded after each save.**
  There is exactly one rendering of a section in the product. An
  as-you-type preview would need a second renderer on the client or a
  round trip per keystroke, and neither is worth a preview that is never
  what the site shows.
- **Structure is live; words wait.** The menu (order, titles, in-or-out)
  is read from the page rows by the public renderer, so it changes on save;
  a page's content is the published snapshot and changes on Publish. The
  screens say so. A new page, never published, is not in the live menu
  because it has no snapshot.
- **A version is written only when content changed**, and the newest thirty
  are kept per page, trimmed on every write — no sweep, no unbounded table.
  Restore is itself a version, so history never loses a step.
- **The editor remounts on the page's `updated_at`.** A restore, or a save
  from another tab, re-renders the server page with new props; a client
  component that kept its local state would silently show stale text.
- **A connected domain is records only, and Vercel decides its state.**
  ADR 0020. The owner publishes a CNAME or an A record (and a TXT when
  Vercel asks for proof); the row goes `active` only when Vercel reports the
  domain verified and correctly configured, on a button, never a poller.
  Nameservers are never suggested: that moves the business's mail.
- **The proxy routes every hostname that is not the platform's own** to
  `/domain/<host>/…` without a database: `classifyHost` names the platform's
  hosts (the app, `*.vercel.app`, the loopbacks, the site domain's own
  labels), the free addresses, and everything else. The page does the one
  trusted lookup — `active` rows only — or answers 404, which is what a
  hostname nobody connected deserves.
- **The platform-wide uniqueness of a hostname is checked under `withSystem`
  before Vercel is asked**, one boolean, because a tenant transaction cannot
  see another tenant's rows and the unique index would otherwise refuse the
  insert after the domain was already on the project.
- **Remove is provider-first, then the row**, as Square's disconnect does it;
  without a token the provider step is skipped so a row can always be
  cleaned up.
- **`example.co.uk` reads as a subdomain** and is offered a CNAME. The guide
  tells the owner to connect the `www` form, which is Vercel's own advice for
  any apex.
- **The logo stays private.** The `[id]/logo` route proves the tenant, reads
  the row through RLS, then streams — and it is NOT gated on the Marketing
  module, because the brand has consumers of its own. A public URL for the
  website is a separate route with its own rules, when it exists.
- **The heading falls back, the rules do not.** A brand colour is used as
  text only when it reads on white (WCAG 3:1); a pale brand yellow keeps
  colouring the rules and the heading returns to the ink. `readableOnWhite`.
- **The reminder sweep caches logo bytes per run.** One tenant's logo is one
  blob read for the whole sweep, not one per invoice.
- **The word "company" is earned.** The `Companies` section renders only when
  a tenant has more than one active company or a company already has a kit
  (ADR 0010: the one-company client never learns the word).
- **`/dashboard/m/marketing` IS the brand screen for now.** A hub with one tile
  would be a click that leads nowhere. When the website and domains arrive
  the hub grows a `CategoryStrip` and the kit moves under `/brand` — the
  guide's route is `/dashboard/m/marketing/**` so it survives that move.
- **The em dash is not product copy.** A user-facing message here reads like
  something a person would say (`docs/help/_TEMPLATE.md` VOICE); the first
  draft of the too-large message had one and was rewritten.

## Open items

- **Buy the site domain and set `SITE_DOMAIN`.** A domain the platform owns,
  on Vercel's nameservers, with a wildcard added to the project. Until then
  every site is `/sites/<slug>` on the platform host. The founder decides the
  name.
- **An ISR cache hit has never been seen** — the dev server renders every
  request. The production build proves it: `x-nextjs-cache: HIT` on a second
  fetch of a published page, and a MISS right after a publish.
- **A pointer drag has not been seen by a person.** The editor's keyboard
  drag is proven; the mouse path is the same sensor set and drop handler,
  but the browser tooling could not produce a real pointer drag. Ten seconds
  with a mouse on the dev branch settles it.
- **Photos in sections** need a public image route like the logo's and an
  upload in the editor; the content model gains an `image` section then.
- **Rewriting one section with the assistant** (rather than the whole site)
  is the editor-shaped version of "Rewrite the words"; the slot prompt
  already exists per section kind.
- **`DndContext` needs an `id`** or its accessibility ids differ between
  server and client and React reports a hydration mismatch — found on the
  first render of the Pages panel and fixed by naming both contexts.
- **Switch connecting on: `VERCEL_API_TOKEN`, `VERCEL_PROJECT_ID` (and
  `VERCEL_TEAM_ID`) in Vercel.** Until then the screen says the feature is
  not switched on and the free address carries on. The first real connect
  is the founder's, with a domain he owns; the Vercel calls have only been
  exercised against the documented shapes.
- **Purchasing (3b)** waits on the terms, the transfer runbook and a billing
  decision — ADR 0020 has the rules. That is also when the mail module's
  wizards publish through Vercel DNS and the shared `domains` table arrives.
- **Apex + www as a pair.** Vercel redirects between them on its own; the
  screen connects one name at a time and does not yet offer "add the other
  one too".
- **Answers stay on the enquiry, the follow-up and the email; they do not
  reach CRM's `custom` fields.** Mapping a question to a CRM field needs
  CRM's field definitions (`validateCustom`), which a shared path cannot
  import; a CRM-side "file website answers under these fields" setting is
  the shape, and it waits for someone to want it.
- **Views have no ceiling.** The beacon's write is an increment on one
  bounded row, so no cap was added (ADR 0022). If a site's numbers are ever
  inflated on purpose, a per-site daily ceiling on `views` is the first
  thing to add.
- **CRM's `record_created` automation does not fire for a website record**
  — the public path writes the details row directly rather than through
  CRM's `createRecord`. Noted in crm.md's open items; a "website lead" rule
  needs a trigger the shared path can call.
- **Nobody has sent a real message through a live site yet.** The path was
  driven on the dev branch (see the build log); the first production message
  will be a client's, or the founder's own test on his site.
- The `cta` and `hero` buttons point at the contact page; the assembler pins
  that, and the prompt asks for labels that say so.
- **The shop block** is `retail` slice 6's, through a declared section slot.
- **Sitemap and robots per site**, and a `canonical` pointing at the host
  address once one exists.
- **Rewriting replaces every draft.** Fine while the assistant is the only
  writer; the editor makes a per-page rewrite the right grain.
- **The dev-branch Test tenant now holds a published site `oak-row-farm`**,
  left from this verification — since slice 4 with an enquiry form on its
  contact page, three messages (two from Jane Doe, one from Sam Rivers),
  the two parties, three `Reply to …` items and, because the CRM-on path
  needed proving, **CRM and Work switched on** for it.
- **Not yet looked at: dark mode, a phone, and a square mark on the PDF.**
  The screen was driven on the dev branch (build log) but only in the light
  theme on a desktop pane. The colour input on a phone and whether the
  160×56pt logo box wants to be taller for a square mark (a 512×512 logo
  renders 56pt square, which is small) are the two things to check with the
  founder's real logo. **The dev-branch Test tenant now holds a draft
  `INV-0001` and both dev tenants have Marketing switched on** — left from
  this verification, harmless, and worth knowing before the next fixture
  sweep.
- **0c: an illustrated symbol** from OpenAI's image model, transparent PNG,
  never the name, composed by the kit beside its own wordmark. Needs
  `OPENAI_API_KEY` (local and Vercel), a lazy client, a stored mark blob and
  `sharp` compositing; the spec grows `mark: "image"`.
- **One typeface.** Every candidate is Noto Sans regular or bold; the set
  would widen with a serif and a display face, which arrive with the website
  (Noto Serif was not fetchable from the notofonts repository on 2026-09-04;
  the Google Fonts zip is the other source).
- **A designer's SVG is not preserved** — it becomes a 1200px PNG. If a
  vector upload ever matters more than the no-markup-in-the-store rule, the
  answer is a sanitiser, not serving the file.
- **More consumers:** the mail signature default and mail templates, the
  Documents generator's letterhead, the public share page's header, the app
  shell's sidebar identity. Each is an import of `resolveBrandFor`.
- **Fonts.** The kit has no type pairing because the PDF has one face
  (NotoSans) and nothing else renders text in the brand yet. Arrives with the
  website.
- **A public logo URL** for the website and for HTML email (an email cannot
  fetch a signed-in route). Serve the same private bytes from a public route
  keyed by something unguessable, cached hard.
- **`accent_color` has no consumer yet.** Stored and previewed so an owner
  sets both once; the website is its first reader.
- **The Companies section links nowhere.** A company is created on
  Accounting's Companies page; the section could say so when there is one
  company and no books.
