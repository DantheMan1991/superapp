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
| 0b | Logo generation: Claude-drafted SVG wordmarks and monograms in the brand colours, rasterised for the PDF (brings `sharp` in on purpose); SVG upload | next |
| 1 | Site model — pages and sections as JSON, draft/publish, a renderer on a free subdomain (host-based routing in `proxy.ts`), generation from the brand kit, profile section templates and the business's data, cached per site | |
| 2 | The editor — blocks, drag to reorder, in-place editing, versions; evaluate Puck (MIT) against the destination first | |
| 3 | Domains at Layer 0 — one `domains` table with purposes (send mail, host mailboxes, website), connect an existing domain by records only, buy a new one through Vercel's registrar API and publish MX/SPF/DKIM/site records ourselves. Needs an ADR on who owns a purchased domain | |
| 4 | Forms into CRM as parties with `source = 'website'`, raising Work follow-ups; page views | |
| — | The shop block: `retail` slice 6 (online orders + pickup windows) fills a declared slot; blocked on commitments (retail 3) and web checkout (payments) | not this module's |

## Build log

Newest first. One entry per session/PR that touched this module. Every PR
that changes this module MUST add an entry here (rule in AGENTS.md).

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
  under `withSystem`, the partial uniques, the CHECKs, the cascade). **Not yet
  verified in a browser** — see Open items.

## Data model

| Table | Purpose | Notes (RLS, invariants, FKs) |
| --- | --- | --- |
| `brand_kits` | The business's look, one row for the business and at most one per company | FORCE RLS. `member_read`; INSERT/UPDATE/DELETE need `app_current_tenant_role() = 'owner'`. Partial uniques: one row with `entity_id IS NULL` per tenant, one per `(tenant_id, entity_id)`. Composite FK `(tenant_id, entity_id) → entities` ON DELETE CASCADE — a company's own look dies with it; the business kit is untouched. CHECKs: colours are `''` or `^#[0-9a-f]{6}$`; the logo is whole (pathname, mime, width, height, bytes all set or all empty); name ≤ 80, tagline ≤ 140 |

Resolution (`resolveBrand`, pure): each field is the company kit's where it
says something, else the business kit's, else the platform default; the
display name falls back to the tenant's name last. `sources` says where each
answer came from, so the screen can tell an owner that a company is showing
the shared logo.

## Key files & seams

- `src/db/schema/brand.ts` — the table; `src/lib/brand/{core,image-sniff,read}.ts` — the seam
- `src/lib/blob.ts` — `brandPathPrefix()`, and the prefix in `isTenantBlobPath()`
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
- **No `sharp` here, deliberately.** It is the right tool for resizing and it
  is also an ELF dependency that has taken production down twice. PNG/JPEG
  header parsing covers slice 0; the logo generator (0b) brings `sharp` in
  when there is an SVG to rasterise, on a route added to
  `outputFileTracingIncludes` in `next.config.ts`.
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

- **Not yet verified in a browser.** The screen has never been opened: enable
  Marketing for a dev-branch tenant on `/admin/tenants/<id>`, upload a PNG,
  set a colour, then open any invoice's PDF. The things to look at: the
  preview strip in dark mode, the colour input on a phone, and whether the
  logo box on the PDF wants to be taller for a square mark.
- **Logo generation (0b)** — Claude-drafted SVG wordmarks/monograms in the
  brand colours, stored as SVG and rasterised to PNG for the PDF; SVG upload
  behind the same rasteriser. An "AI logo" is a wordmark, and the product
  should say so.
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
