# 0032 — The mobile app is the web app in a native shell

- **Date:** 2026-09-06
- **Status:** Accepted
- **Affects:** the whole product surface; the proxy and the auth pages; billing and hours; the identity mirror; a new `mobile/` shell alongside the monolith

## Context

The founder wants Yosher in the App Store and on Google Play, because much
of the product is used away from a desk and "is there an app" is a sales
question. Three facts about the codebase decide how:

- The dashboard shell was built for phones from the start (top bar and drawer
  below the large breakpoint), so the web app already works on a phone.
- Every piece of data work is a server action — 506 of them across 79 files
  on 2026-09-05 — and there is no JSON API a native client could call. A
  native rebuild would first have to build that API and then rebuild every
  screen, and would double the cost of every future PR that touches one.
- Both stores accept a native shell around a site its owner runs. Apple's
  bar is "more than a website in a box" (rule 4.2), which native push, the
  camera and Face ID clear; Google's is only that the site be yours.

The stores also impose rules a plain website never met: nothing may be
bought inside the app except through the store (Apple rule 3.1.1), an app
that creates accounts must let a person delete theirs, and a reviewer needs
a working account. And sign-in had to work inside a webview, which a
development Clerk instance's URL-token sessions and Google's login both
refuse — hence the production instance first (identity dossier, 2026-09-06)
and email-and-password-only sign-in.

## Decision

The mobile app is a Capacitor shell that loads yosherapp.com, and the web
app knows when it is inside it (a marker in the shell's user agent, read by
`isNativeApp()`), leaving out only what the stores forbid: purchase buttons
and sign-up. Everything else is the same product, shipped by the same
deploy, with no store release needed for a product change. Native features
the stores reward — push, camera, biometric lock, universal links — are added
to the shell one at a time, each with its server-side seam in the monolith.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| A React Native / Expo app | No API to call; every screen rebuilt; a second product to maintain. Only offline would justify it, and offline against transactional posting (inventory, bills) is a research project. |
| An installable web app (PWA) only | Not in the stores, which is the sales question; no reliable push on iOS. Kept anyway — the manifest ships — because it is free. |
| A shell that bundles the site | Impossible: the site is server-rendered with server actions. A remote URL is the only shape, and Apple's minimum-functionality rule is met with native features, not by bundling. |
| Selling the subscription through the store | Apple takes a cut and owns the customer relationship; the platform's billing is B2B through Stripe. Hiding purchase inside the app is allowed for a business service and costs nothing. |

## Consequences

- **The store rules shape the web app.** Inside the shell: no Billing row, a
  status-only Billing page, no hour blocks, no sign-up, no "Sign up" footer on
  the sign-in card. The rules live in one function (`isNativeApp`) and a
  handful of `if`s, all pointing here.
- **Account deletion is Clerk's.** The option in Clerk's account dialog
  ("Delete account", enabled per instance) satisfies both stores; the platform
  mirrors it through the `user.deleted` webhook.
- **A cookie can put a laptop into "app mode"** for looking at the app's
  face. It hides purchase buttons from whoever sets it and nothing else.
- **iOS builds need macOS**, which the founder does not have; the shell is
  built on a GitHub Actions macOS runner. Android builds anywhere.
- **Push needs a device-token table** and a sender, keyed by tenant like
  everything else — a later slice with its own RLS policy and dossier entry.
- **The cost:** every store release is a review, and some rejections are a
  reviewer's judgement of "app-like". The mitigation is the native features,
  added in the order reviewers cite them.

## Notes

The prerequisites were found by looking at the live site rather than the
repo: a development Clerk instance in production, Google and GitHub sign-in
on, an application still named SuperApp, two Stripe Checkout screens, no
account deletion. All were cheaper to fix than to argue with a reviewer
about. Revisit this ADR if a paying client needs offline in a barn or on a
job site — that is the one thing the shell cannot give them.
