# 0114 — A workout has one voice, and a line knows how long it is worth saying

- **Date:** 2026-09-27
- **Status:** Accepted
- **Affects:** Workout mode ([modules/fitness.md](../modules/fitness.md), F2b):
  `src/lib/speech/queue-policy.ts`, `src/lib/speech/voice-queue.ts`,
  `speakLine` in `src/lib/speech/say.ts`, `coachSay` in
  `components/workout/sound.ts`, and the founder's posture tool, which will
  speak through the same queue.

## Context

In workout mode the person is on the floor with their face down and the
phone a metre away, so the screen has to be heard. F2b gives it a coach's
voice: each set as it appears ("Now the left side."), a cue halfway through a
set, "Last one." as the last breath starts, "Exercise done." after. The
founder is building a posture tool in parallel that will give spoken
corrections ("Knees out.") from the camera during a set.

These all want to speak in the same minute. At a pace of one second out and
one in, a cue and "Last one." land on top of each other. A correction is only
true for the second it describes.

The one speaking function the product had, `sayIt` (say.ts, the tell box's),
cancels whatever it is saying on every new line. That is right for the tell
box, where the newest answer is the true one. In a workout it lets a cue cut
off the count and a count cut off a correction. A plain first-in-first-out
queue fails the other way: a correction arrives three sentences late, when it
is no longer true, and a burst of lines turns into a monologue.

## Decision

**Everything in workout mode speaks through one queue, and every line says
how it may be treated.** Each line carries:

- a **priority**: `high` interrupts anything lower (the posture tool's
  corrections), `normal` is what happens next (the steps and the count), and
  `low` waits its turn (the cues).
- an optional **key**: a newer line with the same key replaces an older one,
  waiting or already being said.
- a **freshness**: how late it may start and still be worth saying (2 s, 8 s
  and 4 s by priority, or its own). A stale line is dropped, never said late.

An interrupted line is not said again. The queue holds three lines at most.
The rules are pure (`queue-policy.ts`) and tested. The queue itself
(`voice-queue.ts`) only keeps the order and feeds the engine. Workout mode
reaches it through `coachSay`, which honours the two switches (sounds, and the
coach's voice). The tell box keeps `sayIt`. Both share the engine, so a device
that proves it cannot speak goes silent for both.

The engine gained an end. `speakLine` calls back when a line has been said,
so the queue can hold the next line until then. The app's own voice answers
the moment it has the words, not when it has said them, so its end is
estimated from the line's length. In the app, a newer line still cuts the old
one off cleanly: the shell flushes.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| Keep `sayIt` (cancel on every new line) | A cue cuts off "Last one.", and a count cuts off a correction; whatever was said last wins, not what matters most |
| A plain queue, first in first out | A correction waits behind two cues and is said when it is no longer true; a burst of lines becomes a monologue |
| One voice per source (coach, posture), each cancelling its own | Two engines, or two callers of one engine, talk over each other. The browser has one `speechSynthesis`, and a second caller cancels the first |
| Tones only, no words | The tones already mark each breath. They cannot say which side is next or what to keep in mind. The founder asked for a coach, and the posture tool needs words |
| Change the app's native voice to report its end (and to queue) | It needs a new app build, and every older build still on a phone must keep working. The estimate works with every build. Reporting the end can be added in the build that adds VIBRATE and CAMERA |

## Consequences

- The posture tool has a place to speak that cannot talk over the count, and
  cannot be talked over by a cue:
  `coachSay({ text, priority: "high", key: "posture" })`. Its correction goes
  unsaid if it is more than two seconds late, which is the right failure.
- Every word the coach says is a pure function (`core/coach.ts`), tested
  without a screen.
- **Cost:** in the app, the end of a line is a guess. A long line on a slow
  voice can be cut off by the next one, and a short line leaves a short
  silence. Neither has been heard on a phone yet.
- **Cost:** a dropped line is gone. Someone who missed "Now the left side."
  reads it on the screen. The rule is never to say a thing late.
- Fixed on the way, for the tell box too: an utterance stopped by the next one
  (`interrupted`, `canceled`) or refused before the page's first tap
  (`not-allowed`) used to count as proof that the device cannot speak. That
  turned the voice off for the rest of the page. Now only a real failure does.
  And a line overtaken before it began (asked for in the same tick as a newer
  one, or while the page's voices were still loading) was said after the newer
  one, because its cancel had nothing to stop yet. Now it is dropped.

## Notes

What would make us revisit: a workout where the voice is heard as nagging,
which the switch answers for one person and a different set of moments
answers for everyone. Or the posture tool needing to hold the floor for
several lines in a row, which a priority alone does not give it.
