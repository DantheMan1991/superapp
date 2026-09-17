# 0083. A proposal is an ordered list of sections, a brochure is a page order over facts the pack already holds, and the document is HTML

- **Status:** Accepted
- **Date:** 2026-09-17
- **Deciders:** founder — "for the proposal, it needs to be able to look extremely professional. more like a brochure with the price sheet. this would be more for custom homes. then a more simple proposal for a production home"

## Context

[ADR 0070](0070-a-proposal-is-the-estimate-at-its-price-and-its-words-are-fixed-with-the-money.md)
gave the estimate a proposal: one letter-sized PDF, three ways of showing
the price, cost never printed. It is the right document for a remodel and
the wrong one for a $2M custom home, where the proposal is a piece of
sales material — a cover, a letter from the builder, what is being built in
prose, the price sheet, what is still to be chosen, when it happens.

Asked for both, the founder was explicit: **magazine-grade for luxury, not
for production.** So there are two documents, and the questions were
**what a second document is made of**, **who decides its pages**, and
**what renders it**, given that `@react-pdf/renderer` has no page
furniture, no `break-inside`, no orphan control and one font pipeline.

The temptation was a second PDF layout file. That would have been a second
opinion about the money as well as the type, which ADR 0070 exists to
prevent.

## Decision

**A PROPOSAL IS AN ORDERED LIST OF SECTIONS, AND A FORMAT IS A PAGE ORDER.**
`proposal-sections.ts` turns the proposal into `ProposalSection[]` — cover,
letter, facts, parties, text, narrative, price, allowances, milestones,
acceptance — and a `format` column says which order. `letter` is exactly
the document ADR 0070 built, section for section, because nothing about it
was wrong. `brochure` is the custom-home one. **`presentation` is
orthogonal and both formats honour it**: what the paper IS and how the
money is GROUPED were tangled in one field and are now two.

**A BROCHURE IS NOT A LAYOUT PROBLEM, IT IS A PAGE ORDER OVER FACTS THE
PACK ALREADY HOLDS.** This is the claim the slice rests on, and it held:

| Brochure page | Where it already lived |
| --- | --- |
| What is included, in prose | the items' names and `client_note` (ADR 0079) |
| Allowances | the job's selections and their chosen choices (ADR 0067) |
| How it goes | the job's phases, with their dates and trades (ADR 0071) |
| The price sheet | `proposal-model.ts`, unchanged |
| Cover, footer, watermark | the brand kit and the estimate's status |

Two columns were added and nothing else: `format`, and the `letter` the
brochure opens with. No new table, no RLS migration.

**THE MONEY STILL HAS ONE SOURCE.** Sections WRAP `buildProposalModel`
rather than replace it; nothing in the section model computes a price. Two
things that both work out a total is how they come to disagree, so there is
one, and the cost-word scan now runs over the sections as well as the
model, in both formats.

**A PAGE WITH NOTHING ON IT IS NOT PRINTED.** No letter typed, no
selections drawn up, no phases scheduled, no items named — the section is
absent rather than a heading over a blank. That is the difference between a
document and a template somebody forgot to fill in, and it is why a
brochure on a bare estimate is three sections long.

**THE SENTENCE IS PRINTED ONCE.** When the narrative carries the items'
notes, the price sheet prints names and money only. Found by reading the
first real brochure: the two pages sit next to each other and the same
sentence appeared on both, which is how a document starts to look
automatic.

**THE DOCUMENT IS HTML, SERVED BY A GET ROUTE.** Not a page — a page would
arrive wearing the app's sidebar — and not more react-pdf, because a
browser has the page furniture this needs and react-pdf does not. The
stylesheet is inline and the logo is a data URI, so the document prints the
same offline, in a headless browser, and from a saved copy: **a document
that needs the network to look right is not a document.** Print is the
primary medium and the screen is print on a grey desk, which is why the
page is a fixed measure with a shadow rather than a fluid layout.

**And it is deliberately the same URL the next two slices need**, which is
the whole reason this is the first one: **E5b** points a headless Chromium
at it for the PDF the founder asked to keep, and **E5c** serves it from a
tokenised link the client can open and accept on. One document, three
doors — the entry bar's rule (ADR 0081) applied to paper.

## Consequences

- Two columns on `job_estimates` (`format`, CHECK letter / brochure; and
  `letter`), migration `0376`, no RLS migration — the 0347 / 0358 / 0375
  precedent. **Generated clean, with no stray foreign key to repair**,
  because 0375's snapshot recorded the item key's intent.
- Three files: `proposal-sections.ts` (pure, the page order and every word),
  `proposal-html.ts` (layout only, computes nothing), and the route. The
  letter's PDF path is **untouched** — `proposal-pdf.tsx` still renders
  `buildProposalModel`, and its pinned tests still pass unchanged, which is
  the proof this slice broke nothing that worked.
- `format` is a printing choice, so it stays free on an accepted estimate,
  like `presentation` and `show_code_numbers`. The **letter is the
  agreement's words**, so it is fixed with the money, like the scope, the
  exclusions and the terms.
- The brochure costs two extra queries (selections, phases) and the letter
  costs none, because the letter has no page for either.
- **Not built, on purpose, and each its own slice:** the PDF of the brochure
  (E5b — a headless print of this URL, and the founder's "i do want the
  proposal to be exported to pdf still"); the client link with **Accept**
  (E5c); a cover PHOTOGRAPH or the elevation off the current drawing set,
  which wants an image pipeline the cover does not need to be good — the
  cover is typographic for now; and the assurances page (warranty period,
  bonding, insurance), which is a commercial want rather than a residential
  one.

## Alternatives considered

- **A second `@react-pdf` layout.** Rejected: no `break-inside`, no orphan
  control, no running furniture, and a second file that would have grown
  its own opinion about the money.
- **A React page under the dashboard.** Rejected: a document is not a
  screen. It would arrive with the sidebar, the nav and the app's type
  scale, and it could not be what a client link serves.
- **Google Fonts for a display face.** Rejected for now: a document that
  looks different when the network is slow, and a headless print that
  depends on an external fetch. The system serif stack is good, and a
  self-hosted face can be added without changing anything else.
- **One format with the brochure's sections switched on individually.**
  Rejected: nine checkboxes to describe two documents. The founder asked
  for two, and a business that wants a section dropped can leave its
  content empty, which already removes the page.
- **Store the rendered document.** Rejected, as ADR 0070 and 0063 rejected
  it: a file drifts from the rows it was made from.
