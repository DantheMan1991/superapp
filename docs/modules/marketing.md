# Marketing

> How the business looks to its customers, and — as the module grows — where
> it is found. Slice 0 is the **brand kit**: logo, display name, tagline and
> two colours, carried onto every invoice PDF. The roadmap adds a website
> built from the business's own data, custom and purchased domains shared
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
| 1 | Site model — pages and sections as JSON, draft/publish, a renderer on a free subdomain (host-based routing in `proxy.ts`), generation from the brand kit, profile section templates and the business's data, cached per site | |
| 2 | The editor — blocks, drag to reorder, in-place editing, versions; evaluate Puck (MIT) against the destination first | |
| 3 | Domains at Layer 0 — one `domains` table with purposes (send mail, host mailboxes, website), connect an existing domain by records only, buy a new one through Vercel's registrar API and publish MX/SPF/DKIM/site records ourselves. Needs an ADR on who owns a purchased domain | |
| 4 | Forms into CRM as parties with `source = 'website'`, raising Work follow-ups; page views | |
| — | The shop block: `retail` slice 6 (online orders + pickup windows) fills a declared slot; blocked on commitments (retail 3) and web checkout (payments) | not this module's |

## Build log

Newest first. One entry per session/PR that touched this module. Every PR
that changes this module MUST add an entry here (rule in AGENTS.md).

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
