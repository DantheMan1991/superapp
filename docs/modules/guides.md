# Guides

> Tenant-facing how-to guides. A "?" on every dashboard screen opens the guide for that screen beside it, and `/dashboard/guides` lists every guide for the tools a business has switched on. Content is markdown under `docs/help/`, written for the client, with pack vocabulary resolved per tenant.
> Status: `available` · Scope: `platform` <!-- keep Status on ONE line — /admin/docs parses it -->

## Build log

Newest first. One entry per session/PR that touched this area.

### 2026-09-02 — The plumbing: reader, routes, panel, vocabulary (`claude/guides-plumbing`)

Founder, 2026-09-02: *"I think we need a how to page on how to use all of the
modules and packs in Yosher App … as well as in each module there should be
like a how to tab or something that pulls up just the how to for that specific
page or tool. There should be screen shots etc."* Two calls after the
assessment: content lives in the repo, and the guide is in-app only. This PR is
the machinery and two guides that prove it; the guides for each module follow,
most-used first (accounting's core loop, documents, mail, CRM, the packs, then
scheduling and work, which nobody has clicked through yet, so writing theirs is
also the first real walkthrough).

- **`docs/help/<folder>/<topic>.md` is a guide.** Same header shape the build
  record already parses — `# Title`, a blockquote summary — plus `**Route:**`
  (where the "?" finds it) and `**Order:**` (where it lists). The folder is a
  feature slug or a fixed section (`workspace`, `business`, `settings`).
  [`docs/help/_TEMPLATE.md`](../help/_TEMPLATE.md) is the contract for authors.
- **A panel keyed to the page, not a tab per module.** Accounting alone has 37
  screens; a module-level tab is a 37-section document that moves the reader off
  the screen they are learning. `HelpButton` sits first in `PageHeader`'s
  actions row, so every page that uses the header has it, and computes its key
  from the pathname and query string at click time.
- **Routes are exact by default; `**` asks for a subtree.** With prefix
  matching, "Getting around" (`/dashboard`) would have answered for every
  accounting screen with no guide yet. A wrong guide is worse than "no guide
  for this screen yet".
- **Vocabulary.** `{{zone}}`, `{{zone|plural}}`, `{{zone|lower}}`,
  `{{zone|plural|lower}}` — resolved from `ctx.tenant` with no query (the
  sidebar's device), tenant-wide, applied to title, summary and body. The
  plural rule is the sidebar's: a word nobody renamed keeps its declared plural,
  a renamed one takes an `s`. `|lower` was not in the plan; the first pack
  guide needed it in its first paragraph, because the resolved word is
  capitalised and the screens themselves lowercase it mid-sentence.
- **Two guides shipped:** `workspace/getting-around` and `land/overview` — the
  second uses placeholders and a relative link, so the pipeline is proved end to
  end. Every other feature lists as "No guide yet", which is the honest state.
- **Six pages joined `PageHeader`** — hours (twice), team, billing, email,
  settings, taking payments — because they had kept the hand-written heading the
  design-system dossier said was gone, and a button placed in the header reached
  none of them. Mail's connected view has its own bar and got the button by hand.
- **Fixed in passing:** relative links between build docs 404ed (the shared
  `Markdown` rewrites them); production traced only `docs/modules`, so
  `/admin/docs` was missing four sections when deployed; the `[slug]` tracing
  key had never matched anything.
- **CI carve-out:** `docs/help/**` no longer skips the workflow, because a
  guide is product content that `tests/guides.test.ts` reads.

## Data model

None. Guides are files in the repository, read at request time. Nothing is
stored in the database, and a tenant's vocabulary is read from the row
`requireTenant()` already loads.

## Key files & seams

| File | Role |
| --- | --- |
| `docs/help/**` | The guides. `_TEMPLATE.md` documents the header, the route grammar and the placeholder grammar |
| `src/lib/markdown-meta.ts` | Pure header parser shared with the build record; `resolveDocLink` |
| `src/lib/markdown-tree.ts` | The walker both readers use; `skipTopLevel` is how build-docs ignores `help/` |
| `src/lib/guides-core.ts` | Pure: route grammar and matching, `parseGuide`, vocabulary, the index shape |
| `src/lib/guides.ts` | Server-only: reads the tree, memoises it in production, resolves a tenant's vocabulary, gates by enablement |
| `src/components/app/markdown.tsx` | The shared renderer (admin docs, guide pages, the help sheet) |
| `src/components/app/help-button.tsx` | The "?" and its sheet; rendered by `PageHeader` and by Mail's bar |
| `src/app/api/help/route.ts` | `GET /api/help?path=&search=` → the localised guide for a screen, or null |
| `src/app/dashboard/guides/` | The index and the guide page |
| `next.config.ts` | `outputFileTracingIncludes` for `/dashboard/guides` and `/api/help` |
| `tests/guides.test.ts` | The grammar, the matching, the vocabulary, and the checks over the real tree |

## Decisions & gotchas

- **A GET route, not a server action.** `PageHeader` is imported by five
  client files; a `"use server"` module reached through it would put an action
  reference into every page's client manifest, and this repo has already had a
  `use server` export break module toggling with every check green. A read that
  returns prose is a GET, guarded like every other route: `resolveTenantContext()`
  for the caller, then the enablement gate the module page applies.
- **The sheet's markdown loads lazily.** `next/dynamic` with `ssr: false` —
  the first in the codebase — because the button is on every page and a
  markdown parser in every page's bundle is the wrong price for a panel most
  visits never open. The pages import `Markdown` directly.
- **`useSearchParams` is not used.** It demands a Suspense boundary on any
  statically rendered page, and the public share page renders `PageHeader`. The
  button reads `window.location.search` at click time instead, and gates itself
  off outside `/dashboard` and on the Guides pages themselves.
- **Memoised per instance in production only.** The files are traced into the
  deployment, so a module-level promise can never be stale: it lives exactly as
  long as the code it describes. A data cache would outlive a deploy. In
  development every call re-walks the tree so an edit is a refresh.
- **`docs/help/` is skipped by the build-docs walker.** On `/admin/docs` a guide
  would appear as an unexplained "Help" section with its `{{vocabulary}}`
  unresolved. `tests/build-docs.test.ts` holds the line.
- **Tracing keys are substring globs.** Next matches `outputFileTracingIncludes`
  keys with picomatch in `contains` mode, so `/dashboard/guides` covers the
  guide pages beneath it and `/admin/docs` its catch-all. A bracketed key is a
  character class and matches nothing.
- **Nothing body-portalled inside the sheet.** It is a modal Radix `Sheet`; the
  mobile drawer's documented bug — a popover that paints but cannot be clicked —
  applies to it too.
- **Labels are tenant-wide, not per pack.** `zone` is Land's word that Livestock
  also displays; the vocabulary is one map from `tenants.labels` over the
  profile's, the same as `packContext` resolves it.
- **The guide gate mirrors the page gate.** A guide for a feature that exists
  but is not switched on for this tenant is a 404, and `settings` guides are
  owner-only — so a guide URL never describes a screen its reader cannot open.
- **The template is a hidden file.** `_TEMPLATE.md` starts with `_`, which the
  walker skips, so it can carry a real-looking header without becoming a guide.

## Open items

- **Screenshots.** Deliberately none yet. Manual captures rot within weeks at
  the current rate of UI change (the design sweep of 2026-08-11 would have
  invalidated every one), and dark mode doubles the set. The plan is Playwright
  against a seeded tenant, regenerated when a UI PR lands, and only for the
  standalone guide page — the panel sits beside the real screen. Hilltop Farm
  covers pack screens; a neutral business tenant is still needed for core ones,
  and a client tenant must never be captured.
- Per-guide entries in the command palette (`CommandItem.keywords` is unused
  and is the field for synonyms).
- The other five inline `ReactMarkdown` call sites could adopt `Markdown`.
- Heading anchors and a table of contents for long guides.
- Mail's views (`?rules=1`, `?compose=new`, `?message=…`) have no guides yet;
  the route grammar already supports them.
- The content itself, in the agreed order: accounting's core loop, documents,
  mail, CRM, the packs, then scheduling and work.
