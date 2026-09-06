# The Yosher mobile app

A native shell around yosherapp.com — Capacitor, loading the site directly,
with only the offline page bundled. The reasoning is
[ADR 0032](../docs/decisions/0032-the-mobile-app-is-the-web-app-in-a-native-shell.md);
the build record, decisions and roadmap are
[docs/modules/mobile-app.md](../docs/modules/mobile-app.md); getting a build
onto a phone is [docs/runbooks/mobile-app.md](../docs/runbooks/mobile-app.md).

This folder is its own npm package, because the native toolchain has nothing
to do with the web app's dependencies. `npm ci` here, then `npm run sync`.
`app.json` is the one place the app's identity, version and user-agent
marker live; the web repo's tests read it too.
