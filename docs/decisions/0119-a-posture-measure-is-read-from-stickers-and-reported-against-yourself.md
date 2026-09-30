# 0119 — A posture measure is read from stickers, against gravity, and reported against yourself

- **Date:** 2026-09-30
- **Status:** Accepted
- **Affects:** The posture check ([modules/posture.md](../modules/posture.md)):
  what it measures, how, and how its report and history word a result.

## Context

The founder wants knee valgus, hip tilt, head posture and shoulder posture
measured, and asked that nothing be left out to make it the best it can be.
The research behind the plan (the dossier cites it) found:

- A pose model's points are not bones. MediaPipe's are judged correct within
  about 10 cm; its knee valgus read 19° off a lab system, though the change
  from the start of a movement agreed within about 3°. A coloured sticker on
  the bone is found in the picture to a fraction of a millimetre.
- A picture is only as level as the camera. Chrome rounds the phone's tilt
  sensor to about 0.6° and a phone's accelerometer can be a degree out, the
  size of the asymmetries being measured. A plumb line in the picture is
  truly vertical, and two marks on it a metre apart give the scale.
- Even done well, re-measured on another day with the stickers put back on,
  the smallest real change is about 3.6° for shoulder level, 5° for head
  posture, 2.7° for standing knee alignment, and 8–10° for knee valgus in a
  single-leg squat. Side-to-side pelvic height is poor (ICC 0.37), and
  front-to-back pelvic tilt is partly bone shape (0 to 23° in cadavers held
  level).
- Healthy people are asymmetric (fewer than one in five healthy teenagers had
  level shoulders), and standing posture relates weakly or not at all to pain.
  No image-based posture measure has a validated clinically important
  difference.
- Every competitor's weakness is false precision: a global score that never
  moves, labels ("kyphosis", "spine age", "text neck"), thresholds presented
  as verdicts. Diagnostic wording is also what turns a fitness app into a
  medical device (FDA general wellness guidance, 2026; EU MDR Rule 11).

## Decision

**Where a measure depends on a bone, it is read from a sticker on that bone;
the pose model finds the person, frames the views, and says where to look for
each sticker. Every measure is taken against true vertical from the plumb line
(the phone's sensor only guides the levelling). A result is reported as plain
geometry against the person's own earlier checks, with its own noise, and a
change is called a change only when it is bigger than that noise. Nothing is
labelled normal, abnormal, a condition or a risk.**

- Twenty stickers: blue on the left side, green on the right, either on the
  midline. The colour, not the pose model, decides left and right, which a
  model can swap from behind.
- A measure's number is the median over a still hold, two rounds a check, and
  its noise is learned from the person's own repeats, starting from the
  published figures.
- Measures a photo cannot take reliably (leg length, spinal curves, shoulder
  blades, rotations, foot arches) are not shown at all, and pelvic height and
  tilt are marked "trend only".
- The report says what it is: how you stood that day, for fitness and body
  awareness, not a medical assessment.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| Markerless only, as every consumer app does | The model's points are centimetres off the bones; the measures would be the model's error |
| The phone's sensor as the vertical | Rounded to about 0.6° and possibly a degree out, the size of the signal |
| Norms and cut-offs ("forward head below 50°") | A fixed line flags a large share of healthy adults, and a threshold presented as a verdict is a medical claim |
| One posture score | Every benchmark that has one frustrates its users: it does not move when the parts do |
| Real 3D (two phones, a depth camera) | Adds cost and setup for rotations; the listed measures are defined in front and side views, and 3D does not see bones under skin either |

## Consequences

- The person has to buy stickers, place twenty of them (three with a helper)
  and hang a plumb line, and the setup takes minutes, not seconds. The setup
  check exists to make that reliable, and the next check will tell the person
  where a sticker sits against where it sat last time.
- Small asymmetries will read "within your noise" and not change for weeks.
  That is the truth, and the report says so rather than inventing movement.
- Sticker placement is now the largest error, and nobody has studied
  self-placed markers; the readout reports each one so this can be measured.

## Notes

The measure definitions, reference values and their sources are in the
dossier. Revisit the noise figures once the founder has a month of checks.
