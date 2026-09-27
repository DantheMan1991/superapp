# 0113 — A workout session is a document the phone keeps and sends whole

- **Date:** 2026-09-27
- **Status:** Accepted
- **Affects:** Workout mode ([modules/fitness.md](../modules/fitness.md), F2a):
  `core/session.ts`, `components/workout/session-store.ts`,
  `saveSessionAction` / `saveSession`, and the tables `fitness_sessions`,
  `fitness_session_exercises`, `fitness_sets`.

## Context

A workout happens where the signal is worst: a basement, a garage, a field.
The person is on the floor with the phone a metre away and will not retry
anything by hand. Nothing done in a session may be lost to a dropped
connection, a reload, or the phone locking mid-set. And the screen has to know
exactly where the session is after any of those: which exercise, which set,
which side.

The plan (fitness.md, F2) said sets would be "held on the device and sent
when the connection comes back, ADR 0048's idempotency key per set": a queue
of events, each safe to replay. That handles the first half. It does not say
where the session IS after a reload, and it makes a set taken back, a
reordering of two sends, or the three answers after an exercise each a new
kind of event with its own replay rules.

## Decision

**The session is one document on the phone, and the phone sends all of it,
every time.** The document holds the session and everything done in it: each
exercise with its sets and its three answers. It is kept in the phone's
storage (a list of documents, so an unsent session from yesterday is never
overwritten by today's). It is changed only by pure functions in
`core/session.ts` (begin, record a set, one more set, finish an exercise,
skip, finish). After every change it is sent whole to `saveSessionAction`,
which makes the database match it:

- **Every id is the phone's.** The session, each exercise and each set carry
  the id the phone gave them, so a resend updates the same rows and can never
  make a second session.
- **`revision` only goes up.** Every change raises it; the server stores the
  highest it has seen and acknowledges anything at or below it without
  writing. An older copy that arrives late cannot undo a newer one.
- **The children are made to match.** A set the document no longer has is
  deleted, so taking a set back needs no event of its own.
- **Where the session is comes from the document.** `nextStep` works it out
  from what has been recorded, so a reload lands on the set it was on.

Unsent documents are sent again after a change, when the phone comes back
online, on a backoff while it does not, and whenever the program's page is
open. A session left open is closed the next day, at its last set.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| An event per set with an idempotency key (ADR 0048's pattern, as the plan said) | Safe to replay, but it leaves the screen's position to be rebuilt from a stream, and every other change (taking a set back, the three answers, one more set, skipping, finishing) becomes a new event with its own ordering rules. The document makes all of them the same operation |
| Send each change straight to the server and keep nothing on the phone | Loses the workout exactly where it happens: no signal in the basement means nothing saved |
| Keep the session on the phone and send it once, at the finish | A phone that dies or is wiped mid-session loses everything, and the program page cannot say a session is open anywhere but on that one phone |

## Consequences

- Every send carries the whole session: a few kilobytes for the founder's
  phase, far under a server action's 4 MB.
- The server trusts the phone's times (believed backwards, bounded two minutes
  forwards, ADR 0055's rule) and the phone's calendar day (refused more than a
  day and a half ahead).
- An id already used by another session's row is refused, not re-pointed.
- Reads (F3's done days, the week) read the database, which lags the phone
  only while it is out of signal.
- A second device's open session is invisible to the first until it is sent;
  the phone that did the workout is the one that knows.

## Notes

What would make us revisit: two people sharing one session (a class, a
trainer watching live), where a document owned by one phone is the wrong
shape.
