# The week

> Everybody's hours for one week, day by day, who is on the clock right now, and the two ways to record time. This is the screen you use every day.
> **Route:** /dashboard/m/time
> **Order:** 110

Open **Time** {icon:clock} in the sidebar. You land on the week that today falls in.

There are two ways to record time here. Click {button:Start a clock|outline} when work is beginning and stop it when it ends, or click {button:Log time|primary} to write down hours that are already worked. Use whichever suits the job. To read another week, use {button:← Previous|ghost} and {button:Next →|ghost}.

## What you see

- **The heading.** `Time`, and under it how much was worked this week. When somebody was paid without working, a second figure follows it, like `4h paid but not worked`. Before anything is logged it reads `What everybody worked, week by week.`
- **{button:People|outline}.** Takes you to [People](people.md), where you add somebody new or change the day your week starts on.
- **{button:Pay period|outline}.** Takes you to [the pay period](pay-period.md), where the same hours are grouped the way you pay them.
- **{button:Start a clock|outline}.** Starts a running clock for somebody. Grayed out when everybody on the list is already on the clock.
- **{button:Log time|primary}.** Opens the box for writing down hours already worked. It is grayed out until at least one person is on the People list.
- **On the clock now.** A block above the week, and only there when at least one clock is running. It shows every running clock, longest first, whichever week you are reading, because a clock left going is today's problem. The heading counts the people. When your business rounds clocked time, the right of the heading says what to, like `Rounded to 15 minutes when stopped`.
- **A running clock.** One line per person: their name, `you` if it is yours, how long it has been running counting up, and the time it started. Past sixteen hours the figure turns red and the line says `Running over 16 hours. Correct when it started, or throw it away.` Nothing stops a clock on its own, because that would put hours on a timesheet that nobody worked.
- **The week bar.** The dates of the week you are reading, like `Sep 6 – Sep 12`. `This week` sits beside it when you are on the current one. {button:← Previous|ghost} and {button:Next →|ghost} move a week at a time, and there is no limit in either direction. When you have moved away, a {button:This week|outline} button appears on the right to bring you back.
- **Worked this week.** A list of each person and how their week breaks down, biggest first: `40h regular`, then `10h overtime` and `1h double time` when there are any. The rules being used are named on the right. It appears when two or more people worked, or whenever anybody has earned overtime. Paid leave and holiday are left out of these numbers, because they are not hours worked and never count toward overtime.
- **`4h before overtime`.** Sits on somebody's line once they are within eight hours of the weekly threshold. This is the point of showing a week rather than a fortnight: it is a decision you can still make on a Wednesday, not a number you read after payroll.
- **A day.** One block per day that has hours on it, newest first. The heading is the day, like `Fri, Sep 11`, with that day's total on the right. Days with nothing on them are left out, so a week with one busy Tuesday is one block and not seven.
- **A row.** One line per entry: who worked, how long, and what they did. When the hours were not worked, a badge says which kind, like {badge:Paid leave}. Worked hours carry no badge, since that is the ordinary case. `clock` at the end means the entry came from a clock rather than being typed; hover it to see what it was rounded to.
- **{button:Edit|ghost}.** At the end of each row. Opens the same box again, filled in, with a {button:Delete|destructive} button in it.

## How to log an hour

1. Click {button:Log time|primary}.
2. Pick the person under `Who`. If your own sign-in is linked to somebody on the People list, that person is already picked.
3. Type how long under `How long`. You can write it any of these ways, and the line underneath tells you what we understood before you save:

   | You type | We read | 
   | --- | --- |
   | `1:30` | 1 hour 30 minutes |
   | `1h30` or `1h 30m` | 1 hour 30 minutes |
   | `1.5` or `1.5h` | 1 hour 30 minutes |
   | `90m` or `90` | 90 minutes |
   | `2` | 2 hours |

   A plain number under 16 is read as hours and 16 or more as minutes, because nobody logs a sixteen hour day and everybody logs ninety minutes. Watch the line under the box and you never have to remember that.
4. Check `Day`. It starts on today and will not let you pick a day in the future.
5. Leave `Kind` on `Worked` unless these hours were not worked. The choices are `Worked`, `Paid leave`, `Holiday` and `Unpaid`. This matters more than it looks: when overtime arrives, only `Worked` hours will count toward it.
6. Type what they did under `What they did`. Up to 1000 characters, and you can leave it empty.
7. Click {button:Log time|primary}. You see `7h 30m logged` and the entry appears in the week.

## How to use the clock

1. Click {button:Start a clock|outline}.
2. Pick the person under `Who`. Anybody already on the clock is left out of the list, so you cannot start two clocks on one person.
3. Type what they are doing under `What they are doing`. You can leave it empty and add it later.
4. Click {button:Start|primary}. You see `Clock started` and the person appears under `On the clock now`.
5. When the work ends, click {button:Stop|primary} on their line. You see how much was logged.

Nothing is recorded until the clock stops. A running clock is not hours yet, which is why it does not appear in the week below.

What you see when you stop depends on your rounding setting, over on [People](people.md):

| Your setting | You worked | You see |
| --- | --- | --- |
| `To the minute` | 7 hours 53 minutes | `7h 53m logged` |
| `15 minutes` | 7 hours 53 minutes | `7h 53m worked, 8h logged after rounding.` |
| `15 minutes` | 5 minutes | `Clock stopped after 5m. Rounding to 15 minutes left nothing to log.` |

That last row is the setting working, not a fault. Rounding to the nearest quarter hour pays a full quarter for eight minutes and nothing for five, which is what makes it fair over a month. If you do not want that, set rounding to `To the minute`.

## How to fix a clock somebody forgot to start

1. Find the person under `On the clock now` and click {button:Fix start|ghost}.
2. Set `Started at` to when the work really began. It is your business's local time, not your computer's.
3. Click {button:Save|primary}. You see `Start time corrected` and the running total jumps to match.

You can only do this while the clock is running. Once it has stopped it is an ordinary entry in the week below, and you change it with {button:Edit|ghost}.

## How to throw a clock away

1. Click {button:Throw away|ghost} on the line.
2. You see `Clock thrown away. Nothing was logged.`

Use this when a clock was started on the wrong person or by accident. It leaves no record and no hours. There is no way to throw away a clock that has already stopped, because that one produced hours somebody may have been paid for.

## How to correct an entry

1. Find the row and click {button:Edit|ghost}.
2. Change anything you need. The box is the same one you logged it in, and the header tells you whose hours these are. When somebody else logged them, it says so too, like `Jo Okafor · logged by Sam`.
3. Click {button:Save|primary}. You see `Entry saved`.

To remove an entry instead, click {button:Delete|destructive} in the same box. You see `Entry deleted` and the row goes. Nothing warns you first, because right now nothing depends on the entry. That changes once weeks are approved.

## How to read another week

1. Click {button:← Previous|ghost} to go back a week, or {button:Next →|ghost} to go forward.
2. The heading totals and the day blocks all change with it.
3. Click {button:This week|outline} to come back to today.

The week you are reading is in the address bar, so you can send somebody a link to it.

## Messages

| Message | What it means |
| --- | --- |
| `Nobody can have time logged yet` | Nobody is on the People list. Click {button:Add someone|primary} to go and add the first person. |
| `A clock is running. Hours appear here once it stops.` | Nothing is logged in this week yet, but somebody is on the clock. |
| `They are already clocked in.` | That person has a clock running. Stop it before starting another. |
| `That clock has already stopped.` | Somebody stopped it while your page was open. Reload the page. |
| `A clock cannot start later than now.` | You set `Started at` to a time in the future. |
| `That clock has run for more than a day.` | A clock was left running over 24 hours. Correct when it started, then stop it. |
| `Clock thrown away. Nothing was logged.` | The running clock is gone and no hours were recorded. |
| `No hours this week` | Nothing was logged in the week you are reading. Log some, or move to another week. |
| `How long? Try 1:30, 1.5 or 90m.` | We could not read what you typed under `How long`. |
| `Not a length we can read.` | The same thing, under the box, while you are still typing. |
| `That day has not happened yet.` | The day you picked is in the future. |
| `One entry cannot be longer than a day.` | You asked for more than 24 hours in one entry. Split it across the days it covers. |
| `That person has left.` | Somebody marked this person as having left. Bring them back on [People](people.md) first. |
| `This entry changed while you were editing it.` | Somebody else saved this entry while your box was open. Reload the page and make your change again. |
| `no overtime` | That person's week was checked against your rules and stayed under every threshold. |
| `Accountant access is read-only.` | You are signed in as an accountant. You can read every hour and change nothing. |

## Why this screen is a week

Overtime is worked out for a **week**, and only for a week. That is true however often you are paid: if you pay fortnightly, the fortnight is two of these weeks and each is tested on its own. Somebody who works 30 hours one week and 50 the next has earned ten hours of overtime, even though the fortnight adds up to 80. This screen is the unit that decides it; [the pay period](pay-period.md) is the unit you pay.

Which day your week starts on is yours to set, on [People](people.md).

## Not on this page

You cannot say which part of the business an hour was spent on, or mark a week as finished. Neither is built. Ask us where it is up to.

Clocks live only on this screen for now, so somebody clocking themselves in has to open it. Starting a clock from a phone in one tap is coming.

## Who can do what

Owners and staff can log, change and delete hours for anybody. Accountants can read the week and nothing else. Only owners can add people or change the week start, both of which are on [People](people.md).
