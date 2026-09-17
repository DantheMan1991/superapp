# Printing an HTML document in production

The estimate's brochure proposal is an HTML document
([ADR 0083](../decisions/0083-a-proposal-is-an-ordered-list-of-sections-a-brochure-is-a-page-order-over-facts-the-pack-already-holds-and-the-document-is-html.md)),
and its PDF is a headless Chromium print of that same document
([ADR 0084](../decisions/0084-the-brochures-pdf-is-a-headless-print-of-the-document-itself-and-the-format-picks-the-engine.md)).
A serverless function has no browser, so one has to be put where it can reach
it. **This is a deploy step, not a code one** — until it is done, a brochure's
`Print proposal` answers with a page saying so, and everything else about the
pack is unaffected.

## On a laptop: nothing to do

`pressFor` finds Chrome or Edge where the installer puts it, on Windows, macOS
and Linux. Check with:

```bash
npm run print:probe
```

It prints which browser it found, prints a multi-page brochure, and measures
the running footer's clearance on every page. `npm run print:probe -- --keep`
leaves the PDF and the HTML behind and says where.

If your browser is somewhere unusual, set `PUPPETEER_EXECUTABLE_PATH` to it.
That wins over the search.

## In production: host the pack, then set one variable

`@sparticuz/chromium-min` carries no binary. It downloads a
`chromium-v<version>-pack.x64.tar`, untars it into `/tmp/chromium-pack` and
inflates the browser to `/tmp/chromium`, once per cold function; a warm one
finds it already there.

1. **Get the pack that matches the installed package.** Check the version
   first — the package follows Chromium's release cycle, not semver, so a
   patch bump can be a new major:

   ```bash
   node -e "console.log(require('@sparticuz/chromium-min/package.json').version)"
   ```

   Download `chromium-v<that version>-pack.x64.tar` from the matching release
   at <https://github.com/Sparticuz/chromium/releases>.

2. **Put it somewhere fast, close to the function.** Vercel Blob is already a
   dependency of this app and is the obvious home; any public URL works. The
   pack is not a secret — it is a public build of Chromium — so it does not
   need a signed URL, and a permanent one is what you want, because every cold
   start fetches it.

3. **Set `CHROMIUM_PACK_URL`** to that URL in the Vercel project (Production,
   and Preview if you want brochures to print on branch deploys), then
   redeploy so the functions pick it up.

4. **Prove it.** Open a brochure-format estimate and press `Print proposal`.
   The first print after a deploy is the slow one — it is downloading ~50MB —
   and should still come back inside the route's 60-second budget. The second
   is fast.

## When it does not work

The failure page says which of the two it is.

- **"This deployment has no browser to print a brochure with"** — the variable
  is not set, or not set for the environment being served. Nothing was
  attempted; there is nothing in the logs.
- **"The print did not finish"** — the print was attempted and threw, and the
  real error is in the function's log under `[jobs] brochure print failed`.
  The usual causes, in order:
  - **The pack URL 404s or is the wrong architecture.** It must be the `x64`
    pack; this app deploys to linux-x64, the same reason `next.config.ts` lists
    only sharp's linux-x64 binaries.
  - **The pack does not match `puppeteer-core`.** A Chromium too far from the
    installed puppeteer speaks a different DevTools protocol. Bump both
    together or neither.
  - **Out of memory.** Chromium printing a long document wants a few hundred
    MB beyond the app. Raise the function's memory in the Vercel project
    settings; the route's `maxDuration` is in the route file, but memory is not.
  - **The 60 seconds ran out** on a cold start with a slow pack host. Move the
    pack somewhere faster; do not raise the timeout to cover a slow download,
    because the client is waiting on it.

The letter format never touches any of this — it is `@react-pdf` in-process,
and it is the reason a failure here is a missing brochure rather than a
missing proposal.
