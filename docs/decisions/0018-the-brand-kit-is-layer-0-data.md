# 0018 — The brand kit is Layer 0 data, owned per company, edited by Marketing

- **Date:** 2026-09-04
- **Status:** Accepted (slice 0 built 2026-09-04)
- **Affects:** Layer 0 (`brand_kits`, `src/lib/brand/`), the Marketing module,
  the invoice PDF and every future consumer of the business's identity
- **Builds on:** [0010](0010-entities-inside-a-tenant.md),
  [0015](0015-a-connected-account-belongs-to-a-company.md)

## Context

The founder's next core tool is Marketing: a brand kit (colours, a logo
uploaded or generated, a tagline), a website builder, and domains, with
industry packs contributing an online store. The first slice is the brand kit,
and the first question is where the logo lives.

The obvious answer is "in the Marketing module's tables". It is wrong for the
same reason the timezone does not live in Scheduling's: the things that read
a logo are the invoice PDF, the mail signature, a generated document, the
public share page and, later, the website. A module may not import another
module (ESLint enforces it), so Marketing-owned identity would either be
unreadable by Accounting or force a seam whose only job is to leak it.

The second question is the grain. ADR 0010 made the legal entity a
first-class thing inside a tenant and ADR 0015 hung the connected account off
it, because the money lands in the company's bank. Two companies under one
client — the Test tenant's Oak Row LLC and its sibling — may trade under
different names. But unlike a bank account, most companies do NOT want a look
of their own: a farm with two LLCs is still one farm to its customers.

## Decision

- **`brand_kits` is a Layer 0 table** in its own schema domain file, read
  through `src/lib/brand/` the way money is read through `src/lib/money` and
  work is written through `src/lib/work`. Any module or pack may read it.
  **The Marketing module is the one place it is edited.**
- **One kit for the business (`entity_id` null) and optionally one per
  company.** A company kit is resolved over the business kit **field by
  field**: a company that sets only a trading name keeps the shared logo.
- **Writes are owner-only, as an RLS policy** (`app_current_tenant_role() =
  'owner'`), not only as an action-layer check. How the business looks is a
  decision, not a chore.
- **The logo is a private blob**, like every other blob in the product,
  streamed to signed-in members by a route that reads the row through RLS
  first. PNG and JPEG only, sniffed from the bytes.
- **No kit renders exactly what rendered before the kit existed.** Every
  consumer keeps its own defaults; the brand only ever adds.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| Brand tables inside `src/modules/marketing/` | Accounting could not read them without importing a module. Identity would become the first thing a module boundary made unreachable. |
| Columns on `tenants` | One look per client, which is wrong the day a second company trades under its own name — and the Test tenant already has two. Widening later means a migration on the most-read table in the schema. |
| Per-company only, no business-wide kit | Every new client would set the same logo on every company, and a tenant with no books at all (Marketing without Accounting is a real bundle) would have nowhere to put one. |
| Whole-kit override (a company kit replaces the business kit entirely) | Tidier to reason about, worse to use: renaming one company would silently drop its logo. Field-level is the forgiving reading and the screen says which field came from where. |
| A public blob for the logo | Would be the first public blob in the store and need its own rules. A logo is public by nature; the day the website needs a public URL, a public ROUTE serves the same private bytes. |
| `sharp` to validate and resize uploads | Two production incidents are written up in `next.config.ts` and `src/lib/vision-image.ts`. Forty lines of header parsing do this job without putting an ELF dependency on a settings screen. SVG and resizing arrive with the logo generator, deliberately. |

## Consequences

- Accounting's three PDF paths (the route, the send, the reminders) read the
  brand through the lib and know nothing about Marketing. A fourth consumer is
  an import, not a seam.
- A tenant can have Marketing without Accounting: with no companies there is
  just the business kit, and the word "company" never appears (0010's promise).
- The reminder sweep fetches a tenant's logo once per run, not per invoice —
  a blob read is a network call and the sweep already pays for one send each.
- **What this does not decide:** fonts (the PDF has one face), SVG logos and
  logo generation (Claude-drafted wordmarks, which need rasterising for the
  PDF and so bring `sharp` back on purpose), the public logo URL the website
  will need, and whether a company can also override the *tagline* on a per
  document basis. Each is an open item on the Marketing dossier.

## Notes

The reason the per-company row exists in slice 0 rather than "when a client
asks" is the lesson ADR 0015 recorded: a one-company tenant cannot see the
difference between a row hung off the tenant and one hung off the company,
which is precisely the blind spot that cost `production` slice 2c a real bug.
The isolation test holds two companies on one tenant for the same reason.

**Slice 0b landed the same day** and closed two of the open questions above
in the direction this file leaned. `sharp` came in, on purpose and in one
file, to rasterise a drawn wordmark and an uploaded SVG; the SVG is never
kept, so the "no public blob, no markup in the store" line held. And a
generated logo is a **spec** the code draws, not a picture a model paints:
the assistant chooses layout, case, spacing, mark and colour from a fixed
catalogue, fontkit sets the name from the PDF's own Noto Sans, and the spec
is stored beside the PNG so the vector can be re-drawn for the website. The
founder's offer of an image-model API was kept for a later, optional
illustrated symbol — the one thing an image model does better — rather than
for the name, which it sets badly and returns as a raster.
