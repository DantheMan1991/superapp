# 0055 — A queued sentence is old, not wrong: believe the past, bound the future

- **Date:** 2026-09-13
- **Status:** Accepted
- **Amends:** [0048](0048-a-phone-holds-a-grant-that-may-only-tell.md) — its *"clamped to ±15 minutes of the server's"* clause only. Everything else in 0048 stands, including that both times are stored and that retries are recognised.
- **Affects:** `src/lib/tell-sources/spoken-at.ts` (new home), `device-grants/redeem.ts`, `/api/device/tell`, `device_grant_uses.claimed_at`, and the offline queue this unblocks (tell.md, slice D2)

## Context

[ADR 0048](0048-a-phone-holds-a-grant-that-may-only-tell.md) decided how much to
believe a phone about when a sentence was said:

> `claimed_at` is user-settable and for a clock-in the difference is wages, so
> it is clamped to ±15 minutes of the server's and both are stored. Inside the
> tolerance the phone wins, and it must: **a sentence queued in a barn with no
> signal may not reach us for hours.**

**Those two sentences cannot both be true.** A sentence spoken at 07:00 and
uploaded at 10:00 when the phone finds a bar is three hours out, so
`Math.abs(claimed − now) > 15 minutes` rejects it and the clock-in is recorded
at 10:00. The rule defeats the exact case its own justification names, and the
failure is the one it was written to prevent: three hours of wages, silently,
every time — not only when somebody is cheating.

The test written beside it says so out loud. It is titled *"is believed inside
the tolerance, **because a queued sentence is old on purpose**"* and then tests
ten minutes.

**One number was answering two different questions.**

| Question | Shape | Honest size |
| --- | --- | --- |
| How **wrong** might this device's clock be? | Symmetric — it can be fast or slow | Minutes |
| How **old** might this sentence be? | One-directional — only the past | Hours, or overnight |

Nothing about a phone being out of signal for three hours suggests its clock is
three hours wrong. Age was being read as evidence of drift.

## Decision

**Believe the past, bound the future.**

- **Forward:** a small skew only — `SPOKEN_AT_FUTURE_SKEW_MS`, two minutes. A
  sentence cannot have been spoken later than it arrived, so anything beyond
  honest clock skew is a wrong clock or a lie, and the server's time wins. **This
  is the direction fraud points in**: back-dating a clock-in pays, post-dating
  one does not.
- **Backward:** believed up to `SPOKEN_AT_MAX_AGE_MS`, forty-eight hours. A phone
  out of signal overnight and into the next day is an ordinary farm; a sentence
  arriving a week late is likelier a bug or a clock set wrong than a genuine
  field recording, and the server's time wins there too.
- **The gap is returned, not just stored.** `clampSpokenAt` now answers with
  `delayedMs` alongside `effectiveAt`. A caller that knows a sentence is three
  hours old can SAY so — on the card, in the summary, in the audit line — rather
  than leaving the difference to be discovered by somebody reading two columns
  of a table.

It moves to `src/lib/tell-sources/spoken-at.ts`. The thing being timestamped is a
told sentence, not a grant: the web box has no grant at all and needs the same
answer for [slice D2](../modules/tell.md), and a second copy of this rule is how
two paths come to disagree about wages.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| Leave ±15 minutes and let the offline queue send no time at all | Then every queued sentence is stamped when it uploads, which is the wrong answer *always* rather than only when somebody cheats. It also silently discards the one fact the phone is the only witness to. |
| Widen the symmetric tolerance to 48 hours | It would believe a clock-in claimed for two days in the FUTURE, which no honest device produces and a dishonest one would enjoy. The asymmetry is the whole point. |
| Trust the phone completely and rely on both times being stored | "Visible in a table nobody reads" is not a control. A bound that refuses the absurd, plus a delay the caller can surface, is. |
| Have the device measure its own drift against the server before going offline | Correct in principle and unbuildable in practice: the interesting case is a phone that has been out of signal since before anybody thought to ask. |
| Keep the clamp in `device-grants` and have the web box import it | The box has no grant. An import from a module about tokens into the path a signed-in person uses would put an unrelated concept on a hot path, and the next person would reasonably copy the function instead. |

## Consequences

- **Back-dating inside forty-eight hours is now believable where it was not.**
  That is the honest cost. It is accepted because both times are still stored
  (0048's own mitigation, unchanged), because the delay is now RETURNED so a
  caller can put it in front of somebody rather than filing it, and because the
  alternative fails the ordinary case continuously in order to inconvenience a
  dishonest one occasionally.
- **A clock-in is the only verb where this is money**, and it is worth naming:
  anything that stamps a timestamp from `ctx.now` inherits this decision. A verb
  added later that pays somebody should be read against this ADR before it ships.
- No migration. `device_grant_uses` already keeps both times; what changes is
  which of them becomes `effectiveAt`.
- `SPOKEN_AT_TOLERANCE_MS` is gone rather than redefined. A constant whose name
  says "tolerance" while meaning two different bounds is the bug restated.

## Notes

The generalisable lesson: **a single symmetric bound is the wrong shape for any
quantity whose two directions mean different things.** Lateness and error look
alike in a subtraction and are not alike at all.

What would make us revisit: a verb that pays somebody and is speakable from a
device nobody has to sign into. Forty-eight hours of believable back-dating is a
fair trade for a farm's own phone and would not be for a stranger's.
