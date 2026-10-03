# 0128 — Progress photos stay on the phone, under the posture lock

- **Date:** 2026-10-03
- **Status:** Accepted
- **Affects:** Health (H2b): `src/modules/health/photos/`, the photo pages
  under `/personal/m/health/photos`; the lock (`src/lib/posture-lock.ts`, now
  areas; `src/proxy.ts`; `src/components/app/page-lock-guard.tsx`); helpers
  moved to `src/lib` (`camera-label.ts`, `camera-message.ts`,
  `screen-privacy.ts`); `/api/health/voice`; the app's 1.0.9
  (`@capacitor/filesystem`). Extends [ADR 0118](0118-a-posture-checks-pictures-never-leave-the-phone.md)
  and [ADR 0122](0122-the-posture-pages-are-locked-to-this-site-and-loaded-whole.md)
  to a second tool.

## Context

With weight and tape measures in Health (H2, [ADR 0127](0127-weight-is-read-as-a-trend-and-kept-in-kilograms.md)),
the founder wanted progress photos as their own slice, "kept on your phone
only, like the posture check's photos". From a mockup on 2026-10-03 he chose:

- **Propped up, on a timer**: the back camera, ten seconds to stand, and a
  voice that says when to turn.
- **Front, side and back** each time.
- **A "Save a copy" button**: per photo, on his tap, the photo saved to the
  phone's files.
- **A reminder every four weeks**, a line on Today's Weight card, no
  notification.

A body photo in little clothing is the same thing to protect as a posture
check's frame, and the posture check had already paid for the answer: nothing
we wrote sends a picture (ADR 0118), and the pages that show one are locked to
this site (ADR 0122). The questions were whether the photos may reach our
servers at all, how a second tool joins the lock, and how "Save a copy" works
inside the app, whose WebView ignores a download.

## Decision

**The photos never reach a server of ours.** The page takes them from the
camera (`capture.ts`: the frame drawn once onto a canvas no one sees, held to
2,048 pixels on the longest side, made a JPEG) and keeps them in the
browser's storage for this site, IndexedDB `yosher-health-photos`, one record
a day and pose keyed `[owner, day, pose]`, `owner` being the personal space.
The server knows nothing of them: no table, no row, no count. What the screens
need from the server comes down with the page (the weigh-ins, for the trend
on each day). The countdown's voice goes through the shared recorded-voice
route (`/api/health/voice`, the coach's handler), which takes words.
`tests/health-photos-privacy.test.ts` reads the code: no network, no server
action, no storage, no picture made into a file or an address, no sharing and
no file written anywhere in the photo code, but in the three files it names
with their reasons (the store; the capture; Save a copy).

**The photo pages are a locked area of their own.** `posture-lock.ts` now
holds areas: the posture pages, with WebAssembly for the pose model, and
`/personal/m/health/photos`, without. A page load in an area gets ADR 0122's
policy (this site and Clerk only, a nonce for scripts); the router crossing an
area's edge, into it, out of it or between two areas, is answered with a full
page load; `PageLockGuard` (shared, the posture guard now wraps it) catches
what the proxy cannot see. The app blocks screenshots while a photo page is
open (`useScreenPrivacy`, moved to `src/lib`).

**The main back lens, found by name.** Asked for by facing first, so the
browser fills in the cameras' names, then reopened on Camera2 id 0 when the
browser chose another back lens (`src/lib/camera-label.ts`, shared with the
posture check): a Samsung's default is the ultrawide, which bends a body at
the edges.

**"Save a copy" is the one way out, and it is the person's.** On a tap, one
photo: in a browser, an ordinary download into Downloads (an object URL,
revoked after); in the app, the shell writes it into the phone's Documents,
under `Yosher`, through `@capacitor/filesystem` in app 1.0.9
(`APP_FILES_VERSION`); an older app is told to update. Once saved it is an
ordinary file, backed up wherever the phone backs up files, which is why it is
never a default.

**The reminder is worked out on the phone**, from the latest day this phone
holds, four weeks on; the server could not know.

## Alternatives considered

- **Encrypted uploads, keys on the phone.** A photo would follow the person to
  a new phone. Rejected for now: it puts a body's photo on our servers,
  however wrapped, against "kept on your phone only", and a key lost with the
  phone loses them anyway.
- **The phone's own camera app** (`<input capture>`). Simpler, but the photo
  lands in the gallery first, there is no outline to stand by, and no timer.
- **The gallery as the store.** Backed up for free, and out of our hands:
  every photo in Google Photos by default. Save a copy offers it per photo.
- **A lock of its own, separate from the posture's.** The same policy twice.
  An area list keeps one policy and one guard.
- **A server count of photo days** for the reminder: the one fact the server
  could hold without a picture. Still a fact about a body's photos, on a
  server; and a phone without the photos would nag for them.

## Consequences

- A new phone, or clearing the site's data, starts with no photos; the pages
  say so, and Save a copy is the backup.
- The photos are as private as the browser's storage for this site: another
  page of ours could read them, as S16 says of the posture photos; the lock
  holds on the pages that show them.
- Inside the app, Save a copy needs 1.0.9, a new build to install; until then
  the app says to update, and Chrome saves to Downloads.
- No photo is ever on a Yosher server, so none can leak from one, nor be shown
  to anyone at Yosher.
