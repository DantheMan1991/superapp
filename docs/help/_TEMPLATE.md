# What the reader is trying to do

> One or two plain sentences for the person doing the job: what this screen is for, and what they can do here.
> **Route:** /dashboard/m/feature/**
> **Order:** 100

<!--
HOW A GUIDE WORKS. This comment never reaches the reader; the renderer strips it.
Copy this file to docs/help/<folder>/<topic>.md and delete the comment.

WHERE IT LIVES. <folder> is a feature slug — accounting, documents, email, land,
and the rest of src/modules/index.ts and src/packs/index.ts — or one of three
fixed sections: workspace (/dashboard and /dashboard/today), business (hours,
team), settings (owners only). A file whose name starts with "_" or "." is
ignored, which is why this template is not a guide.

ROUTE. Where the "?" on a screen finds this guide. Exact by default, because a
wrong guide is worse than none:
  /dashboard/m/land            this screen only
  /dashboard/m/land/*          any screen exactly one level below it
  /dashboard/m/land/**         this screen and everything beneath it
  /dashboard/m/email?rules=1   a view inside a screen (Mail's views are query params)
  /dashboard/m/email?message   the parameter is present, whatever its value
Several routes go on one line, separated by commas. The most specific match
wins: literal segments first, then single wildcards, then query conditions.
Give every feature an overview.md with /dashboard/m/<feature>/** so each screen
in it has a fallback, then add one guide per screen with an exact route.

ORDER. Lower numbers list first on the Guides page. overview.md always leads.

VOCABULARY. A pack's words are renamed per business — a grazier's "Paddock" is
the pack's "Zone" — so in a pack guide never write such a word by hand. Write
  {{zone}}                 the word as the business uses it
  {{zone|plural}}          its plural
  {{zone|lower}}           lowercase, for mid-sentence
  {{zone|plural|lower}}
The key must be one the feature declares (the labels in src/packs/index.ts,
plus "enterprise"); tests/guides.test.ts fails on an unknown one. Core-tool
guides (accounting, documents, mail and the rest) use no placeholders and no
trade vocabulary at all.

LINKS. Another guide: a relative markdown link, [Getting around](../workspace/getting-around.md).
A screen: its path, [Land](/dashboard/m/land). Outside links open in a new tab.

VOICE. Written for the client, not for us. Say what to do, in the order they do
it, naming buttons and fields exactly as the screen does. Short sentences. No
internal shorthand, no module jargon, no dashes for asides. A PR that changes a
screen updates its guide (AGENTS.md).
-->

## Before you start

What the reader needs to have done, or have to hand.

## Do the thing

1. The first step, naming the button or field exactly as the screen does.
2. The second step.

## What happens next

Where the result shows up, and what to check.
