# 0116 — A workout reminder is the day's unfinished sets, pushed at the hour the person chose

- **Date:** 2026-09-28
- **Status:** Accepted
- **Affects:** Workouts ([modules/fitness.md](../modules/fitness.md), F4a):
  `fitness_reminders` (`drizzle/0430`, RLS `0431`), `core/reminders.ts`,
  `reminder-ops.ts`, the cron `/api/cron/fitness-reminders`, the program
  page's Reminders card. Notifications ([modules/notifications.md](../modules/notifications.md)):
  a second push sender beside the digest (`push-core.ts`, `push.ts`). The
  personal space's door ([modules/personal-space.md](../modules/personal-space.md)):
  `?next=`.

## Context

The founder's program lets a day's sets be split between the morning and the
evening, and the plan for F4 promised reminders at times he chooses. He chose,
from a mockup on 2026-09-28, a morning and an evening time, each on or off,
sent as a push to the Yosher app on his phone, and **a day whose sets are done
is skipped**.

The notifications design says push is the daily digest's second channel, not a
stream of events: one notification per person per workspace per day, at the
digest's hour, carrying obligations that are worked out live and clear
themselves when the work is done. A workout reminder is that kind of thing:
what today still needs, gone once it is done. But it wants the person's hour
(7:30 in the evening), not the digest's 7 in the morning, and it is about one
thing.

Push reaches Android phones today (FCM). iPhone waits on the Apple account, and
nothing pushes to a browser.

## Decision

**A reminder is a time of day on the space's clock, per program: a morning and
an evening, each on or off. Every ten minutes a cron takes each reminder whose
time has come, once a day, works out the day from the sessions that have
reached the server, and pushes only when the day's sets are not done.**

- The time is kept in tens of minutes, the cron's step. A reminder goes within
  an hour of its time or not that day: a cron that was down does not send the
  morning's at lunch.
- The cron claims a reminder (its `last_handled_on` moved to the space's
  today) before it sends, under withTenant, so overlapping runs send it once;
  the one read across spaces that finds the work is under withSystem, as the
  digest's is. A run that dies between the claim and the send loses that
  reminder rather than sending it twice.
- The day is the phase of the last workout, added up with the same
  `dayProgress` a split day uses: `Today's workout` with the whole day, or `The
  rest of today` with the sets left, or nothing when the day is done.
- It goes through the digest's sender to the person's phones, **without a
  badge**: the count on the icon is the digest's, and a reminder is not one of
  its items. A new `sender` label names it in the audit line when a phone is
  found gone.
- The tap opens the program through the personal space's door,
  `/personal/open?next=…`, because the phone may be in the business when it is
  tapped. The door takes only a plain path inside the space
  (`doorDestination`).
- Saving a time already gone today starts it tomorrow, so a reminder never
  goes off the moment it is set.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| A line in the daily digest (the plan's words) | The digest goes at 7 in the morning and is an email first. A personal space's digest would be a second morning email about one thing, and it cannot be at the evening half's hour |
| An event per reminder, stored and marked read | Cannot clear itself: the notifications design's first rule |
| Every day at the times, done or not | Nags about work already done. His call was to skip a done day |
| Also quiet for the week once its 3–4 sessions are done | Offered; he chose only the day rule. The program says more is better |
| Ask the provider to schedule each push | Neither FCM nor APNs schedules a send. A cron is how this codebase does timed work (`social-due`) |
| A time per person rather than per program | A program is what has halves to remind about. A person following two programs sets each |

## Consequences

- A reminder can never nag about a done day, and goes at most once a slot a
  day. It is derived like every digest item: nothing about the day is stored.
- **Cost:** a morning's workout done with no signal is not counted until it is
  sent, so the evening's reminder may say more sets are left than there are.
- **Cost:** push now has a second trigger outside the digest's run. The
  notifications dossier records it, and the rule a new one must meet: what is
  still owed, cleared by doing it, at most once a day per thing.
- **Cost:** a lost reminder on a crash between claim and send, by design.
- **Cost:** no reminder reaches an iPhone until APNs is set up, or a person
  without the app; the card says when no phone is registered.
- The door gained `?next=`, strictly checked; anything else still lands home.

## Notes

What would make us revisit: reminders anybody finds nagging even with the
done-day rule (then the week rule he was offered), a second personal tool that
wants timed pushes (then the cron's shape becomes a shared seam), or web push,
which would let a reminder reach a computer.
