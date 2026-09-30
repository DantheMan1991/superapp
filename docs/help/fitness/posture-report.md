# Reading your posture report

> What one posture check found: each view drawn from your stickers, every measure in plain words with how much it can be trusted and how it changed since an earlier check, what could not be measured and why, and your photos if you kept them.
> **Route:** /personal/m/fitness/posture/checks/*
> **Order:** 53

The report opens by itself when a check ends. To open it later, click the check's row under `Your checks` on the posture check page. The check's numbers are in your account, so its report opens on any device you sign in on. Its photos, if you kept them, show only on the phone that took them.

The report describes how you stood during that check. It is not a medical assessment, and it never calls a result normal or not. Most people are a little uneven, and how you stand says little on its own about pain. What matters is how a measure changes between your own checks, and the report tells you how big a change has to be before it is real.

## What you see

- **`Posture report`**, the title, with {icon:scan-line} and the line `How you stood, from one posture check.`
- **A line above the report** when your account does not have this check yet, and this phone does:
  - `Sending this check's numbers to your account.`, with a spinner, while it goes. The page reads your account again when it gets there;
  - `This check is on this phone only for now. It goes to your account when the phone is online.` when there is no connection. It goes by itself later;
  - or your account's reason, if it refused the check.
- **When the check was**, for example `Wednesday, Sep 30, 11:43 AM`. When it marked your workout program's start or a phase's end, a line with {icon:flag} says which, for example `End of Phase 1: Weeks 1-2, in Starter Mobility` or `Start of Starter Mobility`. See [Following a program](program.md#posture-checks-along-the-way). Under it, how many views it read (`All four views`, or `2 of 4 views`), how many rounds, and where true vertical came from: `Vertical from the plumb line, millimeters from its tape marks.` is the best there is.
- **A yellow box** when the plumb line was not used: `Without the plumb line, the angles against level can be off by about a degree, the size of what is being measured. Hang it where the camera sees it next time.`
- **On a repeat check**, a line saying which check it repeats: `A repeat of your check from 2:23 PM, with the stickers put back on. The differences between the two are your own measuring noise.`
- **`Repeat this check`**, a card, on a check taken today that is not itself a repeat and has not been repeated yet. It says what a repeat is: take every sticker off, put them back on, and check again today; the difference between the two is your own measuring noise, and after three repeats your own figures replace the published ones, higher or lower. Under it, `Repeats so far: 1 of 3.`, or once you have three, `Your own figures are in use, from 3 repeats. Another one makes them steadier.` {button:Start the repeat|outline} opens the check as a repeat of this one. See [Doing a posture check](posture-check.md).
- **`Compared with`**, a list of your checks taken before this one (repeats are left out). It starts on the check just before, marked `The check before`, and your very first is marked `Your first check`. A check that marked your workout program's start or a phase's end says so too, for example `Start of Starter Mobility, Sun, Sep 27, 11:00 AM`, so comparing one phase's end with the start is one choice. A repeat starts on the check it repeats. Choose `No comparison` to see this check on its own. The line under it says `A change is called real only when it is bigger than the measure's noise: the published figure, your own from three repeat checks, or your rounds when they vary more.`
  - **`Stickers against`** the compared check's day, for example `Stickers against Wed, Sep 30`: each sticker that sits 2 cm or more from its place on that check, with how far and which way, for example `Left shoulder tip` `3.5 cm lower`. Under the list, `The other 7 are within 2 cm of where they were.`, or `Every sticker is within 2 cm of where it was.` The small print says it is read against the pose model's points, so only a slip of 2 to 3 cm or more shows.
  - On your first check there is nothing to compare with, and the report says `This is your first check. Your next checks are compared with it, a measure at a time.`
- **The views**, a drawing of each view the check read, from the first round (or the second, when the first was skipped):
  - the stick figure the pose model found, in gray;
  - your stickers as dots: blue on your left side, green on your right, white on the middle;
  - a dashed line for true vertical, through your feet;
  - colored lines along which each measure was taken.
  
  Each drawing is as the camera saw you, so from the front your right side is on the left. It is turned so true vertical is straight up, even if the phone was a little crooked.
- **`Measured reliably`**, the measures a photo can take well. Each row shows:
  - the measure's name and {badge:Reliable|secondary};
  - the result in words, in large type, for example `Left shoulder lower by 1.9° (14 mm)`. Millimeters show when the plumb line's tape marks gave the scale;
  - when you are comparing, how it changed since the check chosen under `Compared with`. A tinted label says the change in the measure's own words when it is more than the noise, for example `Left side dropped 4.6° against the right`, or `Within your noise` when it is not. Under it, what that check said and what the change amounts to, for example `Was: Left shoulder lower by 1.9° (14 mm). More than the 3.6° a real change needs.` A change is never called better or worse: it is a change. When a sticker this measure is read from sat 2 cm or more from its place on that check, a yellow line says so, for example `The left shoulder tip sticker sat 3.5 cm lower than on Wed, Sep 30, so this change may be the sticker rather than you.`;
  - how your two rounds agreed, for example `Your two rounds agreed within 0.4°. A change of more than 3.6° between checks would be real.` The second sentence is the smallest change between two checks that is more than measuring noise. It is the published figure until your own checks give a better one:
    - after three repeat checks, the figure from your repeats, higher or lower than published, and the sentence ends `(your own figure, from 3 repeat checks)`;
    - before that, the figure from your rounds, but only when it is bigger than published, ending `(your own figure, from your rounds)`.
    
    When the rounds differ by more than a real change, the line is yellow: `Your two rounds differed by 5.0°, more than a real change: stand the same way each round.`;
  - a line of context, when the measure has one;
  - where it came from, for example `From the front and back, by your stickers.` `by the pose model's points (no sticker)` means a sticker was missing and the model stood in, which is less exact.

  The reliable measures:
  - `Shoulder level`, from the front and back: the two shoulder tip stickers against level. `Level`, or which shoulder is lower and by how much, for example `Right shoulder lower by 1.0° (6 mm)`. A real change is more than 3.6°. If a shoulder sticker is missing, the pose model's shoulder stands in and the measure moves to `Trend only`.
  - `Head over shoulders`, from the sides: the angle up from the base of your neck to your ear, against level, for example `47.9°`. Healthy adults in studies average about 49°. A lower number means the head sits further forward. A real change is more than 5°.
  - `Body line`, from the sides: your shoulder tip over your outer ankle bone, against vertical. `Upright`, `Leaning forward by 1.5°` or `Leaning back by 1.0°`. Healthy adults in studies lean about 1.5° forward. A real change is more than 2.9°.
  - `Right knee, standing` and `Left knee, standing`, from the front: the front hip bone, kneecap and front of the ankle. `Straight`, `Turns in by 4.1°` when the knee sits inside the line from hip to ankle, or `Turns out by 2.0°` when it sits outside. A real change is more than 2.7°.
- **`Trend only`**, measures that depend too much on exactly where a sticker went, or on the shape of your bones, to read as a value. Compare them only with your own earlier checks. Each row has the same parts, with {badge:Trend only|outline}:
  - `Front hip bones`, from the front: `Level`, or which front hip bone is lower, for example `Right front hip bone lower by 0.8° (3 mm)`. A real change is more than 5.8°.
  - `Low back dimples`, from the back, only with the plumb line's tape marks: `Level`, or which dimple is lower, for example `Left dimple lower by 4 mm`. Differences under about 2 cm cannot be told apart from where the stickers went.
  - `Pelvis tilt`, from the sides: the front hip bone against the low back dimple. `Level`, `Tipped forward by 8.1°` or `Tipped back by 2.0°`. Bone shape alone varies this by up to 11° between people. A real change is more than 8°.
  - `Head tilt`, from the front, by the pose model's ears: `Level`, or `Tilted to your left by 2.0°`. A real change is more than 3°.
  - `Trunk over hips`, from the front (breastbone over the middle of the front hip bones) and the back (base of the neck over the middle of the low back dimples): `Straight over your hips`, or `Shifted to your right by 2.7°`. A real change is more than 6.5°.
  - `Right shoulder, from the side` and `Left shoulder, from the side`: the shoulder tip against the line from the side hip bone up to the ear. `On the line`, `Ahead of the line by 6.0°` or `Behind the line by 2.0°`. A real change is more than 8°.
  - `Right knee, from the side` and `Left knee, from the side`: the side hip bone, outer knee and outer ankle bone. `Straight`, `Bends back 3.0°` when the knee sits behind the line from hip to ankle, or `Stays bent 2.0°`. A real change is more than 12.7°.
- **`Not measured this time`**, each measure the check could not take, with why. For example `The right side or left side view was not captured.` when those views were skipped, or `Needs both shoulder tip stickers, from the front or the back.` when stickers were missing. Put the sticker back on, or check it in [Checking your setup](posture-setup.md), before the next check.
- **`Along the way`**, what happened during the check that affects the report, when anything did:
  - `This phone reports no tilt, so the level was not checked.`;
  - `The phone was not level: turned 2.1°, tipped 0.3°.`, when you tapped {button:Continue anyway|outline};
  - `The plumb line's tape marks were not seen, so there are no millimeters.`;
  - `No plumb line: true vertical came from the phone's own level, and there are no millimeters.`;
  - `The phone moved during the check; the plumb line was found again.`, or `The phone moved during the check and the plumb line was not found again: later views use the phone's own level.`;
  - a view that was not read, for example `Back, round 2: skipped.`, `Left side, round 1: no steady picture in time.` or `Right side, round 2: not taken, the check was finished early.`;
  - a photo that was not kept, for example `The front photo was not kept: the phone took too long.`, or `Photos could not be kept on this phone: ...`;
  - `Something went wrong reading the pictures: ...`, when the pose model reported a problem;
  - a sticker the check stopped for, and what happened: `Not where last time's were: Left shoulder tip (3.5 cm lower). Kept as they were, as you said.` when you tapped {button:It's where it should be|outline}, `... Nobody moved to them, so they were kept as they were.` when nobody did, or `Still not where last time's were after a second look: ...` when it read the view again and the sticker was still off.
- **`Photos on this phone`**, only on the phone that took the check, when it kept photos and they are still there. It says how many, kept only in this browser on this phone, never uploaded.
  - {button:Show the photos|outline|eye} shows them, one for each view. In the Yosher app, screenshots are blocked while they show. {button:Hide the photos|outline|eye-off} hides them again.
  - `Show the lines`, a switch, on at first: draws true vertical through your feet as a dashed white line, the measures' lines in orange, and a dot on each sticker the check found. Turn it off to see the photo on its own.
  - Tap a photo to make it bigger, and again to make it smaller.
  - {button:Delete the photos|ghost|trash} asks `Delete this check's photos?` and says `They are gone from this phone for good. The check's numbers and its report stay.` Click {button:Delete the photos|destructive} to delete them, or {button:Keep them|ghost}.
- **A note**: `This describes how you stood during this check, for fitness and body awareness. It is not a medical assessment. Most people are a little uneven, and how you stand says little on its own about pain.`
- **{button:Copy the numbers|primary|copy}** copies the report as text, and reads `Copied`. The text has each measure's words and each round's value, what was not measured, what happened along the way, and a list of each view's numbers for tuning: which stickers were found, how still you were, and the scale. No picture of you is in it. Paste it to a trainer or a physiotherapist, or send it to us.
- **{button:Back to the posture check|outline}** goes back to the posture check page.
- **{button:Delete this check|ghost|trash}** asks `Delete this check?` and says `Its numbers go from your account and from this phone. This cannot be undone.`, with `, and its photos with them` when this phone kept photos of it. Click {button:Delete this check|destructive} to delete it and go back to the posture check page, or {button:Keep it|ghost}. Another phone that kept a copy forgets it too, the next time its posture check page opens.

## How to see what changed

1. Open the report of your latest check.
2. Under `Compared with`, choose the check to compare with: the one before, your first, or any other.
3. Read each measure's label. `Within your noise` means the two checks cannot be told apart for that measure. That is the honest answer, and it is common for weeks at a time.
4. A label in the measure's own words, like `Left side dropped 4.6° against the right`, is a change bigger than measuring noise.

Put the stickers on the same way each time, and stand in the same outline with the phone at the same height and distance. Most of the noise is where a sticker went.

## How to see what a phase of your program changed

1. Take the check your program asks for at the end of the phase. See [Following a program](program.md#posture-checks-along-the-way).
2. Open its report. The line under the date says `End of Phase 1: Weeks 1-2, in Starter Mobility`.
3. Under `Compared with`, choose the check that marked the start (`Start of Starter Mobility`) to see the whole way so far, or the end of the phase before to see this phase alone.
4. Read each measure's label, as above.

## How to learn your own noise

1. Take a check as usual.
2. On its report, the same day, click {button:Start the repeat|outline} under `Repeat this check`.
3. Take every sticker off, then put them back on the way you usually do.
4. Tap {button:Start|primary} and do the check again.
5. The repeat's report opens, compared with the check it repeats. The differences are your own measuring noise.
6. After three repeats, every report holds a change to your own figures instead of the published ones. Repeats on different days give a truer figure, and each further one makes it steadier.

## Messages

| Message | What it means |
| --- | --- |
| `This check is not here` | Your account does not have this check, and this phone does not either. It may still be on the phone that took it, waiting for a connection, or it was deleted. |
| `Opening the check` | The report is being read from this phone's storage. |
| `Sending this check's numbers to your account.` | This phone has the check and is sending it. The page reads your account again when it arrives. |
| `This check is on this phone only for now. It goes to your account when the phone is online.` | There is no connection. The check goes by itself the next time the posture check page opens online. |
| `This phone is offline. Delete the check when it is back online.` | A delete needs your account, so nothing was deleted. Try again with a connection. |
| `The check could not be deleted just now. Try again.` | Your account did not answer. Nothing was deleted. |
| `Copied` | The numbers are on your clipboard. Paste them where you like. |

## Not on this page

- **A repeat of a check from another day.** A repeat has to be the same day, so the only difference is where the stickers went.
- **Photos on another device.** They stay on the phone that took them.
- **A score or a verdict.** The report never adds measures into one number, and never says a result is good or bad.

## Who can do what

Only you. The posture check is part of Workouts, in your personal space, and nobody else can open it. If someone else signs in to Yosher in the same browser on your phone, they do not see your checks or photos.
