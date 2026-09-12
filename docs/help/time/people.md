# People

> Everybody whose hours this business keeps, and the four settings behind every figure in Time: the day your week runs from, what clocked time is rounded to, how often people are paid, and which overtime rules you follow. Owners work here; everybody else can read it.
> **Route:** /dashboard/m/time/people
> **Order:** 120

Open **Time** {icon:clock} in the sidebar, then click {button:People|outline}. Add somebody with {button:Add someone|primary}. Nobody has to be able to sign in to be on this list, which is the point of it: a seasonal hand, a subcontractor or anybody who never opens the app all belong here.

## What you see

- **The list.** One line per person, active people first and then alphabetically. Somebody who has left is grayed out with a line through their name, and they stay on the list because their past hours are still yours to keep.
- **The sign-in picker.** The second thing on each line. It says `No sign-in` for somebody who does not use the app, or the name of the person's account. Changing it saves immediately and you see `Saved`.
- **{button:Has left|ghost}.** Marks somebody as having left. They stop being offered when you log time and their past hours stay exactly where they are. The button then reads {button:Bring back|ghost}.
- **{button:Add someone|primary}.** Opens the box for adding a person. Owners only.
- **{button:Time|outline}.** Takes you back to the week.
- **Your week starts on.** A picker at the bottom left, from `Sunday` to `Saturday`. This is not just how the page looks. It is the day your week runs from, so it decides which week an hour falls in, and when overtime arrives it will decide that too. Pick the day your business actually counts from.
- **Round clocked time to.** A picker beside it: `To the minute`, `5 minutes`, `6 minutes (a tenth of an hour)`, `10 minutes`, `15 minutes (a quarter hour)` or `30 minutes`. It only affects time from a clock. Hours you type are kept exactly as you type them.
- **People are paid.** `Weekly`, `Every two weeks`, `Twice a month` or `Monthly`. This is when people are **paid**, which is not how overtime is measured — overtime is always worked out for each week on its own. Choosing `Every two weeks` asks you for a starting date, because nothing in the calendar says which of two weeks begins a period.
- **Overtime rules.** `Federal (over 40 in a week)`, `California (daily and weekly)` or `None — no overtime rules`. Whatever you pick, the full rule is spelled out underneath so you can check it. This is a legal choice you make with whoever does your payroll; we do the arithmetic and we do not know where your people work.

## How to add somebody

1. Click {button:Add someone|primary}.
2. Under `Who`, leave `Somebody new` if this is a person the business has no record of. If they are already a customer, supplier or contact, pick their name from the list instead. Doing that keeps one record of them rather than two.
3. If you chose `Somebody new`, type their `Name`. Up to 120 characters.
4. Under `Signs in as`, leave `Nobody — they do not use the app` unless this person has an account here. If they do, pick it. Linking a sign-in means that when they log time, their own name is the one already picked for them.
5. Click {button:Add|primary}. You see `Added` and they appear in the list.

Each sign-in can only belong to one person on this list. Anybody who does not sign in needs nothing, so you can add as many of those as you like.

## How to record that somebody has left

1. Find them in the list and click {button:Has left|ghost}.
2. You see `Jo Okafor marked as left`. Their name grays out.
3. They are no longer offered when you log time. Everything they worked stays in the weeks it was worked in.

To reverse it, click {button:Bring back|ghost} on the same line.

There is no way to delete somebody, and that is deliberate. Their hours are a record of what the business paid for, and a list you can erase is a list nobody can rely on.

## How to set the day your week starts on

1. Scroll to `Your week starts on`.
2. Pick a day. You see `Saved`.
3. Go back to the week with {button:Time|outline}. The days are now grouped from the day you picked.

## How to say how often people are paid

1. Scroll to `People are paid`.
2. Pick how often. For `Weekly`, `Twice a month` and `Monthly` you see `Saved` and nothing else is needed.
3. For `Every two weeks`, a box asks `When does a pay period start?`. Put in the first day of any one of your two-week periods — every other period is counted from it. If the date you give is not the day your week starts on, we move it back to the start of that week, so a period is always two whole weeks.
4. Click {button:Save|primary}. You see `Saved`.

Changing this never changes anybody's overtime. It changes how the [pay period](pay-period.md) screen groups the weeks up.

## How to choose your overtime rules

1. Scroll to `Overtime rules`.
2. Pick the one that applies to you. The line underneath changes to spell out exactly what it means.
3. You see `Saved`, and every figure in Time is worked out that way from then on.

| You pick | What happens |
| --- | --- |
| `Federal (over 40 in a week)` | Anything over 40 hours worked in one week is overtime. The federal minimum, and all that most states add to. |
| `California (daily and weekly)` | Over 8 hours in a day or 40 in a week is overtime; over 12 in a day is double time; the seventh day worked in a week pays overtime for 8 hours and double time beyond. |
| `None — no overtime rules` | Hours are recorded and totalled, and none of them are ever marked as overtime. For a business whose people are all salaried. |

Two things this does **not** do. It never changes an hour that was already logged — the entries stay exactly as they are and only the way they are added up changes, so you can switch and switch back. And it does not tell you which rules apply to you. That is your decision, and your payroll provider's.

## How to set rounding

1. Scroll to `Round clocked time to`.
2. Pick an amount. You see `Saved`.
3. From now on, when a clock stops, its minutes are rounded to that amount.

Rounding is always to the **nearest** amount, never always up and never always down. On a quarter hour, eight minutes becomes fifteen and seven becomes nothing, so over a month it costs as often as it pays. That balance is what makes rounding a timesheet fair, and it is why there is no option to always round down.

Two things it does not touch. Hours you type in by hand are kept exactly as typed, and every clock keeps a record of the real times it ran, so changing this setting never rewrites what already happened.

If you are not sure, leave it on `To the minute`. It is the only setting that needs no explaining to anybody.

## Messages

| Message | What it means |
| --- | --- |
| `Nobody here yet` | Nothing has been added. Click {button:Add someone|primary} to start. |
| `Only an owner can change who is on this list.` | You are signed in as staff or an accountant. You can read the list and not change it. |
| `Give the person a name.` | You chose `Somebody new` and left `Name` empty. |
| `That person can already have time logged for them.` | The person you picked under `Who` is already on this list. |
| `Somebody else is already linked to that sign-in.` | That account belongs to another person here. Free it up on their line first. |
| `That person could not be found.` | Somebody removed the record while your page was open. Reload the page. |
| `Pick one of the rounding options.` | The rounding amount was not one of the choices. Reload the page and pick again. |
| `Pick how often people are paid.` | The pay frequency was not one of the choices. Reload the page and pick again. |
| `Say which day a pay period starts on.` | You chose `Every two weeks` and left the starting date empty. |
| `Pick which overtime rules you follow.` | The rules were not one of the choices. Reload the page and pick again. |

## Not on this page

You cannot record what anybody is paid, what they do, or whether they are salaried. None of that is built yet, and pay rates in particular will not be visible to everybody when they arrive. Ask us where it is up to.

There is no separate rounding for different people, and no way to round a punch up automatically at the end of a shift.

The overtime rules are for the whole business. You cannot yet mark one person as salaried and exempt while the rest are hourly, and there is no ruleset for the 8-and-80 arrangement some healthcare employers use. Ask us if you need either.

## Who can do what

Owners can add people, link and unlink sign-ins, mark somebody as having left, and set all four settings on this page. Staff and accountants can read the list and the settings. Staff can still log hours and start and stop clocks for anybody on it, over on [The week](week.md).
