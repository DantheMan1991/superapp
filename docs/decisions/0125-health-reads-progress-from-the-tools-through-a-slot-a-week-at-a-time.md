# 0125 — Health reads progress from the tools through a slot, a week at a time

- **Date:** 2026-10-02
- **Status:** Accepted
- **Affects:** Health (H1), Workouts (its progress source), Food next (D4), `src/lib/progress-sources/`

## Context

The founder's goal for his personal space (2026-10-01) is to "track progress
based on things i am doing with the workout, eating/diet, cold plunge, sleep
etc." Two of those already have a home: Workouts keeps every session and set,
and Food will keep what is eaten. Cold plunges, sleep and the small habits he
keeps (a sauna, a supplement) had none. So Health had two jobs: keep those,
and show progress across everything, his workouts included.

From a mockup on 2026-10-02 he chose: plunges timed on the phone (time in the
water, the water's temperature, how he feels after); sleep as bed and wake
times with how rested; his own habits, done with a tap or with an amount; and
progress **by week, the last four weeks**, with which way each thing is going.

Three questions followed that the mockup did not settle:

- **How does Health know about workouts?** Health must not import Workouts or
  read its tables (a tool reading another's tables is what the extension model
  forbids), and Workouts must not learn Health exists.
- **What is a week?** Four calendar weeks put a Monday's one day beside three
  whole weeks, and "this week" reads as a collapse every Monday.
- **What is a night?** Sleep crosses midnight, and the person types clock
  times, not instants.

## Decision

**Health hosts a progress slot, the ninth P5 slot, and each tool fills it.**
`src/lib/progress-sources/types.ts` is the contract: a source answers numbers
per window (`ProgressRow`: a name, one value per week, a format, which way is
better) and a card for today (`TodayCard`: a title, an icon, a few lines, its
own page). `registry.ts` is the one file that names the sources; `resolve.ts`
asks each switched-on tool's source in a transaction of its own and gives
Health what came back, plus the names of any that failed. A tool imports
`types.ts` only; ESLint keeps `registry` and `resolve` to Health. Workouts fills
it first (workout days, the feel after a workout, today's workout), Food when
it logs meals. Everything is worked out when the page is read; nothing is
copied into Health.

**A week is the seven days ending on a day.** Progress shows four, the newest
ending today, so every week is whole. A row's newest week is read against the
average of the weeks before it.

**A night is two clock times.** Health keeps the bed and wake times the person
gave and the minutes between them, round midnight when bed is later on the
clock, filed under the morning it ended (`woke_on`, one a morning).

And one rule that runs through the numbers: **nothing is not zero, except in a
count.** A week with no nights has no average sleep (no bar, left out of "the
weeks before"); a week with no plunges has 0 plunges.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| Health reads `fitness_sessions` and `fitness_sets` itself | A tool reading another tool's tables: Workouts could not change its own schema without breaking Health, and the extension model forbids it (§4, "a pack reading another pack's tables directly") |
| Each tool writes a daily summary into a shared `health_facts` table | Two truths: a session edited, or deleted, after its summary was written leaves the summary wrong until something rewrites it, and every tool needs a write path into a table it does not own. Reading through the slot costs a query per tool per page, which a personal space can afford |
| A `health_events` log every tool appends to as it happens | The same two truths, plus history: the sessions logged before Health existed would never appear |
| Calendar weeks (Monday to Sunday) | The newest week is partial most of the week, so every comparison with whole weeks reads as a drop until Sunday. Pro-rating it guesses |
| One week against the one before | Too jumpy for habits kept a few times a week; the average of the earlier weeks is steadier, and the bars still show each week |
| Sleep as two timestamps | The person types clock times. Turning them into instants needs a timezone and a date for each end, and gets the night across a clock change "right" at the cost of a bug every night something about the date is wrong |
| A missing week as zero everywhere | An average of zero hours' sleep for a week nobody logged is a lie the bars would draw; for a count, nothing done is zero done |

## Consequences

- **Bought:** Workouts stays ignorant of Health; Food joins by writing one
  source file and one registry line; a session edited later shows correctly
  at once; a broken source costs its own rows, never the page; Health draws
  every tool alike, so no tool ships a component.
- **Cost:** every Today and Progress load queries each switched-on tool, one
  transaction each. A row's meaning is the tool's word (a "workout day" is a
  day with a set logged, which is not the program's done day), so the slot's
  contract has to say what each row means, in the source.
- **Cost:** a night across a clock change is an hour off, twice a year.
- **Cost:** the week boundaries move every day, so a week's label is its first
  day, not a week number.

## Notes

The slot asks for numbers and short lines and nothing else on purpose, like
the site blocks (ADR 0028): what a source may do is small enough that Health
can never be made to draw something it did not choose to. If a tool ever needs
to show more than a number a week (a chart of its own), that is a reason to
link to the tool's page, not to widen the slot.
