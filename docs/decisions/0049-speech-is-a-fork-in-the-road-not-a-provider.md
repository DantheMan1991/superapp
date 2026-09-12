# 0049 — Speech is a fork in the road, not a provider: the phone's own engine in the app, a vendor in a browser

- **Date:** 2026-09-12
- **Status:** Accepted
- **Affects:** `src/lib/speech/`, `src/components/app/dictate-button.tsx`, `/api/tell/transcribe`, `SETUP.md` (a new optional key)

## Context

Voice slices 0 and 1 built the credential and the verbs. What neither built is
the microphone: everything so far reaches `tell-sources` as TEXT, typed into a
box or handed over by Siri.

The Anthropic API takes text, images and documents — **not audio** — so
speech-to-text is a second model vendor, the first non-Anthropic one in the
tree. That alone made it a decision to take deliberately rather than a library
to pick.

Three options were put to the founder, who chose the third:

1. **The phone's own engine only** (iOS `SFSpeechRecognizer`, Android
   `SpeechRecognizer`, through a Capacitor plugin). Free, private, no vendor —
   and useless in a desktop browser.
2. **A server-side vendor only.** Works everywhere, costs per minute, and
   audio leaves to a third party.
3. **Both, behind a seam.**

## Decision

**The seam is `pickSpeechRoute`, a pure decision the CLIENT makes about where
transcription happens — not an interface with two implementations.**

This is the part worth writing down, because the obvious shape is wrong. Every
other extension point here (`paste-targets`, `tell-sources`, `time-targets`)
declares a contract and lets several fillers implement it. Speech cannot,
because the two engines do not run in the same place:

| | where it runs | cost | audio |
| --- | --- | --- | --- |
| `device` | on the handset, via the app shell | nothing | never leaves it |
| `server` | our server calls a vendor | per minute | leaves to a third party |

A single `SpeechProvider` interface would have to pretend the device engine has
a server side. So the fork is the seam, and only the `server` branch has a
provider registry behind it.

### The device engine wins whenever it exists

Free, no upload, and the recording stays on the handset. Preferring the paid
and less private route because it is more uniform would be the wrong default to
reach for.

### The probe is a runtime question, never an assumption from the user agent

`deviceEngine` asks whether `window.Capacitor.Plugins.SpeechRecognition` is
there **right now**, on this handset. Being inside the app is not enough:
somebody's phone is two store releases behind, and
[ADR 0032](0032-the-mobile-app-is-the-web-app-in-a-native-shell.md) says the web
decides what the app shows — which cuts both ways, so the web has to keep
working on every app version still installed. An old app falls through to the
server route; a new one takes the device route with no web deploy.

**This is why the web half of device speech ships before the plugin exists.**
It is not dead code waiting for a feature; it is the compatibility surface that
lets the plugin land as a pure `mobile/` change.

### Deepgram is the server vendor, and the choice is one file

`nova-3`, per minute of audio rather than per token, and good with a regional
accent next to machinery — which is what this product is actually for. The
contract and the registry live in `providers.ts`; swapping to Whisper or
AssemblyAI is a file beside it and a line in `PROVIDERS`, with no route,
component or test touched.

### Audio is never stored, and neither is the transcript

It arrives in memory, goes to the vendor, and is dropped when the request ends.
No blob storage, no log line, no row. The transcript goes straight back to the
browser and into the textarea for a person to read — **it is not written
anywhere until they press the box's own button**, which is
[ADR 0039](0039-a-pack-declares-what-it-can-be-told-in-one-sentence.md)'s rule
unchanged. Saying something out loud is not a second way to write to the herd.

### Speech is optional, and its absence is a sentence

No key means the mic button says so and the box still takes typing. Nothing
else in the product degrades. The same posture `ANTHROPIC_API_KEY` has.

## Alternatives considered

- **The browser's `SpeechRecognition` API.** Free and already there — but
  Chrome ships the audio to Google anyway (so the privacy argument for the
  device route does not hold), Safari's support is partial, and inside an
  Android WebView it frequently does not exist at all. It would have been a
  fourth route whose behaviour varied by browser vendor, to save a key.
- **One `SpeechProvider` interface with a `device` implementation** that
  proxies to the plugin. Tidier on paper; it would mean a server module whose
  `transcribe` never runs on the server, and a reader who could not tell from
  the type which one uploads audio.
- **Deciding the route on the server** from the user agent. It is the wrong
  question: the user agent says which app, not whether THIS handset's build has
  the plugin.
- **Streaming transcription** (a socket, partial results as somebody speaks).
  Better for a long dictation and irrelevant for a sentence — "clock me in" is
  done before a socket finishes opening.
- **Press-and-hold** rather than tap-to-start. Used outdoors in gloves, where a
  finger sliding off mid-sentence truncates what somebody said with no way to
  tell. It stops itself at 30 seconds instead.

## Consequences

- No migration, and no table. Nothing about speech is persisted.
- `DEEPGRAM_API_KEY` is a new OPTIONAL environment variable
  (`SETUP.md` Part 4.55). Unset in every environment as this lands, so the
  button currently reports that speech is not switched on — which is the
  correct behaviour and is what has been verified.
- **The vendor call itself is unverified.** There is no key on this machine or
  in any environment yet, so `deepgramProvider.transcribe` has never run
  against the live API. Its response parsing is tested against the documented
  shape; the network call is not. First use with a real key should be treated
  as a first use.
- **The Capacitor plugin does not exist yet**, so no shipped app takes the
  device route. That is slice 2b, entirely inside `mobile/`, and needs a store
  release plus a real handset to verify.
- There is no durable per-tenant rate limit on `/api/tell/transcribe`. A
  signed-in session, a 2 MB cap and a 30-second recorder are what bound the
  cost. A counter would be a table, and a table is a migration for something a
  person has to hold a button to do; recorded as an open item instead.
- `SpeechInput.vocabulary` is in the contract and not yet supplied. Feeding the
  tenant's own pen and paddock names to the vendor is the obvious next accuracy
  win — the slice 0 drive failed on exactly that ("the cows" matched no lot) —
  but reading them costs the same queries `proposeTold` is about to make again,
  and doing it well means doing it once for both.
