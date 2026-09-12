# Marketing

> How the business looks to its customers, and — as the module grows — where
> it is found. Slices 0 and 0b are the **brand kit**: logo (uploaded or
> drawn), display name, tagline and two colours, carried onto every invoice
> PDF. Slice 1 is the **website**: pages of typed sections written by the
> assistant from the kit and the business's details, published on a free
> address. The roadmap adds the editor, custom and purchased domains shared
> with the Mail module, forms that land in the CRM, and a shop block the
> `retail` pack fills. Since 2026-09-11 there is a third leg, **social**: the
> accounts a brand posts to, and in time what it posts to them
> ([ADR 0047](../decisions/0047-a-social-channel-belongs-to-a-website-and-a-footer-link-is-not-one.md)).
> A business may have several websites, and each is a brand with its own look,
> address and accounts ([ADR 0045](../decisions/0045-a-business-may-have-several-websites-and-a-kit-may-belong-to-one.md)).
> The brand kit itself is Layer 0 data
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
| — | **Social**, a run of its own: channels, a post that is finished, the writer, the photo half, facts from the packs, the plan, connections, and whether it worked. Its table is in [Social — the plan](#social--the-plan) below | S0–S1 built |

## Social — the plan

Written 2026-09-11, from the founder's brief: *"most businesses will only have
one set of social media, but the yosher app business will for example have a
facebook for each industry. brainstorm the social media tool. content
generation, scheduling, brainstorming, photo recommendation etc."*

It lives in Marketing rather than in a module of its own, because it needs the
brand kit, the site's own words, the photo library and the site-as-brand spine,
and a separate module would import all four across a seam that does not exist.
Selling it separately is a `tenant_modules.config` flag, not an architecture.

### What a social account hangs off

[ADR 0047](../decisions/0047-a-social-channel-belongs-to-a-website-and-a-footer-link-is-not-one.md).
A channel belongs to one of the business's websites, or to the business itself
(`site_id` nullable). The site is the brand — ADR 0045 already said so — so the
per-industry Facebook is a row, and a client with one website never sees a
picker. A footer mark (`settings.social`) is a link an owner chose to display;
a channel is an account the business posts to; neither becomes the other.

### The constraint that shapes every slice

**Posting to a network is an approvals problem, not a code problem.**

| Network | What it actually takes |
| --- | --- |
| Facebook Page + Instagram | One Meta app, Business Verification, App Review for `pages_manage_posts` and `instagram_content_publish`. Weeks, and a screencast. IG needs a Professional account linked to a Page, and **publishes from a public image URL** — it will not take bytes. 50 posts / 24h / account |
| Google Business Profile | Posts API, allowlist approval. Arguably the highest-value one for a local business, and the one nobody thinks of |
| LinkedIn | Community Management API — partner approval. Out of reach for a while |
| X | Paid tiers to post at any useful volume |
| TikTok | Content Posting API; an unaudited app can only leave a draft the person finishes in the app |
| Pinterest, YouTube | App review; YouTube's upload quota is 1,600 units a video against a 10,000/day default |

So **the tool must be worth having with no connections at all.** The default is
not auto-posting: it is a post that is written, cropped and one tap from being
posted from the phone already in their hand, and a reminder at the minute it
was scheduled for. That path does not change when connections land — only the
last step does. Start the Meta review early; it is the long pole, and the Square
lesson (ADR 0017: no developer app, so OAuth is still unproven in production)
is that connection code written before the app exists proves nothing.

### The slices

| # | Slice | Needs an approval? |
| --- | --- | --- |
| **S0** | **Channels: `social_channels` per website or for the business, with the handle, the link, who reads it and how this brand sounds there; the screen; the one-tap footer mark.** [ADR 0047](../decisions/0047-a-social-channel-belongs-to-a-website-and-a-footer-link-is-not-one.md) | **built 2026-09-11** |
| **S1** | **A post, finished: `social_posts`, one row per account, the words held to that network's length, a photo from the library cut to a shape around a focus point, `draft → scheduled → posted`; the list by day; copy the words and download the cut picture; the `*/10` cron raises "time to post" as a Work item.** `idea` was dropped — a dateless draft is one | **built 2026-09-12** |
| S2 | The writer: a post from a sentence, in this channel's voice, from this brand's own words. Hashtags are a fixed enumeration per brand, never invented per call | no |
| S3 | The photo half: rank the library against the post's words with the vision call slice 12 already makes; a crop per network shape with `sharp`; and when nothing fits, a shot note — the shot list's machinery pointed at a post instead of a page | no |
| S4 | Facts from the packs: `src/lib/post-sources/`, the ninth declared extension point. Retail and livestock first | no |
| S5 | The plan: a month of beats — the industry's seasonal template, what the packs say is coming, and the gaps | no |
| S6 | Real connections, one network at a time: Meta first (one review covers Page and Instagram), a public image URL behind a hashed token like the preview link, the cron posting, a failure landing as a Work item. Then Google Business Profile | **yes** |
| S7 | Did it work: a link code per post, clicks counted the way page views are, and the enquiry that names the post it came from | no |

### The parts that need explaining before they are built

**A post idea is a FACT from a pack, never a prompt from nowhere** (S4). The app
already knows what happened: calves born, a batch home from the plant, a price
changed, something back in stock, what is on this week. The breeding calendar
(livestock slice 10) knows what is DUE, so the plan can say "calving starts in
about ten days, line up a photo" — forward-looking content from farm data, which
is the thing a general scheduling tool can never do. The slot returns rows:

```ts
interface PostFact {
  key: string;          // stable, so it is never suggested twice
  happenedOn: string;
  headline: string;     // "Two calves born" — the FACT, not the post
  detail: string;
  shape: "arrival" | "available" | "event" | "milestone" | "seasonal";
  photoHint?: string;
  link?: string;        // the page on the site this is about
}
```

**Rows, not prose, and the reason is two days old.** The Suggest button (2026-09-11,
above) described two screens that do not exist, because it reasoned from what
the page CLAIMED. A writer reasoning from page copy will say "our beef is back
in the freezer" when it is not. A claim in a post must trace to a pack row or to
the site's own words, and the model's job is the wording only.

**One post is one channel, one row.** A fan-out from one idea writes several
rows, each separately edited and separately failing. That keeps the calendar
honest (one dot is one thing going to one place) and stops the identical-text-
everywhere pattern every network punishes. For the operator tenant, fanning one
announcement across the industry Facebooks **with per-industry rewording** is
the feature, and making it explicit is what stops it being spam.

**The photo is a crop, not a second blob** (S3). Social wants 4:5, 1:1 and 9:16;
the library is landscape. The post points at a `site_images` row and holds the
box; `sharp` renders it at post time. One derivative stays one derivative
(ADR 0023), and a re-crop is a post edit rather than a new row.

**Scheduling needs no new machinery.** `*/10 * * * *` is already precedented by
`mail-sync`, so a ten-minute publish tick is a line in `vercel.json` — round the
UI's slots to ten minutes so it never promises a minute it cannot keep. Mirror a
scheduled post onto the Events calendar the way a booking mirrors onto Bookings
(a soft `schedule_item_id`), so the team sees it without opening Marketing. Post
bodies never go into a schedule item.

**Measuring works with no network API at all** (S7). A post's link is `/g/<code>`
— counted, then redirected — and the page beacon counts the visit, and the
enquiry carries `sourceDetail` (ADR 0042). "This post brought 41 clicks and 3
messages" needs no permission from anybody. Network insights are a bonus for
connected channels, not the foundation.

**Deliberately not built:** a comment and message inbox (a second product, and a
separate set of Meta permissions); posting into a client's tenant from the
operator's (ADR 0041 — a client is a party, not a workspace you can reach, and
a superadmin's support view is GET-only); generated photographs (a drawn starter
scene is plainly a placeholder, a generated photo of a farm that is not theirs is
a lie — a logo is a mark, not a claim); and anything a model sends that nobody
read.

## Build log

Newest first. One entry per session/PR that touched this module. Every PR
that changes this module MUST add an entry here (rule in AGENTS.md).

### 2026-09-12 — Social S1: a post, finished (`claude/a-post-that-is-finished`)

The second slice of the social run: writing a post, cutting a photo to it,
putting it on the calendar, and being reminded when it is due. **Migrations
0309 and 0310** (`social_posts` + its policies), applied to dev AND prod before
the merge; `verify-rls` reads 185 tables on dev and 183 on prod (the two-table
gap is another session's unmerged Time work on dev — see Decisions & gotchas).

- **`/social` IS NOW THE POSTS**, and the accounts moved to `/social/accounts`.
  The daily job takes the shorter address; writing down where the accounts are
  is a thing you do once. Done now, before anybody has bookmarked either.
- **`idea` was dropped from the status list the plan promised.** A draft with
  no time on it IS the idea, and a status nothing can produce is dead weight in
  every switch that reads it — the shape that made five call sites return a
  real-but-wrong value once already. What marks a proposed post out when S4
  arrives is `origin` (`hand`, `assistant`, `pack`), which a reader can act on.
- **A FOCUS POINT, NOT A CROP BOX**, and it is the design decision of the
  slice. A free box needs a handle at each corner — four gestures on a phone —
  and it needs the server to refuse a box outside the picture, of the wrong
  ratio, or of zero width. A focus point is one tap: `cropBox()` takes the
  shape and the point and returns the biggest rectangle of that ratio that
  fits, slid to sit around the tap and clamped inside the edges. **It cannot
  express a nonsense crop, so there is nothing to refuse.** The property test
  runs every shape against every focus over four sources including a 3×97
  sliver, and asserts the box never leaves the picture — because what consumes
  it is `sharp.extract()`, which throws on a box that does.
- **The crop is never stored.** ADR 0023 says one derivative per photo and a
  replaced photo is a new row; a crop per post would be a second blob whose
  life nothing owns. It is rendered on demand at
  `/api/marketing/social/posts/[id]/image`, `?download=1` for the attachment,
  and flattened onto white — every network re-encodes to JPEG and a transparent
  corner goes black on most of them, so the alpha is dealt with here where it
  can be seen rather than by Instagram where it cannot.
- **THE MIGRATION HAD TO BE HAND-EDITED, and the test for it is the reason this
  slice has an isolation file worth reading.** drizzle-kit emitted a bare
  `ON DELETE set null` for `(tenant_id, image_id) → site_images`, which means
  "null BOTH columns" — and `tenant_id` is NOT NULL, so deleting a photo would
  have failed with a not-null violation instead of clearing the post's picture.
  PG 15's column-list form `ON DELETE SET NULL ("image_id")` is the fix
  (conventions.md has had the rule since the accounting composite FKs), and
  `REMOVING A PHOTO CLEARS THE POST'S PICTURE AND LEAVES THE POST` proves it
  against a real database rather than against the comment.
- **The sweep splits its writes across two scopes, deliberately.** The work
  item is raised `withTenant` as `staff` with no user, exactly as the website's
  enquiry form raises one (ADR 0021) — Work's own policies decide. Stamping
  `reminded_at` runs under `withSystem`, because `social_posts` is owner-only
  to write and the sweep is not a person. The alternative was a member UPDATE
  policy so the cron could write as `staff`, and **RLS is row-level, not
  column-level**, so that would have let any member rewrite the business's
  public voice. A shortcut in a cron beat a hole in a policy.
- **`reminded_at` is cleared by `schedulePost` and `unschedulePost`**, which is
  the whole reason it is a timestamp on the post rather than a boolean somebody
  has to remember to reset: a post moved to next week is reminded next week.
  One reminder per post, ever, otherwise.
- **The time an owner types is read in the TENANT's zone, not the browser's.**
  `datetime-local` gives a naive string and `Date.parse` reads it in whatever
  zone the laptop is in; an owner away from home would have scheduled for the
  wrong hour, silently. `fromLocalInput` measures the business's offset at that
  instant and corrects.
- **Owner-only to write, and it matters more here than for a logo.** In this
  build a person still has to go and post it, but S6 sends a scheduled post on
  its own — so whoever may write a row may eventually publish one. Recorded in
  `0310`'s header rather than left as a copied default.
- **Tests**: nine more cases in `tests/isolation/social.test.ts` (18 in the
  file) — staff read and cannot write, owner CRUD, another tenant refused every
  verb, a post naming another tenant's account OR photo unrepresentable even
  under `withSystem`, the photo cascade above, a post dying with its account,
  the CHECKs refusing a scheduled post with no time and a status/shape/focus
  nobody registered, and the sweep seeing a due post but not one that is early,
  already reminded, or another tenant's. 27 in `tests/social-posts.test.ts`.
- **Not driven.** The local Clerk session is signed out and another session's
  dev server holds the port. The routes register in the build, both tables'
  rules are proven against a real database, and the crop is covered by a
  property test — but nobody has typed a post, tapped a photo or seen the cron
  raise anything.
- **Not built here:** the writer (S2), ranking the library against the words
  (S3), facts from the packs (S4), the month's plan (S5), any connection (S6),
  and any measurement (S7).

### 2026-09-11 — Social S0: the accounts a brand posts to (`claude/a-facebook-per-brand`)

The founder opened the social media tool with the constraint rather than the
feature: *"most businesses will only have one set of social media, but the
yosher app business will for example have a facebook for each industry."* This
PR is the plan for the whole run (above, **Social — the plan**),
[ADR 0047](../decisions/0047-a-social-channel-belongs-to-a-website-and-a-footer-link-is-not-one.md),
and its first slice. **Migrations 0306 and 0307** (`social_channels` + its
policies), applied to dev AND prod before the merge; `verify-rls` reads 182
tables on both.

**They were generated as `0302`/`0303` and renumbered after the fact**, because
`claude/show-it-to-someone` took those slots from a parallel session and merged
first (it had itself been renumbered off 0300/0301, which the Time module took).
The renumber keeps the ORIGINAL `when` stamps — 1789184591433 and 1789184613616,
the `created_at` values both databases already recorded — because drizzle
applies a migration only when `lastApplied.created_at < when` STRICTLY, so a
fresh stamp would re-run `CREATE TABLE` against a table that exists. Both stamps
are still greater than `0305_time_clock_rls`'s, so the journal stays
monotonic and a database built from zero applies them in order. The regenerated
SQL is byte-identical to what was applied. **Third collision on this slot in two
days; the repair is the one `inventory.md` wrote down.**

- **The expensive half was decided a day earlier and nobody noticed.** ADR
  0045's rejected-alternatives table contains the sentence *"A site is the
  thing that has a logo, a domain and social accounts"* — written to explain
  why a brand is not an `entities` row, in a slice that shipped no social
  anything. A per-industry Facebook is therefore `site_id`, nullable, and not
  a design problem. **A rejected alternative that explains the SHAPE rather
  than the slice is the cheapest documentation there is.**
- **A footer link is not a channel, and this is the whole judgement call.**
  `settings.social` has held up to eight marks since 6c, naming the same
  networks and pointing at the same accounts. Merging them is a jsonb-to-rows
  migration plus a renderer change, to conflate a display choice with a
  publishing target — an owner may post to five accounts and show two marks,
  and `other` is a footer link nothing could ever post to. So they stay apart,
  `showChannelInFooterAction` copies a value across once, and the row draws
  `In the footer` so the drift is visible where it can be fixed. The drift is
  real and accepted, and both guides now say so in the client's words.
- **`site_id IS NULL` means a THIRD thing now.** On `brand_kits` a null
  `site_id` may still be a company's kit, which is why that table needs
  `brand_kits_one_owner` and why a one-column predicate there shipped two live
  bugs the day the column arrived (ADR 0045). There is no second owner column
  here, so null means exactly one thing — the schema comment says so, because a
  reader arriving from `brand_kits` will expect the harder rule.
- **The unique index is the ADR made mechanical.** `(tenant_id, network,
  handle)`, workspace-wide rather than per site: Yosher Homestead's page and
  Yosher Trades' page have different handles, so it never touches the
  per-industry case, and what it refuses is the same account filed under two
  brands — which ADR 0047 says is one channel with a null `site_id` instead.
  `normalizeHandle` (no `@`, no spaces, lowercase) is what lets it be a plain
  index rather than an expression one drizzle-kit would have to be talked into;
  lowercase is safe because handles are case-insensitive on all eight networks,
  and `other` shows its `label` rather than its handle anyway.
- **THE TRAP FOUND WHILE WRITING `listBrands`, and it is the one memory warns
  about.** A business with no website adds accounts; they are business-level
  rows. It then builds a website. With the obvious rule — show the business as
  a brand only when there are no sites or several — that business now has ONE
  brand, and its existing accounts are gone from the screen while sitting in
  the table. So the third condition: the business is also a brand whenever
  business-level channels already exist. "One of everything is the untested
  case", and it is cheaper to hold open than to find later.
- **Nothing posts, and no token column exists.** Publishing is gated on app
  review at Meta and elsewhere, not on this table; the plan above has the
  per-network reality. A connection is S6's table, written when there is an app
  to connect to — the Square lesson (ADR 0017: OAuth code written before the
  developer app existed, still unproven in production) is the one being
  avoided. The screen says so at the bottom, and the `other` form says that one
  can never be connected at all rather than letting somebody find out later.
- **Tests**: nine cases in `tests/isolation/social.test.ts` — staff read both
  sites' and the business's, staff cannot write, an owner inserts/edits/removes,
  another tenant is refused every verb, a channel naming another tenant's site
  is unrepresentable even under `withSystem`, a business-level channel is
  refused by nothing (MATCH SIMPLE), one account is one row per workspace but
  free across tenants, the CHECKs refuse a nameless `other` and an unknown
  network, and a channel dies with its website while the business's survives.
  Twenty-four in `tests/social-channels.test.ts` for the pure half. All
  passing; `guides.test.ts` 55 passing.
- **Housekeeping this PR also did**: the dossier was 2,804 lines and 78% build
  log — the tax AGENTS.md warns about — so slice 18 back to slice 0 moved to
  `marketing-build-log.md`, which build-docs renders with no code change.
- **Not driven.** The local Clerk session is signed out and another session's
  dev server holds the port, so no channel has been added by hand. The routes
  register in the build, the table's rules are proven against two real
  databases, and the pure half is covered.
- **Not built here:** writing a post, the calendar, the photo half, facts from
  the packs, any connection, and any measurement — S1 through S7 above, in that
  order.

### 2026-09-11 — Showing a site to somebody who cannot sign in (`claude/show-it-to-someone`)

The founder asked what else the website tool needed; this was my first answer
and it turned out to be three times the job. **Migrations 0302 and 0303**
(`site_previews` + its policies), applied to dev AND prod before the merge —
generated as 0300/0301 and renumbered when the Time module took those slots.
[ADR 0046](../decisions/0046-a-preview-link-shows-an-unpublished-site-and-the-token-stands-in-for-the-slug.md).

- **The gap:** the point of this module is handing a business its site, and
  the only way to show one was to PUBLISH it — `/sites/<slug>/draft` demands a
  member of that tenant. An agency had no way to say "here it is, what do you
  think?", only "it is live, tell me what is wrong."
- **`/p/<token>/` mirrors `/sites/<slug>/` completely** — the page and its
  paths, images, the map, the logo. `SiteMode` gains `preview` and the
  renderer substitutes the token for `site.slug` ONCE at the top, rather than
  threading a second key through the thirteen components that take `mode`. A
  missed call site there would be a link silently pointing at the members-only
  route, and the compiler cannot see it because the argument is a `string`
  either way.
- **TWO THINGS THAT WOULD HAVE SHIPPED BROKEN, both found by building it.** A
  preview would have had NO PHOTOGRAPHS: an unpublished site's images need
  either a member session or a published site, and a client has neither. And
  every in-site link would have 404'd, because `draft` mode builds them as
  `/sites/<slug>/draft…`. Neither is visible on a one-page site with no
  pictures, which is exactly what Yosher Homestead was when I first looked.
- **Thinner than a document share on purpose**: no passcode, no use cap. What
  is behind it is copy the owner intends to publish. `expires_at` stays NOT
  NULL — the one rule kept whole.
- **No DELETE policy at all.** Revoking is an UPDATE. A link handed to
  somebody outside the business is not the owner's to erase, and it dies only
  with its site.
- **A preview is not a visit.** `isLiveMode` now gates the visitor beacon, the
  structured data and the canonical URL; the enquiry and booking forms show
  but are disabled. A client reviewing their own site must not create a real
  lead or inflate the owner's numbers.
- **Found and fixed on the way:** `memberMapResponse` still resolved the
  tenant's site with `findFirst` by tenant alone — left behind by ADR 0045,
  and with two sites it drew one site's pin in the OTHER'S BRAND COLOUR. It
  takes a site id now and the member map route reads one from the query.
- **Tests**: five cases in `tests/isolation/sites.test.ts` — an owner makes
  one and staff read it, staff cannot make one, NOBODY can delete one, another
  tenant's site is unrepresentable even under `withSystem`, one token hash
  platform-wide, and previews dying with their site. 50 passing.
- **DRIVEN END TO END on the dev branch**, and it caught the bug the whole
  design was built to avoid. The preview page still passed `mode="draft"` — I
  had added the mode and never switched the page to it — so the first
  signed-out fetch came back with every nav link pointing at
  `/sites/oak-row-farm/draft`. Types could not see it: the argument is a
  `string` either way. Fixed, then re-checked with `curl` and NO COOKIES: the
  page, `/about` and `/contact` all 200, the logo 200 `image/png` 17KB, a
  photo 200 `image/jpeg` 13KB, every address `/p/<token>/…`. A junk token
  renders "no longer available" with the same words. The owner's list read
  `Opened 9 times`. After `Stop it`: the page says "no longer available", the
  logo and the photo both 404, and **the view count stayed at 9** — a refused
  look is not a look.
- **Not built here:** comments on a preview (a different table, and it would
  want the passcode this leaves out), and an email that sends the link.

### 2026-09-11 — A screenshot has to be of a screen that exists (`claude/a-screenshot-of-a-screen-that-exists`)

Pressing Suggest on the Yosher Homestead home page worked — 22 notes, 14
screenshots and 8 photographs, split sensibly, and the hero came back as
*"Stand back at the edge of a pasture in early morning or late afternoon light
and take a wide landscape shot of the cattle grazing with fence line and open
sky above them. Leave the left or upper third fairly empty so the headline can
sit over it."* **Two of the fourteen described screens that do not exist**: an
"enterprise profit view" (profit per enterprise is `enterprises` slice 4 and
parked) and a storefront "with an add-to-cart button" (retail slice 6,
unbuilt). It was reasoning from what the PAGE claims, which is exactly how the
page's own careful wording — "costs land against the enterprise" — became a
profit report. No migration.

- **`productCatalogue`** (`src/lib/modules.ts`) reads every `modules` row with
  `status = 'available'` — id, name and the one line each keeps about itself —
  and the prompt is told a screenshot must be of one of them and must show only
  what that line supports. A `coming_soon` row is left out: an empty slot has
  no screen to photograph. The descriptions are maintained to track what
  actually ships (`scripts/seed.ts`), which is what makes them usable as a
  bound at all.
- **NOT THE TENANT'S SWITCHED-ON MODULES, and the distinction is easy to get
  backwards.** A business whose website SELLS this software to an industry is
  usually not itself in that industry: the operator tenant runs Professional
  services and none of the farm packs, while its Homestead site sells exactly
  the farm packs. Asking what that tenant has on would have described the wrong
  screens — worse than the generic note, not better. What bounds a screenshot
  is what the PRODUCT has.
- **The escape hatch is a photograph.** Told that a claim is uncovered, the
  model is instructed to ask for the nearest screen that does exist or for a
  photograph instead — never to invent the screen. A note that sends somebody
  hunting for a report nobody built is worse than a plain photograph of the
  work.
- **The catalogue is the first thing in the user turn**, before the business
  and the spots, and a test asserts that order: it is the bound on the answer,
  not a detail of it. With no catalogue the turn says so and asks for
  photographs only.
- **Tests**: two more in `tests/site-shot-notes.test.ts` — the catalogue
  reaching the turn ahead of the business, and the no-catalogue turn telling
  the model to keep to photographs.
- **Not re-driven.** The first press is the evidence for the shape; whether the
  bound actually stops the two bad screenshots needs a second press against the
  real model, and the page's notes would be overwritten by it.

### 2026-09-11 — The shot list says what to shoot (`claude/what-shot-to-take`)

The founder, looking at the Yosher Homestead shot list: *"it would be nice if
the photos tool gave a better description of what shot to take. ie (shot with
beautiful grass field with blue skys and cows on the field)"* — and then the
half that decides the design: *"it needs to be aware of what is being built …
there will probably need to be some farming photos but also probably some
screen shots of the software."* **Migration 0299** (one jsonb column), applied
to dev AND prod before the merge.

- **WHY THE STANDING NOTES COULD NEVER BE BETTER.** `GENERIC_SHOTS` is eight
  sentences true of any business, and "Something that says what you do at a
  glance" is not a shot anybody can go and take. Three things stacked up on
  that page: the general template carries NO shot notes, so every spot fell
  back to the generic; the farm template writes notes for only its 3 starter
  spots; and the farm template's notes describe **a farm's own site**, which
  Yosher Homestead is not — it is software SOLD TO farms. A fixed note could
  not have been right there however well written.
- **The subject depends on what the business sells, so only the assistant can
  say it.** Same words on a page, two shot lists: a farm wants its pasture in
  the hero and its cuts on the tiles; a business selling software to farms
  wants the pasture in the hero too — it is the reader's world — and a
  SCREENSHOT on the feature card beside it. The prompt teaches exactly that
  distinction and tells the model to choose per spot, and the strongest signal
  it gets is `settings.about`, the owner's own words.
- **One call for the whole page, never one per spot.** The notes are a set:
  a model answering each in isolation repeats itself and cannot decide that
  THIS spot is the screenshot because THAT one took the wide view.
- **THE PIN IS THE DESIGN.** A spot's key carries a section INDEX, so
  inserting or reordering a section would slide a note onto its neighbour.
  Each stored note keeps `for` — the section label, heading and label it was
  written from — and shows only while those still match; otherwise the spot
  quietly reads its standing line again. Not flagged and not deleted: advice
  about a section that changed is worse than none, and asking again is one
  press. Same rule `settings.map` uses for its pin.
- **Editable, because the owner knows the farm and the model knows the page.**
  A note is a paragraph until it is clicked — a shot list is read far more
  often than edited, usually on a phone in a field, and a page of text boxes
  reads as a form to fill in. Emptying one is a REMOVAL, not an empty string:
  the spot goes back to its standing line.
- **Tests**: `tests/site-shot-notes.test.ts` — the pin holding, letting go on
  a rewrite, and letting go when a section is INSERTED ABOVE and the key still
  matches (the case the pin exists for); a stale note falling back quietly;
  `storeFrom` dropping a key the model invented; `readShotNotes` surviving
  anything at all in the column; and the user turn carrying the business's own
  words plus each spot's key, shape and role AS WORDS rather than as the enum.
- **Not built here:** notes for a whole site in one press (it is per page), and
  any use of the note by the uploader — it is written for a person with a
  camera, and nothing reads it back.

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

Older entries — slice 18 back to slice 0 — are in
[marketing-build-log.md](marketing-build-log.md). It renders at `/admin/docs`
like any other file under `docs/`; nothing was deleted.

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
| `social_channels` | An account a brand posts to (S0, `0306`/`0307`) | FORCE RLS; `member_read`, owner INSERT/**UPDATE**/DELETE, no public policy. **`site_id` NULLABLE** — one of the business's websites, or the business itself ([ADR 0047](../decisions/0047-a-social-channel-belongs-to-a-website-and-a-footer-link-is-not-one.md)); the composite FK `(tenant_id, site_id) → sites` ON DELETE CASCADE is MATCH SIMPLE, so a null site is checked by nothing and a named one still cascades. **Unique `(tenant_id, network, handle)`**: one account is one row across the workspace, whichever brand claims it, which is ADR 0047's rule made mechanical. `handle` is `normalizeHandle`d (no `@`, no spaces, lowercase — safe on every network here, and what lets the index be a plain one). CHECKs: `network` in the eight `SOCIAL_NETWORKS`, `status in (active, paused)`, handle 1–80, label ≤ 80, url ≤ 500, `audience`/`voice` ≤ 400, and `social_channels_other_has_label` — `other` is the one network with no name of its own. At most `SOCIAL_CHANNELS_MAX` (12) per owner, counted per site and again for the business's. UPDATE is allowed here and refused on `site_images` for the reason each table exists: a channel is the account and is edited, a photo is a record of an event and is replaced |

| `social_posts` | One post, to one account, once (S1, `0309`/`0310`) | FORCE RLS; `member_read`, owner INSERT/UPDATE/DELETE, no public policy. `channel_id` NOT NULL — composite FK `(tenant_id, channel_id) → social_channels` ON DELETE **CASCADE**: words written for an account that is gone are not words for anything. `image_id` nullable — composite FK `(tenant_id, image_id) → site_images` ON DELETE **SET NULL `("image_id")`, the column-list form, HAND-EDITED into the migration**: drizzle-kit emits the bare form, which would try to null `tenant_id` too and could never run. There is no `site_id`: the brand comes from the channel, which cannot move brands (ADR 0047), so one denormalised column would be one more thing to keep true. CHECKs: `status in (draft, scheduled, posted)` — **no `idea`**, a dateless draft is one; `origin in (hand, assistant, pack)`; `shape` one of the four `POST_SHAPES`; body ≤ 5000, link ≤ 500; `focus_x`/`focus_y` between 0 and 1; and two that matter — `social_posts_scheduled_has_time` and `social_posts_posted_has_time`, because a scheduled post with no time is invisible to the sweep and sits there looking handled. `social_posts_due_idx` is PARTIAL (`status = 'scheduled' and reminded_at is null`) — exactly the rows the ten-minute cron reads. `reminded_at`/`work_item_id` are the sweep's own bookkeeping, written under `withSystem`; `work_item_id` is a SOFT pointer, like `site_enquiries`' |

**The crop is a focus point, not a box.** `shape` + `focus_x`/`focus_y` (0–1 of
the source) go into `cropBox()`, which returns the biggest rectangle of that
ratio that fits, slid around the point and clamped inside the edges. A stored
value therefore cannot describe a crop outside the photo or of the wrong ratio,
so nothing has to refuse one — and the cut picture is rendered on demand at
`/api/marketing/social/posts/[id]/image` rather than stored, which keeps ADR
0023's one-derivative rule whole.

**`social_channels` is not `sites.settings.social`.** The footer marks are up to
eight links an owner chose to DISPLAY; a channel is an account the business
POSTS TO. `showChannelInFooterAction` is the one place the two touch and it
touches them once, copying a value across. Nothing keeps them in step
afterwards, on purpose, and the screen draws {badge:In the footer} so the
mismatch is visible where it can be fixed.

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
- Social (S0): `src/db/schema/social.ts` — the table; `src/lib/social/channels.ts`
  (the account rules, `normalizeHandle`, `profileUrlFor`, `footerLinkFor` —
  pure) and `brands.ts` (`listBrands`, `chooseBrand` — pure, the Social
  screen's `chooseSite`); `src/modules/marketing/social-ops.ts` +
  `social-actions.ts`; `components/channels-panel.tsx`;
  `src/app/dashboard/m/marketing/social/page.tsx`;
  `docs/help/marketing/social.md`; `tests/isolation/social.test.ts` and
  `tests/social-channels.test.ts`
- Social (S1): `src/lib/social/posts.ts` (shapes, `cropBox`, `cropOverlay`,
  the per-network body limits, `groupByDay`, `roundToStep` — pure);
  `src/modules/marketing/post-ops.ts`, `post-actions.ts`, `post-image.ts`
  (the `sharp` crop), `post-reminders.ts` (the sweep);
  `components/posts-panel.tsx`, `components/post-editor.tsx`;
  `src/app/dashboard/m/marketing/social/page.tsx` (the posts),
  `social/accounts/page.tsx` (moved in S1), `social/posts/[postId]/page.tsx`;
  `src/app/api/marketing/social/posts/[id]/image/route.ts`;
  `src/app/api/cron/social-due/route.ts` + the `*/10` entry in `vercel.json`;
  `docs/help/marketing/social.md`, `social-post.md`, `social-accounts.md`;
  `tests/social-posts.test.ts` and the second block of
  `tests/isolation/social.test.ts`
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

- **THE DEV BRANCH HELD TWO TABLES PRODUCTION DID NOT, and the reason is a gap
  in the renumber rule.** Noticed on 2026-09-12: `verify-rls` read 185 on dev
  and 183 on prod. Not this module's doing — `time_periods` and `time_sheets`
  are a parallel session's UNMERGED Time migration, applied to dev the way
  migrate-before-merge asks. The hazard is what happens next. Drizzle keeps a
  single high-water row, and this slice's `0310` is now the newest stamp on
  BOTH databases; that Time migration's own stamp is older. If it is renumbered
  past `0310` while KEEPING its original `when` — which is what
  conventions.md said to do — prod will skip it **silently, forever**, and the
  tables will simply never appear. conventions.md now carries the refinement:
  keep the original stamp only while it is still above every database's
  high-water mark, otherwise re-stamp above the mark AND undo the migration on
  dev first. Checked with `scripts/inspect-migration-state.ts`.
- **The crop is rendered, never stored, and the composite FK to the photo had
  to be hand-edited.** See the `social_posts` row in the data model and the S1
  build-log entry; the isolation test
  `REMOVING A PHOTO CLEARS THE POST'S PICTURE AND LEAVES THE POST` is what
  stops the bare `ON DELETE set null` coming back on the next `db:generate`.
- **The sweep writes under two different scopes on purpose.** The work item is
  raised as `staff` inside the tenant (ADR 0021's shape); `reminded_at` is
  stamped under `withSystem`, because RLS is row-level and a member UPDATE
  policy on `social_posts` would have let any member rewrite the business's
  public voice. `src/modules/marketing/post-reminders.ts` has the argument.

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
