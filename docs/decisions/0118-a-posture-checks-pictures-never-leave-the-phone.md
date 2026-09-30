# 0118 — A posture check's pictures never leave the phone

- **Date:** 2026-09-30
- **Status:** Accepted
- **Affects:** The posture check ([modules/posture.md](../modules/posture.md)):
  `src/modules/fitness/posture/**` (the worker, the camera, the setup check),
  the pose model's hosting (`scripts/copy-pose-assets.ts`, `public/pose/`,
  `next.config.ts`), and every later slice that measures or keeps anything.

## Context

The founder asked for a full-body posture evaluation (knee valgus, hip tilt,
head and shoulder posture) from his phone's camera, and said he would do it
naked, "to have the results more accurate". Clinics take posture photographs
in minimal clothing with markers on the skin, and the hip bones the stickers go
on sit under a waistband, so the camera will see a person in little or no
clothing, often in their own home. He then chose to keep photos for
before-and-after comparison (2026-09-30).

Pictures like these are the most sensitive thing this product would ever hold.
The personal space already keeps support out (ADR 0111), but a picture that
reaches a server can still leak from it: a backup, a log, a breach, a vendor.
Every benchmarked product that uploads body photos (DARI, Kinetisense, Uplift,
PhysioCode, PostureScreen's remote capture) carries that risk; the ones that
do not (Exer, Sency, Kemtai) process on the device.

Nothing about the measuring needs a server. A pose model small enough for a
phone (MediaPipe's, Apache-2.0) finds the person, the stickers are found in
the pixels by plain arithmetic, and the numbers that come out are all a report
or a history needs.

## Decision

**Every camera frame of a posture check is read on the phone, in a worker, and
forgotten. No frame, picture or film is uploaded, sent to any AI, written to
the account, or put in the phone's gallery. What leaves the worker is numbers
(points, angles, sticker centres); what the account keeps is numbers. Photos
the person chooses to keep stay on the phone that took them.**

- Frames are transferred to the worker and closed there as soon as they are
  read. The worker posts through one `send` that throws on anything binary
  (`hasBinary`), so no later change can post a picture out of it.
- The pose model's library, WebAssembly and models are served from this site
  (copied from `node_modules` and downloaded at build time, checked against a
  pinned SHA-256), so the phone never fetches them from anyone else, and they
  are cached for good (`immutable`) under versioned paths.
- The camera's own image is covered by a stick figure the moment a person is
  in view, so whoever picks up the phone sees the figure, not the person.
- `tests/posture-privacy.test.ts` reads the code: nothing under
  `src/modules/fitness/posture/` or the posture pages may call the network,
  storage (but the phone's own settings), recording, photographs or file URLs,
  and no posture code may name another site. An exception must be argued
  here and listed there with its reason.
- Kept photos (a later slice, the founder's choice) are stored on the phone,
  in the browser's own storage for this site, never in the gallery, shown
  behind a tap, and never sent. The account keeps the numbers, so the history
  is on every device and the photos are only on the one that took them.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| Process on a server (a bigger pose model, or 3D reconstruction like OpenCap) | The pictures would leave the phone. OpenCap Monocular is also non-commercial (PolyForm Noncommercial plus the SMPL body model) and runs after the set, not live |
| Send frames to Claude for a second opinion | The same, to a vendor; and a written opinion is not a measurement |
| Keep photos in the account's file storage, encrypted | Any photo on a server can leak with the server; the founder's before-and-after needs only the phone he measures with |
| Save photos to the phone's gallery | The gallery syncs to cloud backups the person may not think of, and shows in every gallery app |
| A content security policy as the guarantee | Worth adding (an open item) but it cannot tell an upload to our own origin from any other request, and a wrong one breaks Clerk on the page; the architecture is the guarantee, the policy only a second lock |

## Consequences

- Nothing we run can see a check's pictures, so nothing we run can leak one,
  and support cannot help by looking at one either: the setup check's readout
  (numbers, copied by the person) is how a problem is diagnosed.
- The phone does all the work. On the founder's Galaxy S25 Ultra the model's
  fast graphics path is broken on its chip (MediaPipe #5867), so it runs on the
  processor, a few frames a second: fine for holding still, and the reason the
  movement slices will read a film after the set rather than live.
- A kept photo is lost with the phone or with the browser's data for the site,
  and does not follow the person to a new phone. That is the price of it never
  being anywhere else.
- A 46 MB model download the first time, per phone.
- In Chrome a page cannot stop a screenshot; the Android app can
  (`FLAG_SECURE` through `@capacitor/privacy-screen`), which the app build that
  adds the camera turns on for the posture screens.

## Notes

Revisit only if a person asks to send a picture somewhere themselves (to a
physiotherapist, say): that would be their own act, from a share button they
press, never a default, and it would need its own decision.
