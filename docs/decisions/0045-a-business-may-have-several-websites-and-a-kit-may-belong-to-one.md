# 0045 — A business may have several websites, and a brand kit may belong to one

- **Date:** 2026-09-10
- **Status:** Accepted
- **Affects:** Marketing (sites, brand kits), Layer 0 `brand_kits`, migration 0297

## Context

`sites_tenant_idx` was a UNIQUE index on `sites.tenant_id`, and the schema
comment called it "one site per tenant in this slice" — scoped, not
principled. The slice it belonged to shipped a website builder for a business
that has one website, which was every client.

Two things arrived that it could not hold.

**The operator tenant ran out of room.** ADR 0044 put the industry marketing
pages in code at `/for/<slug>`; the founder then asked to manage them in the
Marketing module instead, so they can be customised without a deploy. Seeding
the first one (`scripts/seed-vertical-site.ts`) used the operator tenant's ONLY
site, and the second industry had nowhere to go.

**A brand is not a company.** The founder's reason for asking was per-industry
logos, and later per-industry social accounts. Brand kits already resolve a
business-wide look overridden field by field by a per-COMPANY one
(`resolveBrandFor`), so the cheap move was to make each brand an `entities`
row and reuse it. An entity is a company in the books: it appears in the entity
picker, in reports, and on the invoice's company selector. "Yosher Homestead"
has no books, issues no invoices and has no tax id.

Meanwhile the data model was already most of the way there: `site_pages`,
`site_domains`, `site_enquiries`, `site_page_views` and `site_images` all key
on `site_id`, and `site_domains_site_idx` was never unique. What assumed one
site was CODE — `findSite(tx, tenantId)` and its thirteen callers.

## Decision

**A tenant may have many sites.** `sites_tenant_idx` becomes a plain index.
The address stays unique across every tenant, because it is a hostname label,
so nothing about how a site is FOUND changed. `findSite(tx, tenantId)` is gone
and `listSites` / `findSiteById` replace it: "the tenant's site" is no longer a
question with an answer, and a caller that wants one names it.

**A brand kit may belong to a website.** `brand_kits.site_id`, nullable, beside
`entity_id`, with `brand_kits_one_owner` forbidding both. A kit belongs to the
business (neither set), to one of its companies, or to one of its sites, and
`resolveBrandForSite` merges the site's over the business's exactly as the
company's already merged.

**A business with one website never learns the plural exists.** `chooseSite`
opens a single site without being asked and shows a list only from two up —
the same promise ADR 0010 keeps about companies.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| Make each brand an `entities` row and reuse the per-company kit | Puts a fabricated company in the books — in the entity picker, the reports and the invoice's company selector — to borrow a column. A site is the thing that has a logo, a domain and social accounts |
| One site with a page per industry | No per-industry logo, domain, header, footer or social links, which is the entire request |
| Keep the limit; give each brand its own TENANT | Its enquiries would land in that tenant's CRM rather than the one holding the pipeline, and a marketing brand is not a workspace (ADR 0041) |
| A `sites.brand_kit_id` pointing at a freely-created kit | Kits would need a discriminator anyway to stay one-per-owner, and a kit reachable from two sites raises a sharing question nothing is asking |
| Always show the site list | Adds a click and an empty-feeling page for every client who will only ever have one site |

## Consequences

**What it buys.** A business can run two brands — a farm and its farm store, a
platform and the industry it sells to — each with its own address, look, logo,
domain, enquiries and visitor counts, on one set of books and one CRM. The
operator tenant can hold an industry site per vertical.

**What it costs.**

- **Every action that touches a site now names one.** Thirteen call sites, and
  seven client forms that pass a `siteId` through their inputs. Those inputs
  are `unknown` at the boundary, so **`tsc` cannot see a caller that forgot
  it** — the failure would be a form that says "check the fields" forever.
  Required React props were used deliberately to make the compiler find the
  render sites it *can* see.
- **`entity_id is null` stopped meaning "business-wide".** A site's kit also
  has a null `entity_id`, so the old one-column predicate in `resolveBrandFor`
  AND in `kitWhere` would have found a site's row — putting a site's logo on
  the invoices, and letting a save to the business kit overwrite a site's.
  Both were live bugs the moment the column existed; both are fixed here.
- **Nothing writes `site_id` yet.** The column, the constraints and the read
  path are in place and honoured, but the editor still edits the business kit
  and the per-company one. Until that lands, every site wears the business's
  look — which is what every site wore before, so nothing regressed.
- **A `?site=` id in a URL.** Ugly next to a slug, and consistent with
  `pages/[pageId]`. A slug in the URL would break when the address changes.

## Notes

**What would make us revisit:** a business that wants two sites to SHARE a look
that is not the business-wide one. Today that means two kits with the same
values. A kit reachable from several sites would answer it, and would bring the
sharing question this deliberately avoided.

The `site_domains` table needed no change at all — it was already keyed on
`site_id` with a non-unique index, which is the shape a design gets when the
tables were written for the general case and only the constraint was scoped to
the slice. That is the cheap way to be wrong, and it is worth copying.
