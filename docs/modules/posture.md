# Posture check

> Measure how a person stands and moves with their phone's camera: stickers on
> the bones, a plumb line beside them, the phone on a tripod reading every
> picture itself and keeping only numbers. Part of [Workouts](fitness.md) in the
> [personal space](personal-space.md). The decisions are
> [ADR 0118](../decisions/0118-a-posture-checks-pictures-never-leave-the-phone.md)
> (the pictures never leave the phone) and
> [ADR 0119](../decisions/0119-a-posture-measure-is-read-from-stickers-and-reported-against-yourself.md)
> (stickers, gravity, you against you).
> Status: `coming_soon` · Scope: `module` <!-- keep Status on ONE line — /admin/docs parses it -->


## Build log

Newest first. One entry per session/PR that touched this area. Every PR that
changes it MUST add an entry here (rule in AGENTS.md).

### 2026-09-30 — The check in the app (`claude/app-camera`)

The founder asked for it the day slice 1 merged ("I want it to work in the app
as well"), so slice 6 came forward. App **1.0.8** declares CAMERA (and VIBRATE)
and carries the privacy screen and keep-awake plugins; the shell's side is in
[mobile-app.md](mobile-app.md). On the web's side:

- **No screenshots while the camera is on.** `useScreenPrivacy`
  (`client/screen-privacy.ts`) turns on `FLAG_SECURE` for the setup check
  while it runs, and off when it ends or the screen is left: no screenshot, no
  screen recording, a blank card in the app switcher (ADR 0118). Nothing, in a
  browser: the guide says so.
- **The screen stays on through the shell.** `useWakeLock` uses the KeepAwake
  plugin inside the app, for workout mode too.
- **A refused camera, explained by app version.** An app older than 1.0.8 never
  declared the camera and has no switch to allow it, so it is told to update
  (`appCanUseCamera`); a newer one is told where to allow it.
- **The camera goes off when the check ends**, not only when the screen is
  left (`releaseCamera`).

Tests: `tests/mobile-shell.test.ts` (the camera and vibrate lines, the plugins
in the package and both Gradle files, the version against the web's camera
version), `tests/native-app.test.ts` (the version rule, the two plugins'
reads), and the privacy scan over the new file.

Not verified on a phone: no Android SDK here, and the app shows the live
site, so it is proved on the S25 with the workflow's APK once this merges.

### 2026-09-30 — Slice 1: check your setup (`claude/posture-setup-check`)

The plan below, and the first slice of it: everything the check will lean on,
proved on the person's own phone before any measuring is built.

- **The pose model, served from this site.** `@mediapipe/tasks-vision` 1.0.1
  (Apache-2.0). `scripts/copy-pose-assets.ts` (prebuild `--strict`, predev)
  copies the library and its WebAssembly out of `node_modules` into
  `public/pose/tasks-vision-1.0.1/`, and downloads the lite, full and heavy
  models from Google's model store into `public/pose/models/`, each checked
  against the SHA-256 pinned in `core/assets.ts` and named by it. `public/pose/`
  is gitignored, `next.config.ts` serves it `immutable` (every path carries a
  version or a hash), and the proxy's matcher skips `.wasm` and `.task`.
- **The measuring core, pure and tested** (`src/modules/fitness/posture/core/`):
  `geometry.ts` (the level frame, signed angles, the phone's attitude from a
  quaternion, robust numbers), `plumb.ts` (thin-line evidence, RANSAC, strip
  centres to a fraction of a pixel, the metre marks), `stickers.ts` (colour as
  an angle in the Cb/Cr plane, blobs, prediction from the pose points,
  assignment with the left/right swap tried, a hold's aggregate),
  `sticker-map.ts` (the twenty stickers, their anchors and placement words),
  `views.ts` (which side is facing, whether all of them is in the picture,
  stillness), `camera.ts` (the main lens, the locks), `lines.ts` (every line
  the voice says), `readout.ts` (numbers only, and refuses anything
  picture-shaped).
- **The worker** (`worker/posture.worker.ts`): frames in, numbers out, each
  frame closed once read. A small copy of the frame for the pose model and the
  plumb line's first search; full-resolution strips and patches for the fine
  work. MediaPipe is imported at run time from `public/pose/`, never bundled.
- **The setup check** (`/personal/m/fitness/posture/setup`, full screen and
  dark): the main lens chosen and remembered per phone, colour and focus
  locked, the level read live, the plumb line found (picture tilt and scale),
  the person found from all four sides with their stickers, and the pose
  model timed on the phone (heavy, full and lite on the processor, and heavy
  on the graphics chip checked against the processor's points). The coach's
  recorded voice leads (every line fetched ahead). It ends with a readout of
  numbers to copy and send; nothing is saved to the account.
- **The Posture check page** (`/personal/m/fitness/posture`): what it needs,
  the room from above, where the twenty stickers go (drawings, never a
  photograph) with plain words for finding each bone, and the way into the
  setup check with the last readout kept on the phone. A **Posture check**
  card on the Workouts page leads there.
- Shipped `coming_soon` with Workouts: a superadmin's own space previews it,
  nobody else has it.

**Driven** in the browser pane with a free stock photograph of a clothed man
(Pexels, kept out of the repo) with stickers and a plumb line drawn on it, fed
through the development-only "test with a picture" input: the plumb line read
the picture's tilt as −0.801° (drawn −0.8°) and the scale as 730.07 px a metre
(drawn 730), strip fit RMS 0.31 px; eight of the nine front stickers were found
within 0.04 px of where they were drawn, every frame; the ninth was drawn nine
centimetres below the ankle the model found, which the readout's `lookedFor`
showed at once; the camera's picture was covered by the stick figure as soon
as the person was seen; the heavy model took 205 ms a frame on the laptop's
processor (full 74, lite 59; the GPU 641 and agreeing). The drive found the
bug below (a classic worker) and the Stickers row's tally.

Tests: `tests/posture-geometry.test.ts`, `posture-plumb.test.ts` (a drawn
wall, string, door frame and person: the tilt back within 0.05°),
`posture-stickers.test.ts` (skin of six tones never a sticker; discs found
within 0.1 px; the swap), `posture-camera.test.ts` (the lens, the locks, the
model files, the lines, the readout), `posture-privacy.test.ts` (ADR 0118
held to the code).

Not in this slice, said here so it is not lost: the check itself (slice 2),
anything saved (slice 3), the content security policy (open items), and the
Android app (it cannot use the camera until a build adds the permission).

## What he asked for, and what it became

2026-09-29/30, the founder: a tool that "reads things like knee valgus, hip
tilt, head posture shoulder posture etc", "leave no stone unturned to make
this the best possible", on a Samsung Galaxy S25 Ultra, with a tripod and the
room set up however it needs. He will be measured naked or nearly (the product
itself recommends snug shorts or briefs pushed below the hip bones: the same
accuracy), someone can place the stickers on his back, and he chose to keep
photos for before-and-after (on the phone only, ADR 0118).

Four research passes (2026-09-29, by subagents; the sources are cited where
their numbers are used below) settled the shape:

1. **Stickers measure; the model finds.** Pose-model points are judged
   correct within about 10 cm (PCK@0.2); MediaPipe's knee valgus was 19° off a
   lab system, while its change from the start of a movement agreed within
   about ±3° (Asaeda 2024, PMC11399566). MediaPipe plus coloured markers
   matched hand-measured head posture at r > 0.98 (Chen 2025,
   doi:10.3390/automation6040088).
2. **Gravity from a plumb line.** SAPO's protocol hangs one in the picture
   with two marks a metre apart, for vertical and scale (Ferreira 2010,
   PMC2910855). Chrome rounds the phone's sensors (acceleration to 0.1 m/s²,
   about 0.6° of roll), and a phone's accelerometer can be a degree out.
3. **Honest noise.** Full re-tests, stickers re-placed a week apart: shoulder
   level MDC 3.6°, body line 2.9°, pelvic height ICC 0.37 (Barbosa 2022,
   doi:10.53886/gga.e0220023); head posture about 5° (Gallego-Izquierdo 2020,
   PMC7559098); standing knee alignment 2.7° (Sheehy 2015); single-leg squat
   knee angle 7.5–8.9° (Munro 2012). Pelvic tilt is partly bone shape, 0 to
   23° in cadavers held level (Preece 2008, PMC2565125).
4. **Words.** Healthy people are asymmetric; posture relates weakly to pain;
   no image posture measure has a validated clinically important difference
   (Karbalaeimahdi 2025, PMC12827935). Diagnostic words make a medical device
   (FDA general wellness, January 2026; EU MDR Rule 11).

## What it measures (slices 2 and 4)

Plain geometry, each against true vertical from the plumb line, each with its
own noise. "Reliable" measures are reported as values and changes; "trend
only" ones only as changes against the person's own earlier checks.

| Measure | View | From | Report |
| --- | --- | --- | --- |
| Shoulder level | Front and back | The two shoulder-tip stickers, against horizontal | Reliable |
| Body line | Both sides | Shoulder tip to outer ankle bone, against vertical | Reliable |
| Head over shoulders (craniovertebral angle) | Both sides | Ear sticker to neck sticker, against horizontal | Reliable (needs the neck sticker) |
| Standing knee alignment | Front | Front hip bone, kneecap, front of the ankle | Reliable |
| Knee path in a single-leg squat | Front | The same three, at the deepest frame, as a change from standing, left against right | Reliable as a change (8–10° is noise) |
| Hip drop and trunk lean in a single-leg squat and stance | Front | The hip bones' line; breastbone over the hips | Reliable as a change |
| Arms overhead | Side | Shoulder, elbow and trunk | Reliable |
| Front hip bones level | Front | The two front hip bones | Trend only |
| Back hip level | Back | The two low back dimples | Trend only |
| Pelvis tilt | Both sides | Front hip bone to low back dimple | Trend only (bone shape) |
| Head tilt, rounded shoulders, knee hyperextension | Front; sides | Ears; shoulder against neck; hip, knee, ankle | Trend only |

Not measured, because a photograph cannot: leg length, spinal curves,
shoulder blades, rotations, foot arches, the Q-angle.

## How a check runs

- **The room** (the page draws it): a plain matte wall, not blue or green; a
  taped foot outline 0.6 m out from it; the plumb line beside the outline at
  the person's distance; the phone upright on a tripod at hip height, 3 to
  3.5 m away, the rear camera toward the person; soft light from beside the
  phone; no window, mirror or second person in the picture; a warm room.
- **The stickers**: twenty matte dots, 19–25 mm, blue on the left, green on
  the right, either colour on the midline. The ear, shoulder tip, front hip
  bone, side hip bone, outer knee, kneecap, front of the ankle and outer ankle
  bone on each side; the breastbone's notch; the base of the neck and the two
  low back dimples with a helper.
- **The views**: front, right side, back, left side, each held still for about
  ten frames, twice a check (slice 2). The coach says each turn; the phone
  captures when the person is framed, facing the right way and still.
- **The phone**: main lens (never the ultrawide Chrome's `environment` may
  open), 4K portrait, colour and focus locked after they settle, level to a
  degree by its sensor, true vertical from the plumb line.

## The camera, the level and the plumb line

- Chrome lists a camera per Camera2 id; the main lens is id 0 and has the
  flash. `facingMode: "environment"` picks the highest id, the ultrawide on a
  Samsung, so the choice is by `deviceId`, remembered per phone. Samsung hides
  its zoom lenses from Chrome altogether.
- `whiteBalanceMode: "manual"` is a true lock; `focusMode: "manual"` holds
  focus; `exposureMode: "manual"` keeps the time but not the ISO, so exposure is
  locked only with both read back. `takePhoto` stops the stream, so a hold is
  a burst of video frames, not photographs.
- The level: the orientation quaternion (`RelativeOrientationSensor`, about
  0.1°) first, then the gravity sensor, then the motion event (about 0.6°
  steps). It guides the tripod; the plumb line is what a measure is corrected
  by, and the sensor's offset from it is kept per phone.
- The plumb line: a dark cord about 5 mm thick with a weight, and two bits of
  red or orange tape exactly a metre apart. Found as the near-vertical thin
  line most pixels agree on (not a door frame, which is thick), then fitted to
  its centre strip by strip.

## The pose model

MediaPipe Pose Landmarker (heavy for measuring), 33 points, run in IMAGE mode
on a 960-pixel copy of each frame. Its fast path on the graphics chip is
broken on the S25's Adreno 830 (MediaPipe #5867 and #5908: wrong points,
quickly), so the processor runs it unless the setup check has compared the
two on that phone and the graphics chip agreed and was faster. Estimated 3–6
frames a second on the S25's processor for the heavy model; the readout will
say. Other models were looked at and put aside for their licences (RTMPose
weights unclear; COCO-WholeBody, BEDLAM and Sapiens non-commercial).

## Privacy

[ADR 0118](../decisions/0118-a-posture-checks-pictures-never-leave-the-phone.md).
Frames are read in the worker and closed; only numbers leave it (`send`
refuses binary); the account keeps numbers; kept photos stay on the phone,
never the gallery. The camera's own picture is covered by the stick figure
once a person is in view. `tests/posture-privacy.test.ts` refuses network,
storage (but the phone's own settings), recording, photographs and other
sites anywhere in the posture code.

## The slices

| # | Slice | Done when |
| --- | --- | --- |
| 1 | **Check your setup** | Built (the build log). The founder runs it on his S25 and sends the readout |
| 2 | **The standing check** | The coach leads four views, twice; each view is captured when framed, facing the right way and still; the report shows every measure above with its noise, the figure drawn from the points; kept photos (his choice) stored on the phone behind a tap |
| 3 | **History** | Checks saved as numbers and sticker places only; compared with any earlier check; a change called only beyond the person's own noise; each sticker's place against last time checked before measuring; numbers exported; a retake nudged at each program phase |
| 4 | **Movement** | Paced double-leg and single-leg squats, single-leg stance and arms overhead: a film held in memory, read after the set at the model's pace, never kept |
| 5 | **During a workout** | Live cues in workout mode through the seams it left: the stage, `coachSay({ key: "posture" })`, the enrollment's side |
| 6 | **The Android app** | Built with slice 1 (app 1.0.8): CAMERA and VIBRATE, `@capacitor/privacy-screen` while the camera is on, keep-awake. Done when watched on the S25 |
| 7 | **Later** | Sharper models after a licence review, the back's outline, the feet close up |

## Data model

None yet: slice 1 keeps nothing in the database. The phone keeps its own
settings (`yosher.posture.device.v1` in localStorage: the chosen camera, the
delegate, the sensor's offset, the last readout; never a picture).

Planned for slice 3, every table with `tenant_id`, FORCE RLS and composite
keys, like fitness's: `fitness_posture_checks` (when, the setup: camera
height, distance, scale, the rounds) and `fitness_posture_measures` (the
check, the measure, the view, the value, its noise), and the sticker places
per check (numbers) for the placement check.

## Key files & seams

- `src/modules/fitness/posture/core/` — the pure half (above), tested.
- `src/modules/fitness/posture/worker/` — `posture.worker.ts` and
  `protocol.ts` (the messages; numbers only).
- `src/modules/fitness/posture/client/` — `setup-session.ts` (the setup
  check's steps), `camera.ts`, `orientation.ts`, `frames.ts` (a track's
  frames to the worker, or a video's), `device-settings.ts`, `voice.ts`,
  `screen-privacy.ts` (`FLAG_SECURE` in the app).
- `src/lib/native-bridge.ts` (`privacy`, `keepAwake`) and
  `src/lib/native-app-core.ts` (`APP_CAMERA_VERSION`, `appCanUseCamera`): the
  app's side, which the web decides with.
- `src/modules/fitness/posture/components/` — `setup-check.tsx`,
  `overlay.tsx`, `diagrams.tsx`, `last-readout.tsx`, `posture-card.tsx`.
- `src/app/personal/(space)/m/fitness/posture/page.tsx` and `setup/page.tsx`.
- `scripts/copy-pose-assets.ts`, `public/pose/` (gitignored), the `/pose/`
  headers in `next.config.ts`, and the matcher in `src/proxy.ts`.
- `docs/help/fitness/posture.md`, `posture-setup.md`.

## Decisions & gotchas

- **Next bundles the worker as a CLASSIC worker**, even asked for a module.
  MediaPipe then loads its WebAssembly loader with `importScripts`, and the
  module build of that loader (`import.meta`) fails there with "Cannot use
  'import.meta' outside a module". `isClassicWorker()` (`importScripts()` with
  nothing to import: a no-op in a classic worker, a throw in a module one)
  picks the build that works. Found on the first drive.
- **MediaPipe is imported at run time, not bundled** (`webpackIgnore` and
  `turbopackIgnore` on the `import()`): it loads its own loader with a dynamic
  `import(url)` a bundler would rewrite.
- **`public/` is served `max-age=0`.** Without the `/pose/` header a phone
  would revalidate 46 MB before every check.
- **A failed model load is forgotten**, in the worker (`visionLoad`,
  `landmarkers`), so the next ask tries again instead of failing for ever on
  the first error.
- **The camera's picture hides itself** the first time a person is seen, and
  stays hidden unless "Show the camera" is tapped.
- **Every line the voice says is fixed text** (`core/lines.ts`), fetched when
  the check starts: a line built on the fly would miss its recording and be
  said in the device's voice. A missing sticker is said by name, three at most.
- **The test picture is development only** (`testSources` is false in
  production), and a picture used for it lives in `public/pose/test/`, which is
  gitignored with the rest of `public/pose/`.
- **A drawn sticker in the wrong place reads as missing**, and the readout
  says where it was looked for (`lookedFor`) and whether it was looked for at
  all (`unsearched`). The first drive's "missing" ankle was a test picture's
  dot drawn on the shoe.

## Open items

- **Everything the S25 must show** (the readout carries each): which cameras
  Chrome lists and whether `environment` opens the ultrawide; the main lens's
  sizes and locks, and whether exposure holds; the sensor's rate and offset
  against the plumb line; the heavy model's time on the processor, and the
  graphics chip's verdict; the stickers' colours as the camera sees them
  (`hue`, `chroma`) and how much each wanders (`jitterPx`); frames dropped;
  colour drift over the check.
- **A content security policy on the posture routes**, as ADR 0118's second
  lock: it must allow the production Clerk domain, which only a preview
  deploy can confirm, so it waits for one.
- **The check in the app (1.0.8) is unwatched**: the camera prompt, the
  WebView delivering frames (`MediaStreamTrackProcessor`, or the `<video>`
  path when a WebView lacks it), the orientation sensors in a WebView,
  screenshots refused, the screen kept on. The readout's `frames.path` and
  `level.sensor` will say which paths the app took.
- **Self-placed stickers are unstudied**: the placement check (slice 3) is how
  their error will be measured.
- The side figure in the sticker drawing is rough; worth a better drawing
  when slice 2's report draws the figure properly.
