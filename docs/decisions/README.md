# Architecture Decision Records

> **Read before:** revisiting a decision that feels arbitrary, or proposing a
> change to a foundational choice. The answer to "why is it like this?" is
> usually here.
> **Write one when:** a decision closes off a credible alternative and someone
> six months from now would reasonably ask "why not the other thing?"

## What belongs here

A decision, its context, the alternatives rejected, and the consequences —
dated. ADRs are **immutable**: they record what was decided and why *at the
time*. When a decision is reversed, write a new ADR that supersedes the old one
and add a `Superseded by` line to the original. Never edit history.

## What does not belong here

| Not an ADR | Goes in |
| --- | --- |
| An invariant that is always true | [architecture.md](../architecture.md) / [security.md](../security.md) |
| What changed in a module and when | `docs/modules/<slug>.md` build log |
| A code pattern | [conventions.md](../conventions.md) |
| A setup step | `SETUP.md` |

The distinction that matters: **rules say what is true now; ADRs say why, and
what we gave up.** A rule that has an interesting "why" gets a rule *and* an
ADR, with the rule linking to it.

## Format

Copy `_TEMPLATE.md`. Number sequentially, four digits, kebab-case title.
Keep them short — one page. An ADR nobody reads has failed at its only job.

## Index

| # | Decision | Date | Status |
| --- | --- | --- | --- |
| [0001](0001-rls-force-and-separate-app-role.md) | RLS FORCE plus a non-owner `app_user` role | 2026-07-19 | Accepted |
| [0002](0002-monolith-with-module-seams.md) | Monolith with module seams, not services | 2026-07-19 | Accepted |
| [0003](0003-self-hosted-mail-over-provider-apis.md) | Self-hosted Stalwart over a hosted mail provider | 2026-07-26 | Accepted |
| [0004](0004-capability-packs-and-industry-profiles.md) | Capability packs + industry profiles, not per-industry modules | 2026-07-27 | Accepted |
| [0005](0005-polling-over-push-for-mail-freshness.md) | Polling over push for mail freshness | 2026-08-02 | Accepted |
| [0006](0006-agents-act-by-delegation.md) | An agent is a delegation from a person, not a principal | 2026-08-06 | Proposed |
| [0007](0007-cash-basis-reporting.md) | Cash-basis reporting, derived at read time | 2026-08-10 | Accepted |
| [0008](0008-warm-neutrals-and-layered-elevation.md) | Warm neutrals, layered elevation, and the navy rail stays | 2026-08-10 | Accepted |
| [0009](0009-packs-are-modules-profiles-install-them.md) | A pack is a module row; a profile installs, it does not bind | 2026-08-13 | Accepted |
| [0010](0010-entities-inside-a-tenant.md) | A tenant holds many legal entities; the entity owns the books | 2026-08-16 | Proposed |
| [0011](0011-machine-posted-entries.md) | A posting that merely records an authorised act rides that act's permission | 2026-08-21 | Accepted |
| [0012](0012-what-capitalises-stock.md) | What capitalises stock, and what joins the two records of its cost | 2026-08-21 | Proposed |
| [0013](0013-inventory-tax-treatment.md) | Inventory treatment is a policy, not a property of "cash basis" | 2026-08-21 | Proposed |
| [0014](0014-migrations-are-applied-before-the-merge.md) | Migrations are applied by hand, before the merge | 2026-08-23 | Accepted |
| [0015](0015-a-connected-account-belongs-to-a-company.md) | A connected account belongs to a company, not to the client | 2026-08-25 | Accepted |
| [0016](0016-a-catch-weight-item-is-stocked-in-packages.md) | A catch-weight item is stocked in packages and weighed on arrival | 2026-08-25 | Accepted |
| [0017](0017-the-square-account-the-farm-already-has.md) | The Square account the farm already has | 2026-09-02 | Accepted |
| [0018](0018-the-brand-kit-is-layer-0-data.md) | The brand kit is Layer 0 data, owned per company, edited by Marketing | 2026-09-04 | Accepted |
| [0019](0019-a-website-is-pages-of-typed-sections.md) | A website is pages of typed sections, hosted by the platform | 2026-09-04 | Accepted |
| [0020](0020-a-connected-domain-is-records-only.md) | A connected domain is records only; a purchased one is held for the client | 2026-09-04 | Accepted |
| [0021](0021-a-website-enquiry-lands-as-a-party.md) | A website enquiry lands as a party, a follow-up and an email, written as staff | 2026-09-04 | Accepted |
| [0022](0022-page-views-are-a-first-party-beacon.md) | Page views are counted by a first-party beacon that keeps nothing about the person | 2026-09-04 | Accepted |
| [0023](0023-photos-are-one-derivative-in-the-sites-library.md) | Photos are one derivative in the site's own library, served by the platform | 2026-09-04 | Accepted |
| [0024](0024-a-look-is-a-preset-and-its-fonts-are-the-platforms.md) | A look is a preset, and its fonts are the platform's | 2026-09-05 | Accepted |
| [0025](0025-a-booking-is-an-enquiry-with-a-time.md) | A booking is an enquiry with a time, on a calendar the platform provisions | 2026-09-05 | Accepted |
| [0026](0026-a-map-is-a-picture-the-platform-draws.md) | A map is a picture the platform draws, from public-domain tiles | 2026-09-05 | Accepted |
| [0027](0027-the-assistant-proposes-words-and-the-owner-saves-them.md) | The assistant proposes words into slots the code chose, and the owner saves them | 2026-09-05 | Accepted |
| [0028](0028-a-packs-block-is-data-the-site-draws.md) | A pack's block on the website is data the site draws | 2026-09-05 | Accepted |
| [0029](0029-the-preview-follows-the-editor-not-the-save.md) | The preview follows the editor, not the save | 2026-09-05 | Accepted |
| [0030](0030-a-site-template-is-data-an-industry-contributes.md) | A site template is data an industry contributes; the core assembles it and the writer fills the words | 2026-09-05 | Accepted |
| [0031](0031-where-a-photo-belongs-is-read-from-the-page.md) | Where a photo belongs is read from the page, never stored; the template says what to take | 2026-09-05 | Accepted |
| [0032](0032-the-mobile-app-is-the-web-app-in-a-native-shell.md) | The mobile app is the web app in a native shell; the web knows when it is inside and leaves out what the stores forbid | 2026-09-06 | Accepted |
| [0033](0033-a-setup-step-is-a-prerequisite-the-data-proves-missing.md) | A setup step is a prerequisite the data proves missing; nothing is stored, nothing can be dismissed, and a step asks "ever", not "now" | 2026-09-08 | Accepted |
| [0034](0034-a-personal-account-is-a-register-whose-ledger-leg-is-the-owners-equity.md) | A personal account is a register whose ledger leg is the owner's equity: personal by default, no opening balance, never reconciled, visible to the owner and the accountant only | 2026-09-08 | Accepted |
| [0035](0035-the-books-begin-on-a-day-and-nothing-is-dated-before-it.md) | The books begin on a day, per company; nothing may be dated before it, and an import drops the earlier lines rather than carrying history in | 2026-09-08 | Accepted |
