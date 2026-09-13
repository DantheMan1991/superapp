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

### 2026-09-12 — The phone listens before the web exists (`claude/native-speech`)

The shortcut worked and was too slow. The founder: *"it takes way too long to
load the app before the microphone starts working. It needs to be immediate."*

He was right, and **nothing about the microphone was slow.** The sequence was:

    long-press → Android starts the app → the WebView downloads
    yosherapp.com → the server renders the dashboard → JavaScript hydrates
    → only NOW does any code exist that can ask for a microphone

He was waiting for a website. No amount of web work fixes that, because the
web is the thing being waited for.

**So the shell listens for itself, and it is the first thing in `mobile/` that
decides anything.** `MainActivity` sees `yosher://tell` on its launch intent
and starts the microphone immediately, in this process. The app loads behind
it, and by the time the page is ready the words are already waiting.

**The first version of this used `RecognizerIntent` and did not help.** The
founder: *"it really didn't speed it up. It takes a while for Android's
recogniser to fire up."* Right again, and for a specific reason — that intent
**launches Google's speech app as a whole separate activity**, which has its
own cold start. One slow launch had been traded for two.

`SpeechRecognizer` binds to the same service IN PROCESS: no second activity,
no second launch, started before Capacitor has finished building its bridge.
The cost is that it draws NOTHING, which is why `listening` is published to the
page — the sheet shows "Listening…" the moment it paints, rather than an idle
box over a live microphone.

**And no logo, no fade.** The site plays a 1.5-second launch animation on its
first paint inside the app (650ms in, 450ms hold, 400ms out) — pure dead time
on a launch whose whole point is speed. The shell now sets the site's OWN
`yosher_launched` cookie before the page loads, which is the mechanism
`src/lib/launch.ts` already had for "this launch has had its animation".
Reusing it rather than inventing a second flag: a flag the web had to learn
about is a flag that could disagree with the cookie.

This is also, arriving by a different road, exactly what
[ADR 0049](../decisions/0049-speech-is-a-fork-in-the-road-not-a-provider.md)
wanted for the app: the phone's own engine, no upload, nothing charged per
minute. The route it predicted was a Capacitor speech plugin the web would call;
what actually earned it was latency, and the plugin is not needed.

**`TellPlugin` is a hatch and nothing more** — no decisions, no knowledge of
what a sentence means. Two ways out, because the ordering genuinely varies:
`takePending()` for the cold start (the usual case, where somebody finished
speaking while the site was still downloading) and an `utterance` event for the
warm one (a second long-press, or a slow talker on a fast connection).
`pendingUtterance` is cleared as it is taken, so a sentence is recorded once.

**The web must NOT record when the shell already did.** `nativeEars` probes for
the hatch and suppresses `autoListen`, because two microphones for one sentence
is the bug that would have replaced the slow one. An older build has no hatch,
probes false, and keeps the web recorder it has always had — the web copes with
every app version still installed (ADR 0032).

Once the words arrive they are ordinary. The same cards, the same
confirmations, the same rule about what records itself (ADR 0050). `TellBox`
gained `said`, read once during render for the reason the url is: an effect
would paint an empty box and then fill it.

#### The two lines that would have made it fail silently

- **`<queries>` for `android.speech.RecognitionService`.** Android 11 made
  packages opaque, and the recogniser lives in another app. Without the
  declaration `startActivityForResult` throws `ActivityNotFoundException` on
  every modern phone — and the catch treats that as "a device without a
  recogniser", so it would have looked like the feature simply did nothing.
- **`registerPlugin` BEFORE `super.onCreate`.** Capacitor builds its bridge
  there; a plugin registered afterwards is not in it.

Version 1.0.4, `versionCode` 5.

**Not verified by me at all** — this is Java on a machine with no Android SDK.
CI compiles it, which proves it builds and nothing more. Whether the recogniser
opens fast, whether the words survive the hand-off, and whether a second
long-press works while the app is open are all things only a handset can say.

### 2026-09-12 — One tap from the home screen (`claude/tell-shortcut`)

Long-press the Yosher icon and the app opens **already listening**. The
nearest thing to *"without me even opening the app"* that Android allows
without a foreground service, and it is on the device the founder actually
uses.

**Not a line of Java, and that is the design.** The shortcut fires
`yosher://tell`; Capacitor hands that url to the page — `getLaunchUrl` on a
cold start, `appUrlOpen` on a warm one — and `tell-launcher.tsx` decides it
means "open and start listening". The shell declares the door and the web
decides what it means (ADR 0032), so **changing what a long-press DOES is a
web deploy, not a store release.**

`src/lib/native-bridge.ts` gained the `App` plugin beside `push`, found the
same way: probed off `window.Capacitor.Plugins` at runtime, null on a build
that predates it. An older shell simply has no shortcut and its floating
button is untouched.

**A custom scheme rather than an https url**, and the reason is not taste. A
shortcut firing `https://yosherapp.com/...` opens the phone's BROWSER unless
the app has verified App Links — which needs an `assetlinks.json` carrying the
signing certificate's fingerprint, and the debug key and the Play key have
different ones. It would work for exactly one of the two builds anybody is
holding.

**No `<data android:scheme="yosher" />` filter in the manifest**, deliberately.
The shortcut's intent names the activity explicitly and an explicit intent
needs no filter; adding one would publish a `yosher://` door any app or web
page could knock on, for nothing this shortcut does not already have.

`?tell=1` on any dashboard url does the same thing, parsed rather than
substring-matched so a customer called "tell=1" never opens a microphone. That
second spelling exists because a second door is coming — a Siri intent handing
over to the site — and it should not need a second mechanism. It is also the
half that could be driven: `/dashboard/m/land?tell=1` opened the sheet and the
param was taken back out of the url, so a refresh does not reopen it.

`tests/tell-shortcut.test.ts` asserts the two packages agree on the one string
that matters (`android:data` vs `TELL_URL`), because nothing else would catch a
change to either side and the symptom would be a long-press that opens the app
and does nothing.

Version 1.0.2, `versionCode` 3.

**Not verified on a handset by me** — the long-press menu, the cold start and
the warm `appUrlOpen` all need a real phone. The debug APK on the PR is what
proves it.

### 2026-09-12 — The app could never have been given the microphone (`claude/app-microphone`)

Reported from a real phone: *"it says the app needs permission for my
microphone. I can't give the app permission in the phone settings though."*
Both halves of that sentence were true, and the second one is the diagnosis.

**The manifest declared `INTERNET` and nothing else.** The site records a
sentence through `getUserMedia` inside the WebView (ADR 0049). Capacitor's
`BridgeWebChromeClient` already does the hard half — it catches the WebView's
`AUDIO_CAPTURE` request and asks Android for `RECORD_AUDIO` +
`MODIFY_AUDIO_SETTINGS` at runtime (verified against its source, not assumed).
But **a runtime request for a permission the manifest never declared is denied
instantly, with no dialog**, and an app appears in Android's permission
settings only for what it declared. So the app asked, the system refused
silently, and the web told him to go and grant a permission that was not listed
anywhere. There was no switch to find.

Both permissions are now declared, plus
`android.hardware.microphone required="false"` so the Play listing is never
filtered off a device without one — dictation is a convenience and the app
works by typing on anything.

**This was a web decision the shell could not honour.** ADR 0049 says the app
uses the phone's own engine and uploads nothing; because that plugin does not
exist yet, `pickSpeechRoute` falls through to the SERVER route inside the app,
deliberately, so an old build still works. What nobody checked is whether *any*
build could do the thing it was falling back to. Writing a fallback is not
finishing it.

The failure message is now door-aware for the same reason. In a browser,
"allow it" is followable. In an app build that never declared the permission it
is not, so the app says **"This version of the app cannot use the microphone.
Update it, or type instead."** — the web has to cope with every app version
still installed (ADR 0032), including the ones that cannot be fixed by
allowing anything.

`tests/mobile-shell.test.ts` asserts all three manifest lines. The manifest is
hand-edited and nothing else in this repo would ever mention those strings
again.

Version 1.0.1, `versionCode` 2, bumped across `app.json`, `package.json` and
`build.gradle` together.

**Not verified on a handset by me** — this machine has no Android SDK, and the
workflow's debug APK is what proves it. The check after installing is
Settings → Apps → Yosher → Permissions, which should now list Microphone at
all, where before it listed nothing to switch.

### 2026-09-06 — Slice 3: the launch (`claude/mobile-app-3-the-launch`)

The founder, a minute after installing: a blue screen with the logo zooming
in, then away, then the sign-in screen. Built as two halves.

- **The shell's half is a plain navy screen** (`mobile/assets/splash*.png`,
  `launchShowDuration: 300`): the one thing only a native screen can do is be
  there before any page has loaded. The mark is gone from it on purpose —
  it appears once, in motion.
- **The site's half is `src/components/app/launch-overlay.tsx`**: rendered by
  the server over the first page of a launch (the `(auth)` layout and the
  dashboard layout — the two places the app opens), the mark zooms in on a
  cool blue gradient, holds a beat, and the overlay lifts to reveal the page
  that loaded behind it. Inline styles, because it must look right before any
  stylesheet has arrived. About a second and a half; a plain fade for a phone
  that asked for less motion.
- **Once per launch:** the overlay sets a session cookie (`yosher_launched`)
  when it ends; `launchPending()` in `src/lib/native-app.ts` reads it, so a
  second page load renders no overlay and nothing flashes. A webview forgets
  session cookies when the app closes, which is exactly when the launch
  should play again. `src/lib/launch.ts`, `tests/launch.test.ts`.
- The marketing pages are untouched and stay static; the app never opens on
  them.
- **The iOS job compiled for the first time** (a manual run, 2026-09-06),
  once the workflow opened `App.xcodeproj`: Capacitor 8 wires plugins with
  Swift Package Manager and there is no workspace. The Mac half of the
  pipeline is proven; signing and TestFlight still wait on the Apple account.
- **A committed debug signing key** (`mobile/android/yosher-debug.p12`, a
  PKCS12 made with openssl, password `android`). Found the hard way: the
  second build would not install over the first, because each GitHub runner
  signs with a throwaway key. Debug only; the store's upload key is a secret
  in GitHub, later.

### 2026-09-06 — Slice 2b: push, the shell's side for Android (`claude/mobile-app-2b-push-shell`)

- **`@capacitor/push-notifications`** in the shell, with
  `presentationOptions` so a notification arriving while the app is open still
  shows. `npx cap sync android` registers it; the Android manifest merge
  brings the plugin's own permission.
- **Firebase.** A project *Yosher* (`yosher-60d89`) with the Android app
  registered under `com.yosherapp.app`; `google-services.json` committed at
  `mobile/android/app/`, where the Gradle template applies the Google Services
  plugin on sight. The service account's three values are in Vercel
  Production as `FCM_*`; the key file stays off the repo. Proven from a
  laptop before the merge: the account mints a Google token and FCM accepts it
  (a fake device token is refused as invalid, not the credentials).
- **`npm run push:probe -- --email …`** (`scripts/push-probe.ts`): one test
  notification to a person's phones through the digest's own sender, with
  the credentials from the environment or from the files by flag. The
  end-to-end check that does not wait for 7am.
- The getting-around guide gains the permission prompt; the runbook gains
  §3a. `tests/mobile-shell.test.ts` insists the Firebase config names the
  shell's package.
- **iPhone push waits on the Apple account**: an APNs key, the capability on
  the Xcode project and an AppDelegate change, all in the runbook.
- **The app opens on `/dashboard`**, decided by the SITE: the proxy redirects
  a request for `/` that carries the app's user agent
  (`nativeAppEntryRedirect`), so a build already on a phone starts opening in
  the right place the moment the site deploys, with nothing to reinstall. The
  shell's `startPath` in `app.json` says the same thing for a fresh build.
  The first build opened on the marketing landing page, which is for
  browsers; the founder noticed within a minute of installing it — and then
  installed twice more before this moved out of the shell, which is the
  lesson: anything that can be the site's decision should be.

### 2026-09-06 — Slice 2a: push, the web side (`claude/mobile-app-2a-push-web`)

Everything push needs on the server and the page, mergeable before the shell
carries the plugin — the page finds no plugin and does nothing.

- **`push_devices`** (`drizzle/0261` + RLS `0262`), `registerPushDeviceAction`,
  the senders in `src/lib/notifications/push.ts`, and the digest run sending
  the same digest to a person's phones after the email — the notifications
  dossier has the reasoning; this dossier owns the phone's side.
- **`src/lib/native-bridge.ts` + `src/components/app/push-registration.tsx`:**
  the page reads `window.Capacitor`, which the shell injects into the site,
  asks for permission, registers, posts the token, and routes a tapped
  notification to `data.url`. Pure detection, tested with hand-built windows.
- **Registration is written under `withSystem`**, deliberately: a phone
  changes hands, and the row for its token then belongs to somebody the new
  person cannot see. The action binds the row to the verified caller and
  nothing else.

### 2026-09-06 — Slice 1: the shell (`claude/mobile-app-1-the-shell`)

The app exists: `mobile/`, a Capacitor 8 project that loads yosherapp.com.

- **`mobile/` is its own npm package** (`capacitor.config.ts`, `app.json`,
  `www/`, `assets/`, the generated `android/`). The web's tsconfig and
  ESLint exclude it; nothing in the web's CI installs it.
- **`app.json` is the one place** the app id (`com.yosherapp.app`), name,
  version, site URL and user-agent marker live. The config reads it, and
  `tests/mobile-shell.test.ts` in the web repo insists its marker is the one
  `src/lib/native-app-core.ts` reads and its version matches `package.json`.
- **The webview goes to yosherapp.com and nowhere else** but Clerk's two
  hosts; every other link opens in the phone's browser. `appendUserAgent` is
  `YosherApp/<version> (<platform>)`, per platform. On iOS the content sits
  below the status bar (`contentInset: "always"`) until the site pads for a
  notch itself.
- **An offline page is the only thing bundled** (`www/offline.html`, wired as
  `server.errorPath`): what the app shows when the site cannot be reached,
  with a "Try again" that reloads the site.
- **Icons and splash** for every Android density, generated by
  `@capacitor/assets` from `mobile/assets/` — the mark on the sidebar's navy,
  drawn by sharp from `public/yosher-mark.png`.
- **Builds run on GitHub Actions** (`.github/workflows/mobile.yml`): a debug
  APK on every pull request touching `mobile/`, attached as an artifact; the
  iOS project generated and compiled for the simulator on a macOS runner on
  pushes to main and by hand. Nobody on the team has a Mac or an Android SDK.
  `docs/runbooks/mobile-app.md` is how a build reaches a phone.
- **Two loader traps met on the way**: `typescript@latest` resolved to
  TypeScript 7, whose package no longer exposes `transpileModule`, so the
  Capacitor CLI loads the config as a native ES module where `__dirname` does
  not exist. The config now works under either loader, and the package pins
  TypeScript 5. And a `#` in an npm script is a comment on Linux, so the
  colour arguments in the `assets` script are quoted.

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
| `push_devices` | A phone that asked to be told, keyed by person | Own-rows-only RLS (`0262`); registered and sent under `withSystem`. Notifications dossier for the sending side |

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
- `mobile/capacitor.config.ts` and `mobile/app.json` — the shell's identity,
  the site it loads, the marker it sends; `mobile/www/offline.html` — the one
  bundled page; `mobile/assets/` — icon and splash sources; `mobile/android/`
  — the generated Android project (committed; `ios/` is generated in CI until
  signing is configured). `tests/mobile-shell.test.ts` ties the marker to the
  web.
- `.github/workflows/mobile.yml` — the Android debug build and the iOS
  simulator compile; `docs/runbooks/mobile-app.md` — getting a build onto a
  phone, and how a shell change ships.
- `mobile/android/app/google-services.json` — the Android app's Firebase
  identity; `scripts/push-probe.ts` — a test notification through the real
  sender.

## Decisions & gotchas

**The launch animation is the site's, the splash is the shell's.** A native
splash cannot animate on both platforms (iOS launch screens are static), and
anything drawn in the shell needs an app release to change. So the shell
shows plain navy for the instant before the webview has a page, and the site
plays the mark on its first paint inside the app. The two must not both show
the mark, or it appears twice — which is why the splash sources are plain.

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

- **iOS will need `NSMicrophoneUsageDescription` the day `mobile/ios/` is
  generated.** There is no iOS project yet, so there is nothing to edit — but
  the same failure is waiting there in a different costume: a WKWebView asking
  for the microphone with no usage string in `Info.plist` does not prompt, it
  **crashes the app**. Worse than Android's silent denial, and the fix is one
  key. Written down here because `cap add ios` will generate a plist that does
  not have it.

- **Slice 1 shipped without signing.** What remains of the shell itself: a
  signed Android release build (an upload key in GitHub secrets, once the
  Play organisation account exists); iOS signing and a TestFlight upload
  (App Store Connect API key, certificate and profile in secrets, once the
  Apple organisation membership exists), after which the generated `ios/`
  project is committed; the site padding for the notch itself so the header
  can run under the status bar (`contentInset: "never"`); the site hiding the
  splash on hydration instead of on a timer; Android's back button walking
  the webview's history.
- **Push on iPhone** waits on the Apple account: an APNs key (`APNS_*` in
  Vercel), the Push Notifications capability on the Xcode project, and the
  AppDelegate forwarding the device token — all when `mobile/ios/` is
  committed from a CI run. Android push is complete.
- **Unregister on sign-out** is not done: a phone keeps receiving the previous
  person's digest until somebody else signs in on it, which re-points the row.
  Clerk's sign-out has no hook the page owns yet.
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
