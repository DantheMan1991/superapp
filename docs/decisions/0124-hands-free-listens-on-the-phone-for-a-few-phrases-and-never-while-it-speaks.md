# 0124 — Hands-free listens on the phone, for a few phrases, and never while it speaks

- **Date:** 2026-10-02
- **Status:** Accepted
- **Affects:** Food (cook mode, D1c), Workouts next (F6), `src/lib/voice-commands/`, `src/lib/speech/`

## Context

D1b's cook mode needed hands: a tap for Next, a tap for a timer, a tap to
stop it. The founder's call when D1b was planned was that reading the steps
aloud should come together with saying "next", so cook mode can be used with
flour on both hands (D1c). Three things had to be decided, and he decided them
from a mockup on 2026-10-02:

- **Where the listening happens.** Offered: on the phone, with an open-source
  keyword spotter; streamed to Deepgram, the vendor the tell box already
  listens with (about $0.35 a 45-minute cook, the kitchen heard off the
  phone); or Chrome's own recognizer (free, but Google hears it, and it does
  not work inside the Yosher app). **He chose the phone.**
- **What a person says.** Single words ("next") fire on "what's next?" said to
  someone in the room; a name first ("Chef, next step") almost never fires by
  accident but makes every command longer. **He chose short phrases**: "next
  step", "go back", "repeat", "start timer", "stop timer", "ingredients".
- **Whose voice reads.** **The workout coach's recorded voice** (ADR 0115), not
  the phone's own, which he had called robotic.

He also asked for the listener to be **shared code**, so Workouts' own
hands-free (F6: "done", "next", "again" while on the floor) follows.

A keyword spotter knows sounds, not words, and how well it hears a phrase is a
measurement, not a promise. So the choice was spiked before it was built:
Deepgram's four recorded voices said each phrase and seven sentences of
ordinary kitchen talk, and the result was fed to the spotter in Node.

## Decision

Hands-free listens **on the phone**, with Sherpa-ONNX's keyword spotter
compiled to WebAssembly (`@sherpaw/kws`, Apache-2.0) and its 3M-parameter
Chinese and English model (Apache-2.0), served from this site. It listens
**only for the phrases a screen names**, written in the model's own sounds and
measured before they went in, **and never while the page's one voice speaks**:
the sound is dropped from the moment a line starts until 0.6 s after it ends.
The sound goes from an AudioWorklet straight to a worker, and only the label
of a phrase heard comes back; nothing is recorded, sent or kept. The steps are
read in the coach's recorded voice, one line at a time.

The measurements that shaped it (2026-10-02):

- Listening for "start timer" and "stop timer" together, the spotter took one
  for the other. Cook mode listens for "stop timer" **only while a timer
  rings**, and for "start timer" only while none does: with that, 20 of 24
  phrases heard across the four voices, and **0 false fires** on the kitchen
  talk in either state.
- "go back" and "ingredients" were heard from two voices of four, so each has
  a longer alternate, "previous step" and "show ingredients", heard from three.
- "stop timer" over the timer's own alarm: 16 of 16 with the chime as loud as
  the voice, 13 of 16 at twice as loud; the alarm alone fired nothing. So echo
  cancellation stays off: on Android it switches the phone to call mode, which
  turns the voice and the alarm down, and half duplex does not need it.
- Decoding costs about 46 ms per second of sound on a laptop, so it runs in a
  worker, never on the page's thread.
- A phone's microphone runs at 48 kHz. Fed 48 kHz, the engine resamples and
  hears exactly as well as at the model's 16 kHz; the capture context asks for
  16 kHz anyway, so the browser resamples once and the engine logs nothing,
  and it falls back to the phone's own rate where a browser refuses.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| Stream the kitchen to Deepgram | The founder's call: his kitchen would be heard off the phone, and every cook costs money. It would forgive phrasing and noise better |
| Chrome's speech recognition | Google hears it, and it does not exist inside the Yosher app's WebView |
| Single words, or a name before each phrase | His call: single words fire on conversation; a name doubles every command |
| One vocabulary with both timer phrases | Measured: the spotter confused them. State-swapping removed every confusion seen |
| Echo cancellation instead of not listening while it speaks | It turns Android's media volume down (call mode), and the voice reading "repeat with the rest of the dough" would still be heard by a canceller that misses |
| The engine on the page's thread (`@sherpaw/kws/core` directly) | 46 ms of every second of sound, more on a phone, on the thread that answers taps |
| The package's own worker (`@sherpaw/kws` default) | It starts a module worker the bundler would rebuild as a classic one (the posture worker's lesson, ADR 0118); our own worker imports the engine at run time instead |
| Bundling the engine | It finds its WebAssembly beside itself from `import.meta.url`, which a bundler rewrites; copied into `public/` like the pose model |
| Loading the engine or model from a CDN or Hugging Face at run time | Another company sees every phone that cooks; served from this site, pinned by version and hash, `immutable` |
| The phone's own voice | The founder's call: robotic, as he found it in workouts |

## Consequences

- **Free to run, and private.** No sound leaves the phone; there is no per-cook
  cost for listening. The reading costs what the coach's lines cost: each
  recipe's lines recorded once (about 3 cents per 1,000 characters) and kept on
  the phone. The recipe's words, not the person's, go to the voice vendor.
- **A first download of about 15 MB**: the engine (12.5 MB, about 2 MB on the
  wire, since the site compresses WebAssembly) and the model (13 MB, which does
  not compress). The phone keeps both; a build downloads the model from the
  pinned commit and fails if its hash changed.
- **Fixed phrases only.** "Next" alone, "go on", "what's next" do nothing. A
  loud kitchen, or a voice unlike the four measured, can miss a phrase: the
  numbers above are synthetic speech in a quiet room. Nobody has yet said a
  phrase to a phone in a kitchen.
- **It cannot be interrupted by speaking.** While the voice reads, nothing is
  heard; a long step must finish (or a tap must cut it) before "next step"
  works. A timer that starts ringing stops the voice, so "stop timer" is never
  kept waiting.
- **One listener per page**, shared: Workouts' F6 brings its own phrases
  (measured the same way) and its own commands, and reuses the rest.

## Notes

- The spike's numbers came from synthetic speech (Deepgram Aura-2: Arcas,
  Orion, Helena, Vesta). A real phone, a real kitchen and the founder's own
  voice are the next measurement; if a phrase misses there, add a
  pronunciation measured the same way, never a guessed one.
- Revisit if the founder finds the misses or the half duplex frustrating in
  real use: streaming to Deepgram is the forgiving alternative, at a cost and
  with the kitchen heard off the phone.
- The engine's own `setKeywords` rebuilds the native spotter (it reloads the
  model's sessions), so a vocabulary change is only made when a timer starts
  or stops ringing, never per screen.
