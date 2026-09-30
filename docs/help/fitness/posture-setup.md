# Checking your setup

> Prove, on your own phone, everything the posture check needs: the camera and its locks, the level, the plumb line, you from all four sides with your stickers, and how fast the pose model runs. It ends with a readout of numbers to copy and send.
> **Route:** /personal/m/fitness/posture/setup
> **Order:** 51

Open the posture check and click {button:Check your setup|primary}. The screen goes dark and fills the phone, because the phone will be on its tripod and you three meters away, listening to it. Run it before your first check, and again whenever the phone, the room or the stickers change.

Nothing the camera sees leaves your phone. Once you are in the picture, the screen covers the camera's image with a stick figure, so anyone who picks up the phone sees the figure, not you. In the Yosher app (version 1.0.8 or later), screenshots and screen recordings are blocked while the camera is on, and the app switcher shows a blank card. In Chrome, nothing a page can do blocks a screenshot. The camera switches off as soon as the check is done.

## What you see

- **`Check your setup`**, the title, and {icon:x} at the top right, which closes the check and takes you back to the posture check page.
- **The picture.** Before you start, it says `The camera starts when you tap Start.` Once the camera is on, you see what it sees, with the check's drawing over it:
  - the plumb line it found, in teal;
  - a stick figure of you from the pose model;
  - each sticker it found, as a dot in the sticker's color;
  - a dashed circle where it looked for a sticker and found none.
- **{button:Hide the camera|outline|eye-off}** covers the camera's image with the drawing on a dark background. Once you are in the picture this happens by itself, and the button reads {button:Show the camera|outline|eye}, which shows the image again.
- **Before you start**, four steps and {button:Start|primary}:
  1. Stand the phone upright on its tripod, at hip height, 3 to 3.5 m from your foot outline.
  2. Hang the plumb line beside the outline, so it runs from the top of the picture to the bottom.
  3. Put your stickers on. Turn the sound up.
  4. Tap Start, then follow the voice.
- **The instruction**, in large type once you start: what to do now. The coach says the same out loud, and more: see Messages below.
- **A button to move on**, when a step is waiting on you: {button:Continue anyway|outline} at the level, {button:Skip the plumb line|outline}, {button:Skip the front|outline} and the same for each side, and {button:Skip the timing|outline}. A skipped step shows `Skipped` or `Check`, and the readout says so.
- **The steps**, one row each, with what the check found and where it stands: `Waiting`, `Checking`, `Ready`, `Check` (something to look at), or `Skipped`.
  - **`Camera`.** Which camera it chose and the size of its picture, for example `camera 0, facing back · 2160 × 3840`. It always chooses the main lens, never the wide-angle one, and remembers it on this phone.
  - **`Focus and color`.** Whether it could hold the camera's color, focus and brightness steady, for example `Locked: color, focus`, or `This camera would not lock`.
  - **`Level`.** How far the phone leans, live, for example `Roll 0.4° · tilt 1.2°`. Turn the phone on its tripod until both are under a degree or two: the row reads `Ready` once it has stayed there a moment. `This phone reports no tilt` when the phone has no sensor for it.
  - **`Plumb line`.** For example `Found · picture turned -0.12° · 1 m = 891 px`: how far the whole picture is turned, which every measure is corrected by, and the scale from your two tape marks. `Found · no meter marks` when it cannot see the tape. `Not found: the phone's sensor stands in` when there is no plumb line in the picture.
  - **`You, head to toe`.** How much of the picture you fill, for example `Fills 46% of the picture`, once all of you is in it. `Not seen head to toe` when it never saw you whole.
  - **`Stickers`.** Each side's count as it goes, for example `Front 9 of 9 · Right 8 of 8 · Back 5 of 5 · Left 7 of 8`. A side you skipped reads `skipped`, and one where you never held still reads `no steady picture`.
  - **`Pose model`.** How long the pose model takes on this phone, for example `0.24 s a frame on the processor`. It times three versions, and tries the phone's graphics chip too, which it uses only if the chip gets the same answers and is faster.
- **When it is done**, {button:Copy the readout|primary|copy} copies the readout, and reads `Copied`. The readout is numbers only: the phone, the camera, the level, the plumb line, the stickers and the model's speed. No picture of you is in it. {button:Back to the posture check|outline} goes back.

## How to check your setup

1. Put the phone on its tripod with the camera on its back facing your foot outline. Open the check and tap {button:Start|primary}.
2. Allow the camera when your phone asks.
3. Wait while the color settles. Then turn the phone on the tripod until `Level` reads `Ready`.
4. Make sure the plumb line runs through the whole picture. `Plumb line` reads `Ready` when it has found it and the tape marks.
5. Walk to your foot outline and face the phone. The coach tells you if you need to move, and says `Hold still.` when it starts reading.
6. When it says `Got it.`, turn as it asks: your right side to the phone, then your back, then your left side. It says any sticker it cannot find by name.
7. Stay where you are while it times the pose model, about half a minute.
8. When it says `Setup check done. You can come back to the phone.`, go back to the phone and tap {button:Copy the readout|primary|copy}. Send the readout to us.

## Messages

| Message | What it means |
| --- | --- |
| `Allow the camera when your phone asks.` | The check is asking for the camera. Tap Allow. |
| `This version of the app cannot use the camera. Update the app, or open yosherapp.com in Chrome.` | Your Yosher app is older than version 1.0.8, which is the first that can use the camera. Install the newer app, or use Chrome on the phone meanwhile. |
| `The camera was not allowed. Allow it for Yosher in your phone's settings, under Apps, Yosher, Permissions, then try again.` | In the Yosher app, you said no to the camera. Open your phone's Settings, then Apps, Yosher, Permissions, allow Camera, and start again. |
| `The camera was not allowed. Allow it for this site in Chrome's settings, then try again.` | You said no to the camera, or Chrome has it blocked. Allow it in Chrome's site settings and start again. |
| `This browser cannot use the camera.` | The browser has no camera support. Use Chrome. |
| `No camera that faces away from the screen was found.` | The phone reported no camera on its back. |
| `The camera gave no picture.` | The camera opened but sent nothing. Close the check, close any other app using the camera, and start again. |
| `Point the phone at your foot outline. Hold on while the color settles.` | The camera is settling its color and brightness before holding them steady. Wait a few seconds. |
| `Turn the phone on its tripod until it reads level: under a degree each way.` | Adjust the tripod until `Level` reads `Ready`, or tap {button:Continue anyway|outline}. |
| `Hang the plumb line beside your foot outline, in the picture from top to bottom.` | The check is looking for the plumb line. `Plumb line` reads `Ready` when it has it. |
| `Stay there while I time the pose model. It takes about half a minute.` | Stand where you are while it times the model on this phone. |
| `Done. Copy the readout and send it over, then come back for the check itself.` | The check has finished. Tap {button:Copy the readout|primary|copy}. |
| `The part of the check that reads the pictures stopped: …` | The part that reads the pictures crashed. Close the check and start it again, and send us the readout if it happens twice. |
| `The pose model could not start on this phone: …` | The part that finds you could not load, often a lost connection while it downloaded. Close the check and start it again. |
| `Reading a picture went wrong: …` | One picture could not be read. The check carries on. If it keeps showing, send us the readout. |
| `Walk to your foot outline and face the phone.` | Spoken. Go and stand in your outline, facing the phone. |
| `Step back a little.` or `Step a little closer.` | Spoken. You are too big or too small in the picture. |
| `Move a little to your left.` (or right, forward, back) | Spoken. Part of you is out of the picture on one side. |
| `I can't see your feet.` or `I can't see the top of your head.` | Spoken. Move so the whole of you is in the picture, or lower or raise the phone. |
| `I can see more than one person. Only you in the picture.` | Spoken. Someone else is in view. |
| `I've lost you. Come back into the picture.` | Spoken. The check cannot see you. |
| `Hold still.` | Spoken. It is reading your stickers. Stay still until it says `Got it.` |
| `Not quite. Check which way you're facing.` | Spoken. You are facing a different way from the one it asked for. |
| `I can't find the right front hip bone sticker.` | Spoken, one for each sticker it cannot find, three at most. Check the sticker is on, and is on the bone the page shows. |
| `Every sticker I looked for is there.` | Spoken. All the stickers for that side were found. |

## Not on this page

- **The measuring itself.** This checks the setup; the check with its report comes in the next update.
- **Saving anything.** Nothing goes to your account. The phone keeps which camera it chose, how far its tilt sensor was off, and the last readout, which you can copy again from the posture check page.
- **A picture of you.** Never kept, never sent.

## Who can do what

Only you. The posture check is part of Workouts, in your personal space, and nobody else can open it.
