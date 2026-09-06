# Runbook — getting the Yosher app onto a phone

> **Read before:** building, installing or releasing the mobile app. §1 is
> what exists today; §2 is Android, which works now; §3 is iOS, which waits
> on an Apple developer account; §4 is how a change ships.
> **Update when:** a step turns out to be wrong, a store account exists, or a
> signing step is added.

## 1. What the app is

A native shell around yosherapp.com — [ADR 0032](../decisions/0032-the-mobile-app-is-the-web-app-in-a-native-shell.md),
dossier [mobile-app.md](../modules/mobile-app.md). The shell lives in
`mobile/`, its own npm package. It loads the live site, so a product change
ships with the web deploy and needs no app release. An app release is needed
only when the shell itself changes: its version, its icon, a native feature.

Nobody on the team has a Mac or an Android SDK installed, so **the builds
happen on GitHub Actions** (`.github/workflows/mobile.yml`), and a phone gets
the result from there.

## 2. Android, today

Every pull request or push to `main` that touches `mobile/` builds a debug
APK and attaches it to the run.

1. GitHub → **Actions** → the **Mobile** workflow → the newest run → the
   **Artifacts** box at the bottom → download `yosher-android-debug`.
2. Unzip it; inside is `app-debug.apk`. Get it onto the phone: email it to
   yourself, or put it in Google Drive, or plug the phone in and copy it.
3. On the phone, open the file. Android asks whether to allow installs from
   this source (Files, Gmail, Drive — whichever opened it); allow it, then
   **Install**. A debug build is unsigned for the store, so the phone warns
   once. That is expected. Later builds install over it: every build is
   signed with the same debug key (`mobile/android/yosher-debug.p12`,
   committed on purpose), so sign-in and the notification permission
   survive an update. Before that key existed each GitHub build carried a
   throwaway key and the phone refused the next one.
4. Open **Yosher**. It shows the site; sign in as usual. The Billing row is
   gone and sign-up is a card — that is the app telling the site it is the
   app, and it means the shell's user-agent marker is working.

To try the offline page: turn on aeroplane mode and open the app cold. You
see *Yosher can't reach the internet* with **Try again**.

Play Store: a **release** build, signed with an upload key kept in GitHub
secrets, is the next step once the Google Play organisation account exists.
Not built yet; the job's `assembleDebug` becomes `bundleRelease` then.

## 3. iOS, when the Apple account exists

iOS builds only on macOS, and the founder's machine is Windows. The
workflow's **ios** job runs on a macOS runner on every push to `main` (and by
hand: Actions → Mobile → **Run workflow**), generates the Xcode project and
compiles it for the simulator. That proves the shell builds; it cannot be
installed on a phone.

Putting it on an iPhone needs:

1. An Apple Developer Program membership as an **organisation** (a D-U-N-S
   number for the LLC; verification takes days to weeks).
2. In App Store Connect: an app record with bundle id `com.yosherapp.app`
   (from `mobile/app.json`).
3. Signing in CI: an App Store Connect API key, the distribution certificate
   and the provisioning profile, stored as GitHub secrets; the ios job then
   archives, signs and uploads to **TestFlight**, and the phone installs from
   the TestFlight app. This is the step that gets built when the account
   exists — a small fastlane lane, or `xcodebuild -exportArchive` with
   `-allowProvisioningUpdates`.
4. Once signing and capabilities (push, associated domains) are configured,
   commit the generated `mobile/ios/` from a run so the settings stop being
   regenerated.

## 3a. Push notifications

Android push goes through Firebase Cloud Messaging; iPhone push through
Apple's APNs. The web side (the device table, the senders, the digest sending
after the email) is built; this is the plumbing around it.

**Firebase, done once (2026-09-06).** A Firebase project *Yosher*
(`yosher-60d89`) with an Android app registered under `com.yosherapp.app`.
Two files came out of it:

- `google-services.json` — the app's config, committed at
  `mobile/android/app/google-services.json`. Not a secret: it identifies the
  app to Firebase, and the Gradle template applies the Google Services plugin
  the moment the file exists.
- A service-account key (`yosher-…-firebase-adminsdk-….json`) — a private
  key that sends as the project. Never in the repo. Its `project_id`,
  `client_email` and `private_key` are Vercel Production's
  `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL` and `FCM_PRIVATE_KEY`; the key is
  pasted as the one-line value the file holds, `\n` sequences and all.

**To prove it end to end** once a phone has the app: sign in on the phone,
allow notifications, then from a laptop with the repo:

```bash
npm run push:probe -- --email you@example.com --service-account C:/path/to/firebase-adminsdk.json
```

It sends one test notification through the digest's own sender to every
phone that person registered and prints counts. The same command with
`--apns-key`, `--apns-key-id` and `--apns-team-id` covers an iPhone once
Apple's side exists.

**iPhone, when the Apple account exists.** In the developer account create
an APNs authentication key (.p8) and note its key id and the team id; those
are Vercel's `APNS_KEY_ID`, `APNS_TEAM_ID` and `APNS_PRIVATE_KEY` (the
file's contents), with `APNS_BUNDLE_ID=com.yosherapp.app`. The Xcode project
needs the Push Notifications capability and an AppDelegate that forwards the
device token to Capacitor, per the plugin's iOS instructions — both done when
`mobile/ios/` is committed from a CI run (§3).

## 4. How a change to the shell ships

- **Version.** `mobile/app.json` holds the version the user agent reports
  (`YosherApp/1.0.0 (ios)`); `mobile/package.json` mirrors it and a test
  insists they match. The native version numbers live where the platforms
  keep them: `android/app/build.gradle` (`versionName`, `versionCode`) and
  the Xcode project (`MARKETING_VERSION`, `CURRENT_PROJECT_VERSION`). Bump
  all of them together; the stores refuse a build whose number did not go up.
- **Config.** After editing `capacitor.config.ts`, `npm run sync` (or the
  workflow does it). The config is copied into each native project by sync,
  never edited there.
- **Icons and splash.** Sources in `mobile/assets/` (drawn from the mark by
  a sharp one-liner recorded in the dossier); `npm run assets` regenerates
  every platform size. The splash is plain navy on purpose: the site plays
  the launch animation itself (the mark zooming in on blue) on its first
  paint inside the app, so the look changes with a web deploy.
- **Local work** (optional): Android Studio opens `mobile/android`; Xcode
  opens `mobile/ios/App/App.xcworkspace` on a Mac. Neither is needed for the
  workflow to build.

## 5. Traps

- **The marker and the web must agree.** `tests/mobile-shell.test.ts` fails
  if `app.json`'s marker is not the one `src/lib/native-app-core.ts` reads.
  Change both or neither.
- **`#` in an npm script is a comment on Linux.** The colours in the assets
  script are quoted for that reason.
- **The site's own subdomains open in the phone's browser**, by design:
  only `clerk.yosherapp.com` and `accounts.yosherapp.com` are allowed inside
  the webview. A customer's marketing site is not the app.
- **A debug APK is not the Play Store.** It installs with a warning and
  never updates itself; it is for trying the app, not for a client.
