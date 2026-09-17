# 0084. The brochure's PDF is a headless print of the document itself, and the format picks the engine

- **Status:** Accepted
- **Date:** 2026-09-17
- **Deciders:** founder — "i do want the proposal to be exported to pdf still fyi"

## Context

[ADR 0083](0083-a-proposal-is-an-ordered-list-of-sections-a-brochure-is-a-page-order-over-facts-the-pack-already-holds-and-the-document-is-html.md)
made the brochure an HTML document served from
`/api/jobs/estimates/[id]/document`, and said in as many words that this
slice would point a headless Chromium at that URL. It is the founder's own
requirement: the client gets a link, **and** the proposal still exports to a
PDF.

There was also a live defect. `/api/jobs/estimates/[id]/pdf` rendered the
letter's `@react-pdf` document **whatever the estimate's format said**, so a
custom-home estimate set to `brochure` answered `Print proposal` with the
plain letterhead proposal — the wrong document, silently, on the estimate's
page and on the list. A format that changes the paper has to change the file.

## Decision

**THE FORMAT PICKS THE ENGINE, AT ONE URL.** `/pdf` stays the one address for
"the PDF of this proposal": a letter is the react-pdf document ADR 0070 built
and is untouched, a brochure is this document's own HTML through a browser.
The buttons never have to know which, and the list's `Proposal` button becomes
correct for free.

**THE PRESS IS HANDED THE DOCUMENT, NEVER A URL.** The route renders the HTML
in its own process and passes the string to `page.setContent`. A headless
browser fetching the app's own URL would have to carry the caller's session
into Chromium to get past `requireTenant()`, and a document assembled twice
can differ from itself. Instead **both doors return the same `htmlOf(...)`
expression** — one function, called from two places — so "one document, three
doors" is a fact about the code rather than an intention. This is also where
ADR 0083's rule pays: the stylesheet is inline and the logo is a data URI, so
`load` is reached with nothing on the wire.

**ONE LOADER FOR EVERY DOOR.** `loadProposalDocument` reads the rows, the
brand and — only for a brochure — the selections and phases, in one
transaction. The page, the file and the client link E5c will serve all come
through it, so there is no way for one of them to be made from a different
estimate than another.

**WHERE THE BROWSER COMES FROM IS ONE PURE FUNCTION OVER THE ENVIRONMENT.**
`pressFor(env, platform, exists)` returns a local browser, a hosted pack, or
nothing with a message naming what to set. **A browser already on the machine
wins over a pack it would have to download**, because a developer holding
production's variables has a pack URL on a machine that cannot run a Linux
binary; in a function no local browser exists, so the pack is what is left.
`exists` is injected, so every platform and every combination is tested
without a filesystem and without a browser.

**THE 250MB WORRY IS ANSWERABLE, AND `-min` IS THE ANSWER.** The plan recorded
a fear that a browser would not fit in a function beside sharp's libvips. It
is not close: `puppeteer-core` is 7.8MB and `@sparticuz/chromium-min` is 67KB,
because the ~50MB Chromium is **not in the package** — it is fetched from
`CHROMIUM_PACK_URL` on the first print of a cold function and inflated into
`/tmp`, where a warm one finds it again. Both are `serverExternalPackages`, so
they are copied out of `node_modules` rather than bundled, and neither
resolves its own files through a rewritten path.

**A DEAD END IS WORSE THAN A PLAIN ANSWER.** A brochure whose print cannot run
**does not fall back to the letter** — that is the silent wrong document this
slice exists to end — and does not answer a blank 500. It answers 503 with one
page saying whether the deployment has no browser or the print itself broke,
and linking the document, which any browser prints. So the document now
carries a **Print** control of its own: screen only, hidden in print media, on
no sheet of paper and in no headless render. It is what makes that sentence
true, and what a client on a shared link will reach for.

**THE RUNNING FOOTER WAS PRINTING THROUGH THE TEXT, AND ONLY PAPER COULD SAY
SO.** The footer is `position: fixed`, so it repeats on every page and
reserves room for itself on none: a FULL page put its last line at 62pt off
the paper against the footer's own baseline at 57pt. On screen it never
happened, because there the sheet's 1.1in bottom padding holds the footer off
the text — print drops that padding and reserved nothing in its place, so the
collision existed only on paper, in a document nobody had printed yet. The fix
is an empty `tfoot` around the sections, which is the only thing that reserves
a band page after page, with the fixed footer pinned into it: **tfoot reserves,
fixed pins.** A bottom padding was tried first and does not do it — it
appeared to on a synthetic page, which was the page breaks falling
differently, and the real document still printed through the footer.

**SO THE PRINT HAS A PROBE, BECAUSE NOTHING ELSE CAN SEE IT.**
`npm run print:probe` renders a multi-page brochure through the real
stylesheet, prints it, reads it back with the same `pdfjs-dist` the Documents
module reads uploads with, and compares the footer's baseline to the lowest
body text on every page. It exits 1 and names the page when the clearance
goes. Removing the band drops two pages to 5pt and the probe fails; the
clearance today is 37pt at worst. No screen, no type check and no unit test
could have found this, and a fact about pagination needs an instrument.

## Consequences

- **No migration and no schema change.** `format` shipped with 0376.
- Two dependencies, both small, and **one env var to make it live in
  production**: `CHROMIUM_PACK_URL`. Unset, a brochure's PDF answers 503 and
  says so; the letter never needs a browser at all, so nothing that works
  today can stop working. See
  [docs/runbooks/printing-html-documents.md](../runbooks/printing-html-documents.md).
- `maxDuration = 60` on the route: a cold function downloads and inflates its
  own binary before it can print. A letter returns in well under a second and
  pays none of it.
- **Verified locally, against a real Chrome, on the real estimate** — the dev
  branch's EST-ITEMS-1, printed to a 4-page Letter PDF and read back page by
  page. **The serverless path is unverified until a pack is hosted and the
  variable is set**, which is a deploy step and not a code one.
- `printHtmlToPdf` is in `src/lib/pdf/`, not in the pack: it is the platform's
  one way to print a page, and the next document written as HTML uses it
  without asking the jobs pack for anything.
- The browser is closed with a five-second race and then killed. A
  `--single-process` Chromium can hang on a graceful close, and a hung close
  spends the whole function timeout on a PDF that is already made.

## Alternatives considered

- **A second `@react-pdf` layout for the brochure.** ADR 0083 rejected it for
  two reasons and only one has expired: sections now hold every word and
  figure, so a second layout would no longer grow its own opinion about the
  money. But it would still be a second DOCUMENT — the link and the file would
  not look the same — and it would still be laying out a magazine in an engine
  with no orphan control. Printing the page keeps one document.
- **A hosted browser service** (Browserless and the like). Rejected: it would
  send a tenant's proposal, its client's name and its price off the platform
  to a third party, for a document the product can print itself.
- **Only the browser's own Print.** Free, perfect fidelity, and it is what the
  503 page falls back to — but it is not a file. Nothing can attach it, mail
  it or file it in Documents, and telling a client to use their print dialogue
  is not an export.
- **The full `@sparticuz/chromium`.** Rejected: ~50MB of Chromium in the
  function bundle, against a 250MB limit already carrying libvips, to save a
  one-time download into `/tmp` that a warm function does not repeat.
- **Keeping a browser warm across invocations.** Rejected: a browser handle
  that survived a freeze is a confusing failure mode, and the launch is a few
  hundred milliseconds once the binary is there.
- **A `tfoot` carrying the footer itself** rather than an empty spacer.
  Rejected: on the last page it rides up under the content instead of sitting
  at the foot of the sheet, and a signature page whose footer floats mid-page
  looks unfinished.
