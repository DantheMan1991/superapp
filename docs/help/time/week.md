# The week

> Everybody's hours for one week, day by day, and the box you log them in. This is the screen you use every day.
> **Route:** /dashboard/m/time
> **Order:** 110

Open **Time** {icon:clock} in the sidebar. You land on the week that today falls in. To add hours, click {button:Log time|primary}. To read another week, use {button:← Previous|ghost} and {button:Next →|ghost}.

## What you see

- **The heading.** `Time`, and under it how much was worked this week. When somebody was paid without working, a second figure follows it, like `4h paid but not worked`. Before anything is logged it reads `What everybody worked, week by week.`
- **{button:People|outline}.** Takes you to [People](people.md), where you add somebody new or change the day your week starts on.
- **{button:Log time|primary}.** Opens the box for adding hours. It is grayed out until at least one person is on the People list.
- **The week bar.** The dates of the week you are reading, like `Sep 6 – Sep 12`. `This week` sits beside it when you are on the current one. {button:← Previous|ghost} and {button:Next →|ghost} move a week at a time, and there is no limit in either direction. When you have moved away, a {button:This week|outline} button appears on the right to bring you back.
- **Worked this week.** A short list of each person and what they worked, biggest first. It only appears when two or more people worked, because with one person it would repeat the figure in the heading. Paid leave and holiday are left out of these numbers.
- **A day.** One block per day that has hours on it, newest first. The heading is the day, like `Fri, Sep 11`, with that day's total on the right. Days with nothing on them are left out, so a week with one busy Tuesday is one block and not seven.
- **A row.** One line per entry: who worked, how long, and what they did. When the hours were not worked, a badge says which kind, like {badge:Paid leave}. Worked hours carry no badge, since that is the ordinary case.
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
| `No hours this week` | Nothing was logged in the week you are reading. Log some, or move to another week. |
| `How long? Try 1:30, 1.5 or 90m.` | We could not read what you typed under `How long`. |
| `Not a length we can read.` | The same thing, under the box, while you are still typing. |
| `That day has not happened yet.` | The day you picked is in the future. |
| `One entry cannot be longer than a day.` | You asked for more than 24 hours in one entry. Split it across the days it covers. |
| `That person has left.` | Somebody marked this person as having left. Bring them back on [People](people.md) first. |
| `This entry changed while you were editing it.` | Somebody else saved this entry while your box was open. Reload the page and make your change again. |
| `Accountant access is read-only.` | You are signed in as an accountant. You can read every hour and change nothing. |

## Not on this page

You cannot clock in and out yet, say which part of the business an hour was spent on, mark a week as finished, or see overtime. None of that is built. Ask us where it is up to.

## Who can do what

Owners and staff can log, change and delete hours for anybody. Accountants can read the week and nothing else. Only owners can add people or change the week start, both of which are on [People](people.md).
