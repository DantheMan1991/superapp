# Voice commands — hands-free's listener

> The ears of hands-free: a page listens, on the phone itself, for a few short
> phrases, and a phrase does what its button would. An open-source keyword
> spotter (Sherpa-ONNX, compiled to WebAssembly) runs in a worker; the sound
> goes from the microphone straight to it, and only the label of a phrase
> heard comes back. Nothing is recorded, sent or kept. Built for Food's cook
> mode ([food.md](food.md), D1c) as shared code, so Workouts' hands-free
> ([fitness.md](fitness.md), F6) follows. The decision is
> [ADR 0124](../decisions/0124-hands-free-listens-on-the-phone-for-a-few-phrases-and-never-while-it-speaks.md).
> Status: `available` · Scope: `platform` <!-- keep Status on ONE line — /admin/docs parses it -->


## Build log

Newest first. One entry per session/PR that touched this area. Every PR
that changes it MUST add an entry here (rule in AGENTS.md).

### 2026-10-02 — Workouts listens too (`claude/fitness-f6`)

Workouts' F6 ([fitness.md](fitness.md)) is the listener's second user, as the
founder asked when it was built. Its phrases were measured first, the same way
(spikes 6 to 8, never committed): each candidate alone in the spotter against
Deepgram's four voices, then the chosen set together, and 13 sentences of talk
around a workout (counting aloud, "I'm almost done with this one.", "Can you
pause the TV for a second?", "Start the car, I'll be right out.").

- **Single words fire on talk.** "done", "next" and "start" were heard from all
  four voices and fired on every sentence that had the word in it ("done" also
  on "Hold on, I need some water."); "pause" alone was heard from two and fired
  three times. A keyword spotter hears a word wherever it is said.
- **Two words do not.** "start set", "set done", "one more set" and "next
  exercise" from all four with 0 false fires; "resume" and "repeat", single
  words nobody says in passing, the same. Listened for together: 29 of 32
  heard, no phrase taken for another, 0 false fires on 60 sentences.
- **"pause workout" is the weak one**: heard from three voices; eight more
  ways of saying it (stress, the vowel, "workout" with either stress) caught
  the fourth no better, so it keeps its two.
- "finish set" (two of four) and "keep going" (two of four, and it fired on
  "Keep going, you're doing great.") were measured and left out.

What changed in the shared code:

- `phrases.ts`: the six workout phrases, with what was measured.
- **`holdListener(reason, on)`**: something on the page other than the one
  voice is speaking, and the listener holds for it as for the voice, its tail
  included. A workout's demo playing with the author's sound is the first:
  "repeat on the other side" in the video must not repeat the set.
- `words.ts`: why it stopped (`listenerFailureWords`), whether Try again can
  help (`canRetry`), and the download's percentage, moved out of Food so both
  tools say the same.
- **A resume waits for the page to stay on the screen** (`RESUME_AFTER_MS`,
  0.3 s). Found on the drive: a page behind another window was shown for about
  10 ms every 2 s, and took and dropped the microphone each time (25 requests
  in under a minute); after, one request in 8 s of the same flicker.

### 2026-10-02 — The listener, for cook mode (`claude/food-d1c`)

Built with Food D1c ([food.md](food.md) has the cook-mode half and the drive).
The founder's calls, from a mockup: listen **on the phone**, for **short
phrases**, with the **workout coach's recorded voice** reading, and in
**shared code** so Workouts follows.

**The spike, before any of it** (2026-10-02, never committed): Deepgram's four
recorded voices (Arcas, Orion, Helena, Vesta) said each phrase and seven
sentences of ordinary kitchen talk ("What's next on the list for dinner?",
"Let's go out to the back porch", "Can you start the oven for me?", "Stop it,
that's too much salt", ...), fed to `@sherpaw/kws` in Node:

- With the dictionary pronunciations alone, "start timer" and "stop timer"
  were taken for each other. Listening for only one of them at a time (a
  timer ringing or not), and with a few more pronunciations: **20 of 24
  phrases heard, 0 false fires** in either state.
- The engine's threshold changed nothing; raising its boost or its search beam
  added false fires. Defaults kept.
- "go back" and "ingredients" were heard from two voices of four; "previous
  step" and "show ingredients" from three, so they are alternates.
- "stop timer" over the alarm (three sine chimes every 1.5 s, no echo
  cancelling): 16/16 with the chime as loud as the voice, 13/16 at twice as
  loud. The alarm alone: nothing.
- Fed 48 kHz (a phone's microphone), the engine resamples and hears exactly as
  at 16 kHz (22/28 both). Decoding: about 46 ms per second of sound, on a
  laptop, in Node.
- The recorded voice reading recipe shorthand, read back by Deepgram's own
  recognizer: fine for "tbsp", "oz", "lbs", "g", "ml", "min", "hr", "400°F";
  garbled "1/4 cup", "1 1/2", "1 ½", "½ tsp", "9x13-inch" and "400F". Food's
  `spokenText` writes those out.

What was built:

- **`assets.ts`**: the engine's version (`KWS_VERSION`, pinned to the installed
  `@sherpaw/kws`), where its copy is served, and the model: the Hugging Face
  commit, its SHA-256, its size, its four files' places in the pack.
- **`scripts/copy-listener-assets.ts`** (prebuild `--strict`, predev): copies
  `core.js`, the chunk it imports and `prebuilt/kws.wasm` into
  `public/voice-commands/sherpaw-kws-<v>/`, downloads the model from the pinned
  commit, checks its hash, and **checks every phrase's sounds against the
  model's own token list**, read out of the file it just checked. Proven to
  refuse a phrase with a sound the model lacks (`"repeat" uses IY9`).
- **`phrases.ts`**: the phrases in the model's tokens (ARPAbet with stress),
  `MODEL_PHONES`, and `keywordsFor(commands, listening)`, which turns a tool's
  command table into the engine's keywords, labelled with the command.
- **`listener.worker.ts`**: imports the engine from this site at run time,
  downloads the model with its progress told, builds the spotter, and decodes
  the microphone's blocks as they arrive on their own port; drops a block
  older than 2 s (a phone too slow to keep up skips rather than lags), drops
  everything while held, and starts a fresh stream after.
- **`capture-worklet.ts`**: the AudioWorklet, as a string loaded from a blob:
  blocks of a tenth of a second, samples held to [-1, 1], posted straight to
  the worker.
- **`listener.ts`**: one listener per page. `startListening` (from a tap),
  `setListenerKeywords`, `stopListening`, `setHeardHandler`, the state
  (`off`, `starting` with progress, `listening`, `held`, `paused`, `failed`
  with a reason) and `useListener` to read it.

**Driven** in cook mode on a production build (food.md has the whole drive):
the spike's recordings played into a stand-in microphone (a
`MediaStreamDestination` returned by a patched `getUserMedia`, the page's own
sound muted by a gain of 0). Every phrase did its command, in the four voices;
kitchen talk fired nothing; a phrase played while the voice spoke was dropped;
off, on again from the cache (ready in 1.4 s), leaving the page, a hidden page
(paused, the microphone let go and taken back without a prompt) and a refused
microphone (the message, then Try again) all behaved. The worker loaded the
engine from `public/` inside a production build, which is the bundling risk
the design took. The files are served `immutable`, and the proxy never ran on
them.

## Data model

None. Nothing is stored: not the sound, not what was heard. The phone keeps
the engine and model in its HTTP cache (served `immutable`).

## How a phrase is heard

1. A tap calls `startListening(keywords)`: a capture AudioContext at 16 kHz is
   made in the tap (a phone allows audio to start only there), and the state
   is `starting`.
2. The microphone is asked for **first**, so a person who says no downloads
   nothing. Constraints: one channel, noise suppression and auto gain on,
   **echo cancellation off** (below).
3. The worklet module is loaded from a blob, the worklet node made, and the
   worker started (`new Worker(new URL("./listener.worker.ts",
   import.meta.url))`). A `MessageChannel` joins the worklet to the worker:
   the sound never passes through the page.
4. The worker imports the engine and downloads the model side by side (the
   model's bytes are the `starting` progress), loads the model into the
   engine's file system (`@sherpaw/preloader`'s `loadData`), and makes the
   spotter with the keywords: `ready`, and the state is `listening`.
5. A phrase heard is posted as its label; the page drops it if it arrived
   while held, and otherwise hands it to the screen's handler.

## Decisions & gotchas

- **It never hears itself.** While the page's one voice
  (`src/lib/speech/voice-queue.ts`) is busy, and for 0.6 s after
  (`TAIL_MS`: the room's echo and the speaker's own lag), the worker drops the
  sound and the page ignores a label. The state is `held`; the screen says
  "Reading". A tool's voice must speak through the queue, or the listener
  will hear it.
- **Echo cancellation is off, on purpose.** Half duplex does not need it, the
  alarm does not confuse the spotter (measured), and on Android it puts the
  phone in call mode, which turns the voice and the alarm down. Untested on a
  real phone either way.
- **A vocabulary change rebuilds the native spotter** (the engine's
  `setKeywords` makes a new one, reloading the model's sessions): change it on
  a state change (a timer starts or stops ringing), never per screen. The page
  sends a list only when it differs from the last one sent.
- **The engine refuses a vocabulary with two identical pronunciations**, even
  under different labels: a phrase belongs to one command at a time.
- **The engine refuses a sample outside [-1, 1]**: the worklet clamps.
- **Not bundled.** The engine finds `prebuilt/kws.wasm` from its own
  `import.meta.url`, which a bundler would rewrite, and the package's default
  entry starts a module worker the bundler would rebuild as a classic one (the
  posture worker's lesson). Our worker is bundled (Next emits it as
  `static/media/listener.worker.<hash>.ts`) and imports the engine's ES module
  from `public/` at run time with `webpackIgnore`/`turbopackIgnore`, as the
  posture worker imports MediaPipe; the drive proved it in a production build.
- **A context at the model's rate.** Chrome, the Android app and Safari feed a
  16 kHz context from a 48 kHz microphone (the browser resamples, once); a
  browser that refuses (`createMediaStreamSource` throws) gets a context at
  its own rate and the engine resamples, logging `Creating a resampler` once
  per stream.
- **Only while it is on the screen.** The page hidden lets the microphone go
  (`paused`); back on the screen for 0.3 s, it is taken again with no prompt.
- **The proxy skips `/voice-commands/` whole**: the model is a `.data` file,
  and adding `data` to the matcher's extensions would also skip any path with
  ".data" in it. `tests/voice-commands.test.ts` reads the matcher out of
  `src/proxy.ts` and checks both.
- **Errors are words, not codes**: a `failed` state carries `unsupported`,
  `denied`, `no-microphone`, `download` or `engine`, and the tool says what
  to do. The worker's own messages go to `console.warn` (they carry no sound
  and no words of the person's).

## Key files & seams

- `src/lib/voice-commands/assets.ts`, `phrases.ts`, `protocol.ts`,
  `capture-worklet.ts`, `listener.worker.ts`, `listener.ts`, `use-listener.ts`,
  `words.ts`
- `scripts/copy-listener-assets.ts`; `package.json` prebuild and predev;
  `.gitignore` (`/public/voice-commands/`); `next.config.ts` (`immutable` for
  `/voice-commands/:path*`); `src/proxy.ts` (the matcher's skip)
- Tests: `tests/voice-commands.test.ts` (the pinned files, the phrases' sounds,
  the matcher, the worklet parses). A tool's own phrases and commands are
  tested in its own suite (`tests/food-hands-free.test.ts`).
- Users: Food's cook mode (`src/modules/food/components/cook-mode.tsx`,
  `core/hands-free.ts`) and Workouts' workout mode
  (`src/modules/fitness/components/workout/workout-screen.tsx`,
  `hands-free.ts`, `core/hands-free.ts`).

## Open items

- **Nobody has said a phrase to a phone yet.** Every number above is synthetic
  speech in silence, and the browser drive played those recordings into a
  stand-in microphone. A real kitchen, a fan, a sizzling pan and the
  founder's voice are the next measurement.
- **The voice and the alarm's loudness while listening**, on Android, with echo
  cancelling off: untested on a phone.
- **Speaking over the voice** (barge-in) is not possible by design; revisit if
  it frustrates in real use. Streaming to Deepgram (ADR 0124's rejected
  alternative) is the forgiving one.
- The engine's model also knows Chinese; nothing uses it.
