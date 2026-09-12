# 0051 — The way in is the shell, not a page, and not the nav rail

- **Date:** 2026-09-12
- **Status:** Accepted
- **Supersedes:** the placement consequence in [0039](0039-a-pack-declares-what-it-can-be-told-in-one-sentence.md) ("the box lives on the livestock daily round… when a second pack fills the slot it belongs on What needs you"). Everything else in 0039 stands, as amended by [0050](0050-a-safe-verb-records-itself.md).
- **Affects:** `src/components/app/tell-launcher.tsx`, the dashboard layout, `/dashboard/today`

## Context

ADR 0039 put the tell box on the livestock daily round and wrote down where it
would go next: *"when a second pack fills the slot the box belongs somewhere
both can be reached from — What needs you."* The `time` source arrived, the box
moved, and the prediction held exactly.

Then the founder asked the better question:

> *"Why is this in the what needs me page? Shouldn't this be prominent in the
> side bar and probably every page?"*

**The 0039 line answered "where can it be reached from", which is not the same
question as "where should the way in live".** ADR 0039 opens by naming the cost
it exists to remove — *"the cost is not any single screen; it is knowing which
one, while holding a bucket"* — and a control you must first navigate to in
order to avoid navigating is that same cost, one level up. This is the second
time in a day that a thing built to save steps had quietly reintroduced them;
ADR 0050 was the first.

## Decision

**The tell control lives in the dashboard shell, as a floating button in the
bottom-right corner, on every page.**

### Not the nav rail, which was the founder's own suggestion

On a phone the rail is a **drawer** behind a hamburger (`app-shell.tsx`, whose
own comments describe the drawer's modal behaviour). A row in it would be
hamburger → find → tap: three taps to reach a feature ADR 0050 had just got
down to one, on the device the whole thing exists for. It is the right answer
on a laptop and the wrong one in a barn, and where they disagree the barn wins.

### Not the header either

Always visible on both, and never covering anything — but the top-right corner
is the hardest place on a phone to reach one-handed, which is the exact posture
this is for. It also reads as a settings control rather than the main way in.

**Bottom right, because that is where a thumb is.** The rail is left, the
header is top, and neither is reachable while the other hand is holding
something.

### The press that opens it is the press that starts it

The sheet opens **already listening**. Somebody who pressed a microphone has
said what they want; a second press to begin would be the tap ADR 0050 removed.
The sheet is how it shows that it is on — a microphone with no visible state is
worse than a button — and it closes itself once something is recorded. The
whole interaction for "clock me in" is press, speak, done.

### One control, not two

The inline box is gone from `/dashboard/today`. Two ways in would mean two code
paths, two guide sections, and a reasonable person wondering which one is the
real one. The guide content moved with it, from `what-needs-you.md` to
`getting-around.md`, which is the guide for the shell.

### Not on the guides shelf

`/dashboard/guides/**` is the one place somebody is reading rather than doing,
and a button that covers the last line of a paragraph is how people stop
reading the manual.

## Alternatives considered

- **Keep it on What needs you as well.** Duplication with no gain; see above.
- **A command-palette entry.** The palette already exists (`toCommandItems`)
  and this could join it — but a palette is a keyboard affordance, and the
  hands this is for are not on a keyboard. Worth adding later as a second door,
  never as the only one.
- **Bottom-centre, like a tab bar.** More reachable still, and it collides with
  the phone's own home indicator and with any future bottom navigation. The
  corner leaves both alone.
- **Only inside the mobile app.** The same person uses the laptop in the
  office and the phone in the field, and a control that moves depending on
  which they picked up is a control they have to think about.

## Consequences

- The layout renders it, so `isServerSpeechConfigured()` is read once per page
  render in the shell rather than by each page that wanted a box.
- It floats over page content. Mitigated by the corner, by shrinking on large
  screens, and by `print:hidden` — but a page whose own bottom-right corner is
  load-bearing will need to know about it. None does today.
- `env(safe-area-inset-bottom)` keeps it clear of the iPhone home indicator.
  Without that it sits under the swipe bar and takes two tries to hit; it has
  NOT been verified on a real handset, only reasoned and emulated at 375px.
- The sheet is remounted per opening, so every press starts a fresh sentence
  rather than reviving the last one.
- Guides: `getting-around.md` now carries the whole thing and
  `what-needs-you.md` carries none of it.
