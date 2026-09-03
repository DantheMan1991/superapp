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
wins: more literal segments first; then an exact route over a "**" subtree at
the same depth; then single wildcards; then query conditions.
Give every feature an overview.md with /dashboard/m/<feature>/** so each screen
in it has a fallback, then add one guide per screen with an exact route.

ORDER. Lower numbers list first on the Guides page. overview.md always leads.
Number a feature's guides in the order of its own menu, so the page reads like
the screen.

AREA. Optional. Where a feature has many guides, the caption a guide is
grouped under on the Guides page:
  > **Area:** Banking
Use the feature's own menu words (Banking, Sales, Reports), so a reader finds
the guide where they found the screen. Areas appear in the order their guides
do; a guide with no area, such as the overview, leads uncaptioned. A feature
with a handful of guides needs none. tests/guides.test.ts requires one on
every accounting guide but the overview.

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
Link only to a guide that is on main already; a link to one in an open PR is a
dead link until it merges.

CONTROLS. Draw a control the way the screen draws it. The renderer turns these
markers into the app's own components, so they cannot go stale the way a
screenshot does:
  {button:New bill|primary}            a button. Looks: primary, outline (the
  {button:Void|outline|trash}          default), ghost, destructive, secondary,
                                       link. An icon name may follow the look.
  {badge:Overdue 3 days|destructive}   a status badge. Looks: primary, secondary,
                                       outline (the default), destructive,
                                       success, warning.
  {icon:calculator}                    an icon on its own: a sidebar row's icon,
                                       the "?" (circle-question-mark).
  {kbd:Ctrl+K}                         a key.
  `Statement end date`                 a pill, tab, tile, column header, field,
                                       menu item or status word the reader looks
                                       for: a chip in the app's face, never code.
                                       In the panel a chip is live too.
Icon names: src/components/app/guide-icons.ts, plus the module icons in
icon-registry.ts. Write the look the screen actually uses, not the one that
reads best. In the help panel a drawn button and every chip are live: the reader clicks
one and the real thing on the screen is ringed, matched by its text (something
clickable first, then a label or heading), so spell the label exactly as
rendered. tests/guides.test.ts fails on a modifier it cannot place
or an icon nobody registered.

VOICE. Talk to the reader, and tell them what to do:
  "Click {button:Approve|primary}. You see `Approved and posted.`"
  never "Approve posts the bill.", "the page reads", "a badge sits under it".
American English in your own words (gray, canceled, check the box); a label is
always quoted exactly as the screen spells it. One fact per sentence, most
under fifteen words. Say what a control does in the same breath as naming it.
Quote exact text only when the reader has to recognize it: a message, an empty
state, an error, a status word. Everything else in plain words. No dashes for
asides, no words from our side of the glass ("strip", "shelf", "obligation",
"register", "entity"), no "simply" or "just".

SHAPE. Every guide has the same sections in the same order, so a reader who has
used one knows where to look in the next:
  (opening paragraph)   what the page is for and how you get to it; two or
                        three sentences, the main action named
  ## What you see       one bullet per control or area, top to bottom: the
                        bold name, what it shows, what happens when you use it
  ## How to <task>      one section per task, numbered steps, ending with what
                        the reader sees when it worked; link the next step
  ## Messages           a table, the exact message then what it means and what
                        to do; only when the page shows messages
  ## Not on this page   what a reader might look for that is not built, with
                        "ask us" where we would do it for them
  ## Who can do what    owners, staff, accountants
Leave out a section the page has no need of. Never add a different one.

DEPTH. A guide is the manual for its screen, not a summary. One guide per
screen. Cover every control on it: every field in every dialog (what it accepts
and what it is for), every table column, every filter and status word, every
owner-only control, every message the screen can show, and what happens after
each action. Say why a control exists where a reader would wonder. Read every
component the screen renders before writing, not just the page file, and check
it against the running screen. Each feature also gets an overview guide that
maps its screens. This is the founder's bar (2026-09-02): the first two guides
were "not near detailed enough" and were rewritten to it. Two guides may share a
route when one screen needs two pages (the tie goes to the earlier slug, which
is the one the "?" shows; link to the other from it). A PR that changes a
screen updates its guide (AGENTS.md).
-->

Open **Feature** in the sidebar. This page is where you do the thing. To start, click {button:Main action|primary}.

## What you see

- **The first control.** What it shows. What happens when you use it.
- **The second control.** The same.

## How to do the thing

1. Click {button:Main action|primary}.
2. Fill in `Field name`, then click {button:Save|primary}.
3. You see `Saved.` and the new row in the list.

## Messages

| Message | What it means |
| --- | --- |
| `Nothing here yet` | The list is empty. Click {button:Main action|primary} to add the first one. |

## Not on this page

What a reader might look for that is not built. Ask us if you need it.

## Who can do what

Owners can do everything here. Staff can see the page and add things. Accountants can only read it.
