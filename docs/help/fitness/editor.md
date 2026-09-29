# Building and editing a program

> One screen for three jobs: checking the draft Claude made from your PDF, building a program by hand, and changing a program you already saved. Nothing is saved until you click Save program.
> **Route:** /personal/m/fitness/import/*, /personal/m/fitness/new, /personal/m/fitness/programs/*/edit
> **Order:** 20

You reach this screen three ways. After an import, it opens on the draft, titled `Review the draft`. From {button:Build one by hand|outline|plus} on the Workouts page, it opens empty, titled `Build a program`. From {button:Edit program|outline|pencil} on a program, it opens on that program, titled `Edit` and the program's name, with the line `Change anything; nothing is saved until Save program.` Whichever way you came, change what you need and click {button:Save program|primary}.

## What you see

- **The yellow note, on a draft only**: `Check it against the book. Nothing is saved until you press Save program.` Claude reads carefully, but a draft is a first reading, not the book.
- **A draft that is not ready opens without the editor.** While Claude is still reading it says `Still drafting. Reload this page in a minute.` A draft that failed shows the reason in red, with {button:Import again|outline}, which opens the import, and {button:Discard draft|outline}, which throws the draft away after asking.
- **`Name`.** The program's name. It is the one thing a program cannot be saved without.
- **`Written by`.** Who wrote it, if anybody. Leave it empty for your own.
- **`How the program works`.** The program's rules in a few sentences: how often, how hard, how to breathe, when to move on. It shows at the top of the program.
- **`Sessions a week`.** How many sessions a week the program asks for, as one number or a range: `3` to `4`. Leave the second box empty for a single number.
- **`Effort, out of 10`.** How hard the program says to work, on a scale of 1 to 10, as one number or a range. After each exercise in a session, this range is marked on the effort scale.
- **`Breathing pace, in seconds`.** How long to breathe out and how long to breathe in, for example `5` out, `5` in. The breath pacer in a session keeps this pace. Left empty, it uses 5 and 5. An import fills it in when the program states a pace.
- **`Side self-assessment`.** For a program with tests that find which side you lean to, and exercises it does on one side because of it. Most programs have none. Then the box reads `For a program with tests that say which side you lean to, and exercises done on one side because of it.`, with {button:Add a self-assessment|outline|plus}, which opens an empty one. An import fills it in when the PDF has one. With one:
  - **{button:Remove|ghost|trash}** takes the self-assessment out of the program.
  - **`The video that shows the tests`.** Paste the YouTube link to the program's video of the tests. The line under it says `plays here`, `only plays on YouTube` or `checked when you save`.
  - **`Tests`**, each in its own numbered box:
    - **The test's name**, in `Name of the test`.
    - **{icon:trash}** removes that test.
    - **The question**, what you compare on the two sides. Left empty, it asks `Which side went further?`.
    - **Which way it counts**: `Left further means you lean left`, for most tests, or `Left further means you lean right`, for a test the program counts the other way round. Copy this from the program's table. When you take the tests you say only which side went further, and the app counts it the right way.
  - **{button:Add a test|outline|plus}** adds a test at the end.
  - **`Tests that must agree`**, with `of 5` beside it: how many tests must point to the same side for it to be yours. With fewer, you do both sides.
  - **`What the program says about it`.** A sentence or two on what to do with the result.
- **The count line**, for example `4 phases · 14 exercises`.
- **Each phase**, in its own box:
  - **`Phase 1`** and its name, for example `Weeks 1–2`.
  - **{icon:chevron-up} and {icon:chevron-down}** move the phase up or down. **{icon:trash}** removes it and every exercise in it.
  - **`Days before moving on`.** How many days the program says to do this phase before starting the next. Leave it empty if it sets no rule.
  - **`Notes for this phase`.** Anything that applies to the whole phase.
  - **The exercises, in order.** Each row shows its number, its name, `(optional)` if it is optional, and what to do, for example `2 × 8 breaths per side`. Click a row to open it.
  - **{button:Add an exercise|outline|plus}.** Adds an empty exercise at the end of the phase and opens it.
- **An open exercise** has these fields:
  - **`Exercise`.** Its name.
  - **`What it is for`.** A sentence or two about why you do it.
  - **`Counted in`.** What a set is counted in: `reps`, `breaths`, `rolls` or `seconds`. Many mobility programs count breaths, not reps.
  - **`Sets`.** How many sets, as one number or a range: `2` to `3`.
  - **`Count`.** How many reps, breaths, rolls or seconds in each set, as one number or a range.
  - **`Per side`.** Tick it when the count is for each side.
  - **`Side, once yours is known`**, when `Per side` is ticked. What the program says to do once you know which side you lean to: `Both sides`, the default, `Only the side you lean toward` or `Only the side you lean away from`. Untick `Per side` and the exercise goes back to both sides.
  - **`That side is`**, when the exercise is done on one side. How the side is named, for an exercise done lying down: `The side`, `The side you lie on` or `The leg on top`. Under it, the words for someone who leans left, for example `Leaning left, a workout says: Lying on your left side.`
  - **`Optional`.** Tick it when the program says the exercise is extra.
  - **`How to know you are doing it right`.** The program's checks, one per line. They show under the exercise while you follow the program.
  - **`Videos`.** Each video has its own box. Paste a YouTube link into `Paste a YouTube link`. The line under it tells you what happens to it: `plays here`, `only plays on YouTube`, or `checked when you save`. From the second video on, `Name (optional)` names the video, for example `Alternative`. Leave it empty and the video's own title on YouTube is filled in when you save, for example `Inner Foot Roll`. The first video has no name box: it shows under the exercise's own name. `Start` and `End` play just part of the video, written as minutes and seconds like `0:42`. In a session, the demo goes round and round that part; see [Doing a session](workout.md). {icon:trash} removes a video. {button:Add a video|outline|plus} adds another. With no video, it reads `No video yet.`
  - **`Notes`.** Anything about this exercise you need while doing it: which side, when to move to a harder version, equipment.
  - **{button:Move up|ghost|chevron-up}, {button:Move down|ghost|chevron-down} and {button:Remove|ghost|trash}.** Move the exercise within its phase, or take it out.
- **{button:Add a phase|outline|plus}.** Adds an empty phase at the end.
- **`Fix these before saving:`.** Appears after you click {button:Save program|primary} if anything needs fixing, with up to eight things to fix. The first also shows as a message at the bottom of the screen.
- **`Delete this program`, when editing a saved program.** {button:Delete program|destructive} deletes it after asking. See below.
- **At the bottom of the screen:**
  - On a draft, {button:Discard draft|ghost} throws the draft away after asking.
  - Otherwise, {button:Cancel|ghost} leaves without saving.
  - {button:Save program|primary} saves and opens the program. It reads `Saving…` while it works.

## How to check a draft from your PDF

1. Read the note at the top, then go through the phases in order.
2. Open each exercise and compare it with the book: the sets, the count, what it is counted in, per side, the side, and the video.
3. If the draft has a `Side self-assessment`, compare each test with the program's table, above all which way it counts, and check `Tests that must agree`.
4. Fix anything that is wrong, and fill in anything the draft left empty.
5. Click {button:Save program|primary}. You see `Program saved. It is ready to follow.` and the program opens.

## How to build a program by hand

1. On the Workouts page, click {button:Build one by hand|outline|plus}.
2. Give the program a `Name`.
3. Name the first phase, and fill in its first exercise, which is already open.
4. Add the other exercises with {button:Add an exercise|outline|plus}, and more phases with {button:Add a phase|outline|plus}.
5. Click {button:Save program|primary}.

## How to change a saved program

1. Open the program and click {button:Edit program|outline|pencil}.
2. Change what you need. Everything you keep stays the same program, so nothing about it is lost.
3. Click {button:Save program|primary}. You see `Program saved`.

## How to add a side self-assessment by hand

1. Under `Side self-assessment`, click {button:Add a self-assessment|outline|plus}.
2. Paste the link to the video that shows the tests.
3. Give the first test its name, and choose which way it counts. Click {button:Add a test|outline|plus} for each of the others.
4. Fill in `Tests that must agree`.
5. Open each exercise the program does on one side. Tick `Per side` if it is not ticked, then choose `Side, once yours is known` and `That side is`.
6. Click {button:Save program|primary}.

For a program imported from a PDF, the PDF can fill this in for you. See [Reading the PDF again](read-again.md).

## How to delete a program

1. Open the program, click {button:Edit program|outline|pencil}, and scroll to `Delete this program`.
2. Click {button:Delete program|destructive}. You are asked `Delete` and the program's name. When you have done workouts with it, the question says how many go with it, for example `and the 12 workouts you have done with it`.
3. Click {button:Delete program|destructive} again to confirm, or {button:Keep it|ghost} to go back. You see `Program deleted` and the Workouts page opens.

## Messages

| Message | What it means |
| --- | --- |
| `Give the program a name.` | The `Name` box is empty. |
| `Add at least one phase.` | A program needs at least one phase. |
| `Weeks 1–2 has no exercises.` | A phase is empty. Add an exercise or remove the phase. |
| `Weeks 1–2, exercise 2 needs a name.` | An exercise has no name. |
| `Weeks 1–2, exercise 2: sets needs a number.` | `Sets` is empty. |
| `Weeks 1–2, exercise 2: count (to) must be a whole number.` | Something other than a whole number is in a box that takes one. |
| `Weeks 1–2, exercise 2: sets: the second number cannot be smaller than the first.` | A range runs backwards, like `3` to `2`. |
| `Weeks 1–2, exercise 2: That is not a link to one YouTube video.` | The link is not YouTube, or it is a playlist. Paste the link to the one video. |
| `Weeks 1–2, exercise 2: Write the start as minutes and seconds, like 0:42.` | `Start` or `End` could not be read. |
| `Weeks 1–2, exercise 2: a video's end must come after its start.` | `End` is before `Start`. |
| `Effort must be between 1 and 10.` | Effort is on a scale of 1 to 10. |
| `Breathing pace must be between 1 and 30.` | Each part of the pace is a number of seconds, from 1 to 30. |
| `Breathing out must be a whole number.` | Write the seconds as a whole number, like `5`. The same goes for breathing in. |
| `The self-assessment needs at least one test.` | Add a test, or remove the self-assessment. |
| `Self-assessment, test 2 needs a name.` | A test has no name. |
| `Self-assessment: tests that must agree needs a number.` | `Tests that must agree` is empty. |
| `Self-assessment: tests that must agree must be a whole number.` | Write it as a whole number, like `3`. |
| `Self-assessment: tests that must agree must be between 1 and 20.` | The number is 0, or too large. |
| `The self-assessment asks for 4 tests to agree but has 3 tests.` | More tests must agree than there are. Lower the number, or add the missing tests. |
| `Self-assessment: That is not a link to one YouTube video.` | The video link is not YouTube, or it is a playlist. Paste the link to the one video. |
| `This program changed since you opened it. Reload the page to see the latest, then make your change again.` | It was saved somewhere else, for example in another tab, after you opened it. Reload, then make your change again. |
| `That program is not here any more. It may have been deleted.` | The program was deleted after you opened it. |
| `The program could not be saved. Try again.` | Something went wrong. Click {button:Save program|primary} again. |
| `Still drafting. Reload this page in a minute.` | Claude has not finished the draft yet. |
| `The draft was interrupted before it finished. Discard it and import the PDF again.` | Drafting stopped part way and will not finish. Click {button:Discard draft|outline}, then {button:Import again|outline}. |
| `This draft could not be read. Import the PDF again.` | The saved draft cannot be opened any more. Click {button:Import again|outline}. |
| `Discard this draft?` | Asked before a draft is thrown away. Nothing from it is kept. |

## Not on this page

- **Moving an exercise to another phase.** Not built. Remove it from one phase and add it to the other.
- **Using one exercise in two programs.** Each program keeps its own exercises for now.
- **Uploading your own video.** Only YouTube links for now.
- **Taking the side self-assessment.** Not built yet. Until it is, a session has you do every exercise on both sides.

## Who can do what

Only you. Programs live in your personal space.
