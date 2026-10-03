# Health

> The third personal tool (ADR 0111): the person's cold plunges, sleep, own
> habits, weight and tape measures, logged in a few taps, beside today's
> workout and what they ate, and their progress across all of it, week by week. It answers the founder's
> goal (2026-10-01): "track progress based on things i am doing with the
> workout, eating/diet, cold plunge, sleep etc." Health keeps what no other
> tool knows, and reads the rest through the progress slot
> (`src/lib/progress-sources/`, ADR 0125), which Workouts fills and Food will.
> Lives in a personal space beside [fitness](fitness.md) and [food](food.md);
> the container is [personal-space](personal-space.md).
> Status: `coming_soon` · Scope: `module` <!-- keep Status on ONE line — /admin/docs parses it -->

## Build log

Newest first. One entry per session/PR that touched this module. Every PR
that changes this module MUST add an entry here (rule in AGENTS.md).

### 2026-10-03 — H2: weight and the body, and earlier days (`claude/health-h2`)
- **The founder's calls, from a mockup (2026-10-03, after D4a #695 merged).**
  Weight and the body next ("Weight and body", over the week and shopping
  list, a recipe's nutrition and strength). Weight typed in (his scale does not
  sync to an app); the **waist and more tape measures** he picks; a **goal
  weight and a pace**; **progress photos** as a slice of their own after this
  one, kept on the phone only; **the calorie check** (what his eating and his
  trend say he burns) as its own slice once a few weeks are logged. Not body
  fat. Pounds and inches (as the plunge's °F), and two weeks back for earlier
  days (as Food), were my defaults, said in the chat.
- **Weight on Today** (`components/weight-card.tsx`): the box starts at the last
  weigh-in; kept, the weight, the trend through it and how it moved this week
  ("Trend 185.7 lb · down 0.5 lb this week"), and how far the goal is. The trend
  is worked out on the phone from the two months of weigh-ins the page sends, so
  it moves with the weigh-in just kept. Under it, when the tape measures were
  last taken, and Measure.
- **Body** (`/personal/m/health/body`, `body-view.tsx`, `weight-chart.tsx`,
  `goal-card.tsx`): Trend, This week and Goal; the chart (30 days, 90 days,
  All: dots, the trend's line, the goal dashed when near); the goal (set,
  change, remove; lose or gain is wherever it is from the trend); the tape
  measures (latest, the move since the first, the days measured to open again);
  every weigh-in, changed or removed in place, any day.
- **Measure** (`/body/measure?day=`, `measure-form.tsx`): a day's tape measures
  together, as a decimal or as a tape reads ("36 1/4"). **Your tape measures**
  (`/body/measures`, `measure-manager.tsx`): the common ones a tap to add, any
  other by name, each with its better way.
- **Earlier days**: Today steps back two weeks (`?day=`, `core/days.ts`). That
  day's night ("The night before yesterday"), weigh-in, plunges (Type one in
  only: `plungeInputSchema.takenOn`) and habits; the slot's cards are left off,
  since their lines speak of today. Every action that writes a day takes
  `asToday`, so `NEW_DAY` still guards a page left open overnight, and `DAY`
  refuses one out of reach.
- **Progress**: Weight (the trend at each week's last weigh-in) and each tape
  measure (the week's mean) first, as the slot's new `measure` format: bars
  across the weeks' range, at least 5 lb or 2 in of it; a change under 0.3 lb or
  0.2 in is "about the same". The weight's better way is towards the goal.
- Four tables (`0446_health_body.sql`, RLS in `0447_health_body_rls.sql`; the
  composite key's target index moved above its foreign key by hand, as 0441's),
  ADR 0127, three new guides (`body.md`, `measure.md`, `measures.md`) and the
  others updated, `weight` and `ruler` in the guides' icons, the catalogue line
  and the personal home's copy. Tests: `tests/health-body.test.ts` (20 pure),
  `tests/health-body-ops.test.ts` (10 db), `tests/isolation/health-body.test.ts`
  (6), and `health-ops` for the day read and the row order.
- **On dev and production, before the merge.** Production's ledger was read
  first (it ended at `0445`, with exactly `0446` and `0447` pending); both went
  on at the founder's word (ledger ids 452 and 453), `db:verify-rls` is green on
  both databases (270 tables), and the measure key reads `FOREIGN KEY
  (tenant_id, measure_id) REFERENCES health_measures(tenant_id, id) ON DELETE
  CASCADE` in `pg_constraint`. The seed put Health's new catalogue line on both,
  and `db:verify-modules` is green on both.
- **Driven on dev (a production build, his space).** A weight refused (40) and
  kept; yesterday filled in (its night and weigh-in), and weigh-ins on four
  earlier days; the trend and week change checked by hand (185.7, down 0.5); a
  goal set (no date with five days, then "around Nov 24" with twelve); tape
  measures added (two common ones, one by name and bigger-is-better), taken
  today and on an earlier day from Today's link, a "0.5" refused and "36 1/4"
  read; a weigh-in changed in Body's list; a plunge typed in for yesterday;
  Progress; 375 px with no sideways scroll. It found:
  - **The chart's words were 17 pixels on a desktop**: a fixed viewBox scaled
    to the card. It is drawn at the card's measured width now, and starts at
    the first weigh-in in the days chosen, not 30 days back with a week of dots
    in its last quarter.
  - **Progress drew a 0.9 lb fall as one bar a fifth of the other**: bars across
    the bare range. They span at least 5 lb or 2 in now.
  - **"At the last 4 weeks' pace" was read off twelve days**: it says "your
    recent pace" now.
  - Progress rounded a tape to a tenth ("36.3 in") where Body wrote "36.25 in":
    a tape reads to a hundredth in both. Body's list mixed "Tuesday, Sep 29"
    and "Sep 26"; it names every day of this year alike. A "colours" in the
    product's words is "colors".

### 2026-10-03 — Food joins the progress slot (`claude/food-d4a`)
- Food's eating log (D4a, [food.md](food.md)) fills the slot: Progress gains
  `Calories a day`, `Protein a day`, `Carbs a day` and `Fat a day` (averaged
  over the days something was logged) and, once targets are set in Food, the
  days on each; Today gains an `Eating` card. Registered after Workouts.
- `valueWords` writes an amount of ten or more whole, with thousands
  marked ("2,010 kcal"), and an amount's smallest change depends on its unit:
  50 kcal, 5 g, 100 mg (`NOTICEABLE_BY_UNIT`); a habit's minutes keep the old,
  tiny threshold.
- `DayWatch` moved to `src/components/app/day-watch.tsx`, where Food's Today
  uses it too.
- The slot test (`tests/health-ops.test.ts`) expects Food's rows and card
  beside Workouts', since the preview switches every personal tool on.

### 2026-10-02 — H1: plunges, sleep, habits, and progress by week (`claude/health-h1`)
- **The founder's calls, from a mockup (2026-10-02).** A cold plunge is a
  timer counting up, with a soft tone each minute, kept as the time in the
  water and the water's temperature, then "how do you feel" 0 to 10, or typed
  in. Sleep is bed and wake times, filled in from the night before so most
  mornings it is one tap, the hours worked out, and how rested, 0 to 10 (a
  watch or ring later, only if he wears one). His own habits: name one, mark
  it done with a tap, or with a number (minutes, grams) when it has a unit.
  Progress is by week, the last four weeks: sleep, plunges, workouts, the feel
  after a workout, and which way each is going.
- **Today** (`/personal/m/health`, `HealthModule.tsx`): last night's sleep
  (the form, already filled in, or the night kept with Change), today's
  plunges with Start the timer and Type one in, a Workout card from Workouts,
  and the habits as buttons. A page left open overnight fetches itself again
  when looked at (`components/day-watch.tsx`), and the actions refuse a day
  that is not the space's today (`NEW_DAY`).
- **The plunge timer** (`/personal/m/health/plunge`, `components/plunge-timer.tsx`):
  ready (the water, starting at the last plunge's), in the water (big numbers,
  a tone and an Android buzz each minute, the screen kept on), out of the
  water (how you feel, Save or Discard with a second ask), and typed in. The
  timer is an epoch start in `localStorage` (`components/plunge-store.ts`), so
  a locked phone or a reload loses no time.
- **Progress** (`/personal/m/health/progress`, `components/progress-view.tsx`):
  a row per thing tracked, the last 7 days in words, the change on the weeks
  before with an arrow for the way it moved and Health's colour when that is
  the better way, and four bars.
- **Your habits** (`/personal/m/health/habits`, `components/habit-manager.tsx`):
  add, rename, give or take a unit, delete with a second ask.
- **The progress slot** (`src/lib/progress-sources/`, the ninth P5 slot,
  ADR 0125): Health hosts it, Workouts fills it
  (`fitness/progress-source.ts`, `fitness/core/progress-rows.ts`): workout
  days and the feel after a workout per week, and today's card.
- Four tables (`0441_health.sql`, RLS in `0442_health_rls.sql`), the catalogue
  row (`coming_soon`, sort 320), the accent (`--accent-health`, hue 345), the
  icon `heart-pulse`, four guides (`docs/help/health/`), and the tests:
  `tests/health-core.test.ts` (pure), `tests/health-ops.test.ts` (the
  database, the slot included) and `tests/isolation/health.test.ts`.
- **On dev and production, before the merge.** Production's ledger was read
  first (it ended at `0440`, with exactly `0441` and `0442` pending); both
  went on at the founder's word, and `db:verify-rls` is green on both
  databases (263 tables). The catalogue row was seeded on both at his separate
  yes, and `db:verify-modules` is green on both (22 modules). As a
  `coming_soon` tool, the seed switched Health on in no space.
- **Driven on dev (a production build, his space).** Sleep saved and changed,
  same times refused; habits added (a duplicate name refused with its
  message), marked with and without an amount; a plunge timed past a minute
  (one tone, one buzz at 1:00), reloaded mid-plunge (still counting), Done,
  Discard asked and kept, saved with its feel; one typed in; Progress with
  Workouts' rows from the slot; 375 px with no sideways scroll. It found:
  - **A habit added on Your habits never appeared** until a reload: the
    actions refreshed Today and Progress only, and an action re-renders the
    page it was called from only when that page is named. Your habits is
    named now.
  - **After Save the sleep card showed the old night for two seconds.** The
    action answers before the page it re-rendered streams in, and in between
    the props are the old ones. The card now keeps what it saved, and so do
    the habit buttons (at once, put back if refused), a removed plunge and
    the habits list; the server's copy takes over as soon as it differs.
  - Today read six queries one after another; it reads four now (this
    morning's night is the latest night when it was logged today, and the
    last plunge was never shown).
  - A reload mid-plunge leaves the page unable to sound until it is tapped:
    any tap on the timer now brings the tones back.
  - At 375 px the Remove confirm squeezed the plunge's line onto two rows; it
    wraps onto its own line now.
  - With the page's clock moved a day ahead, Today fetched itself again, as
    `DayWatch` should; but a phone whose clock is wrong would have fetched it
    every minute, since the server's day never catches up. It asks once per
    day the phone reaches now.

## Data model

| Table | Purpose | Notes (RLS, invariants, FKs) |
| --- | --- | --- |
| `health_plunges` | One cold plunge: `taken_on` (the space's day it started), `started_at`, `seconds` (1 to 3600), `water_f` (28 to 110, optional), `feel_after` (0 to 10, optional) | `id` is the PHONE's uuid, so a Save sent twice is one plunge (`ON CONFLICT (id) DO NOTHING`); an id already used in another space inserts nothing and the action says INVALID (isolation test). Index `(tenant_id, taken_on)`. ENABLE + FORCE RLS, superadmin + member policies |
| `health_sleep` | One night, kept the morning it ended: `woke_on`, `bed_time` and `woke_time` (Postgres `time`), `minutes` (1 to 1440, worked out from the two), `rested` (0 to 10, optional) | Unique `(tenant_id, woke_on)`: one night a morning, a second save updates it. Same RLS |
| `health_habits` | The person's own habit: `name` (1 to 60), `unit` (1 to 20, or null for done-or-not), `position` | Unique `(tenant_id, id)` (`health_habits_tenant_id_id_idx`) for the composite key below. Names unique per space case-insensitively, checked in `createHabit`/`updateHabit` (no index: see gotchas). At most 30 (`HABITS_MAX`, checked in code). Same RLS |
| `health_habit_logs` | A habit done on a day: `done_on`, `amount` (> 0, or null) | Unique `(tenant_id, habit_id, done_on)`: once a day, a second mark updates the amount. Composite FK `(tenant_id, habit_id)` → `health_habits (tenant_id, id)` ON DELETE CASCADE, so a log can never point at another space's habit and deleting a habit deletes its days. Same RLS |
| `health_weighins` | A weigh-in (H2): `weighed_on`, `kg` (20 to 320) | Unique `(tenant_id, weighed_on)`: one a day, a second save updates it. Kept in kilograms whatever the person reads (`core/body.ts` turns pounds both ways). The trend is never stored. Same RLS |
| `health_weight_goals` | The goal (H2): `goal_kg` (20 to 320), `pace_kg` (0.1 to 1 a week) | One per space: `tenant_id` is the key. Lose or gain is never kept. Same RLS |
| `health_measures` | A tape measure of the person's own (H2): `name` (1 to 40), `better` (`smaller`, `bigger` or null), `position` | Unique `(tenant_id, id)` for the composite key below. Names unique per space case-insensitively, checked in `createMeasure`/`updateMeasure`. At most 12 (`MEASURES_MAX`). Same RLS |
| `health_measurements` | A tape measure taken on a day (H2): `measured_on`, `cm` (1 to 400) | Unique `(tenant_id, measure_id, measured_on)`. Composite FK `(tenant_id, measure_id)` → `health_measures (tenant_id, id)` ON DELETE CASCADE. Same RLS |

## Key files & seams

- `src/modules/health/HealthModule.tsx` — Today, rendered at `/personal/m/health` by the `[slug]` page.
- `src/modules/health/core/` — pure: `sleep.ts` (clock times to minutes, words), `plunge.ts` (timer face, typed time and water), `habits.ts`, `progress.ts` (the windows, `readRow`, `weekWords`, bars), `rows.ts` (Health's own rows), `body.ts` (H2: units, typed weights and tapes, the trend, the pace, the goal's words, the body's rows, the chart's scale), `days.ts` (H2: the days that can be filled in, `dayRefused`, day words), `errors.ts`.
- `src/modules/health/log-ops.ts` (plunges, sleep), `habit-ops.ts`, `body-ops.ts` (H2: weigh-ins, the goal, tape measures and measurements), `progress-ops.ts` (`ownRows`, `dayData`) — every read and write in the space's own transaction.
- `src/modules/health/actions.ts` — `requirePersonalSpace` + `requireModuleEnabled("health")` + zod; each returns `{ ok }` or `{ error }` with a sentence.
- `src/modules/health/components/` — `sleep-card`, `weight-card`, `plunge-card`, `plunge-timer` + `plunge-store`, `habit-chips`, `habit-manager`, `progress-view`, `score-scale`, and Body's `body-view`, `weight-chart`, `goal-card`, `measure-form`, `measure-manager`; `DayWatch` is `src/components/app/day-watch.tsx`, shared with Food.
- `src/app/personal/(space)/m/health/{plunge,progress,habits,body,body/measure,body/measures}/page.tsx` — the screens below Today.
- `src/lib/progress-sources/` — the slot: `types.ts` (contract, the only file a tool imports), `registry.ts` (the one file that names the sources), `resolve.ts` (what Health calls). ESLint keeps `registry`/`resolve` to Health (`PROGRESS_HOST`).
- `src/modules/fitness/progress-source.ts` + `core/progress-rows.ts` — Workouts' filler.
- `docs/help/health/` — `overview.md` (Today), `plunge.md`, `progress.md`, `habits.md`, `body.md`, `measure.md`, `measures.md`.

## Decisions & gotchas

- **Health reads the other tools through a slot, never their tables**
  ([ADR 0125](../decisions/0125-health-reads-progress-from-the-tools-through-a-slot-a-week-at-a-time.md)).
  A source answers numbers per window and a card for today, in a transaction
  of its own (a failed query aborts the transaction it ran in), and only
  while its tool is switched on; a failed source costs its own rows and the
  page names the tool. Health draws everything alike, so a tool ships no
  component.
- **A week is the seven days ending on a day**, not Monday to Sunday: the
  newest is the seven days ending today, so a Monday never compares one day
  with whole weeks. The labels say each window's first day.
- **Nothing is not zero, except in a count.** An average (sleep a night, how
  rested, time in the cold, the feel after a workout) is null for a week with
  nothing, drawn as a flat line and left out of "the weeks before"; a count
  (plunges, a habit's days, workout days) and a counted habit's total are 0.
- **"Better" is not "up".** The arrow is the way the number moved
  (`RowReading.moved`); the colour is whether that is the row's better way
  (`direction`). Every row today is better up; a row whose better is down (a
  resting heart rate, one day) reads right without a change here.
- **Sleep is clock times, not instants.** `minutes` = wake less bed, round
  midnight when bed is later on the clock, so no timezone is in the sum; a
  night across a clock change is an hour off, twice a year. `woke_on` is the
  morning it is filed under, and the action only takes the space's today.
- **A workout day here is not the program's done day.** Health counts a day
  with at least one set logged, in any program; the program page counts a
  day that met every exercise's minimum (the phase gate). Both are right for
  their page. A set recorded out of the plan's order is ignored by
  `recordSet`, which is how the slot test's first fixture logged nothing.
- **The plunge timer is a start, not a count**, kept in `localStorage`
  (`yosher.health.plunge`), dropped after six hours. The tone needs the audio
  context unlocked by the Start tap (`unlockAudio`); a reload mid-plunge plays
  no tones for minutes already past. `navigator.vibrate` buzzes on Android
  only. A typed plunge's id is made at its first Save and kept in a ref, so a
  retried Save is one plunge.
- **Habit names are unique by a check, not an index.** Two creates with the
  same name at the same instant could both pass; the Add button is disabled
  while one is in flight, so only two tabs at once could do it. Same for the
  30-habit cap.
- **Show what was just done; let the server's copy take over.** A server
  action answers before the page it re-rendered has streamed in (two seconds
  on dev; the gap is shorter in production but never zero), so a component
  drawn only from its props shows the state before the action for that long,
  and invites a second tap. Each Health component that changes something
  keeps its own copy of what it changed (`useState` from the props), and
  replaces it with the props when their contents differ from the last ones
  seen (a key string, compared during render). Name every page an action can
  change in `refresh()` (`actions.ts`), or the page it was called from is not
  re-rendered at all.
- **Today reaches two weeks back, and says when it was drawn as today** (H2,
  ADR 0127; H1 marked today only). A write's day must be in reach
  (`dayRefused`: today or the 14 days before, else `DAY`), and every write
  carries `asToday`, true when the page showed its day as today; once the
  space's day has moved on, such a write is refused (`NEW_DAY`), because a page
  drawn yesterday would otherwise file this morning under yesterday, now a day
  that may be filled in. `asToday` defaults to true, so a page from before H2
  sending none keeps H1's rule. `DayWatch` refreshes a today page when it is
  looked at again; an earlier day's page has none. The slot's cards are left
  off an earlier day: their lines say "today".
- **Weight is a trend, worked out on read** (ADR 0127): `weightTrend` moves a
  tenth of the way to each weigh-in a day after the last (`1 - 0.9^n` after a
  gap), from the first weigh-in; Today and Progress read 60 days before what
  they show (`TREND_WARM_UP_DAYS`). It lags a steady loss by about a pound at a
  pound a week, and Body's guide says so. The pace is the least-squares line
  through 28 days (four weigh-ins, ten days apart, or none); the goal's date
  comes from the trend and that pace, and "your recent pace" is the phrase,
  because twelve days of weigh-ins once read as "the last 4 weeks" (the drive).
- **Kept in kg and cm, read in lb and in.** Weigh-ins are typed to a tenth of a
  pound and tapes to a hundredth of an inch; a pound turned to kilograms and
  back leaves a trillionth over, so a goal's 70 days were 71 until
  `readGoal`'s ceiling took a hair off (`- 1e-9`).
- **A level is drawn across its range, not from zero** (`barHeights`, format
  `measure`): the four weeks' range, at least 5 lb or 2 in, so a pound reads as
  a step and not a cliff. Weight reads to a tenth, a tape to a hundredth.
- **The chart is drawn at the card's measured width.** A fixed viewBox scaled
  to a desktop card drew 17-pixel labels; `weight-chart.tsx` measures its box
  (ResizeObserver) and draws in pixels at 11 px type.
- **A weigh-in or a day's tape measures already kept can be changed whenever**:
  Body's list changes or removes any weigh-in (`changeWeighin`, NOT_FOUND when
  there is none), and Measure opens a day out of reach only when something was
  kept on it. Adding stops at two weeks.
- **A day's tape measures are all or nothing**: `saveMeasurements` checks every
  measure is the space's own before writing any (NOT_FOUND), and null takes one
  off the day.
- **Coming soon, like Workouts and Food.** It reaches a superadmin's own space
  through the preview (`previewPersonalTools`), never the seed. Health data in
  a consumer app needs P1's privacy policy before anyone else gets it
  ([personal-space.md](personal-space.md), "Health data law").

## Open items

- **A watch or a ring.** Sleep and heart rate from a wearable, only if he wears
  one (his call).
- **Progress photos** (H2b, the founder's call): front and side, kept on the
  phone only, as the posture check's are (ADR 0118), compared over time.
- **The calorie check** (the founder's call: its own slice once a few weeks
  are logged): what his eating (Food's log) and his trend say he burns a day,
  and his calorie target against it. Needs days with everything eaten logged.
- **Kilograms and centimeters**: a setting, never a migration (ADR 0127).
- **A smart scale or Health Connect**: he types his in today.
- **Adding a weigh-in older than two weeks** (an import of a paper log or a
  scale's memory). Changing an old one works.
- **Nobody has weighed in on a phone yet**: the drive was a desktop pane at
  375 px; a real Android keyboard's decimal key is unwatched.
- **Not built:** body fat; tape measure reorder; reminders; °C; a countdown
  plunge; spoken minutes; habit reorder and goals; more than four weeks.
