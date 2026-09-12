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
| **5** | **Photos — a library per site in the private store (one derivative, metadata stripped, ≤ 1,600px), uploaded from the editor's picker, served by the platform on every public route, placed beside the hero, beside the about section, and as a `Photo` section of its own.** [ADR 0023](../decisions/0023-photos-are-one-derivative-in-the-sites-library.md) | **built 2026-09-04** |
| **5b** | **A `Photo gallery` section: up to twelve photos from the library in a grid of two, three or four, with a heading and a caption each; a photo opens larger in a new tab.** | **built 2026-09-04** |
| **5c** | **A `Slideshow` section (photos one at a time, arrows and dots, moving on by itself if asked, paused on hover, still under reduced motion) and a lightbox for the gallery's tiles — the public page's one moving part, in one client component with no library.** | **built 2026-09-04** |
| **5d** | **A swipe across a slideshow or the lightbox moves between photos (pointer events, vertical scrolling left to the browser); the arrow keys move a focused slideshow.** | **built 2026-09-04** |
| **5e** | **The alt text nudge: photos without a description are counted per section and per page in the editor's list, and per page on the Website screen's Pages panel.** | **built 2026-09-05** |
| **6** | **Columns and cards: two to four columns of cards (photo or icon, heading, a few lines, a button), sortable in the editor, in white panels on a band or plain, with a wide-left or wide-right variant for two columns.** | **built 2026-09-05** |
| **6b** | **Layout presets on every section (width, spacing, alignment; the hero's height and photo side, the about section's photo side) and backgrounds (none, a tint, the brand colour, dark, a photo with an overlay), with the words' tone following the background.** | **built 2026-09-05** |
| **6c** | **The frame around every page: an announcement bar, a header button, social links as marks, footer columns and a footer line, edited on the Website screen and live the moment they are saved; and a link is now one of four shapes, on save and at render.** | **built 2026-09-05** |
| **6d** | **Fonts and looks on the brand kit: a Modern, Warm or Classic look, six curated font pairings bundled by the platform, and pill, rounded or square buttons, with the corners following the look; a sample beside the fields reads as the site will.** [ADR 0024](../decisions/0024-a-look-is-a-preset-and-its-fonts-are-the-platforms.md) | **built 2026-09-05** |
| **7** | **The editor's preview at a phone's or a tablet's width, remembered per browser; a click on a section in the preview selects it in the editor, and the editor's selection is outlined in the preview, through `postMessage` on the same origin.** | **built 2026-09-05** |
| **8** | **Bookings: a `Book a time` section whose open times are the section's hours minus what is on a Bookings calendar the platform provisions; a booking lands as an enquiry with a time (party, CRM record, follow-up, email) and as a calendar item with the visitor on it.** [ADR 0025](../decisions/0025-a-booking-is-an-enquiry-with-a-time.md) | **built 2026-09-05** |
| **9a** | **The first live block: `What's on`, the next events from an Events calendar the platform provisions, drawn from the calendar when the page is rendered and kept current by themselves.** | **built 2026-09-05** |
| **9b** | **Prices and availability from the packs through a declared slot: a pack contributes a block kind, its editor fields (as data) and the rows to draw; the site offers it while the pack is on, draws it in its own look, and hosts it. Retail's `Price list` is the first block: one channel's current prices with what has run out marked, from Inventory's balance. A live team block is not planned: Columns does a team by hand, and a live one raises consent questions a section should not answer.** [ADR 0028](../decisions/0028-a-packs-block-is-data-the-site-draws.md) | **built 2026-09-05** |
| **10** | **`Find us`: a map of the site's address, a picture the platform draws from public-domain USGS tiles around a pin the Census geocoder placed at save, with the address and a `Get directions` link. No client library, no third-party request from a visitor's browser, United States only.** [ADR 0026](../decisions/0026-a-map-is-a-picture-the-platform-draws.md) | **built 2026-09-05** |
| **11a** | **What search engines and browsers ask a site for: `robots.txt` and `sitemap.xml` per site on every address it has, LocalBusiness structured data on the home page from the settings (address, phone, email, the map's pin, the logo, the social profiles), and an icon from the brand kit (a square logo as it is, otherwise a monogram in the brand colour) at 32, 180 and 512.** | **built 2026-09-05** |
| **11b** | **A share image drawn per page (the page's title in the kit's type on the brand colour, the logo or the monogram in a white panel, the address in the corner) as `og:image` and the Twitter card; and an address the site used to have sends people on to the current one, for the same page, on the platform path and on the free address.** | **built 2026-09-05** |
| **12** | **The assistant everywhere: new words for one section with an optional ask, a page from a sentence, a photo's description from its pixels. Each proposes words into slots the code chose, unsaved until the owner saves; nothing else about a section is sent or changed.** [ADR 0027](../decisions/0027-the-assistant-proposes-words-and-the-owner-saves-them.md) | **built 2026-09-05** |
| **13** | **The preview follows the editor: the draft frame draws the editor's unsaved page through `postMessage` on the same origin, and the pack blocks and events it needs come from `/api/marketing/sites/live`.** [ADR 0029](../decisions/0029-the-preview-follows-the-editor-not-the-save.md) | **built 2026-09-05** |
| **14** | **The header folds on a phone: a script-free disclosure behind a `Menu` button, the header button beside it.** | **built 2026-09-05** |
| **15** | **Industry site templates: a template is data an industry contributes (pages of typed sections with starter words, a frame, a look, picture slots the platform's drawn scenes fill); the core assembles it against what the tenant has switched on and the writer fills every word slot. The homestead farm's is five pages: Home, Shop, Visit, About, Contact.** [ADR 0030](../decisions/0030-a-site-template-is-data-an-industry-contributes.md) | **built 2026-09-05** |
| **15b** | **The farm template sharpened: the owner's own lines about the business feed the writer, a title tag per page, How to buy and hours on Home.** | **built 2026-09-05** |
| **16** | **Testimonials and questions, shown only once filled (an FAQPage for search engines), and the logo's size on the header.** | **built 2026-09-05** |
| **17** | **The visual pass, from the best farm sites: the hero's eyebrow and second button and its scale by height, photo tiles for what is offered, icon circles, larger headings, a sticky header and a brand-colour footer, all in the renderer.** | **built 2026-09-05** |
| **18** | **The shot list: every place a photo belongs, read from the pages and never stored, with what to take there in the template's own words, filled from a phone through the camera.** [ADR 0031](../decisions/0031-where-a-photo-belongs-is-read-from-the-page.md) | **built 2026-09-05** |
| — | The shop block: `retail` slice 6 (online orders + pickup windows) fills the slot 9b made, plus a client island the site owns and a provider names; blocked on commitments (retail 3) and web checkout (payments) | not this module's |

## Build log

Newest first. One entry per session/PR that touched this module. Every PR
that changes this module MUST add an entry here (rule in AGENTS.md).

### 2026-09-11 — A website can be removed (`claude/a-website-can-be-removed`)

Lifting the one-site limit made "add a website" reachable and left no way to
undo it — the founder's first mistaken site would have been permanent. No
migration: every child table already cascades on `sites`.

- **Two refusals, and they are the design.** `deleteSite` refuses a PUBLISHED
  site ("unpublish it first") and one with a CONNECTED DOMAIN ("remove the
  domain first"). Both make the destructive act the second thing that happens,
  never the first. The domain refusal is also correctness: the domain has to
  come off Vercel as well as out of the table, and `removeDomainAction` is the
  tested path that does both — cascading the row here would leave the project
  holding a domain pointing at a site that is gone, which is the half of a
  broken delete nobody can see from inside the app.
- **THE BLOBS ARE THE ONE THING THE DATABASE CANNOT CLEAN UP.** `site_images`
  and the site's own logo are rows pointing at files; a cascade deletes the
  rows and leaves the files. `deleteSite` returns the pathnames and the action
  discards them AFTER the commit — before it, a rollback would have destroyed
  files for a site that still exists. A discard that fails is swallowed: the
  row is already gone, so throwing would report a failure that did not happen.
- **The confirm counts what goes** — pages, photos, messages — because "are you
  sure?" asks a question the reader cannot answer without going to look it up.
  It also says what STAYS, which is the half people get wrong: every enquiry
  already became a customer in CRM and a follow-up in Work, and the follow-up's
  notes carry the message itself (`enquiryNotes`). What goes is the enquiry ROW.
- **Neither refusal is drawn as a disabled button.** The reason a delete is
  unavailable is a sentence worth reading, and a disabled control with a
  tooltip is how that sentence goes unread.
- **`SITE_EXISTS` removed.** Nothing has thrown it since a business could have
  several sites, and its message — "This business already has a website" —
  had become a lie.
- **Tests**: four cases in `tests/isolation/sites.test.ts` — the published
  refusal followed by a successful delete once unpublished, the domain refusal
  followed by the same, the full cascade with the blob pathnames handed back
  (checked under `withSystem`, so RLS is not the reason a row looks gone), and
  another tenant's site refused and still present afterwards. 45 passing.
- **DRIVEN ON PRODUCTION** (2026-09-11), in the operator tenant, after the
  merge and once delete existed to make a throwaway safe: built
  `scratch-delete-test`, which landed straight on its own screen and put
  `All websites` in the header beside `Add a website` now that there were two.
  The confirm asked, verbatim: *"Delete scratch-delete-test? This removes 3
  pages, 0 photos, 0 messages, and cannot be undone. Your customers and
  follow-ups are kept — they live in your CRM and your work list, not on the
  website."* The toast confirmed, the URL dropped its `?site=` and the one
  remaining site opened straight in with `All websites` gone again. **The
  database afterwards: one site, and ZERO orphaned rows** across `site_pages`,
  `site_images` and site-owned `brand_kits`; the audit row carried
  `{slug, pages: 3, photos: 0, enquiries: 0}`. Yosher Homestead was untouched —
  its 9 sections, its own kit, its logo.
  **The PUBLISHED refusal is still proven by test only**: exercising it in the
  UI would mean putting a junk site on the real domain for a few seconds, and
  the isolation case already covers it.
  *(The confirm was accepted by replacing `window.confirm` so its exact wording
  could be asserted rather than dismissed by a native dialog the harness cannot
  read. Everything either side of it — the button, the action, the navigation —
  was the real thing.)*

### 2026-09-11 — The site wears its own look everywhere (`claude/the-site-wears-its-own-look`)

**Found by driving it on production**, in the Yosher App workspace, which no
session had been able to reach before. Gave the seeded Yosher Homestead site
its own look, drew it its own wordmark — and the page header still showed
Yosher's logo. No migration.

- **A LOOK PER WEBSITE SHIPPED HALF-WIRED.** Seven brand reads were enumerated
  in that session's own analysis and **two were changed**. The header logo
  (`src/lib/sites/logo.ts`), the favicon (`icon.ts`), the drawn map's pin
  colour (`map.ts`), the assistant's brief (`assistant-actions.ts`) and the
  rewrite (`site-actions.ts`) all still read `resolveBrandFor(tx, tenantId,
  null)` — the BUSINESS's brand. All five now resolve the site's.
- **The failure is invisible at runtime, which is why it survived review.**
  `resolveBrandFor` returns a real brand and renders a real logo; it is simply
  the wrong business's, and only on a tenant that has given a site a look of
  its own — which no fixture had, and which is precisely the tenant the
  feature exists for. Every line looked like the line beside it.
- **`tests/site-brand-contract.test.ts` is a SCAN, not a behaviour test**: no
  file under `src/lib/sites/` may call `resolveBrandFor`, because everything
  there serves one site by definition. It was run against the old code first
  and named `logo.ts`, `icon.ts` and `map.ts`. The two places the business kit
  is still correct are listed in the test with their reasons —
  `createSiteAction` (no site exists yet) and the kit editor's preview.
- **What the drive DID confirm**, all on production: the Website screen opens
  straight into the one site and offers `Add a website`; the seeded page
  renders its nine sections in order; `Give it its own look` creates the site
  kit and the panel becomes the full editor inheriting the business's colours;
  a name and tagline save to the SITE and the business kit keeps its own; the
  Warm look reached the page (serif headings, 10px buttons where the business
  has pills); and **`Draw a logo` pre-filled "Yosher Homestead" / "YH" from the
  site's kit** and drew six wordmarks in the site's colours, one of which is
  now the site's own.

### 2026-09-10 — The enquiry says which site it came from (`claude/which-site-sent-the-lead`)

Both public doors this module owns — the enquiry form
(`src/lib/sites/enquiries.ts`) and the booking form (`src/lib/sites/bookings.ts`)
— now pass `sourceDetail: site.title || site.slug` through the lead slot
(ADR 0042), so a CRM record says WHICH of a business's websites produced it.
**Never the tenant's name as a fallback**: two sites of one business reading
identically in the CRM is the one thing the field exists to prevent. Migration
0298 and the rule the merge needed are written up in
[crm.md](crm.md); nothing about how a site is rendered or published changed.

### 2026-09-10 — Adding a second website (`claude/add-a-second-website`)

**A defect the previous two PRs shipped, found by the founder:** "I don't see
anything different on the production. still just one website." He was right,
and the reason was a catch-22 of my own making.

- **"Add a website" lived only on `SiteList`, and `SiteList` is drawn only from
  two sites up** (`chooseSite`) — so a business with ONE site had no control
  anywhere that could make a second. Every tenant in production has exactly one
  site, so nobody could reach the feature at all. It now lives in the Website
  screen's `PageHeader`, where it is reachable from a site rather than only
  from a list that site's existence prevents. `All websites` joins it once
  there are several, and the header's title becomes the site's own name so a
  person knows which of them they are editing.
- **Building a site now GOES to it.** `useRun` only calls `router.refresh()`,
  and the build form is reached at `?site=new` — where a refresh redraws the
  build form and the site just built is nowhere, looking exactly like a press
  that did nothing. `BuildSiteForm` now pushes to `?site=<id>` from the
  `siteId` that `createSiteAction` already returned.
- **THE LESSON, and it is not about this feature.** Both halves were verified
  by `tsc`, a green build, 3080 tests and an isolation run, and both were
  reachable only by a user doing the one thing the tests never do: *starting
  from the state every real tenant is actually in.* A one-site tenant was the
  universal case in production and the untested case in the suite.
- **Driven end to end on the dev branch's Hilltop Farm**: one site → the header
  offers `Add a website`; `?site=new` draws the build form; `Build it` writes
  the site, the toast fires and the screen lands on
  `?site=ff4d072c-…` titled `hilltop-farm-store`; the header then offers
  `All websites`, and the list draws both with `Live` and `Draft`.
- **`hilltop-farm-store` IS KEPT on the dev branch, deliberately.** It is the
  only two-site tenant anywhere, and the list, the `All websites` link and the
  per-site look panel cannot be driven by hand without one — the same reason
  the Test tenant keeps two companies. Do not tidy it away.
- **A browser-pane trap, not an app bug:** while a viewport is emulated tall
  (`resize_window` 1280×4600, used to screenshot a long page), `left_click` by
  `ref` reports the right coordinates and hit-tests correctly but never reaches
  the handler. Three clicks looked like an app that ignored them. Reset to
  `preset: "desktop"` before driving anything.

### 2026-09-10 — A look per website (`claude/a-look-per-website`)

The write half of [ADR 0045](../decisions/0045-a-business-may-have-several-websites-and-a-kit-may-belong-to-one.md),
which the session before this one left as a column nothing filled in. **No
migration** — `brand_kits.site_id` and its constraints went out with 0297.

- **`KitOwner` replaces `entityId: string | null`** through `kit-ops` and the
  kit actions: `{ kind: "business" }`, `{ kind: "company"; entityId }`,
  `{ kind: "site"; siteId }`. Two states became three, and a second nullable
  parameter would have made every function decide what both-set means — a
  question `brand_kits_one_owner` already refuses to represent.
- **The type lives in `src/lib/brand/owner.ts`, not in `kit-ops`**, because the
  screens need it and `kit-ops` is `server-only`. That file also holds
  `ownerFields` (the wire/column shape), `ownerFrom` and `isBusinessKit`.
- **A THIRD instance of the same bug, found and fixed here.** ADR 0045 had
  already closed `resolveBrandFor` (which would have printed a site's logo on
  the invoices) and `kitWhere` (which would have let a save to the business kit
  overwrite a site's). The Marketing screen had it too:
  `kits.find((k) => k.entityId === null)` over `loadBrandKits`, which returns
  every row — so **a website's kit could have been drawn as the business's
  brand**, and `find` takes the first match. `isBusinessKit` is now the one
  predicate, and it exists as a named function precisely because the inline
  version has been wrong three times.
- **One editor, three owners.** `BrandKitPanel`, `BrandKitForm`,
  `LogoControls` and `LogoGenerator` all take an owner now, so the Website
  screen draws the SAME panel the Marketing screen draws for the business and
  for a company. `company-look-controls.tsx` became `own-look-controls.tsx`
  (`StartOwnLookButton` / `RemoveOwnLookButton`): the two pairs differed only
  in a noun and in what the warning said was at stake — invoices for a company,
  pages for a site — and keeping two is how the wording drifts.
- **The Website screen gained "This website's look"**, below Address and
  OUTSIDE the owner-only block so staff can see which brand a site wears. A
  site with no kit says *"Uses your brand"* and offers one button rather than
  drawing an empty form.
- **A new site's suggested look still goes on the BUSINESS kit**, and the
  existing guard is what makes that safe now that it could go elsewhere: it
  applies only when the business has chosen no look at all, so by the time a
  second site is built the condition is false and a new brand can never
  redefine the one every other site inherits.
- **Driven on Hilltop Farm**: the Website screen renders the panel at the
  bottom reading *"Uses your brand. … Give it its own look"*. **Not clicked** —
  the dev server reads the PRODUCTION database, and pressing it would have
  written a real `brand_kits` row for a tenant nobody asked me to touch. The
  write path is covered by the test below instead.
- **Tests**: `tests/brand-owner.test.ts` (the wire round-trip, and
  `isBusinessKit` against a list holding all three kinds with the SITE's row
  first, because that is the row the old predicate returned) and two cases in
  `tests/isolation/brand.test.ts` driving the real ops — a site kit created,
  found, saved and deleted **with the business kit asserted untouched**, and
  another tenant's site id refused before anything is written. `server-only` is
  stubbed in `vitest.config.ts`, which is what lets a test call the module's own
  ops.
- **Not built here:** an enquiry recording WHICH site produced the lead; a kit
  shared by two sites (two kits with the same values today); and the per-site
  look reaching the invoice PDF, which stays the business's and should.

### 2026-09-10 — Many websites per business, and a kit that may belong to one (`claude/many-sites-per-tenant`)

The founder: "lift the one-site-per-tenant limit … the logo for each industry
will be slightly different, plus … we will need to be able to handle the social
media for each industry." **Migration 0297, applied to dev AND prod before the
merge** (ADR 0014) and proved in `pg_indexes`: `sites_tenant_idx` is now a
PLAIN index on both.
[ADR 0045](../decisions/0045-a-business-may-have-several-websites-and-a-kit-may-belong-to-one.md).

- **The limit was thinner than it looked.** Every table hanging off a site —
  `site_pages`, `site_domains`, `site_enquiries`, `site_page_views`,
  `site_images` — already keyed on `site_id`, and `site_domains_site_idx` was
  never unique. What assumed one site was CODE.
- **`findSite(tx, tenantId)` is gone**, with its thirteen callers.
  `listSites` and `findSiteById` replace it, and every action that touches a
  site now names one through a `siteRef` Zod object. "The tenant's site" is no
  longer a question with an answer.
- **`chooseSite`** (`src/lib/sites/choose.ts`, pure and tested): one site opens
  without being asked and wins over a stale `?site=` in a bookmark; `new` steps
  aside so a second can be built; two or more with none asked for draws
  `SiteList`. **A business with one website never learns the plural exists** —
  ADR 0010's promise about companies, kept again. Two screens ask (the Website
  screen and the shot list), which is why the rule is one pure function.
- **A kit may belong to a website**: `brand_kits.site_id` beside `entity_id`,
  `brand_kits_one_owner` forbidding both, a composite FK that CASCADEs, and
  `resolveBrandForSite` merging the site's look over the business's exactly as
  a company's already merged. The public renderer, the drafts screen and the
  site read path all resolve the SITE's brand now.
- **TWO LIVE BUGS THE COLUMN CREATED, both fixed here.** `entity_id is null`
  had meant "business-wide"; a site's kit also has a null `entity_id`, so the
  one-column predicate in `resolveBrandFor` (read) AND `kitWhere` (write) would
  have found a site's row — putting a site's logo on the invoices, and letting
  a save to the business kit overwrite a site's. Both predicates now require
  BOTH nulls.
- **`tsc` is blind to the boundary that mattered.** Server actions take
  `input: unknown`, so seven client forms could have shipped without a
  `siteId` and typechecked — the symptom would be a form that says "check the
  fields" forever. They were found by grepping every caller of each changed
  input schema, not by the compiler. Required React props WERE used
  deliberately for the component tree, because there the compiler does find
  every render site: it walked the cascade out to `section-forms`'s `photos`
  context and the page editor.
- **Nothing writes `site_id` yet.** The column, the constraints and the read
  path are in and honoured; the editor still edits the business kit and the
  per-company one, so every site wears the business look — as it did before,
  so nothing regressed. The per-site kit editor is the next PR and is the
  larger half: 45 `entityId` references across `kit-ops`/`actions` and five
  components, which want a `KitOwner` discriminated union rather than
  `entityId: string | null`.
- **Tests**: `tests/sites-choose.test.ts` (every branch, including one-site
  winning over a stale id and never reporting a site and a list at once) and
  three cases in `tests/isolation/sites.test.ts` — a second site with its own
  platform-wide address, a per-site kit that may not own two things or name
  another tenant's site, and a kit dying with its site. **One existing
  assertion was retired**: "a tenant holds one site" was the limit itself.
  `test:isolation` 660 passing on the dev branch; `verify-rls` 176 tables on
  both.
- **Not built here:** the per-site kit editor, and an enquiry recording WHICH
  site produced the lead (still `source = 'website'`, which stops being enough
  the day a second site is published).

### 2026-09-05 — Slice 18: the shot list (`claude/marketing-shot-list`)

The founder, looking at his own Shop page with three tinted tiles and no
photos: "I'm assuming this page is supposed to have some photos, but there
is no way of me knowing that." The pages know where a photo belongs; now
they say so, and the saying is a list a person can take into the field
and fill from a phone. No migration.
[ADR 0031](../decisions/0031-where-a-photo-belongs-is-read-from-the-page.md).

- **The spots are read, never stored** (`src/lib/sites/shots.ts`, pure).
  `pageSpots` walks a page's sections and lists every place a photo can
  go: behind a hero whose background is a photo (`cover`), beside a hero
  otherwise (`beside`, optional), beside an About (`about`), each item of
  a What you offer (`item`), each card of a Columns (`card`, optional), a
  Photo section (`picture`), an empty gallery or slideshow (`set`, one
  spot that appends) or the photos already in one, and behind any other
  section whose background is a photo (`backdrop`). A spot is `empty`,
  `starter` (one of the platform's drawn stand-ins, known by the
  `starter-` name its file carries, `isStarterPhoto`) or `photo`; it has
  a shape (wide, landscape, square, any) and a note on what to take. Keys
  are `"<section>:<where>"` (`spotKey`/`parseSpotKey`); `placePhoto` puts
  one photo into one spot of the content as it is NOW and refuses, with
  the reason, a key the page no longer fits. `shotSummary`/`shotLine` are
  the one line on the Website page and at the top of the list;
  `emptySpotCount` is the editor's line. `tests/site-shots.test.ts`.
- **The notes are the template's, by role and by slot**
  (`SiteTemplate.shots`, `TemplatePicture.shot`, read by `shotNotesFor`).
  The farm says "Beef as the customer gets it, close, in daylight, on a plain
  background: the wrapped pack, the open carton, the full box"; a picture slot's `shot` wins over
  the role's note while the section at that index is still of the kind
  the template put there, so a moved section falls back to its role. The
  core's `GENERIC_SHOTS` are true of any business and a test keeps them
  free of farm words.
- **The screen** (`/dashboard/m/marketing/website/photos`,
  `components/shot-list.tsx`). A card with the line; a section per page
  in menu order with `Edit the page`; a row per spot, open ones first,
  optional after wanted, filled last: the photo or a dashed box in the
  spot's shape, the name, the section it sits in, the note, and for owners
  the buttons. `Take a photo` is a file input with `capture="environment"`,
  offered only where `navigator.maxTouchPoints` says there is likely a
  camera (read through `useSyncExternalStore`, so the server renders
  without it); `Choose from your phone` / `Upload a photo` and `From the
  library` (the picker's own dialog) stand beside it. An upload goes the
  picker's way (`uploadPresigned` → `registerSitePhotoAction`) and then
  `placePhotoAction`; a filled row gets `Describe the photo` with the
  assistant's `Suggest` and `Save description`, the same action with the
  same photo and new words. A row keeps what it placed as an override
  over the server's props, so the placement shows at once and the
  `router.refresh()` that follows agrees with it.
- **The write** (`placePhotoAction`, `page-actions.ts`): the gate (owner),
  Zod, the page row and the photo row under RLS (the photo must be this
  site's), `placePhoto`, then `savePageDraft` with the page's own title,
  the path left alone and its nav flag, so a version is recorded like any
  save; audit `marketing.site.photo_placed` with the path, the spot key
  and the photo id. `page-actions.ts` and `image-actions.ts` revalidate
  the new route.
- **Where it shows.** The Website page gains a `Photos` card between Pages
  and Messages with the line and `Open the shot list`; the Pages rows say
  `3 photos to take`; the editor's Sections panel says `2 places for a
  photo on this page are empty.` with `The shot list` as a link.
  `loadSiteDrafts` now returns the image rows as well, since the page
  needs a pathname to know a stand-in. `images` joined the guide icons.
- **Verified on the dev branch.** Hilltop's list read 20 places: 17 to
  take, 3 stand-ins (the hills, dawn and furrows scenes), the Contact
  page none; the Pages rows read `11 photos to take` and so on. `From the
  library` on the Shop hero's `Beside the headline` spot placed the hills
  scene: `Photo placed.`, the row showed the picture with `A drawn
  stand-in` under it, the count rose to four, and the draft on the server
  agreed (`sections[0].image`), then was put back. The upload and the
  camera are the picker's proven path and the browser's own file input;
  the pane cannot choose a file, so a phone has not been seen taking one.
  Two traps: a route added while the dev server ran 404'd without
  compiling until the server was restarted, and a click on a scrolled
  page in the pane did not land until the viewport was made tall enough
  to hold the whole page (`resize_window` 1100×3400).
- **Guides.** `docs/help/marketing/shot-list.md` is new (route
  `/dashboard/m/marketing/website/photos`); `website.md` gains the
  `Photos` card and the Pages row's count; `page-editor.md` the line under
  Sections. Security rows for the route and the action.

### 2026-09-05 — Slice 17: the visual pass, from the best farm sites (`claude/marketing-site-visual-pass`)

The founder: "the design could use some work; browse some of the best
websites for ideas, mainly visually." Looked at Seven Sons Farms, White
Oak Pastures, Polyface Farms and a template gallery at desktop width.
What the best share: a full-bleed photo hero with a huge display headline,
a small-capitals line above it and two buttons; product tiles with photos
and the name on the picture; a three-step "how it works" with icons in
tinted circles; section headings large enough to carry a band; alternating
photo-and-words rows; a dark or brand-colour footer; a sticky header. Each
is now the renderer's, so every site gets it, and the farm template leans
on all of them. No migration.

- **The hero.** `eyebrow` (≤60, small capitals in the accent on a light
  band and in white on a photo) and `secondary` (a second button drawn as
  an outline) join the content model; the headline's scale follows the
  section's height (up to `text-7xl` on a tall hero); the buttons grow
  (`size="lg"`). A photo background's flat wash became a gradient, darkest
  under the words and lightest above, so the picture still reads.
- **Product tiles.** `offer` items take an optional `image`: with one, the
  photo with the name on a bottom gradient; without, a band in a tint of
  the brand colour (`color-mix`) with the item's initial in the corner.
  Counted by the alt nudge like any placed photo; the editor has a photo
  picker per item.
- **Cards, headings, buttons.** A card's icon sits in a circle tinted
  with the accent; every section heading is one scale (`H2`, `text-3xl
  sm:text-4xl`); buttons are semibold with a hover shadow.
- **The frame.** The header is sticky with a blur; the footer is a band in
  the brand colour with its own foreground, column headings in small
  capitals, and the social icons inheriting the colour.
- **The farm template** uses all of it: `Raised here. Sold direct.` above
  the headline, `See what we sell` and `Plan a visit` side by side, the
  home page's marketing sections centred, and the About story as an
  `about` section with the furrows picture beside it rather than a
  picture on its own.
- **Driven on the dev branch**: Hilltop Farm rebuilt through the same
  functions as the button (37 seconds of writing, three pictures) and
  published; the home page drew `GRASS-FED SINCE 1998` in small capitals
  over a headline at the largest scale, two buttons, the gold sun on the
  lighter hills under the gradient, and `What we raise` as four tinted
  tiles with initials; the cards, headings and the brand-colour footer
  followed. Tests: the hero's new fields and the offer item's photo in the
  core, photos, pages, assistant, template and proof suites.
- **Not built here:** a review-count strip (needs a source of reviews), a
  press-logo row, and a newsletter band (an outbound-mail decision).

### 2026-09-05 — Slice 16: testimonials, questions, and the logo's size (`claude/marketing-proof-and-logo-size`)

The founder, with his own site open: add testimonials and an FAQ, shown
only once filled; and "I still don't see a way to resize things. I want to
make the logo bigger." No migration.

- **Two section kinds that show only once filled** (`src/lib/sites/proof.ts`,
  pure). `quotes`: a heading and up to six quotes (words ≤400, a name, a
  word about them); a quote shows only with words AND a name. `faq`: a
  heading, a note and up to ten questions (≤120) with answers (≤600); a
  question shows only once answered, drawn as native disclosures (no
  script, the fold's rule) and told to search engines as an FAQPage from
  the answered ones alone. With nothing complete a section draws nothing
  on a public page, a faint line in the draft preview, and the editor's
  list says `none filled in yet` / `none answered yet`. Both are in the
  editor's catalogue as `Testimonials` and `Questions`, in the assistant's
  slot map, and `faq` is a block the page-from-a-sentence writer may
  choose (only questions the brief lets it answer).
- **The farm template carries both**: an empty `What customers say` on
  Home before the call to visit, and six `Common questions` a farm that
  sells direct is asked (halves and wholes, delivery, pickup, packaging,
  cards, visits) on the Shop page with BLANK answers, so they wait in the
  editor until the owner answers and the site writer is never handed a
  blank answer to guess (`templateSlots` leaves them out).
- **The logo's size.** `settings.logoSize` (small, medium, large; medium
  is what every site had): a `Logo size` block on the Header and footer
  card, three buttons, saved with the frame; the header draws
  `h-8`/`h-10`/`h-12 sm:h-16` with a ceiling on the width. Where the
  other sizes live was the founder's real question: every section's
  `Width` and `Spacing`, the hero's `Height`, a photo section's own
  `Width`; the guide says so under the logo block.
- **Driven on the dev branch** on Test's home page, signed in: the editor
  offered `Testimonials` and `Questions` after `Columns`; a quote with a
  name and one without, a question with an answer and one without, saved
  (`What customers say: 1 quote`, `Common questions: 1 answered`); the
  draft drew the named quote and the answered question only; published,
  the public page carried the quote and an FAQPage with the one answered
  question; the logo set to Large drew the header's image at the larger
  height. Tests: `tests/site-proof.test.ts`, and the frame, style and
  template suites learned the new kinds.

### 2026-09-05 — Slice 15b: the farm template, sharpened (`claude/marketing-farm-template-sharpened`)

The founder asked whether the template was top notch and said he wanted
best-in-industry. Against what the best direct-to-consumer farm sites do,
five things were short, and all five are in. No migration.

- **The writer knows what the farm sells.** `settings.about` (up to 600
  characters, "About the business" on the build form and under the details
  card): the owner's own lines about what they raise, how, and who buys it.
  It rides the brief (`SiteBrief.about`) into the site writer and the
  editor's assistant as "In the owner's own words", and the farm template's
  writer notes tell the model to name exactly what the owner names and
  nothing else. Never shown on the site as written.
- **Search titles.** `PageContent.seoTitle` (≤70): the title tag and the
  Open Graph title when set, else the page and the site as before. The
  page editor has `Title for search engines`; the writer fills it for every
  page (what the page offers, the town, then the name); the farm template
  carries starters. The live preview's shape check passes it through.
- **The home page sells.** A three-step `How to buy` (order ahead, pick a
  day, take it home; the first card's button goes to the shop) after `How
  we farm`, and the hours (`Where to find us`) on the home page, since
  market hours are a farm's best conversion line. `What's on` moved to
  the Visit page so an empty events box never sits on the landing page.
  The About story's second starter paragraph is a sentence about the farm,
  not an instruction to the owner. The shop's order form asks when the
  order is needed by.
- **Starter art.** A brand with no accent drew its sun in the primary, a
  dark disc; the sun is now the accent when there is one and a warm gold
  when there is none or it equals the primary, and the hills are drawn
  lighter so the hero's overlay does not crush them.
- **Driven on the dev branch through the real Build button**, with the
  pane signed in and the organisation switched to Hilltop Farm (the switch
  holds within one document, so the build was reached by client-side
  navigation; a full page load flips the server back to Test, the Clerk
  dev trap from 9b). About: "We raise grass-fed Dexter beef, pastured pigs,
  meat chickens and laying hens on 40 acres… families in Knox County…
  Saturday market… farm store on Fridays." The writer answered with
  `Grass-fed beef, chicken and eggs in Mount Vernon` over the hills,
  `What we raise: Grass-fed Dexter beef, Beef by the half, Whole chickens,
  Eggs by the dozen`, the shop's hero naming Friday at the farm store and
  Saturday at market, search titles per page (`Grass-fed beef, chicken and
  eggs, Mount Vernon | Hilltop Farm`, `Shop beef, chicken and eggs |
  Hilltop Farm`), hours and `How to buy` on the home page, events on the
  Visit page, three pictures, the warm look, `Order now` in the header.
  Published by a script (the flipped session cannot publish) and read on
  the platform path.

### 2026-09-05 — Slice 15: industry site templates, the homestead farm's first (`claude/marketing-industry-templates`)

The founder: "create an elite website template for the homestead farming
industry. Each industry can have its own templates. Make the farming one
top notch: visually, SEO, easy navigation and great marketing." No
migration. [ADR 0030](../decisions/0030-a-site-template-is-data-an-industry-contributes.md)
records the shape: a template is DATA an industry contributes, the core
assembles it, the writer fills the words.

- **The slot** (`src/lib/site-templates/`): a template is pages of the
  site's own typed sections carrying STARTER words (`{name}`, `{what}`,
  `{tagline}` filled by the assembler), each section optionally conditional
  (`needs: "scheduling"` for booking and events, `needs: "hours"`), a frame
  (header button, footer columns, footer note) set on the new site, a look
  suggestion applied to a kit only where every look field is unset
  (`saveKitLook`, the `display.currencySymbol` rule), and picture slots
  naming a platform scene. `assembleTemplate` keeps a pack's block only
  when the tenant's catalogue offers it with every select chosen for them
  (one channel: kept; two: left to the owner), and parses every page.
  `registry.ts` is the one file naming an industry; `general.ts` is the
  three pages every site was, so nothing about an existing site changed.
  `templateFor(tenants.industry)` picks.
- **The writer over every slot**: `templateSlots` hands the model every
  page's description and every section's words with their limits
  (`src/lib/sites/words.ts`, the slot walk the assistant already had, now
  shared); one forced tool `write_site` answers the same paths;
  `applySiteWords` puts them in one section at a time, a bad section keeps
  its starter, and `filled > 0` is what "written by the assistant" means.
  The old fixed slots (`standardSiteCopy`, `assembleSite`, `mergeSiteCopy`)
  are gone. The system prompt asks for the town with what the business
  sells in descriptions, for search.
- **Starter pictures**: three text-free scenes in pure SVG
  (`src/lib/sites/starters.ts`: hills, furrows, dawn), drawn in the brand's
  primary and accent, rasterised to 1600×1000 JPEGs by `sharp`, put in the
  tenant's photo namespace as `starter-<scene>` and rowed like any upload
  (`starter-pictures.ts`), then attached to the template's slots in a
  second pass of the drafts (`attachPictures`). Reused by name on a
  rewrite. No stock photo, no licence; the owner replaces one in a click.
- **The homestead farm's template** (`src/industries/homestead-farm/site-template.ts`,
  data beside the profile): Home (hero on the hills, what we raise, how we
  farm as three icon cards, the price list when Retail offers it, what's
  on when Scheduling is on, a call to visit), Shop (how to order, by the
  cut and by the share, the price list, an order form asking what and
  pickup or delivery), Visit (hero on the dawn, what a visit is like, a
  booking when Scheduling is on, hours, the map), About (the story, what
  we stand for, the furrows picture), Contact; `Order now` in the header
  to the shop, Shop and Visit footer columns, `Raised here. Sold here.`,
  the warm look. Its starter words are true of a homestead farm as a kind
  and never of one farm, and its writer notes tell the model to keep only
  what the brief supports.
- **The build**: `createSiteAction` picks the template, merges its frame
  under the typed details, suggests the look, assembles, writes, creates
  the site and its drafts, then makes the pictures and takes them into the
  drafts in a second pass; `rewriteSiteCopyAction` re-assembles the same
  way and reuses the pictures. The Website page says which template the
  site was built from.
- **Driven on the dev branch.** The pane's dev session was lost during an
  organisation switch (the Clerk trap from slice 9b, again), so the build
  ran as a script calling the same functions in the same order on Hilltop
  Farm (industry `homestead-farm`, Scheduling on, Retail with two
  channels), then published: the writer answered in 28 seconds with
  `Grass-fed meat and eggs from Mount Vernon, Ohio` over the hills scene,
  every description naming the town, the price list left out for the two
  channels, the visit page with its booking, hours and map, the shop page
  with its order form; three starter pictures made in 3 seconds
  (18–24KB each); the kit took the warm look; the header carried
  `Order now` and the footer its two columns and line. The public pages
  answered on the platform path, the hero picture served at 18.5KB. Tests:
  `tests/site-templates.test.ts` (every template on the registry assembles
  and parses; the farm's conditions; pictures; the writer's slots and
  words; the scenes).
- **Not built here:** a template picker (one template per industry, the
  general one otherwise), a second template for any industry, an
  industry's own section kinds (a section the site lacks is added to the
  site for everyone), and photographs.

### 2026-09-05 — Slice 14: the header folds on a phone (`claude/marketing-header-folds`)

The first open item every site showed: with four pages and a button the
menu wrapped under the logo on a phone. No migration.

- **A native disclosure, no script.** Below `md` the pages fold behind a
  `Menu` button (`<details>`/`<summary>`, the three bars swapping for an X
  through `group-open:`) at the right of the header, in a white panel
  anchored under it with the current page marked; the owner's button stays
  in the row beside it, since it is the one thing a visitor came to press.
  From `md` up the row is as it was. A page with only the home link folds
  nothing. ADR 0019 keeps a public page's scripts few, and a disclosure
  opens and closes from the keyboard by itself; choosing a page closes it
  because the next page is a new document. Not built: closing on a click
  outside, which a disclosure cannot do without script.
- **The draft route's dev-only key warning** ("passed a child from
  DraftSitePage", an open item since slice 13) is gone: the banner is one
  string child with a `key`, and a fresh load of the draft logs nothing.
- **Driven on the dev branch** on Test's draft at 375px: one 73px row —
  the logo, `Book a visit`, the Menu button — with the wide row hidden;
  opened, a 224px panel under the button listed Home (marked current),
  About, Contact and Tours, the icon an X; at the pane's width the row of
  four and the button showed and the disclosure was hidden. The website
  guide's header-button line says how it folds.

### 2026-09-05 — Slice 13: the preview follows the editor (`claude/marketing-live-preview`)

The founder: "any changes on the site are not live; you have to hit save
to see them. I want to see the change immediately." Built the same day.
No migration. [ADR 0029](../decisions/0029-the-preview-follows-the-editor-not-the-save.md)
records why the frame stayed and the save did not move.

- **The frame stays; the editor sends it the draft.** The draft route
  asked for `?live=1` renders the saved draft as before, then hands the
  page to `LiveDraft` (`src/components/site/live-draft.tsx`, a client
  component that imports the renderer), which believes one new message
  from its parent on this origin, `yosher:site-draft` (the page as it
  stands: title, path, sections, and the photos the editor holds), and
  redraws the same `SitePage` with it. The editor posts it 120ms after
  every edit (one message per keystroke burst, not per keystroke) and
  again whenever the frame says it is ready, so a frame that loads after
  the owner started typing catches up at once. The renderer now has to
  stay free of server-only imports, and does.
- **The shape is checked, the limits are not** (`readPreviewMessage` in
  `preview.ts`): strings where strings go, sections as objects of a kind in
  `SECTION_DEFAULTS`, at most `PAGE_SECTIONS_MAX`. A headline being typed
  is blank for a moment and the preview shows that instead of stopping;
  the renderer turns anything unsafe into nothing as it does for a stored
  row, so a draft that could not be saved can still be seen.
- **Live data for unsaved sections.** A block whose view the page did not
  load, or an events section when none were loaded, makes the frame ask
  `POST /api/marketing/sites/live` (member-only, `loadLiveData` in
  `read.ts`: the same `loadSiteBlocks` and `liveEvents` the draft route
  runs, over sections parsed through the content model, nothing written,
  `no-store`), debounced 250ms with the previous ask aborted, and keeps
  what comes back. `wantsLiveData` (pure) decides when.
- **The outline survives a redraw**: `LiveDraft` keeps the selected index
  from the editor's `yosher:site-select` and paints `site-selected` again
  after every draft, since a re-rendered section can lose a class the
  click-to-select island added by hand.
- **Driven on the dev branch** on Test's home page: the frame's `src`
  carried `?live=1`; a new headline typed in the form reached the frame's
  `h1` in about 200ms with `Unsaved changes` up and nothing saved; a
  `Price list` added after the headline drew at once (its rows already
  loaded for the saved twin), and with its sold-out rule changed to a
  config the page had not loaded, its rows came through the live route in
  about three seconds on the route's first compile (the request answered
  200); the phone width still framed the live page at 390px; a click on a
  section in the frame still selected its row. Ten sections in the frame,
  ten rows in the list, and the page was left unsaved, unchanged. Tests:
  `tests/site-preview.test.ts` (the draft message, the photo sizes, when
  live data is wanted).
- **Not built here:** an edit made in the preview itself (the frame is a
  picture of the draft, the form is where it is written), and a preview of
  another page than the one being edited (the menu still moves between
  saved drafts).

### 2026-09-05 — Slice 9b: a pack's block on the page, and Retail's price list first (`claude/marketing-site-blocks-seam`)

The last roadmap row. No migration. The site can now host a block a pack
fills, and Retail fills it with one channel's prices
([ADR 0028](../decisions/0028-a-packs-block-is-data-the-site-draws.md)).

- **The slot** (`src/lib/site-blocks/`): `types.ts`, types only — a
  provider is a kind (`pack.block`), a label and hint, editor FIELDS
  described as data (a select with options, a switch), a pure
  `parseConfig`, and a `load(tx, tenantId, config, now)` that answers ROWS
  (name, detail, amount, sold out) and a footnote. `registry.ts` is the one
  file in the chain that names a pack (the basis-lens shape). `resolve.ts`
  is what the site calls: `siteBlockCatalog` for the editor,
  `blockSectionsProblem` for the save, `loadSiteBlocks` for the render —
  all bounded by the tenant's `tenant_modules`, read in the page's own
  transaction, so a block whose pack is off is not offered, not saved and
  not drawn. `core.ts` is pure: `blockKey` (kind + sorted config, so two
  sections set up alike share one load), `newBlockSection`,
  `filterCatalog`, `blockLabel`.
- **One section kind, `block`** (`kind`, `config`, plus the site's heading,
  note and empty line; `style` like any section). `newSection` and
  `SECTION_TYPES` are now typed on `PlainSectionType`, because a block
  starts from a catalogue entry the route loaded, never from a kind alone.
  `PublicSite.blocks` carries the views; the renderer draws rows in the
  site's tone with a `Sold out` pill, the empty line when there are none,
  and in the draft preview a word to the owner when a block has no view.
  The editor offers each catalogue entry as a button after the fixed
  kinds, draws a provider's fields from their descriptions, names a block
  row by its catalogue label, and shows an amber note on a block whose
  pack has gone off. The assistant's slot map gained `block` (heading,
  note, empty line).
- **Retail's price list** (`src/packs/retail/site-blocks.ts` over the pure
  `core/site-prices.ts`): `Prices from` one of the tenant's active
  channels (chosen for the owner when there is one) and `When something
  has run out` (marked, or left off). Rows are priced, active items by
  name with what the price is per (`per lb`, `each`, `per dozen`) and the
  figure in the tenant's symbol, dollars when none is set; sold out is
  nothing on hand anywhere by inventory's `onHandByItem`, and an item
  never counted is for sale. Read through the pack's own verbs as the
  site's anonymous reader; names, prices and "sold out" reach the page and
  nothing else. Retail's dossier carries its side.
- **Driven on the dev branch.** Hilltop Farm (Retail, Inventory, two
  channels, two prices) was the first target, and the Clerk dev instance
  would not hold the organisation switch server-side: the client said
  Hilltop Farm while server actions ran as Test, so a save was refused as
  "needs the retail pack switched on" for the wrong tenant, and the log
  showed Clerk's "refreshing the session token resulted in an infinite
  redirect loop". (A Hilltop Farm site was built along the way; it is a
  draft.) So Test got Retail, Inventory and Assets switched on by hand on
  the dev branch, a `Saturday market` channel and three items, two priced.
  The editor offered `Price list` after `Columns`; added after `About`,
  the one channel was chosen for the owner (with one channel the select
  offers no blank, so `needs its settings filled in` is reachable only
  with several; `parsePriceBlockConfig` is what refuses, and it is tested);
  saved with a heading and a note, the draft page listed
  `Eggs · per dozen · $6.00` and `Ground beef · per lb · $8.99`, the
  unpriced honey nowhere, and the published page was unchanged until
  publish. Retail switched off by hand: the button gone from the editor,
  the row named `Prices` from its kind, the amber note on the section, the
  draft page showing the owner's line and no price; switched back on, and
  the page published, the public page listed the two prices. Tests: `tests/site-blocks.test.ts` (the slot's shape, the key,
  the catalogue filter, the presenter).
- **Not built here:** a block a visitor can act on (the shop block needs a
  client island the site owns and a provider names), any field kind beyond
  a select and a switch, and a block from any pack but Retail. Prices
  reach the site on the page cache's clock (five minutes), a save or a
  publish redraws at once.

### 2026-09-05 — Slice 12: the assistant everywhere (`claude/marketing-site-assistant`)

The last row of the elite-builder roadmap but 9b. No migration. Three
doors in the page editor, one shape ([ADR 0027](../decisions/0027-the-assistant-proposes-words-and-the-owner-saves-them.md)):
the model is briefed with what the public page already prints (name,
tagline, kind, address, hours) plus ONE bounded thing, answers through one
forced tool, and what comes back is parsed through the content model and
handed to the editor's own unsaved state. The actions write no row; the
owner reads and presses Save, or does not. Drawn only when
`ANTHROPIC_API_KEY` is set (`assistantOn()`, passed from the route).

- **New words for one section** (`RewriteWords`, under `Layout and look`):
  an optional ask (up to 200 characters) and "Rewrite the words".
  `sectionWords` walks a per-kind path map (`TEXT_PATHS`: hero
  `headline, subheadline, cta.label`; columns `heading, intro,
  cards[].heading, cards[].body[], cards[].cta.label`; and so on) and sends
  the strings that are there, each with its length (`limitFor`, the
  schema's numbers); `applyWords` puts the same keys back, cuts to size,
  ignores any other key, and parses the result — so a photo, a link, an
  icon, a booking's rule or the look cannot change, and an emptied
  required slot is the one friendly refusal.
- **A page from a sentence** (`WritePage`, in the Page card): a sentence
  (up to 400 characters) and "Write the page"; a confirm when sections
  exist. The tool returns blocks of a fixed kind list (`PAGE_BLOCK_KINDS`:
  hero, text, offer, columns, cta, form, contact, hours, map, and booking
  and events while Scheduling is on) with a heading, lines, items and a
  button; `assemblePageBlocks` makes real sections over `newSection`
  defaults (buttons to `/contact`, card icon `check`, once-only kinds
  deduped, calendar kinds dropped without Scheduling, everything cut to
  size rather than refused) and the meta description with them.
- **A photo's description** (`SuggestDescription`, beside `Describe the
  photo` and in gallery rows): the photo's bytes from the private blob,
  through `normalizeImageForVision`, as one image block with one sentence
  of instruction; `AltTextSchema` trims a leading "Photo of" and caps at
  160. Nothing about the site goes with it.
- **The server half**: `assistant.ts` (`rewriteSectionWords`,
  `draftPageContent`, `describePhoto`, each with an injectable call over
  `callAssistantModel`: adaptive thinking, one cached system prompt, a
  forced tool) and `assistant-actions.ts` (gate → Zod → the brief in one
  `withTenant` read → the model call OUTSIDE any transaction → parse).
  Errors `ASSISTANT_OFF`, `ASSISTANT_BUSY`, `ASSISTANT_FAILED` with the
  reason in the log and one friendly line at the client. The valve is
  `site_assistant` in `public_access_attempts`, sixty an hour per tenant,
  keyed by a sha256 of the tenant id: `ipKey` is `unsalted` without
  `INTERVIEW_IP_SALT`, which `overPublicCap` treats as no key at all.
- **Driven on the dev branch** on Test, with the laptop's key. The contact
  page's Contact details note, asked for "shorter and warmer, and say the
  phone is the quickest way to reach us", came back in five seconds as "A
  phone call is the quickest way to reach us. Deliveries go out Fridays…",
  the heading untouched, `Unsaved changes` up, and was saved. The home
  page's one undescribed photo (a Columns card) was described in four
  seconds ("White bold text reading "Oak Row Farm" on the left side of a
  plain green background…", 149 characters), the amber nudge cleared, and
  was saved. A new page `Tours` at `/tours`, written from one sentence
  about free Saturday farm tours, came back in thirteen seconds as six
  sections (Big headline "Come walk the farm with us", Text "What a visit
  is like", Columns "Who comes out", Hours, Book a time, Call to action)
  and a 151-character description, and was saved; it is unpublished.
- **A trap**: after the editor route's file was edited while the dev
  server was up, Turbopack answered the route with the not-found page
  (application code ran, 140ms) until a later edit triggered a rebuild.
  Instrumenting the route proved the data was there; the instrument line
  was removed. Not a code problem, but ten minutes of one.
- **Not built here:** a conversation (each press is one ask; "no, shorter"
  is typed into the box), the assistant on the Website page's details or
  header and footer, a caption suggestion (a caption is the owner's voice,
  a description is the picture's), and a rewrite of a whole page's words
  in one press (one section at a time keeps every answer readable before
  it is saved). Tests: `tests/site-assistant.test.ts`.

### 2026-09-05 — Slice 11b: the share image, and an old address that sends people on (`claude/marketing-site-share-redirects`)

The second half of the SEO pack. Migration `0260` adds `previous_slugs`
to `sites` with a GIN index; applied and verified on dev and production
before the merge.

- **The share image** (`src/lib/sites/share.ts`, `siteShareResponse`): a
  1200×630 PNG per page — the page's title (the site's on the home page)
  in the kit's Noto Sans as PATHS (`textPaths`, newly exported from
  `logo-svg.ts`, so no font is needed at raster time), the site's name (or
  its tagline on the home page) under it at 85%, the address in the corner
  at 70%, all on the brand colour in its own foreground; and in a white
  rounded panel top-left the logo's own pixels or the monogram (`monogramPng`,
  exported from `icon.ts`). Titles shrink to fit the width down to 34px.
  Named by `shareKey(shareFacts(site, page, base))`, an FNV hash of the
  title, the subtitle, the host, the colour and the logo's pathname; the
  route finds the page by recomputing keys, so a retitled page is a new
  picture and an old key is a 404. Routes `src/app/sites/[slug]/share/[key]`
  and the domain twin; `/share` is reserved and `siteRewrite` maps it.
  `publicSiteMetadata` now sets `openGraph.images` (absolute, through
  `siteBaseUrlFor`, the connected domain first) and a `summary_large_image`
  Twitter card.
- **`siteBaseUrlFor(site, mode, env)`** (`seo.ts`, pure) replaces the
  renderer's private `siteBase`: the connected domain, else the free
  address on a host, else the platform path.
- **An old address sends people on**: `sites.previous_slugs text[]`,
  written by `changeSiteSlug` through `withPreviousSlug` (the old address
  first, the new one never in the list, nothing twice, ten at most);
  `lookupSiteByPreviousSlug` (`withSystem`, identifiers only, `@>`
  containment on the GIN index); and `sendOnIfMoved` in `public-route.tsx`,
  which runs only when nothing is at the address and answers a permanent
  redirect to the same page at the site's current address for the same
  kind of address (platform path or free address). A current slug elsewhere
  always wins; a moved site that is unpublished is a 404 like any other.
- **Not built here:** a redirect from a previous CONNECTED DOMAIN (a domain
  the business gave up is not the platform's to answer for) and a share
  image the owner uploads instead of the drawn one.
- **Driven on the dev branch** on Test: the about page's head carried
  `og:image` at `/sites/oak-row-farm/share/e5043e08`, `og:image:width`
  1200, `og:site_name`, and a `summary_large_image` Twitter card; the
  picture came back as a 38KB PNG with the photo cache headers and a 304
  on its ETag, a wrong key was 404, and it read: the wordmark in its white
  panel, `About` in bold, `Oak Row Farm Co.` under it, the address in the
  corner, on the brand colour. Then the address was changed to
  `oak-row-farm-co`: `/sites/oak-row-farm/about` landed on
  `/sites/oak-row-farm-co/about` and `oak-row-farm.localhost:3000/about` on
  `oak-row-farm-co.localhost:3000/about`; changed back, the
  `oak-row-farm-co` address sent people to `oak-row-farm` in turn. Note
  that the absolute addresses (`og:image`, a platform-path redirect) take
  their host from `NEXT_PUBLIC_APP_URL`, which on the laptop is
  `127.0.0.1:3000` while the browser says `localhost`; in production the two
  are the same name. Tests: `tests/site-share.test.ts`.

### 2026-09-05 — Slice 11a: robots, a sitemap, structured data and an icon (`claude/marketing-site-seo`)

What a crawler and a browser ask a site for by name, answered per site
on every address it has. No migration.

- **`src/lib/sites/seo.ts`** (pure, tested): `robotsText`, `sitemapXml`
  (escaped), `siteBaseUrl` (the host's root on a site host or a connected
  domain, `/sites/<slug>` on the platform), `pageUrl`,
  `localBusinessJsonLd` (a `LocalBusiness` that says only what the
  settings say: name, url, the tagline as description, telephone, email,
  the address as one line, `geo` from the map's pin, `logo`/`image`,
  `sameAs` from the social links; a blank field is left out), `jsonLdText`
  (`<` escaped so a name cannot close the tag), `ICON_SIZES` 32 | 180 |
  512, `hash32`.
- **`seo-routes.ts`** (`robotsResponse`, `sitemapResponse`): a published
  site only, else 404 (robots read that as no rules, and it says nothing
  about which addresses exist); the base is the connected domain when
  there is one — the canonical, wherever the request came in — else the
  origin the visitor used, classified with the proxy's own `classifyHost`.
  The sitemap lists the published pages in menu order with the site's
  `published_at` as `lastmod`. Routes `src/app/sites/[slug]/robots.txt`,
  `…/sitemap.xml` and the `/domain/[host]/` twins; `siteRewrite` sends a
  site host's `/robots.txt` and `/sitemap.xml` there, and its
  `/favicon.ico` and `/apple-touch-icon.png` to the icon route. The
  platform's own `robots.ts` and `sitemap.ts` are untouched: the proxy
  answers before Next's metadata routes on a site host, and never on the
  platform's.
- **The icon** (`icon.ts`, `siteIconResponse`): a logo whose sides are
  within 0.8–1.25 of each other is fitted on white as it is; anything else
  (a wide wordmark squeezed into a tab is a smudge), and a business with no
  logo, gets a monogram — the initials on a rounded square in the brand
  colour, drawn by the kit's own `renderLogoSvg` with a `monogram` spec and
  rasterised by `rasterizeSvgToPng`. Named by the logo's pathname, the
  colour, the title and the size, cached like a photo. Routes
  `src/app/sites/[slug]/icon/[size]` and the domain twin; the pages' metadata
  names them as `icons` (`/icon/32` and `/icon/180` on a host, under
  `/sites/<slug>` on the platform), and `/icon` is a reserved page path.
- **Structured data**: `SitePage` writes a `<script type="application/ld+json">`
  on the home page in the two public modes, from `businessFacts` (the
  absolute base: the connected domain, else the free address on a host,
  else the platform path).
- **Driven on the dev branch** on Test's `oak-row-farm`: on the platform
  path, `robots.txt` answered the four lines with the sitemap at
  `/sites/oak-row-farm/sitemap.xml`, the sitemap listed the three pages
  with the last publish as `lastmod`, the icons at 32 and 180 came back as
  PNG with the photo cache headers and a 304 on the ETag, size 64 and an
  unknown site were 404; on the free address `oak-row-farm.localhost:3000`
  both files answered root-relative through the proxy; the home page's
  head named the two icons and its structured data carried the name,
  tagline, address, phone, email, the map's pin, the logo and the eight
  social profiles; and the 512 icon was `OR` in the brand colour on a
  rounded square, the fixture's logo being a wide wordmark. Tests:
  `tests/site-seo.test.ts`.

### 2026-09-05 — Slice 10: find us, a map the platform draws (`claude/marketing-site-map`)

MapLibre is in the repo and was not used
([ADR 0026](../decisions/0026-a-map-is-a-picture-the-platform-draws.md)):
a map on a public page is one `<img>` the platform drew. No migration; the
pin is JSON on the settings.

- **The pin** (`SiteSettings.map`: `lat`, `lng`, the geocoder's `matched`
  address, and the `address` it was placed from): `saveSiteDetailsAction`
  keeps the pin only while the address is the one it was placed from,
  then `placeOnMap` asks the Census Bureau's geocoder outside the
  transaction and writes the pin beside the address in a second one,
  unless the address changed again meanwhile. `createSiteAction` does the
  same after the site is made. A miss writes nothing and the Website
  screen's `On the map` line says so (`mapStatusLine`).
- **`src/lib/sites/map-core.ts`** (pure, tested): Web Mercator
  (`lngLatToPixel`, `tilesForWindow` for a 960×540 window), `mapKey` (an
  FNV hash of the pin, the zoom and the colour, plus the zoom), `zoomFromKey`,
  `markerSvg`, `directionsUrl`, `pinFromCensus`, `pinIsFor`,
  `mapStatusLine`, and the tile source: USGS Topo, `{z}/{y}/{x}`, zoom 0–16
  (17 answers 404; checked).
- **`src/lib/sites/map.ts`**: `geocodeAddress` (Census, 8s, a User-Agent),
  `renderMap` (the tiles fetched in parallel, composed on a canvas that
  holds every tile whole because `sharp` places overlays at non-negative
  offsets only, cut to the window, the marker on top, WebP q82),
  `siteMapResponse` (published only, the key must be the one the site
  holds, ETag = the key, the photo routes' public cache headers) and
  `memberMapResponse` (the draft preview). Routes:
  `src/app/sites/[slug]/map/[key]`, `src/app/domain/[host]/map/[key]`,
  `src/app/api/marketing/sites/map/[key]`; `siteRewrite` maps `/map/*` on a
  site host and `/map` is reserved as a page path.
- **The `map` section** (`heading`, `note`, `zoom` 13 town | 15
  neighborhood | 16 street, `showAddress`, `directions`) renders the
  picture with `Map: USGS The National Map` under it, the address beside,
  and `Get directions` opening the visitor's maps app in a new tab; with
  no pin it still prints the address and the button, and with no address
  the public page skips it while the draft says why. The editor's form
  carries the `On the map` line (`mapStatus` from the editor page) and the
  three controls.
- **Driven on the dev branch** on Test: the fixture's `17 Main St` had read
  `Not on the map` (the geocoder's first match for it is `17 E MAIN ST`,
  across town), so the details were saved as `17 N Main St`, and the line
  became `On the map as 17 N MAIN ST, MOUNT VERNON, OH, 43050.` A `Find us`
  section at the end of the contact page, saved and published, drew the
  live page's picture from `/sites/oak-row-farm/map/85c6ecf0-15`: 960×540
  WebP, `200`, the photo cache headers, `ETag "85c6ecf0-15"`, the downtown
  and the river with the brand-colour pin in the middle, `Map: USGS The
  National Map` under it, the address and `Get directions` (a new tab, the
  visitor's maps app) beside. The draft preview drew the same picture
  through the member route; a key the site does not hold and a zoom the
  key cannot carry were both 404; the same key with `If-None-Match` was
  304. Tests: `tests/site-map.test.ts` (the projection agreed with the
  fetched tile's row once the hand arithmetic was corrected: 12358, not
  12359).

### 2026-09-05 — Slice 9a: what's on, the first live block (`claude/marketing-site-events`)

A section whose content is not typed: the next events on the business's
Events calendar, read when the page is drawn. The second managed business
calendar, on the mechanism ADR 0025 settled for the first. No migration.

- **`src/lib/schedule/managed-calendars.ts`** replaces `bookings-calendar.ts`:
  `MANAGED_CALENDARS` (`bookings` green, `events` amber), `ensureManagedCalendar`,
  `findManagedCalendarId`, `itemsOnCalendar` (through `listRange`, one
  calendar, soonest first) and `busyOnCalendar` on top of it. `savePageAction`
  provisions each calendar a saved page's sections call for, while Scheduling
  is on.
- **The `events` section** (`heading`, `note`, `count` 3 | 5 | 10,
  `horizonDays` 30 | 60 | 90 | 180, `emptyText`) and
  **`src/lib/sites/events-core.ts`** (pure, tested): `LiveEvent`,
  `upcomingEvents` (still to come or under way, inside the horizon, soonest
  first, at most the count), `eventDate` (the poster's day block) and
  `eventWhen` ("8:00 am to 12:00 pm", "All day", "Sep 12 to Sep 14", a span
  across days with times).
- **`PublicSite.events` and `PublicSite.timezone`** (`read.ts`): the read
  loads the calendar's next 180 days only when a page on show carries an
  events section (`wantsEvents`), as `staff` with no user for the public
  routes — the everyone share at `write` is what lets the page see titles
  and locations — and as the owner for the draft. The renderer's `events`
  case takes its `count` and `horizonDays` from `site.events` and draws a
  list: the day block in the tone's heading colour, the title, when, and
  the location after a middle dot. Nothing coming up reads the section's
  `emptyText` or a standard line.
- **Freshness is the page cache's.** The public routes are ISR at 300s and
  nothing in Scheduling revalidates a site, so an event added or cancelled
  in the calendar reaches the page within five minutes; a page save or a
  publish revalidates at once. The guide says "within a few minutes".
- **What row 9 does not include, and why.** Prices and availability come
  from the retail and inventory packs; the site cannot import a pack, so
  they need the declared-slot seam (a pack contributes a block kind, its
  fields and its renderer) that the shop block needs too, and a seam with
  no implementor in hand is the thing this repo keeps refusing to build.
  They wait for `retail` slice 6 as row 9b. A live team block is not
  planned: Columns does a team by hand today, and a block that lists
  members from their profiles would decide for each of them whether their
  name is public.
- **Driven on the dev branch** on Test: a `What's on` section added at the
  end of the home page with a note, saved (`Events` appeared under
  `Business calendars` beside `Bookings`) and published; the live page read
  `Nothing scheduled yet. Check back soon.`; then `Open barn day` on
  Saturday, September 19, 10 to 2 at `The barn, 17 Main St`, made in
  Scheduling's own New event dialog with `Events` picked as the calendar
  (`Event created`), and the live home page listed `SAT 19 SEP · Open barn
  day · 10:00 am to 2:00 pm · The barn, 17 Main St`. Tests:
  `tests/site-events.test.ts`.

### 2026-09-05 — Slice 8: book a time (`claude/marketing-site-bookings`)

The site's second thing a visitor can do, and the first that crosses into
another module's data
([ADR 0025](../decisions/0025-a-booking-is-an-enquiry-with-a-time.md)).
Migration `0259` adds four columns to `site_enquiries`; applied and
verified on dev and production before the merge.

- **The `booking` section** (`src/lib/sites/schema.ts`, the thirteenth
  kind): `heading`, `note`, `title` (what is being booked, as it reads on
  the calendar and in the email), `minutes` (15–120), `days` (0 = Sunday),
  `from`/`to` on the wall clock, `leadHours` (0, 2, 24, 48), `horizonDays`
  (7, 14, 30, 60), `askPhone`, `buttonLabel`, `thanks`. The editor's fields
  (`section-forms.tsx`) are the same words; the section can be added only
  while Scheduling is on (the editor page passes `bookingOn`), and says so
  in amber when it is off.
- **`src/lib/sites/booking-core.ts`** (pure, tested): the request schema
  (the enquiry's with an ISO `start` in front), `bookingWindow` (after the
  notice, before the horizon), `offerSlots` — `findFreeSlots` from the
  scheduling module's availability seam over the section's rules and the
  calendar's busy time, grouped by day with labels — and `isOffered`, the
  check the write path makes. `describeBooking` is the sentence everything
  else uses: "Tuesday, September 15, 9:00 am to 9:30 am".
- **`src/lib/schedule/managed-calendars.ts`** (the scheduling seam): the
  business's Bookings calendar, made once through the managed unique index
  (`marketing` / `bookings`), owned by the business and shared with
  everyone at `write`; `busyOnCalendar` through `listRange` and `show_as`.
  `savePageAction` calls `ensureManagedCalendar` when a saved page holds a
  booking section and Scheduling is on: an owner's context, since the
  business owns it. The share is put back at `write` on every such save.
- **`src/lib/sites/bookings.ts`**: `openBookingTimes` (the read: a
  published site with Scheduling on, the section from the PUBLISHED page,
  the calendar's busy time as `staff` with no user through the everyone
  share, the open times) and `receiveSiteBooking` (the write: caps as the
  enquiry's plus a per-site daily count of bookings, the section from the
  published page again, `pg_advisory_xact_lock` on the calendar, `isOffered`
  or "taken", then the party, the CRM record when CRM is on, the follow-up
  `Confirm the booking with …` due today, the calendar item titled
  `<title>: <name>` with the notes as its description and the visitor as an
  `accepted` external attendee, the `site_enquiries` row with the time and a
  soft `schedule_item_id`, the audit `site.booking.received`, the email).
  `notifyPlan` and `tryAddContactPoint` are now exported from
  `enquiries.ts` and shared.
- **`GET /api/sites/slots`**: the third public door, a read — instants and
  labels for a published site, an empty list for everything else, capped at
  60 an hour per IP in `public_access_attempts`, never cached.
- **The island** (`src/components/site/booking-form.tsx`, the public page's
  fourth script where a booking section is on the page): fetches the open
  times, day chips then time chips in the brand colour, the enquiry's
  fields with a note in place of the message, the server action
  `submitSiteBooking`; a time that was just taken is answered with the rest.
  In the draft it is drawn and takes nothing. The Website screen's Messages
  panel shows a booking as a message with a `booking` badge and
  `<title>, <when>` under the name; the email's subject reads
  `<name> booked <title> from your website` and its close names the
  Bookings calendar.
- **Words** (`enquiry-schema.ts`): `EnquiryWords.booking`, `bookingWorkTitle`,
  and `enquiryNotes` / `enquiryEmail` reading as a booking when it is one;
  a plain message reads exactly as before.
- **Driven on the dev branch** on Test, with Scheduling switched on for it
  from the superadmin's tenant page: a `Book a time` section on the contact
  page (`Farm visit`, weekdays 9 to 12, half an hour, a day's notice, a
  month ahead), saved (which made the `Bookings` calendar — it appeared
  under `Business calendars` with Share, Edit and Archive) and published.
  The live contact page offered Monday to Friday from the 7th to October 5
  with `9:00 am` to `11:30 am` on each; `Pat Booker` booked Monday the 7th
  at 9:00 with a note and read `Booked: Monday, September 7, 9:00 am to
  9:30 am` and the thanks line. The Messages panel then showed the row with
  a `booking` badge and `Visit, Monday, September 7, 9:00 am to 9:30 am`,
  `Contact: Pat Booker`, `Emailed to the site's email address`; the week of
  the 7th in Scheduling drew `Visit: Pat Booker`; the follow-up
  `Confirm the booking with Pat Booker` opened from the row, about the
  contact; and the live page no longer offered `9:00 am` on the 7th. One
  slip on the way, worth knowing: a script that set `input[id$="-title"]`
  renamed the PAGE (`#page-title`) rather than the section; the page was
  put back and the section titled by its own id. Tests:
  `tests/site-bookings.test.ts`.

### 2026-09-05 — Slice 7: the preview at a phone's width, and pointing at a section (`claude/marketing-editor-preview`)

The editor's preview grows two things the founder asked for in the
"elite builder" brainstorm, without a second renderer: a device toggle,
and a click in the preview that selects the section in the editor. No
migration.

- **`src/lib/sites/preview.ts`** (pure, tested): `PREVIEW_DEVICES`
  (desktop = the pane, tablet 820px, phone 390px), `previewWidth`,
  `PREVIEW_DEVICE_KEY` (the `localStorage` key the choice is kept under),
  `SECTION_ATTR` (`data-section-index`) and `readPreviewMessage`, which
  believes exactly three messages — `yosher:site-section` (a click, index ≥
  0), `yosher:site-select` (the editor's selection, -1 for none) and
  `yosher:site-ready` — and nothing else; extensions and devtools post their
  own and every one of them is null here.
- **The renderer** marks every section's `<section>` with its index, in
  draft mode only, and mounts `DraftSelect`
  (`src/components/site/draft-select.tsx`) in place of the view beacon. The
  island does nothing unless the page is framed (`window.parent !== window`):
  the draft opened in its own tab stays a page like any other. Framed, it
  adds `site-draft` to the root (the hover and selection outlines in
  `globals.css`, in the brand colour), turns a click on a section into a
  message to the editor — a link or a button inside a section selects the
  section instead of going anywhere; the menu, outside any section, still
  moves between pages — and answers the editor's selection by outlining and
  scrolling to the section. On mount it says it is ready, so a reloaded
  preview gets the current selection back.
- **The editor** (`page-editor.tsx`): one `message` listener, registered
  once, that checks the origin and that the source is its own iframe before
  reading; a click selects the row at that index and scrolls the section's
  form into view; the selection (as an index) is posted to the frame
  whenever it changes and whenever the frame says it is ready. The device
  buttons (`Monitor`, `Tablet`, `Smartphone`) sit beside Reload; the frame
  narrows with a transition and takes a dark bezel at a device width.
- **Indices, not ids.** The preview shows the SAVED draft; the list may be
  unsaved. A click maps by position into the current rows, which is right
  until sections are added, moved or removed and not yet saved, and the
  guide says so. Ids would need a stable id per section in the content
  model, which nothing else has asked for.
- **Two lint rules shaped the editor's state.** The React Compiler's rules
  refuse a `setState` inside an effect and a ref written during render, so
  the remembered device is read through `useSyncExternalStore` (the server
  renders desktop, the browser reads its storage, a browser that keeps
  nothing still shows what was clicked), and the message listener is
  registered again on every change of the rows or the selection rather
  than reading a ref. The guide's `{icon:monitor}`, `{icon:tablet}` and
  `{icon:smartphone}` needed registering in `guide-icons.ts` first; the
  guides test says so by name.
- **Driven on the dev branch** on Test's home page: the frame loaded with
  seven marked sections and the first outlined; a click on the third in the
  preview selected the `Hours` row and opened its form; a click on the
  second row in the list outlined the slideshow in the preview; a click on
  the hero's button selected the hero and left the preview's address alone;
  `Phone` narrowed the frame to 390px in a bezel, was still pressed after a
  reload of the editor, and `Desktop` put it back. The draft opened in its
  own tab had the markers but no `site-draft` class, no outline and an
  ordinary cursor. Tests: `tests/site-preview.test.ts`.

### 2026-09-05 — Slice 6d: fonts and looks (`claude/marketing-site-looks`)

The site's character, from the brand kit: a look, a font pairing and a
button shape, each a preset from a short list
([ADR 0024](../decisions/0024-a-look-is-a-preset-and-its-fonts-are-the-platforms.md)).
Migration `0258` adds three text columns to `brand_kits` with CHECKs that
are the whole vocabulary; applied and verified on dev and production before
the merge.

- **`src/lib/brand/looks.ts`** (pure, tested): `BRAND_LOOKS` (modern, warm,
  classic), `FONT_PAIRINGS` (clean, warm, classic, bold, friendly, elegant),
  `BUTTON_SHAPES` (pill, rounded, square), the specs with their captions,
  `LOOK_SPECS` (each look's default pairing, shape and two corner radii),
  `resolveLook({ look, fontPairing, buttonShape })` (the look's defaults
  under the owner's own choices; nothing chosen is `modern`, which is how
  every site started) and `lookRadiusVars`. `resolveBrand` picks the three
  fields like a colour (company's, else business's, else nobody's) through
  type guards, so a value outside the lists reads as nobody's.
- **The fonts** (`src/components/site/site-fonts.ts`): nine families through
  `next/font/google` with `preload: false`, paired as Geist/Geist (`clean`),
  Lora/Nunito, Playfair Display/Source Serif 4, Oswald/Source Sans 3,
  Poppins/Nunito, Cormorant Garamond/Montserrat. `siteFonts(pairing)` hands
  the renderer the variable classes and two `font-family` values.
- **The renderer**: the root carries `site-root`, the pairing's classes and
  five new variables (`--site-font-heading`, `--site-font-body`,
  `--site-radius`, `--site-radius-field`, `--site-radius-button`); a rule
  in `globals.css` gives `.site-root` its body family and its `h1`–`h3` the
  heading family; every photo, panel, tile, box and button now reads its
  corners from the variables (`rounded-[var(--site-radius)]` and so on)
  instead of a fixed class. The slideshow's arrows and dots and the social
  marks stay round: they are controls and marks, not the look.
- **The brand screen**: a `Look`, `Fonts` and `Buttons` row in the kit's
  fields (`components/look-fields.tsx`), each a pressed-button row with a
  caption, and under them `How your website reads`: the business name in
  the heading family, a line in the body family and a button in the shape,
  changing as the owner clicks. The preview strip at the top of the card
  gains the same sample from the SAVED kit, labelled with the look, the
  fonts and the buttons. On a company kit the rows offer `Your brand's` as
  the blank; on the business kit `As the look`. Staff see the three as
  words.
- **Fixed on the way: a brand kit save did not revalidate the public site.**
  `revalidate()` in `actions.ts` named only the brand screen, so a new
  colour (since slice 1) reached a live site only when the five-minute cache
  ran out. It now names the website screen and the three public routes.
- **`next/font/google` under vitest** is a build-time loader whose exports
  are not callable, and the guides and vocabulary tests import every screen,
  so `tests/stubs/next-font-google.ts` (aliased in `vitest.config.ts`) hands
  them callable stubs. A new family needs a line there too.
- **Driven on the dev branch** on Test: the brand screen's sample changed
  as the rows were pressed (Classic → Playfair Display over Source Serif 4,
  2px buttons, 6px corners; Bold → Oswald over Source Sans 3; `As the look`
  back to the look's own; Rounded → 10px buttons), `Brand saved.` on Save,
  and the live home page then read in Playfair Display and Source Serif 4
  with the `Book a visit` and `See what we offer` buttons at 10px and the
  cards at 6px; the browser had loaded those two families and no other. The
  contact page's boxes were 4px and its labels in Source Serif. Then the
  Warm look with the buttons `As the look`: Lora over Nunito, 24px corners
  in the sample and 1.5rem on the site, the gallery's tiles soft, only Lora
  and Nunito fetched. The Test site is left on Warm. Tests:
  `tests/brand-looks.test.ts`, the `resolveBrand` cases in
  `tests/brand-core.test.ts`.

### 2026-09-05 — Slice 6c: the header, the footer and the bar across the top (`claude/marketing-site-header-footer`)

The frame around every page, edited on the Website screen and shown the
moment it is saved. No migration: the frame lives in `sites.settings`
beside the details, with a default for every row saved before it existed.

- **`SiteSettingsSchema`** (`src/lib/sites/schema.ts`) gains `announcement`
  (`text`, an optional `href`, `shown`), `headerButton` (a `Cta` or null),
  `social` (up to eight `SocialLink`s: `network`, `url`, and a `label` for
  `other`), `footerColumns` (up to three, each a heading, a few lines and up
  to six links) and `footerNote`. Every one has a default, so
  `readSiteSettings` of an older row is the row plus an empty frame; and a
  save of the details now merges into the existing settings instead of
  rebuilding them (`settingsFrom(existing, input)`), which is what keeps the
  frame when the phone number changes.
- **A link is one of four shapes** (`src/lib/sites/links.ts`, pure): a page
  on this site (`/contact`, never `//host`), `http(s)://`, `mailto:`,
  `tel:`. `CtaSchema.href` now refines on it, so the editor's buttons and
  cards refuse a `javascript:` on save, in the rule's own words through
  `contentProblem`; and the renderer's `resolveHref` returns null for
  anything else, drawing a button as words and a card's link not at all.
  Before this slice `href` was any 200 characters, and the public pages sit
  on the platform's own origin: a stored `javascript:` was a stored XSS
  against anyone signed in who clicked it. Every link stored on the dev and
  production branches was checked against the rule before the merge (dev 6,
  production 3, none outside it), so the tighter schema blanks no page.
- **`src/lib/sites/frame.ts`** (pure, tested): `FrameInput` is the form as
  typed, blanks and all; `frameFromInput` trims, drops the blank rows and
  names the first thing wrong (`The header button needs a link.`,
  `The footer link "Map" needs a link.`, the four shapes for a bad one);
  `frameInputFrom` is the way back. `linkProblem` and `webUrlProblem` give
  the form its inline messages from the same rules.
- **The renderer** (`site-page.tsx`): `Announcement` (a brand-colour band
  above the header, the text a link when it has one), `SiteHeader` (the
  button after the menu, in the light tone's button style; menu and button
  wrap under the logo on a phone), `SiteFooter` (the one quiet row it was
  when there are no columns, plus the marks; a grid of the details column
  and the owner's columns when there are; and, always, `© <year> <name>`
  with the footer line beside it). `src/components/site/social-icons.tsx`
  holds the marks as filled paths and draws `other` as its own words in a
  pill; each opens in a new tab with `rel="noopener noreferrer"`.
- **The screen**: a `Header and footer` card on the Website page
  (`components/header-footer-form.tsx`) in four blocks: the bar (a switch,
  the text, the link), the button (label, goes to), the social links (a
  network, the address, the name of `other`; the network fills itself in
  from a pasted address through `guessNetwork`), the footer (columns with a
  heading, text and links; the footer line). Save is held while any link is
  wrong and the save's refusal names the row. Staff see a read-only
  summary. `saveHeaderFooterAction` (`site-actions.ts`): gate → Zod →
  `frameFromInput` → merge into the existing settings → `updateSiteSettings`
  → audit `marketing.site.header_footer_saved` → revalidate.
- **Fixed on the way: a publish or a details save did not revalidate a
  connected domain's pages.** `revalidateSite` in `site-actions.ts` and
  `revalidateAll` in `page-actions.ts` named the platform and hosted routes
  but not `/domain/[host]/[[...path]]` (the image and domain actions did),
  so on a custom domain a publish showed only when the five-minute cache ran
  out. Both now name all three.
- **Driven on the dev branch** on Test's `oak-row-farm`: the bar switched on
  with `Closed Monday, September 7, for Labor Day` linking to `/contact`; a
  `Book a visit` button; a Facebook address whose network filled in by
  itself, and an Etsy shop as `Another site`; a `Visit` column with a line
  and two links and an `Hours` column of text alone; `Family owned since
  1978.` as the line. The save answered `Header and footer saved. They show
  on the site straight away.`, and the live home page then carried the
  brand-colour bar with its link, the button at the end of the menu, the
  Facebook mark and the `Etsy shop` pill opening in a new tab, the
  three-column footer, and `© 2026 Oak Row Farm Co.` beside the line. Then
  the six other networks, each recognised from its pasted address, to see
  all seven marks at once (they read right at 44px; `Add a link` greyed out
  at eight); a details save that changed the phone left the frame as it
  was; and `www.example.com` in the button's `Goes to` put the four shapes
  in red under the box and held Save until `Discard changes`. Tests:
  `tests/site-frame.test.ts`.

### 2026-09-05 — Slice 6b: layout presets and backgrounds (`claude/marketing-site-layout-presets`)

Everything "resize" was really asking for, as presets that fit a phone. No
migration: `style` is optional JSON on every section, and a page saved
before it existed reads exactly as designed.

- **`SectionStyleSchema`** (`src/lib/sites/schema.ts`), optional on all
  twelve kinds: `width` default | text | page | full, `spacing` default |
  tight | normal | airy, `align` default | left | center, `background`
  default | none | tint | brand | dark | photo, and `photo` (an `ImageRef`
  drawn behind everything when the background is `photo`). The hero gains
  `height` compact | standard | tall and `imageSide`; the about section
  `imageSide`; both optional.
- **`src/lib/sites/style.ts`** (pure, tested): `SECTION_DEFAULTS` per kind
  (the offer and cards on a tint, the call to action on the brand band,
  reading kinds in the text column), `resolveStyle(type, style, adjust)`
  which lets the renderer adjust a default (an about with a photo takes the
  page column; plain columns lose the band; a wide photo the full width)
  under the owner's choice, and the classes: `widthClass`, `spacingClass`,
  `heroHeightClass`, `backgroundClass`. **`toneFor(background)`** is the
  point: headings and links take the brand colour on a light background,
  white on dark or a photo, the brand's own foreground on the brand band;
  quiet text fades rather than changing colour on the brand band; a button
  is the brand colour on light and white elsewhere. A white card panel keeps
  the light tone whatever band is behind it.
- **The renderer** (`site-page.tsx`, rewritten): every section renders
  through a `Shell` that draws the band (and, for `photo`, the photo as an
  absolutely placed decorative image under a 55% dark overlay, eager only
  on the hero), then the column, the room and `text-center` when centred.
  Each case takes its colours from the tone. The hero's photo may sit left;
  the about's too; centred heroes centre the headline block and the
  button. `Gallery` now hands its wrapper to the Shell and takes a caption
  class; `Slideshow` and the enquiry form take `onDark` and light their
  captions, labels and dots.
- **The editor** (`section-forms.tsx`): `SectionForm` is now the kind's
  fields plus a `Layout and look` block (`StyleFields`) on every card:
  `Width` (not for a photo or a slideshow, which have their own), `Height`
  for the hero or `Spacing` for the rest, `Alignment`, `Background` and,
  for a photo background, a `Background photo` picker; `Photo side` appears
  under a hero's or an about's placed photo. `Choice` is the shared row of
  pressed buttons.
- Tests: `tests/site-style.test.ts` (the schema's defaults and the old
  page that still parses, resolution order, the classes, the tones, and
  that a background photo needs no description). Guide: `page-editor.md`.
- **Driven on the dev branch (Test tenant, `oak-row-farm`)**: the home
  page's hero set to `Tall`, `Centred`, background `Photo` with the hay
  barn behind it and its side photo moved `Left`; the Columns section to a
  `Dark` band; the call to action `Centred` and `Airy`; saved and
  published. The live home page's hero section read `relative
  bg-neutral-900 text-white` with the background photo loading eagerly
  under the `bg-neutral-950/55` overlay, its inner column `py-24 sm:py-40
  text-center`, the headline computed white and centred, and the side
  photo first in the grid; the columns band was `bg-neutral-900 text-white`
  with a white heading while the cards' headings stayed the brand colour
  inside their white panels; the call to action kept the brand band with
  `py-24` and a centred row. The editor route answered a stale 404 once
  after the many edits until any change to its file made Turbopack
  recompile it — nothing in the code, and worth knowing before chasing a
  ghost.

### 2026-09-05 — Slice 6: columns and cards (`claude/marketing-site-columns`)

The founder asked for "drag and resize sections, columns" and an elite
builder. The assessment (kept in the roadmap rows 6b–12): no pixel drag or
resize — it breaks on phones and starves the assistant and the live
blocks — but every layout choice people reach for as presets, starting
with the biggest structural gap, a columns section.

- **`columns` section** (`src/lib/sites/schema.ts`): `heading`, `intro`,
  `columns` 2 | 3 | 4, `widths` equal | wide-left | wide-right (read with
  two columns), `look` cards | plain, and `cards` (≤ `CARDS_MAX` = 12) of
  `CardSchema`: `{ id, image: ImageRef | null, icon, heading, body ≤ 4
  paragraphs, cta | null }`. `icon` is one of `CARD_ICON_NAMES`, twenty-four
  trade-neutral lucide names, drawn by `src/components/site/card-icons.tsx`
  (`CARD_ICONS`, `CardIcon`); a test keeps the two lists equal. A card's
  `id` is made once in the editor (the form field's `makeFieldId`) so a
  dragged card keeps its identity.
- **Rendered** (`site-page.tsx`): a band with white panels (the offer
  section's look) or plain; the grid is one column on a phone, two on a
  tablet, `columns` on a laptop, and for two columns `md:grid-cols-[2fr_1fr]`
  or `[1fr_2fr]` when a side is wider. A card shows its photo (4:3,
  rounded) or, without one, its icon in the brand colour; then the heading
  in the brand colour, the paragraphs, and the button as a text link.
- **The editor** (`section-forms.tsx`): `Heading`, `Line under it`,
  `Columns` (2/3/4), `Widths` (only with two), `Look` (Cards/Plain) and
  `CardsFields`: a sortable list on its own `DndContext` (`cards-<section>`,
  never colliding with the sections list), each card a panel with a drag
  handle, `Card n`, ↑/↓, remove, `Heading`, `Text`, `Icon` (a select of
  `iconLabel` names), `Photo` (the library picker) and the button fields;
  {button:Add a card|outline|plus} up to twelve. `iconLabel` ("map-pin" →
  "Map pin") lives in `pages.ts`, pure. `undescribedPhotos` counts card
  photos; `sectionSummary` reads `Heading: card, card, card`.
- Tests: `tests/site-columns.test.ts` (the card and section shapes, the
  icon list against the drawings, summaries, photo counts),
  `sites-pages` catalogue. Guide: `page-editor.md`.
- **Driven on the dev branch (Test tenant, `oak-row-farm`)**: a `Columns`
  section added after the home page's About, headed "Why people buy from
  us" with a line under it; the three starter cards overwritten (a `truck`
  icon on the first, the library's photo on the second, a `Get in touch`
  button to `/contact` on the third), the third moved up with the arrow,
  saved (the list read `Columns Why people buy from us: Delivered on
  Fridays, Ask us anyt…` with the alt nudge under it for the photo card),
  published. The live home page drew the tinted band with three white
  panels in a `sm:grid-cols-2 lg:grid-cols-3` grid: the icon card, the
  card with the text link to `/sites/oak-row-farm/contact`, and the photo
  card with its icon hidden.

### 2026-09-05 — Slice 5e: the alt text nudge (`claude/marketing-site-alt-nudge`)

Nothing enforces a photo's description, so the lists say when one is
missing. No migration.

- **`undescribedPhotos(section)` / `undescribedPhotosOnPage(content)` /
  `altNudge(count)`** (`src/lib/sites/pages.ts`, pure, tested): every
  placed photo — the hero's, the about section's, a `Photo` section's, a
  gallery's or a slideshow's items — counted, with those whose `alt` is
  blank after trimming; the line reads `The photo has no description.`,
  `3 photos have no description.` or `2 of 3 photos have no description.`,
  and is null when nothing is missing.
- **The editor** (`page-editor.tsx`): a section's row in the list shows the
  nudge in amber under its summary; under the `Sections` heading the
  page's count appears with `Screen readers and search engines say the
  description instead of the picture; add one under each photo.` Both
  follow the unsaved state, so typing a description clears them at once.
- **The Website screen** (`pages-panel.tsx`): each page's row adds `· 2
  photos without a description` in amber, from the page's DRAFT (what the
  editor would show), beside the section count.
- Guides: `page-editor.md`, `website.md`.
- **Driven on the dev branch**: the Pages panel read `Home / · 6 sections
  · 2 photos without a description · published` (the slideshow's two
  photos had captions but no descriptions) and nothing for About and
  Contact; the home page's editor showed `2 of 3 photos have no
  description.` under `Sections` and `2 photos have no description.`
  under the Slideshow row; typing one description made them `1 of 3` and
  `1 of 2`, typing the second cleared both; saved.

### 2026-09-04 — Slice 5d: the swipe (`claude/marketing-site-swipe`)

The thing a thumb tries first. No migration, no new section.

- **`swipeDirection(dx, dy)`** (`src/lib/sites/slides.ts`, pure, tested):
  a drag of at least `SWIPE_THRESHOLD` (40px) that is more across than up
  or down is `1` (finger left, next) or `-1` (finger right, previous);
  anything else is `0` and was a scroll the browser already handled.
- **`useSwipe`** in `slideshow.tsx`: pointer events (a finger and a mouse
  alike) remember the press and judge the release; `touch-action: pan-y`
  on the element leaves vertical scrolling to the browser and takes only
  the sideways move; the photos are `draggable={false}` and `select-none`
  so a mouse drag does not start a native image drag that would cancel the
  pointer. Spread on the slideshow's frame and the lightbox's stage. A
  release that ended a swipe also fires a click, so the lightbox's
  close-on-backdrop asks `consumeSwipe()` first and ignores that one.
- **Arrow keys** on the slideshow: the wrapper's `onKeyDown` moves the show
  while any of its buttons has focus, the way the lightbox already did.
- Guide: `page-editor.md` (a swipe on a phone, the arrow keys).
- **Driven on the dev branch** with synthetic pointer events on the
  published home page's slideshow (paused first): a 100px drag left moved
  to the next photo, a 100px drag right back, a drag mostly downward and a
  20px drag changed nothing, and ArrowRight on a focused dot moved on; the
  frame's computed `touch-action` was `pan-y` and the photo `draggable`
  `false`. In the about page's lightbox a drag left read `Photo 2 of 2`
  and the click that followed it did not close the dialog, a drag right
  read `Photo 1 of 2`, and a plain click on the dark closed it.

### 2026-09-04 — Slice 5c: the slideshow, and the gallery's lightbox (`claude/marketing-site-slideshow`)

The first client script on a public page beyond the beacon and the form,
and deliberately the last kind for a while: photos shown one at a time.
No migration; two sections' JSON.

- **`slideshow` section** (`src/lib/sites/schema.ts`): `heading`
  (optional), the gallery's `items` (≤ `GALLERY_ITEMS_MAX`, `{ image,
  caption }`), `seconds` 0–30 (0 = only when pressed; default 6) and
  `layout` inset | wide (default wide). Catalogue entry `Slideshow`;
  summarised like the gallery (`<heading>: n photos`).
- **`src/components/site/slideshow.tsx`** (client): `Slideshow` and
  `Gallery` (+ its `Lightbox`), plain elements on the site's CSS variables.
  The server resolves each photo to a `Slide` (`src/lib/sites/slides.ts`:
  `{ src, alt, caption, width, height }`, `wrapIndex`, `slideLabel`,
  `SLIDESHOW_SECONDS`, `secondsLabel`) through `toSlides` in
  `site-page.tsx`, so the component never learns a mode or a row. What a
  visitor is promised: the first photo is in the server HTML; only the
  current photo is in the page and the next is fetched ahead; arrows,
  dots (`aria-current`) and Pause/Play are named buttons; the caption row
  is `aria-live` with a visually hidden `Photo n of m`; a moving show
  stops while the pointer or focus is on it and **never moves under
  `prefers-reduced-motion: reduce`**. The gallery's tiles stay links to the
  photo's route (no script → new tab) and open the `Lightbox` with a
  script: `role="dialog"` `aria-modal`, Escape and the arrow keys, focus on
  Close and back to the tile on close, body scroll locked, a click on the
  dark closes.
- **The editor**: the `Slideshow` card has `Heading`, `Moves on by itself`
  ({button:Only when pressed|outline}, {button:Every 4 seconds|outline},
  {button:Every 6 seconds|outline}, {button:Every 10 seconds|outline}),
  `Width` and the gallery's photo rows (`GalleryFields`, shared).
- Tests: `tests/site-photos.test.ts` (the section's shape and limits,
  `wrapIndex`, the labels), `sites-pages` catalogue. Guides:
  `page-editor.md` (the Slideshow kind; the gallery's tiles now open over
  the page), `website.md`.
- **Driven on the dev branch (Test tenant, `oak-row-farm`)**: a `Slideshow`
  added under the home page's hero, headed "Life on the farm", `Every 4
  seconds`, full width, the library's two photos with captions; saved (the
  list read `Life on the farm: 2 photos`), published. On the live home page
  it had already moved to the second photo by the time the checks ran;
  `Next photo` wrapped to the first with the live caption row reading `The
  front field Photo 1 of 2`, `Previous photo` went back, 4.6 seconds later
  the dot had moved on its own, `Pause` became `Play` (`aria-pressed`) and
  4.6 seconds later nothing had moved. On the about page a gallery tile
  (still a `target="_blank"` link to the photo's route) opened a
  `role="dialog" aria-modal` labelled `Photo 1 of 2` with focus on `Close`
  and the body's scroll locked; ArrowRight read `Photo 2 of 2` with the
  second photo, ArrowRight again wrapped to the first, Escape closed it
  with focus back on the tile and the scroll restored; the second tile
  opened at `Photo 2 of 2` and `Close` closed it.

### 2026-09-04 — Slice 5b: the gallery (`claude/marketing-site-gallery`)

The placement ADR 0023 left for later, on the library and routes it built.
No migration: a gallery is a section, so it is JSON on the page.

- **`gallery` section** (`src/lib/sites/schema.ts`): `heading` (optional),
  `items` — up to `GALLERY_ITEMS_MAX` (12) of `{ image: ImageRef, caption ≤
  120 }` — and `columns` 2 | 3 | 4 (default 3). Catalogue entry `Photo
  gallery`; a fresh one is headed "Photos" and empty; the editor's list
  summarises it as `<heading>: <n> photos` / `no photos yet`.
- **Rendered** (`site-page.tsx`) as a heading and a grid: two columns on a
  phone, `columns` on a wide screen; each photo is a 4:3 `object-cover`
  tile wrapped in a link to the photo's own route (`target="_blank"`), so a
  visitor can see it larger with no script; captions under the tiles. A
  photo whose row is gone is skipped and a gallery with none left draws
  nothing.
- **The editor** (`GalleryFields` in `section-forms.tsx`): `Heading`,
  `Photos per row` (2/3/4 as pressed buttons), then one row per photo —
  the picture, `Photo N description` (alt), `Photo N caption`, change
  ({icon:image-plus}), ↑, ↓, remove — and {button:Add a photo|outline|plus},
  which opens the same library dialog a single placement uses
  (`PhotoLibraryDialog` is now exported): a pick appends when adding or
  replaces when changing; a photo removed from the library is dropped
  from the gallery's items at once.
- Tests: `tests/site-photos.test.ts` (the gallery's shape, limits and
  summaries), `sites-pages` catalogue list. Guides: `page-editor.md`.
- **Driven on the dev branch (Test tenant, `oak-row-farm`)**: a `Photo
  gallery` added to the about page from the catalogue, headed "Around the
  farm" at two per row; the first photo picked from the library (the
  hero's), the second uploaded through the gallery's dialog (an 1800×1200
  canvas JPEG, back at 1600×1067 with `Photo added.`); descriptions and
  captions typed, saved (the list read `Around the farm: 2 photos`),
  published. The live about page drew the heading and two 4:3 tiles, each
  a `target="_blank"` link to its photo's route, with the alt text and the
  captions underneath.

### 2026-09-04 — Slice 5: photos on the pages (`claude/marketing-site-photos`)

The pictures the brochure was missing. [ADR 0023](../decisions/0023-photos-are-one-derivative-in-the-sites-library.md)
settles what is kept (one derivative the platform made, nothing else), where
it is served from (our routes, published sites only) and where a photo may go
(three placements).

- **`site_images`** (`0256`, RLS in `0257`): a library per site under the new
  blob prefix `sitePhotoPathPrefix(tenant)` = `sites/<tenant>/photos/`
  (`src/lib/blob.ts`, in the tenant allowlist), at most `SITE_IMAGES_MAX`
  (60) rows; members read, owners insert and delete, no UPDATE. Unique on
  `pathname`; CHECKs on the mime (`image/jpeg`, `image/png`) and the
  dimensions.
- **The upload** is the logo's twin: `POST /api/marketing/sites/upload`
  issues a presigned token bounded to the prefix, the photo types and
  `PHOTO_MAX_BYTES` (12MB); the browser uploads straight to the store
  (`uploadPresigned`); `registerSitePhotoAction` then runs
  `inspectUploadedPhoto` (`photo-ingest.ts`), which re-reads the real bytes,
  refuses an SVG, and hands them to **`preparePhoto`**
  (`src/lib/sites/photo.ts`): `sharp` decodes with a 50-megapixel limit,
  `rotate()` bakes the EXIF orientation in, the long edge is capped at
  `PHOTO_MAX_EDGE` (1,600), and the result is a JPEG (q82, mozjpeg) or a
  PNG when the upload had transparency — with every metadata tag dropped,
  because nothing calls `withMetadata()`. The derivative is `put`, the
  upload is `del`eted, the row is written inside `withTenant` and audited
  (`marketing.site.photo_added`); a row that fails takes its blob with it.
- **The content model**: `ImageRefSchema` `{ id, alt }`; `hero.image` and
  `about.image` (nullable), and a new `image` section `{ image, caption,
  layout: inset | wide }`. `PublicSite.images` maps id → `{ width, height }`
  so the renderer draws a photo only when its row still exists and can give
  the `<img>` its size (no layout shift). `imageSrc(mode, slug, id)`: `/images/<id>`
  on a site host, `/sites/<slug>/images/<id>` on the platform host, the
  member route in the draft preview.
- **Served** by `siteImageResponse` (`src/lib/sites/images.ts`) at
  `/sites/[slug]/images/[imageId]` and `/domain/[host]/images/[imageId]`,
  **published sites only**, `public, max-age=3600, s-maxage=604800`; and to
  members at `/api/marketing/sites/images/[id]`. The proxy's mapping moved
  into the pure **`siteRewrite`** (`slug.ts`) so it could be tested: `/logo`
  and `/images/*` go to the site's asset routes, everything else to the
  page route; `/images` joined the reserved page paths.
- **The editor**: `PhotoField` (`components/photo-picker.tsx`) on the hero
  (`Photo beside the headline`), the about section (`Photo beside the
  text`) and the `Photo` section (with `Caption` and `Width`: `In the text
  column` / `Full width`); the placed photo shows with its size and a
  `Describe the photo` alt field, {button:Change photo|outline|image-plus}
  and {button:Remove|ghost|trash}; {button:Add a photo|outline|image-plus}
  opens the **library dialog** (`Your site's photos`): a grid to pick from,
  {button:Upload a photo|outline|image-plus}, and a {icon:trash} per photo
  that removes it from the site after a confirm. The library is the
  editor's state, handed to every section's picker (`PageEditor` takes
  `photos` and `tenantId` from the route).
- Tests: `tests/site-photos.test.ts` (the schema, `imageSrc`, the reserved
  path, the prefix, `siteRewrite` for both host kinds, and `preparePhoto`
  end to end with `sharp`: a 3000×2000 JPEG becomes 1600×1067, a
  transparent PNG stays PNG and is not enlarged, orientation 6 becomes
  600×800 with no EXIF left, an SVG and junk are refused);
  `tests/isolation/sites.test.ts` gains the `site_images` block. Guides:
  `page-editor.md` (the photo fields, the `Photo` kind, the dialog, the
  messages), `website.md` (photos are no longer "not on this page").
  Security rows for the three routes.
- **Driven on the dev branch (Test tenant, `oak-row-farm`, real blob
  store)**: a 2400×1600 JPEG (55KB, drawn on a canvas and handed to the
  picker's file input) uploaded through the presigned door, came back
  `1600 × 1067` in the hero's `Photo beside the headline` with `Photo
  added.`; alt text set, saved, published; the live home page drew it
  beside the headline from `/sites/oak-row-farm/images/<id>` (200,
  `image/jpeg`, 18,005 bytes, the public cache header, an ETag), with
  `width`/`height` attributes and `loading="eager"`; the draft preview drew
  the same photo from the member route; the member route answered 401
  without a session, an unknown id and a malformed id 404, and `/images` as
  a page 404. A 1200×900 PNG with transparency went into a full-width
  `Photo` section on the about page and stayed a PNG at 1200×900 with its
  caption. Removing it from the library (`Photo removed.`) cleared the
  section, the published about page lost its figure, the route answered
  404 and the blob was gone from the store; the audit log held one
  `photo_added` per upload and one `photo_removed`. `curl -H "Host:
  oak-row-farm.localhost:3000"` then served `/`, `/about`, `/logo` and
  `/images/<id>` through the proxy's rewrite.
- **Found while driving: `<slug>.localhost` had been reading as the
  PLATFORM since slice 3**, because `classifyHost` treated any subdomain of
  a platform host as the platform's before asking whether it was a site's
  free address — and on a laptop the site domain and a platform host are
  both `localhost`. Fixed by deciding the free address first (exact
  platform hosts still win); production names are unaffected because the
  site domain is never a platform host's. `tests/sites-domains.test.ts`
  pins it. The slice 3 curl checks had only exercised `/domain/<host>`.

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
- **The assistant in the editor proposes; the owner saves** (slice 12,
  [ADR 0027](../decisions/0027-the-assistant-proposes-words-and-the-owner-saves-them.md)).
  Three doors, one shape: a brief of what the public page already prints,
  ONE bounded input (a section's words by slot with a length each, a
  sentence, a photo's pixels), one forced tool, a parse through the content
  model, and the editor's own unsaved state. `sectionWords`/`applyWords`
  walk a per-kind path map (`hero: headline, subheadline, cta.label` and so
  on) so a rewrite can touch nothing but strings that were already there;
  `assemblePageBlocks` turns blocks of a fixed kind list into real sections
  with `newSection` defaults, once-only kinds deduped, calendar kinds
  dropped while Scheduling is off. The actions write no row: a mistake is
  undone by not saving. The valve is `site_assistant` in
  `public_access_attempts`, keyed by a hash of the tenant id rather than
  `ipKey` (which is `unsalted`, and so no key at all, without
  `INTERVIEW_IP_SALT`).
- **Where a photo belongs is read from the page, never kept** (18, ADR
  0031). A stored checklist would drift from the pages the moment a
  section was added or moved; the shot list is `pageSpots` over the draft,
  so it is right by construction and costs no table. The template's notes
  are keyed by role and by picture slot, with the slot's note taken only
  while the section there is still of the kind the template put in it, so
  an owner's edit falls back to the role's words rather than to a sentence
  about the wrong section. The core's notes speak no industry; a test
  keeps them so.
- **The camera is a file input** (18). `capture="environment"` on an
  `<input type="file">` opens the camera on a phone and is ignored on a
  computer: no permission prompt of the platform's own, no media API. The
  button is offered on `navigator.maxTouchPoints`, a guess about a camera,
  which is why the plain upload button stays beside it everywhere; the
  guess is read through `useSyncExternalStore` so the server renders the
  list without it and nothing mismatches on hydration.
- **The look is the platform's, and it follows the best of the kind** (17).
  The visual pass took its patterns from the best direct-to-consumer farm
  sites (Seven Sons, White Oak Pastures, Polyface) and put each into the
  RENDERER rather than the template, so every site gets the hero scale,
  the gradient wash, the tiles, the tinted icon circles, the heading
  scale, the sticky header and the brand-colour footer, and a template
  only chooses among them. A template never carries a pixel; a look that
  needs a new control gets it in the content model (the hero's eyebrow
  and second button, an offer item's photo) where every industry can use it.
- **Proof is never written for a business** (16). Testimonials and
  questions are section kinds that show only once filled (a quote needs
  words and a name, a question an answer), so a template can carry them
  empty, or with questions and no answers, and nothing invented reaches a
  visitor; `templateSlots` keeps a blank answer away from the writer.
  Answered questions are told to search engines as an FAQPage. The logo's
  size is a frame setting (`settings.logoSize`), not a section's.
- **A site template is data an industry contributes** (15,
  [ADR 0030](../decisions/0030-a-site-template-is-data-an-industry-contributes.md)).
  The fourth use of P5 and the industry layer's first: pages of the site's
  own typed sections with STARTER words (`{name}`, `{what}` filled by the
  assembler), a frame, a look suggestion (applied to a kit only where every
  look field is unset, the `display.currencySymbol` rule) and picture slots
  the platform's drawn scenes fill. `assembleTemplate` keeps a booking or
  events section only while Scheduling is on, hours only with hours, and a
  pack's block only when the tenant's catalogue offers it with every
  setting chosen for them (one channel: kept; two: left for the owner).
  The writer is handed EVERY word slot with its starter and its length
  (`templateSlots`) and writes them back through one forced tool;
  `applySiteWords` puts them in one section at a time, so a bad section
  keeps its starter. Without a key the starter words are the site. The old
  fixed three pages became `general.ts`; `standardSiteCopy`, `assembleSite`
  and `mergeSiteCopy` are gone. Starter pictures are library rows named
  `starter-<scene>` in the tenant's photo namespace, reused on a rewrite.
- **The header folds on a phone with a native disclosure, not a script**
  (14). `<details>`/`<summary>` below `md`, the owner's button kept in the
  row, the pages in a panel under a Menu button; ADR 0019 keeps a public
  page's scripts few and a disclosure needs none, opens from the keyboard
  and closes when a page is chosen. What it cannot do without script is
  close on a click outside, accepted.
- **The preview follows the editor, not the save** (13, [ADR 0029](../decisions/0029-the-preview-follows-the-editor-not-the-save.md)).
  The frame stays (device widths are the browser's breakpoints, and two
  stylesheets in one document is the other reason), and the editor posts
  `yosher:site-draft` to it 120ms after every edit; `LiveDraft` in the
  frame redraws the same renderer with it. Autosave was refused for the
  reason ADR 0027 gave the assistant: a save nobody pressed, and a
  version per keystroke. The frame checks the SHAPE of the draft, not the
  content model's limits, so a blank required field mid-edit still
  draws; unsaved sections that need live data ask `/api/marketing/sites/live`.
- **A pack's block is data the site draws** (9b, [ADR 0028](../decisions/0028-a-packs-block-is-data-the-site-draws.md)).
  The third use of P5: the site names the slot (`src/lib/site-blocks`), the
  registry names the packs, Retail fills it. A provider describes its editor
  FIELDS as data (a select with options, a switch), checks a config, and
  answers ROWS (name, detail, amount, sold out); the editor draws the
  fields and the renderer draws the rows in the site's look, so no pack
  ships a component or puts markup on a public origin. One section kind,
  `block` (`kind`, `config`, plus the site's heading, note and empty line),
  keyed on `PublicSite.blocks` by `blockKey` (kind + sorted config) so two
  sections set up alike share one load. GATED on the pack being on, read in
  the page's own transaction: not offered, not saved (`blockSectionsProblem`
  in `savePageAction`), not drawn. `newSection` and `SECTION_TYPES` are typed
  on `PlainSectionType` because a block starts from a catalogue entry, never
  from a kind alone.
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

Since 6d (`0258`): `look`, `font_pairing` and `button_shape`, each `''` or
one of the words in `src/lib/brand/looks.ts` (CHECKs `brand_kits_look_values`,
`brand_kits_font_pairing_values`, `brand_kits_button_shape_values`). `''` on
a company kit is "as the business kit says"; on the business kit it is the
platform default, `modern`. Resolved by `resolveBrand` like a colour and
turned into one answer by `resolveLook` ([ADR 0024](../decisions/0024-a-look-is-a-preset-and-its-fonts-are-the-platforms.md)).

| Table | Purpose | Notes (RLS, invariants, FKs) |
| --- | --- | --- |
| `sites` | The business's website: its address, live details and status | FORCE RLS. `member_read`; INSERT/UPDATE/DELETE need `app_current_tenant_role() = 'owner'`. Unique on `tenant_id` (one site per tenant, this slice) and on `slug` platform-wide (it is a hostname label). Since 11b (`0260`): `previous_slugs text[]`, the addresses the site used to have, newest first, at most ten, GIN-indexed for the containment lookup an old address makes. CHECKs: slug shape `^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$`, `status in (draft, published)`, `copy_source in (model, standard)`, title ≤ 80. `settings` is `SiteSettingsSchema`: the details (phone, email, address, hours), since 6c the frame (announcement bar, header button, social links, footer columns, footer line), and since 10 `map`, the geocoded pin kept with the address it was placed from (ADR 0026), all read live by the renderer |
| `site_pages` | One page: its path, title, nav place, `draft` and `published` content | FORCE RLS, same policies. Composite FK `(tenant_id, site_id) → sites` ON DELETE CASCADE. Unique `(site_id, path)`. CHECK: path `^/(?:[a-z0-9-]+(?:/[a-z0-9-]+)*)?$`, title 1–80. `draft`/`published` are `PageContentSchema`; `published` null = never published. Since 9b a section may be a pack's `block` (`kind` such as `retail.prices`, a `config` its provider's fields set); no table changes, the pack's rows are read at render. Since 15b the content carries `seoTitle` (≤70, the title tag when set) and the settings carry `about` (≤600, the owner's lines for the writer) |
| `site_page_versions` | A page's history: the content at each `save`, `publish` and `restore` | FORCE RLS; `member_read`, owner INSERT and DELETE (no UPDATE — a version is never edited). Composite FK `(tenant_id, page_id) → site_pages` ON DELETE CASCADE. CHECK on `kind`. Trimmed to the newest `PAGE_VERSIONS_KEEP` (30) on every write by `recordVersion` |
| `site_domains` | A domain the business owns, connected to its site | FORCE RLS; `member_read`, owner INSERT/UPDATE/DELETE. Composite FK `(tenant_id, site_id) → sites` ON DELETE CASCADE. **Unique on `domain` platform-wide** (a hostname points at one site); at most five per site (`SITE_DOMAINS_MAX`). CHECKs: hostname shape, `status in (pending, active, error)`. `records` is `DnsRecordToPublish[]`, what the owner was last told to publish; `vercel_verified`/`vercel_configured_by` are Vercel's last words. **Only an `active` row routes**, and only Vercel makes a row active |
| `site_enquiries` | A message sent through the site's form: the record of what was sent | FORCE RLS; `member_read`, **member INSERT** (`owner`/`staff` — the public path writes as `staff`, ADR 0021), owner DELETE, **no UPDATE policy**. Composite FK `(tenant_id, site_id) → sites` ON DELETE CASCADE. `party_id` / `work_item_id` are **soft pointers** (no FK): the screen resolves them and says when one is gone. CHECKs: name 1–120, message 1–4000, `notify_via in (none, site_email, owners)`. `ip_hash` is the salted hash the caps use, never the IP. Capped at `ENQUIRY_SITE_DAILY_CAP` (100) per site per UTC day. Since 4b (`0254`): `answers` jsonb, `EnquiryAnswer[]` label snapshots of the business's own questions. Since 8 (`0259`): `booking_starts_at` / `booking_ends_at` (both or neither, CHECK `site_enquiries_booking_whole`), `booking_title`, and `schedule_item_id`, a soft pointer to the item on the Bookings calendar — a booking is an enquiry with a time (ADR 0025), capped at `BOOKING_SITE_DAILY_CAP` (100) bookings per site per day |
| `site_page_views` | How many people looked at a page: one row per `(site, day, path)`, counters only | FORCE RLS; `member_read`, **member INSERT and UPDATE** (`owner`/`staff` — the beacon upserts as `staff`, ADR 0022), **no DELETE policy**. Composite FK `(tenant_id, site_id) → sites` ON DELETE CASCADE. Unique `(site_id, day, path)`; `day` is a `date` in the tenant's timezone. CHECK: counts ≥ 0. Nothing about a person is stored; `visitors` is browsers reporting their first view of the day on that page |
| `site_images` | The site's photo library: one row per derivative the platform made | FORCE RLS; `member_read`, owner INSERT/DELETE, **no UPDATE** (a replaced photo is a new row). Composite FK `(tenant_id, site_id) → sites` ON DELETE CASCADE. **Unique on `pathname`** (one blob, one row); at most `SITE_IMAGES_MAX` (60) per site. CHECKs: `mime_type in (image/jpeg, image/png)`, width/height/bytes > 0. The blob lives under `sites/<tenant>/photos/`; sections reference the row by id with their own alt text (ADR 0023) |

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
- Photos: `src/lib/sites/photo.ts` (`preparePhoto`, the limits),
  `images.ts` (`siteImageResponse`, the public cache header),
  `read.ts` (`listSiteImages`, `PublicSite.images`), `slug.ts`
  (`siteRewrite`, `/images` reserved), `src/lib/blob.ts`
  (`sitePhotoPathPrefix`); `src/modules/marketing/photo-ingest.ts`,
  `image-ops.ts`, `image-actions.ts`, `components/photo-picker.tsx`;
  routes `src/app/api/marketing/sites/upload`,
  `src/app/api/marketing/sites/images/[id]`,
  `src/app/sites/[slug]/images/[imageId]`,
  `src/app/domain/[host]/images/[imageId]`
- Search engines and icons: `src/lib/sites/seo.ts` (robots, the sitemap,
  the structured data, the icon sizes, `siteBaseUrlFor`, `shareFacts` and
  `shareKey` — pure), `seo-routes.ts` (`robotsResponse`, `sitemapResponse`),
  `icon.ts` (`siteIconResponse`, `monogramPng`), `share.ts`
  (`renderShareImage`, `siteShareResponse`), `textPaths` in
  `src/lib/brand/logo-svg.ts`, the `robots.txt`, `sitemap.xml`,
  `icon/[size]` and `share/[key]` routes under `src/app/sites/[slug]/` and
  `src/app/domain/[host]/`, `iconsFor`, `shareImageFor` and `sendOnIfMoved`
  in `public-route.tsx`, `businessFacts` in `site-page.tsx`,
  `lookupSiteByPreviousSlug` in `read.ts`, `withPreviousSlug` in `slug.ts`;
  migration `0260`
- The map: `src/lib/sites/map-core.ts` (the projection, the key, the
  marker, the geocoder's answer, the status line — pure), `map.ts`
  (`geocodeAddress`, `renderMap`, the two responses), the three `map/[key]`
  routes, `placeOnMap` in `site-actions.ts`, the `map` case in
  `site-page.tsx` and `section-forms.tsx`
- Events: `src/lib/sites/events-core.ts` (`upcomingEvents`, `eventDate`,
  `eventWhen` — pure), `wantsEvents` / `liveEvents` in `read.ts`, the
  `events` case in `site-page.tsx` and `section-forms.tsx`
- Bookings: `src/lib/sites/booking-core.ts` (the request, the window, the
  offered times, the sentence — pure), `bookings.ts` (`openBookingTimes`,
  `receiveSiteBooking`), `src/lib/schedule/managed-calendars.ts`
  (`ensureManagedCalendar`, `findManagedCalendarId`, `busyOnCalendar`),
  `src/app/api/sites/slots/route.ts`, `src/components/site/booking-form.tsx`
  + `booking-action.ts`, the `booking` case in `section-forms.tsx` and the
  `bookingOn` gate in `page-editor.tsx`; migration `0259`
- The preview: `src/lib/sites/preview.ts` (devices, the three messages —
  pure), `src/components/site/draft-select.tsx` (the draft's island),
  the `.site-draft` rules in `src/app/globals.css`, the device buttons and
  the listener in `components/page-editor.tsx`
- The look: `src/lib/brand/looks.ts` (the lists, the specs, `resolveLook`,
  `lookRadiusVars` — pure), `src/components/site/site-fonts.ts` (the
  bundled families, `siteFonts`), the `.site-root` rule in
  `src/app/globals.css`, `components/look-fields.tsx` and the sample in
  `components/brand-preview.tsx`; migration `0258`
- The frame: `src/lib/sites/links.ts` (a link's four shapes, `isSafeHref`,
  the social networks, `guessNetwork` — pure), `frame.ts` (the Header and
  footer form ↔ the settings, `frameFromInput` and its messages — pure),
  `src/components/site/social-icons.tsx` (the marks), `Announcement`,
  `SiteHeader` and `SiteFooter` in `site-page.tsx`;
  `src/modules/marketing/components/header-footer-form.tsx` and
  `saveHeaderFooterAction` in `site-actions.ts`
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
- `src/modules/marketing/assistant.ts` (the three model calls, injectable),
  `assistant-actions.ts` (gate → brief → call → parse; writes nothing),
  `ai/assistant-prompt.ts` (the pure half: `sectionWords`/`applyWords` over
  `TEXT_PATHS`, `assemblePageBlocks`, the tools and user turns);
  `components/assistant-controls.tsx` (`RewriteWords`, `WritePage`,
  `SuggestDescription`); `tests/site-assistant.test.ts`
- `src/lib/sites/proof.ts` — testimonials and questions shown only once
  filled (`completeQuotes`, `completeQuestions`, `faqJsonLd`) and the
  logo's sizes (`logoSizeClass`) (16); `tests/site-proof.test.ts`
- `src/lib/site-templates/` — the templates (15, ADR 0030): `types.ts` (a
  template is data), `core.ts` (pure: `assembleTemplate`, `attachPictures`,
  `templateSlots`, `applySiteWords`, `blockConfigFor`), `general.ts` (the
  platform's own three pages), `registry.ts` (the one file naming an
  industry), `resolve.ts` (`templateFor`); `src/industries/homestead-farm/site-template.ts`
  (the farm's five pages); `src/lib/sites/words.ts` (the slot walk, shared
  with the assistant); `src/lib/sites/starters.ts` (the drawn scenes, pure
  SVG) and `src/modules/marketing/starter-pictures.ts` (rasterised, stored,
  rowed); `site-generate.ts` (`writeSite` over every slot);
  `tests/site-templates.test.ts`
- `src/components/site/live-draft.tsx` — the frame's client half (13, ADR 0029):
  believes `yosher:site-draft`, redraws `SitePage`, fetches live data for
  unsaved sections from `src/app/api/marketing/sites/live/route.ts`
  (`loadLiveData` in `read.ts`); `preview.ts` holds the protocol
  (`readPreviewMessage`, `draftImages`, `wantsLiveData`)
- `src/lib/site-blocks/` — the declared slot (9b, ADR 0028): `types.ts` (the
  provider shape, types only), `core.ts` (pure: `blockKey`, `newBlockSection`,
  `filterCatalog`, `blockLabel`), `registry.ts` (the one file that names a
  pack), `resolve.ts` (`siteBlockCatalog`, `blockSectionsProblem`,
  `loadSiteBlocks`, all bounded by `tenant_modules`); the `block` section in
  `schema.ts`; `PublicSite.blocks`; `src/packs/retail/site-blocks.ts` (the
  price list provider) over `core/site-prices.ts` (pure presenter);
  `tests/site-blocks.test.ts`
- `docs/help/marketing/overview.md` — the screen's guide
- `src/lib/sites/shots.ts` — the shot list (18, ADR 0031): `pageSpots`, `spotKey`/`parseSpotKey`, `placePhoto`, `shotSummary`/`shotLine`, `emptySpotCount`, `isStarterPhoto`, `GENERIC_SHOTS`, `shotNotesFor` (pure); `SiteTemplate.shots` and `TemplatePicture.shot` in `src/lib/site-templates/types.ts`; `placePhotoAction` in `page-actions.ts`; `components/shot-list.tsx` and `src/app/dashboard/m/marketing/website/photos/page.tsx`; the `Photos` card on the Website page; `docs/help/marketing/shot-list.md`; `tests/site-shots.test.ts`

## Decisions & gotchas

- **A booking is an enquiry with a time** (ADR 0025), not a table of its
  own: the same party, follow-up, email and panel, plus four columns and a
  calendar item. The calendar is one the platform provisions and shares
  with everyone at `write`, because that share is what lets a write with no
  user through the scheduling policies — the only alternative was a
  `withSystem` insert stepping around them. The rules live on the section
  and are read from the PUBLISHED page on every request; the busy time is
  the calendar's `show_as`; the chosen start is recomputed against the
  offer under an advisory lock and refused as "just taken" otherwise. No
  confirmation email goes to the visitor: the platform mails a public
  form's words to the business's own addresses only.
- **The share image is drawn, not uploaded, and named by what is on it.**
  Type as paths from the kit's own font, the brand colour, the logo's own
  pixels: nothing on it is a file a tenant wrote, and a retitled page is a
  new address every cache forgets by itself. An uploaded share image is a
  later option, not a replacement.
- **An old address sends people on for as long as it is remembered**, ten
  addresses deep, and a current address anywhere wins over a previous one
  here; the platform never answers for a domain a business gave up.
- **A wide logo does not become a favicon.** The tab's icon is the logo
  only when it is roughly square; otherwise it is a monogram drawn by the
  kit's own machinery, because a wordmark at 32 pixels is a smudge and a
  business with no logo needs an icon just the same. The same rule will
  serve the share image's corner.
- **The structured data says what the settings say.** A LocalBusiness with
  only the fields the owner filled in; nothing is invented for a blank one,
  since a placeholder there is a placeholder in a search result.
- **A map is a picture the platform draws** (ADR 0026): public-domain USGS
  Topo tiles stitched on the server around a pin the Census geocoder
  placed, cached like a photo under a key that changes with the pin, the
  zoom and the colour. No MapLibre on a public page, no visitor request to
  a tile server, no commercial basemap terms; United States only, as the
  Land pack accepted for its aerial. The section says how close; the
  settings hold where.
- **A live block reads at render, on the page cache's clock.** The events
  block is the renderer reading the workspace (through `PublicSite`, loaded
  inside the same tenant transaction as the pages) rather than a section
  that was typed. It costs one calendar read per page render, only when a
  page on show has the block, and it is as fresh as the ISR window. The
  same shape — load into `PublicSite` when a section calls for it, draw
  from it — is what a pack's block will do through the declared-slot seam.
- **The public page's scripts are four where a booking section is on it.**
  The booking island is the enquiry form's twin with a time picker; it
  fetches the open times from a public read and posts through a public
  action, and every other page keeps its three.
- **The draft has a fourth script; the public page keeps three.** The
  section-pointing island renders only in draft mode and does nothing unless
  framed by the editor, so "the public page's scripts are three" (below)
  still holds for every visitor, and the draft opened on its own is not
  cluttered with outlines. The messages are the smallest possible surface —
  an index each way and a ready — on the same origin, source-checked on
  both sides; nothing in them is content.
- **A look is a preset, and its fonts are the platform's** (ADR 0024). Three
  words on the kit, each from a short list, and nine families bundled at
  build time by `next/font`; never an uploaded font, never a stylesheet,
  never a request from a visitor's browser to a third party. `clean` IS
  Geist, so a kit that has said nothing reads exactly as before. The
  corners travel as CSS variables the classes read, so no component knows
  which look is on, and a fourth look is an entry in `LOOK_SPECS`.
- **The look is the business's, not the website's.** It sits on the brand
  kit beside the colours because a share page, a mail signature and the
  documents will want the same answer; the invoice PDF ignores it for now
  and keeps Noto Sans (`src/lib/pdf/fonts`), which is an open item, not a
  contradiction.
- **The frame is settings, and shows at once.** The announcement bar, the
  header button, the social links and the footer live in `sites.settings`
  beside the phone and the hours, not in a page's draft, for the same
  reason the contact section reads the settings live: they are the site's,
  not a page's, and a bar that says "Closed Monday" has to be true the
  moment it is saved. There is no draft of the frame; the Website screen
  says so under the card's heading.
- **A link is one of four shapes, checked twice.** On save, `CtaSchema`
  and the frame refuse anything but an in-site path, `http(s)://`,
  `mailto:` or `tel:`; at render, `resolveHref` returns null for anything
  else and the words are drawn without a link. The second check is for a
  row that did not come through the first — an older page, a hand edit —
  and it costs nothing. The rule was missing until 6c; see the build log
  for why it is a security rule on the platform's origin.
- **The marks are paths in the repo, and `other` is words.** lucide 1.x
  dropped its brand icons, so the seven networks' marks are filled 24×24
  paths in `social-icons.tsx`, drawn in the current colour. A network
  without a mark (Etsy, Nextdoor, a Google profile) is `other`, shown as
  the owner's own label in a pill: a row of marks with one stroke icon
  among them reads as a mistake.
- **The public page's scripts are three, and each earns its place.** The
  view beacon (a count), the enquiry form (a pending state and a thank-you)
  and the slideshow with the gallery's lightbox (photos one at a time).
  Each is a plain component with no library, each degrades to something
  that works without it (nothing, a posted form, a link to the photo), and
  each is written so a visitor who asked for less motion or uses a keyboard
  loses nothing. A fourth script needs the same three sentences.
- **A site's free address is decided before a platform host's
  subdomains.** `classifyHost` checks exact platform hosts, then
  `hostToSiteSlug`, then platform subdomains and `.vercel.app`. The order
  only matters where the site domain and a platform host coincide, which
  is a laptop (`localhost`); it is what makes `oak-row.localhost:3000` a
  site. Reversing it (slice 3 did, unknowingly) turns local host routing
  off with no error anywhere.
- **One derivative is all a photo ever is** (ADR 0023). The upload is
  decoded, oriented, capped at 1,600px, re-encoded and stripped of every
  tag, then deleted; the store never holds an original, an SVG or a
  camera's GPS position. A replaced photo is a new row, which is why the
  table has no UPDATE policy and the public cache can hold an id for a week.
- **A photo on an unpublished site is not on the internet.** The public
  route refuses unless the site is `published`; the editor and the draft
  preview read the member route. `PublicSite.images` is the renderer's
  guard as well as its sizes: a section whose row is gone draws nothing.
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
- **The map is United States only, and trusts the geocoder's first
  match.** An address elsewhere is "not on the map" (the section still
  prints the address and offers directions); a second public-domain source
  with the same standing, or a tenant-level override as the Land pack's
  basemap has, is the shape a fix would take. An ambiguous address may pin
  the wrong match; the screen shows the matched address so the owner can
  make theirs more specific. A control to nudge the pin by hand is not
  built.
- **No confirmation email reaches the visitor who booked.** The page says
  "we'll confirm by email" and the follow-up makes it true by hand. Mailing
  an address a stranger typed is a decision about outbound mail (a verified
  sender, a cap, an unsubscribe) rather than about bookings; when it is
  made, the receiver has the words ready in `enquiryEmail`.
- **Two offers share one calendar.** A second booking section (a
  consultation beside a visit) lands on the same Bookings calendar and
  blocks the same times. A calendar picker on the section, offering
  business calendars, is the next step when somebody has two things to
  book that do not compete for the same person.
- **A booked time cannot be cancelled from the site.** The visitor emails;
  a member cancels the item in Scheduling, which frees the time at once.
- **The documents do not read the look yet.** The invoice PDF draws Noto
  Sans from `src/lib/pdf/fonts` whatever the kit says. Carrying the pairing
  onto the PDF means shipping the same nine families as TTFs for
  `@react-pdf/renderer` and registering them by name; the seam is
  `invoice-brand.ts`, and nothing is asking for it yet.
- **There is no ceiling on pages in the menu.** The header folds on a
  phone (slice 14) and a row on a wide screen wraps, so twenty pages would
  read badly rather than break; a `PAGE_SECTIONS_MAX`-style ceiling on pages
  in the menu, or a "more" fold on wide screens, waits for a site with that
  many.
- **Six marks are from memory.** The Facebook, Instagram, YouTube, TikTok,
  LinkedIn, X and Pinterest paths in `social-icons.tsx` were checked by eye
  at 44px on the dev branch, not against the networks' brand files. A mark
  that looks off on a real phone is a path to replace, nothing else.
- **A pointer drag has not been seen by a person.** The editor's keyboard
  drag is proven; the mouse path is the same sensor set and drop handler,
  but the browser tooling could not produce a real pointer drag. Ten seconds
  with a mouse on the dev branch settles it.
- **Alt text is nudged, never enforced.** The lists count photos without
  a description (5e); publishing is not blocked by one, on purpose — a
  missing description is worse than a late one but better than a page
  that cannot go live.
- **A second, smaller derivative** per photo if pages get heavy: the row
  has the room, the route can pick by a query, and the renderer already
  knows every placement's width.
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
- **The shop block** is `retail` slice 6's, through the `block` slot 9b made; it needs a client island the site owns and a provider names, the slot's first change. **Only list-shaped blocks** exist today (rows: name, detail, amount, sold out) and only two field kinds (select, switch); both grow by adding a kind to the slot, where every pack gets it. **A price changed in Retail reaches the site on the page cache's clock** (five minutes); nothing in Retail revalidates a site, like Scheduling.
- **Sitemap and robots per site**, and a `canonical` pointing at the host
  address once one exists.
- **Rewriting replaces every draft.** Fine while the assistant is the only
  writer; the editor makes a per-page rewrite the right grain.
- **The dev-branch Test tenant now holds a published site `oak-row-farm`**,
  left from this verification — since slice 4 with an enquiry form on its
  contact page, three messages (two from Jane Doe, one from Sam Rivers),
  the two parties, three `Reply to …` items and, because the CRM-on path
  needed proving, **CRM and Work switched on** for it. Since slice 5 its
  hero carries a photo (a green canvas reading "Oak Row Farm"); since 5b
  the about page ends in a two-photo gallery and the library holds two
  rows; since 5c a two-photo slideshow moving every four seconds sits
  under the home page's hero.
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
- **The draft preview draws no placeholder where a photo belongs.** The
  shot list is where the where and the what are said (18); a
  `mode === "draft"` notice in the renderer, like the map's, is the shape
  if a preview cue is ever wanted (ADR 0031).
- **`Take a photo` is offered on a guess.** `navigator.maxTouchPoints > 0`
  stands in for "has a camera"; a touch laptop gets the button and a file
  window. A phone has not yet been seen taking a photo into a spot: the
  upload path is the picker's, proven, and the camera is the browser's own
  file input with `capture`.
