# Mobile app

> Yosher in the App Store and on Google Play: a native shell around the web
> app (ADR 0032), and the small set of things the web app does differently
> when it is inside that shell because the stores require it. This dossier
> owns the shell, the "am I inside the app" seam, and the store-driven rules
> on other modules' screens.
> Status: `available` · Scope: `platform` <!-- keep Status on ONE line — /admin/docs parses it -->


## Build log

Newest first. One entry per session/PR that touched this module. Every PR
that changes this module MUST add an entry here (rule in AGENTS.md).

### 2026-09-06 — Slice 0: the app-aware web (`claude/mobile-app-0-app-aware-web`)

The web app learns when it is inside the shell, and does what the stores
require there. No shell exists yet; this is what it will load.

- **`isNativeApp()`** (`src/lib/native-app.ts`, pure half in
  `src/lib/native-app-core.ts`): true when the request's user agent carries
  `YosherApp/<version> (<platform>)` — the marker the shell will append via
  Capacitor's `appendUserAgent` — or when a `yosher_app=1` cookie is set, the
  laptop way of looking at the app's face. Every request a webview makes
  carries its user agent, server actions included, so no header plumbing.
- **Inside the app:** the Billing row leaves the rail and the Billing page
  shows subscription status and the sentence "Billing isn't available in the
  app." — no plans, no Stripe portal, no pointer elsewhere (App Store rule
  3.1.1). The Hours page keeps its meter and work log and drops the two hour
  blocks. `/sign-up` becomes a card saying businesses join from a web browser,
  and the sign-in card loses its "Sign up" footer.
- **Account deletion end to end.** Clerk's account dialog offers "Delete
  account" once the instance setting is on (founder's toggle: Configure →
  Settings → *Allow users to delete their accounts*); the Clerk webhook now
  handles `user.deleted` by removing the person's profile row (memberships
  cascade, the tenant stays) and auditing it. `tests/identity-account-deletion.test.ts`.
- **An install manifest** (`src/app/manifest.ts`, icons in `public/icons/`
  drawn from the mark with sharp, Apple touch icon and home-screen title in
  the root metadata), so a phone can put Yosher on its home screen today and
  Android's Trusted Web Activity route has what it reads.
- ADR 0032 records the decision and the alternatives.

## Data model

| Table | Purpose | Notes (RLS, invariants, FKs) |
| --- | --- | --- |
| — | Nothing yet | Push will add a per-person device-token table, tenant-scoped like everything else |

## Key files & seams

- `src/lib/native-app-core.ts` — the marker, the cookie, and the pure
  decision (`isNativeAppRequest`, `nativeAppInfo`); `tests/native-app.test.ts`.
- `src/lib/native-app.ts` — `isNativeApp()`, the server-side question every
  store rule hangs off.
- `src/app/dashboard/layout.tsx`, `src/app/dashboard/billing/page.tsx`,
  `src/app/dashboard/hours/page.tsx`, the two `(auth)` pages — the rules.
- `src/app/api/webhooks/clerk/route.ts` + `removeProfile` in
  `src/lib/tenant-sync.ts` — account deletion's mirror.
- `src/app/manifest.ts`, `public/icons/` — the install manifest;
  `tests/manifest.test.ts`.
- `docs/decisions/0032-the-mobile-app-is-the-web-app-in-a-native-shell.md`.

## Decisions & gotchas

**The marker is in the user agent, not a header the shell adds.** Capacitor
sets a custom user agent for the whole webview; every request it makes —
page loads, RSC fetches, server-action posts, image loads — carries it, with
no plugin and nothing to forget on a new kind of request. A header would
need a plugin on the native side and would be missing from anything the
webview fetched on its own.

**The cookie is a convenience, not a control.** `yosher_app=1` on a laptop
hides purchase buttons from the person who set it. Nothing is protected by
it, so nothing verifies it.

**"Not available in the app" and no pointer.** Apple's rule forbids buttons,
links and "calls to action" toward another purchasing mechanism, and the
line is drawn by reviewers. A sentence that says billing is not here and
stops is safe; "manage it on our website" is the kind of sentence that has
cost other apps a rejection round. The Team page and every other owner
setting stay, because they sell nothing.

**Hours stays in the rail, Billing does not.** The Hours page is the meter
and the work log, useful on a phone; the blocks were one card of it. The
Billing page inside the app would be a status badge and a sentence, and a
rail row that leads to nothing is worse than no row.

**Account deletion is Clerk's dialog, not a page of ours.** Both stores
require an in-app path when sign-up is reachable in the app — and sign-up is
not, but the reviewer looks for the option anyway. Clerk's `<UserButton>`
dialog has it, gated by an instance setting, and the webhook keeps the mirror
honest. A page of our own would have to reimplement Clerk's re-authentication
and confirmation for no gain.

**Deleting a person never deletes a business.** `removeProfile` removes the
profile and lets memberships cascade; the tenant and everything in it stay,
including rows that name the person by id. A sole owner who deletes
themselves leaves a tenant with no owner, which the platform owner resolves
from `/admin` — the same as any other departure.

## Open items

- **Slice 1 — the shell.** A Capacitor project under `mobile/` loading
  yosherapp.com with `appendUserAgent: "YosherApp/<version> (<platform>)"`,
  a native offline screen, and the store metadata. iOS builds on a GitHub
  Actions macOS runner (the founder is on Windows); Android locally or there.
- **Slice 2 — push.** A tenant-scoped device-token table with RLS, a
  registration action called by the shell, and a sender (APNs token auth,
  FCM v1) fed by the notifications digest machinery — the feature reviewers
  cite first under rule 4.2.
- **Slice 3 — camera, Face ID, universal links, PDF share.** Each a plugin on
  the native side and a small seam here (`/.well-known/apple-app-site-association`
  and `assetlinks.json` as route handlers, driven by env).
- **Slice 4 — the store submissions.** A demo account with password sign-in
  and no MFA in a seeded tenant, kept alive for every future review; privacy
  labels; Play's data-safety form; screenshots per device.
- **Founder toggles before slice 0 merges:** *Allow users to delete their
  accounts* on the production instance (and the development one), so the
  guide's "Delete account" line is true the day it ships.
- **The Gmail-connect OAuth** in the email module cannot run inside a
  webview (Google refuses embedded browsers). Not a sign-in concern any more;
  only matters if a client connects a mailbox from the app.
