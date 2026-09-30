# Doing a posture check

> Measure how you stand from all four sides, twice, with the coach's voice telling you when to turn. About three minutes. Your report opens when it is done.
> **Route:** /personal/m/fitness/posture/check
> **Order:** 52

Open the posture check and click {button:Start a posture check|primary}. The screen goes dark and fills the phone, because the phone will be on its tripod and you three meters away, listening to it. Run [Checking your setup](posture-setup.md) on this phone first: it finds the main lens and proves your stickers can be seen.

Nothing the camera sees leaves your phone. Once you are in the picture, the screen covers the camera's image with a stick figure. The check keeps numbers: where each sticker was, and the angles from them. When it ends, the numbers go to your account, so every device you sign in on shows the check. It keeps a photo of each view only if you turn that on, and only on this phone. In the Yosher app (version 1.0.8 or later), screenshots and screen recordings are blocked while the camera is on.

## What you see

- **`Posture check`**, the title, and {icon:x} at the top right, which closes the check and takes you back to the posture check page. Closing it before the end keeps nothing: the numbers so far and any photo it took are deleted.
- **Before you start:**
  - a short dark box reading `The camera starts when you tap Start.`;
  - `This phone has not run the setup check yet. Check your setup first: it finds the main lens and proves the stickers can be seen.`, only on a phone that has never run the setup check. The words `Check your setup` open it;
  - four steps: the phone on its tripod at hip height, 3 to 3.5 m from your foot outline, with the plumb line beside the outline; your stickers on and the sound up; tap Start and stay by the phone until the voice sends you to your outline; then face the phone and turn when you are told, front, right side, back, left side, twice;
  - **`Keep a photo of each view on this phone`**, a switch. It is off until you turn it on, and the phone remembers your choice for next time. When it is on, the check keeps one photo from each side, from the first round, in this browser on this phone only. They are never uploaded and never put in your gallery. Clearing the site's data in your browser removes them, and the phone may too if it runs short of space;
  - {button:Start|primary}, which starts the camera and the check.
- **The four views**, `Front`, `Right`, `Back` and `Left`, with `Round 1 of 2` or `Round 2 of 2` beside them. The view being read now is highlighted. A view that is done shows {icon:check}. A view you skipped is crossed out.
- **The picture.** What the camera sees, with the check's drawing over it: the plumb line it found in teal, a stick figure of you, each sticker it found as a dot in the sticker's color, and a dashed circle where it looked for a sticker and found none. Once you are in the picture, the camera's image is covered by the drawing on a dark background. {button:Show the camera|outline|eye} shows the image again, and {button:Hide the camera|outline|eye-off} covers it.
- **What the coach said**, in large type: the last thing the voice told you, so anyone looking at the phone knows what it is waiting for. Every line is in Messages below.
- **The progress bar**, while a view is being read. Above it, the view's name and `Waiting for you to be framed and still` until you are in the picture, facing the right way and still. Then `Reading 1 of 12` up to `Reading 12 of 12` as it reads twelve still pictures. When it has twelve, the coach says `Got it.`
- **What the phone is doing**, with a spinner, while it gets ready: `Starting the camera`, then `Letting the color settle`, and the first time on a phone `Loading the pose model: about 30 MB, the first time on this phone`. At the end, `Saving the numbers`, while the check is kept on this phone and sent to your account. With no connection it is sent later, by itself.
- **Chips** under it:
  - `Level · turned 0.4° · tipped 1.2°`, or `Not level · turned 2.1° · tipped 0.3°`, only when the phone was not level at the start. Turn the phone on its tripod until it reads `Level`;
  - `Finding the plumb line`, while it looks for it;
  - `Plumb line found, with its meter marks` once it has found it and the two pieces of tape. `Plumb line found, no meter marks` when it cannot see the tape, so the report has no millimeters. `No plumb line: the phone's level stands in` when there is none in the picture;
  - `Loading the pose model`, the first time on a phone, while it downloads;
  - `Stickers 8 of 9`, how many of this view's stickers it can see right now.
- **Buttons**, when the check is waiting on you:
  - {button:Continue anyway|outline}, while the phone is not level. The check goes on, and the report says the phone was not level;
  - {button:Go on without it|outline}, while it looks for the plumb line. The phone's own level stands in, which is less exact: the report says so;
  - {button:Skip the front|outline}, and the same for each side, while a view is waiting for you. That view is not measured in this round;
  - {button:Finish with what's done|outline}, once at least one view is done. The check stops and the report opens with what it has.
- **A yellow box**, when something went wrong that the check carries on past. See Messages.
- **A red box**, when the check cannot go on, with {button:Back to the posture check|outline}. See Messages.

## How to do a posture check

1. Put your stickers on and hang the plumb line beside your foot outline. Put the phone on its tripod with the camera on its back facing the outline. Turn the sound up.
2. Decide whether to keep photos, and set `Keep a photo of each view on this phone`.
3. Tap {button:Start|primary}. Allow the camera the first time your phone asks.
4. Stay by the phone. The voice says `Stay by the phone for a moment while I get ready.` while it settles the color, checks the level and finds the plumb line. The first time on a phone it also downloads the pose model, about 30 MB, so use Wi-Fi. If it says `The phone isn't level. Turn it on its tripod until the screen says it is.`, turn the phone until the chip reads `Level`.
5. When the voice says `Walk to your foot outline and face the phone.`, stand in the outline. Arms relaxed at your sides, weight on both feet, looking straight ahead.
6. Stand still when it says `Hold still.` It reads twelve still pictures, a few seconds, then says `Got it.`
7. Turn when it tells you: `Now turn so your right side faces the phone.`, then your back, then your left side. Stay in the outline as you turn.
8. After the left side it says `Round two. Step off your outline and shake out, then step back on and face the phone.` Step off, shake out your arms and legs, and step back on. The four views are read again. The difference between the two rounds tells you how much your own stance varies.
9. When it says `That's the check done. You can come back to the phone.`, your report is open. See [Reading your posture report](posture-report.md).

## How to stop early

- To keep what is done so far, tap {button:Finish with what's done|outline}. The report opens with the views that were read.
- To throw the check away, tap {icon:x}. Nothing is kept, not even the photos it took.

## Messages

| Message | What it means |
| --- | --- |
| `Stay by the phone for a moment while I get ready.` | The check is starting the camera, settling its color, checking the level and finding the plumb line. Stay out of the picture. |
| `The phone isn't level. Turn it on its tripod until the screen says it is.` | The phone leans more than a degree to the side, or two forward or back. Turn it until the chip reads `Level`, or tap {button:Continue anyway|outline}. |
| `Finding the plumb line.` | The check is looking for the plumb line. It gives up after about 20 seconds, or when you tap {button:Go on without it|outline}. |
| `I can't find the plumb line, so I'll use the phone's own level.` | There is no plumb line in the picture, or it is too faint. The check goes on, with the phone's own sense of level, which can be a degree out. |
| `Walk to your foot outline and face the phone.` | The check is ready for you. |
| `Step back a little.` / `Step a little closer.` | You fill too much, or too little, of the picture. |
| `Move a little to your left.` / `Move a little to your right.` / `Move a little forward.` / `Move a little back.` | Part of you is off the side of the picture. Move the way it says, then stand still. |
| `I can't see your feet.` / `I can't see the top of your head.` | Part of you is out of the picture. Step back, or ask for the phone to be moved. |
| `I've lost you. Come back into the picture.` | The check cannot see anyone. |
| `I can see more than one person. Only you in the picture.` | Someone else is in the picture. The check waits until they leave it. |
| `Not quite. Check which way you're facing.` | You are facing a different way from the view it wants. Turn as the last instruction said. |
| `Hold still.` | You are in place: stay still while it reads. It starts again if you move. |
| `Got it.` | This view is done. |
| `I can't find the right kneecap sticker.` | Said after a first-round view, by name, for up to two stickers it could not see, so you can press one back on before the second round. The report shows which measures a missing sticker stopped. |
| `Now turn so your right side faces the phone.` / `Now turn so your back faces the phone.` / `Now turn so your left side faces the phone.` | Turn in your outline to the next view. |
| `Round two. Step off your outline and shake out, then step back on and face the phone.` | The second round starts from a fresh stance. |
| `The phone has moved. Hold on while I find the plumb line again.` | The phone's level changed by more than a degree, so the tripod was probably knocked. The check finds the plumb line again before it goes on, and the report says so. |
| `That's the check done. You can come back to the phone.` | The report is open on the phone. |
| `No view was held still long enough, so there is nothing to report. Check your setup, then try again.` | Every view was skipped, or you were never framed and still for long enough. Run [Checking your setup](posture-setup.md) to see why. |
| `This check could not be kept on this phone or in your account (...). Copy its numbers now: they are gone when you leave this page.` | The browser would not store the check (often a private window), and it could not reach your account either. The report shows anyway: tap {button:Copy the numbers|primary|copy} before you leave. When only this phone could not keep it, the check goes straight to your account instead and its report opens as usual. |
| `The pose model could not start on this phone: ...` | The part of the check that finds you in the picture failed to load. Close the check and start again. If it happens again, run the setup check and send us its readout. |
| `Reading a picture went wrong: ...` | One picture could not be read. The check carries on with the next. |
| `The part of the check that reads the pictures stopped: ...` | The check cannot read pictures any more. Close it and start again. |
| `This version of the app cannot use the camera. Update the app, or open yosherapp.com in Chrome.` | Your Yosher app is older than version 1.0.8. Install the newer app, or use Chrome meanwhile. |
| `The camera was not allowed. Allow it for Yosher in your phone's settings, under Apps, Yosher, Permissions, then try again.` | In the Yosher app, you said no to the camera. Allow Camera in your phone's Settings and start again. |
| `The camera was not allowed. Allow it for this site in Chrome's settings, then try again.` | You said no to the camera, or Chrome has it blocked. Allow it in Chrome's site settings and start again. |
| `This browser cannot use the camera.` | The browser has no camera support. Use Chrome. |
| `No camera that faces away from the screen was found.` | The phone reported no camera on its back. |
| `The camera gave no picture.` | The camera opened but sent nothing. Close any other app using the camera and start again. |

## Not on this page

- **Movement.** Squats, standing on one leg and arms overhead come in a later update.
- **Feedback during a workout.** The check is for standing still. Live cues while you train come later.
- **A photo when the switch is off.** Nothing is kept but numbers. Turn `Keep a photo of each view on this phone` on before you tap {button:Start|primary}.

## Who can do what

Only you. The posture check is part of Workouts, in your personal space, and nobody else can open it.
