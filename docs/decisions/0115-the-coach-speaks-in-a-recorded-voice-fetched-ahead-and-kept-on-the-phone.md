# 0115 — The coach speaks in a recorded voice, fetched ahead and kept on the phone, with the device's voice as the fallback

- **Date:** 2026-09-27
- **Status:** Accepted
- **Affects:** Workout mode ([modules/fitness.md](../modules/fitness.md), F2d):
  `src/lib/speech/voices.ts`, `synthesis.ts`, `clips.ts`, the engine under
  `voice-queue.ts` ([ADR 0114](0114-a-workout-has-one-voice-and-a-line-knows-how-long-it-is-worth-saying.md)),
  `pickVoice` in `say.ts` (the tell box's voice too), the route
  `/api/fitness/voice`, and `sessionLines` in `core/coach.ts`.

## Context

The founder used the workout on his PC and said the coach's voice "sounds very
robotic. can we get a more natural voice." The coach spoke with the device's
own engine (`speechSynthesis` in a browser, Android's text-to-speech in the
app), and the voice was chosen as the first one in the page's language. On a
Windows PC that is Microsoft David, the oldest-sounding voice the machine has.

A device's voices vary with the device. Edge has natural voices, Chrome has
Google's (better than David, still synthetic), an iPhone has good ones only if
they were downloaded, and a Mac lists joke voices first. No choice made on the
device gives the same voice on the founder's PC, his phone and the Android app.

Deepgram is already this product's speech vendor: the tell box sends it audio
to transcribe ([ADR 0049](0049-speech-is-a-fork-in-the-road-not-a-provider.md)).
Its Aura-2 voices are natural, $0.030 per 1,000 characters (checked
2026-09-27), and answered a coach's line in 140 to 510 ms when tried. The
founder heard four of them as samples and chose Arcas.

A workout also has to work with no signal (ADR 0113), and some lines have to
be heard on time: "Last one." as the last breath starts.

## Decision

**The coach's lines are recorded by Deepgram in the voice the phone chose,
fetched before they are said, and kept on the phone. The device's own voice
says any line whose recording is not there in time.**

- The lines a session can say are known in advance: they are pure functions of
  the plan and the session (`sessionLines`, which walks the session with the
  same functions the screen speaks with). They are fetched on the start screen,
  while the feel check is answered, and again as the session moves on, so only
  a line a change made new (a set added with "One more set") is fetched late.
- One route, `/api/fitness/voice`, records a batch of up to 40 lines of up to
  300 characters, behind the personal space's door and the Workouts gate. It
  sends the words and nothing else, with Deepgram's model-improvement opt-out,
  and keeps nothing. The recordings come back as one binary body, not JSON.
- The phone keeps every recording in Cache Storage, keyed by a hash of the voice
  and the words. A program's lines are downloaded about once.
- The one queue (ADR 0114) is unchanged. Only its engine changes: a line's
  recording when there is one, through the page's one audio context; otherwise
  `speakLine`. A line still being fetched waits up to 2 seconds for it. A `high`
  line (the posture tool's) never waits.
- When the device does speak, it now picks its most natural voice
  (`pickVoice`): natural or neural first, then premium, enhanced, Google; the
  person's own region; never another language; a dated or joke voice only if
  there is nothing else. A network voice that fails on a page is passed over,
  not taken as proof that the device cannot speak. The tell box gets this too.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| Only a better pick of the device's voice | Free, and it is the fallback now. But the voice still depends on the device: natural in Edge, synthetic in Chrome, the phone's own in the app. The founder chose a vendor voice once he had heard both |
| Record each line when it is said | Every line would wait for a network round trip, the counts would be late, and a session with no signal would have no voice at all |
| A new vendor (OpenAI, ElevenLabs, Google, Azure) | A new account, key and set of terms, for voices no better for this use than one from the vendor we already use. The route and `synthesis.ts` are the only places that know the vendor, so a change later is one file |
| Keep the recordings on the server (blob storage), shared across devices | One more store holding the program's words, for a saving of cents. The phone's own cache covers the case that matters, a session with no signal |
| JSON with base64 for the batch | A third more bytes for a phone to download on a gym's signal |
| Recordings of numbers and words stitched together | Stitched speech is what sounds robotic. Each line is recorded whole |

## Consequences

- The coach sounds the same on every device, in the voice the person chose, and
  keeps it with no signal for any line it has said before.
- **Cost:** money, about 4 cents the first time a session's lines are fetched
  (about 1,400 characters), then close to nothing. There is no per-space
  counter, which would be a table. Recorded as an open item before Workouts is
  opened to everyone.
- **Cost:** the program's words (exercise names, sets, cues) now go to a vendor.
  Nothing personal does: not how the body felt, not what hurt, not who it is.
- **Cost:** a line fetched late is said a second late, or in the device's voice.
  A line the walk does not foresee is recorded on first use.
- **Cost:** the recordings play through Web Audio. On an iPhone with the ringer
  switch off, Web Audio may be silent where speech was not, and the app's
  WebView playing them has not been heard. Neither has been tried on a phone.
- The demo now waits for the coach (F2d): the queue says whether it is busy
  (`isVoiceBusy`, `subscribeVoiceBusy`), and a new exercise's demo starts when
  the voice goes quiet.

## Notes

What would make us revisit: a second use for recorded lines outside Workouts
(the tell box's answers are different: they are new every time, and waiting for
a round trip is the cost there), the cost growing past cents once others use
it, or a vendor voice that sounds better for coaching.
