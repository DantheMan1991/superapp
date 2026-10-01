# 0122 — The posture pages are locked to this site, and loaded whole

- **Date:** 2026-09-30
- **Status:** Accepted
- **Affects:** `src/proxy.ts` and `src/lib/posture-lock.ts` (the policy and
  the pages' edge); the posture pages' layout and its guard
  (`posture/components/posture-lock-guard.tsx`); how the pose worker starts
  (`posture/client/blob-worker.ts`) and loads its files
  (`posture/worker/posture.worker.ts`, `onThisSite`). Completes the second
  lock [ADR 0118](0118-a-posture-checks-pictures-never-leave-the-phone.md)
  left open.

## Context

ADR 0118 keeps a posture check's pictures on the phone because nothing we
wrote sends one. It turned down a content security policy *as the guarantee*,
since a policy cannot tell an upload to our own site from any other request,
and a wrong one breaks Clerk, but kept it as worth adding: a second lock that
holds even against code we did not write. The founder asked for it on
2026-09-30 ("yes, do the lockdown").

Three facts shaped it, two of them found by driving it:

- **A policy belongs to a page load, and Next moves between screens without
  one.** A policy on a posture page would be missing when the person arrived
  from Workouts in the app's usual way, and would follow them out to every page
  after, breaking Workouts' videos and the business workspace, which needs maps,
  payments and more from other servers.
- **A worker started from an address takes its policy from that address's
  response, not from the page.** Next starts the pose worker from its own
  bootstrap's address on this site, which sends no policy. On a locked page, a
  probe worker started that way reached example.com; the same code started from
  a blob was refused. The frames are read in the worker.
- **Clerk loads from its own host**, a different one for each instance: the
  development instance's, and production's `clerk.yosherapp.com` (read from the
  live site's publishable key).

## Decision

- **The policy.** The proxy gives every page load under
  `/personal/m/fitness/posture` a content security policy with a fresh nonce:
  everything from this site; scripts only from this site, carrying the nonce
  (Next puts it on its own), or from Clerk, plus `'wasm-unsafe-eval'` for the
  pose model; connections to this site and Clerk only; images from this site,
  `blob:`, `data:` and Clerk's image host; workers from this site or a blob; no
  frames, no plugins, no form posting elsewhere, and no other site framing the
  page. Clerk's host is read from the publishable key the page signs in with.
  Development adds `'unsafe-eval'` (React's error stacks), the dev server's
  socket and Clerk's development telemetry.
- **The pages are loaded whole.** The router's requests across the pages'
  edge, in or out (navigations and prefetches), are answered with something
  that is not the router's kind, which Next takes as "load this page whole"
  (`fetchServerResponse`, and the segment cache's prefetch, which then counts
  as a miss). In, the page gets its own policy; out, the next page leaves it
  behind. A router request is told by what the browser says of every request,
  `Sec-Fetch-Dest: empty` (a script's fetch, which no script can disguise), for
  a page on the other side of the edge from the Referer; never an API route.
  Next's own `rsc` header would name the router more exactly, but in production
  Next hides it from the proxy, so it counts only where a browser sends no
  `Sec-Fetch-Dest`. The posture layout's guard catches what the proxy cannot
  see, such as back and forward from the router's cache, or a browser that
  sends no Referer: a posture page whose load began elsewhere reloads, and
  leaving the posture pages in the app reloads where the person went.
- **The worker starts from a blob.** For the one call that starts it, Next's
  own start is handed a stand-in that starts the same bootstrap inside a blob,
  a single line that imports it, keeping the `#params=` the bootstrap reads its
  chunks from. A blob worker takes the page's policy. Inside it a path from the
  site's root means nothing, so the worker loads the pose model's files by
  their full address on this site.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| One policy for the whole site | The business workspace needs maps, payments, mail images, videos and Stripe or Square, each from other servers. A policy that allows them all locks little; one that does not breaks them. The posture pages are where the pictures are |
| One policy for the whole personal space | The workspace switcher moves to the business workspace in the app, taking the policy with it, and Workouts needs YouTube |
| A policy the page writes into itself (`<meta>`) when the camera starts | Arriving would need no full load, but leaving still would, and a policy written by the page's own script comes after that script has run; the server's header comes before anything |
| A policy header on the worker's script | The worker's address is Next's shared bootstrap with a hashed name; a header there would hold every worker the site ever starts the same way, while a blob holds exactly this one |
| The camera in a sandboxed frame | A rebuild of the check for the same result |

## Consequences

- No script on a posture page or in its worker, ours, Next's, Clerk's,
  MediaPipe's or a library's, can send a request, an image or a beacon to
  another server. The drive saw each refused, and the whole check, its photos
  and its report work under the lock, in development and in a production
  build, where the pose model runs without `'unsafe-eval'`.
- Moving into or out of the posture pages is a full page load, a moment slower
  than moving within the app. The production build proved both edges direct;
  the first one judged the router by Next's `rsc` header and, with production
  hiding it, every crossing fell to the guard's reload: safe, but a second
  load.
- **What the lock does not do**, plainly:
  - It allows our own site, so it cannot stop an upload to us; the first lock
    does (ADR 0118), and `tests/posture-privacy.test.ts` guards it.
  - Kept photos live in the browser's storage for this site, which any of the
    site's pages could read. The lock covers the pages that take and show them,
    not the rest of the site; only a site-wide policy would, a far bigger job.
  - A policy does not govern a navigation to another site or a WebRTC
    connection. Nothing in the posture code makes either, and the privacy test
    fails on `window.open`.
  - Development's policy is looser (eval, the dev socket).
- The phone app: Capacitor 8 injects its bridge as a document-start script on
  current Android WebViews, outside the page's policy, and plugins talk to the
  phone without the network. An old WebView falls back to rewriting the page,
  which drops our header: no lock there, and nothing broken.
- A worker started the same way anywhere else is not held by its page's policy.
  The posture worker's start is the only one, and the privacy test checks that
  it goes through the blob.
