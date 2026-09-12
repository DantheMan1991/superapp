# People

> Everybody whose hours this business keeps, what they are paid, and the four settings behind every figure in Time. Owners work here; everybody else can read the list and the settings but never the pay.
> **Route:** /dashboard/m/time/people
> **Order:** 120

Open **Time** {icon:clock} in the sidebar, then click {button:People|outline}. Add somebody with {button:Add someone|primary}. Nobody has to be able to sign in to be on this list, which is the point of it: a seasonal hand, a subcontractor or anybody who never opens the app all belong here.

## What you see

- **The list.** One line per person, active people first and then alphabetically. Somebody who has left is grayed out with a line through their name, and they stay on the list because their past hours are still yours to keep.
- **The sign-in picker.** The second thing on each line. It says `No sign-in` for somebody who does not use the app, or the name of the person's account. Changing it saves immediately and you see `Saved`.
- **{button:Has left|ghost}.** Marks somebody as having left. They stop being offered when you log time and their past hours stay exactly where they are. The button then reads {button:Bring back|ghost}.
- **{button:Add someone|primary}.** Opens the box for adding a person. Owners only.
- **{button:Shared clock|outline}.** Opens [The shared clock](shared-clock.md) — the screen you leave on a tablet by the door.
- **{button:Time|outline}.** Takes you back to the week.
- **{button:Give a PIN|ghost}.** Beside each person, for owners. Once they have one the line shows a `PIN set` chip and the button reads {button:Change PIN|ghost}, with {button:Remove PIN|ghost} beside it. A `locked out` chip and {button:Let them try again|outline} appear only while somebody is locked out.
- **Your week starts on.** A picker at the bottom left, from `Sunday` to `Saturday`. This is not just how the page looks. It is the day your week runs from, so it decides which week an hour falls in, and when overtime arrives it will decide that too. Pick the day your business actually counts from.
- **Round clocked time to.** A picker beside it: `To the minute`, `5 minutes`, `6 minutes (a tenth of an hour)`, `10 minutes`, `15 minutes (a quarter hour)` or `30 minutes`. It only affects time from a clock. Hours you type are kept exactly as you type them.
- **People are paid.** `Weekly`, `Every two weeks`, `Twice a month` or `Monthly`. This is when people are **paid**, which is not how overtime is measured — overtime is always worked out for each week on its own. Choosing `Every two weeks` asks you for a starting date, because nothing in the calendar says which of two weeks begins a period.
- **Pay rates.** A panel headed `Pay rates`, marked `only owners can see this`. One line per rate ever set: who, the hourly figure, the day it started, and the charge-out rate and on-costs when you have given them. Staff and accountants do not see this panel at all — it is not hidden from them by the screen, it is invisible to them in the database.
- **Overtime rules.** `Federal (over 40 in a week)`, `California (daily and weekly)` or `None — no overtime rules`. Whatever you pick, the full rule is spelled out underneath so you can check it. This is a legal choice you make with whoever does your payroll; we do the arithmetic and we do not know where your people work.
- **Wages in your books.** A tick box at the bottom, owners only: `Send wages to the books when a period is locked`. Off unless you turn it on.

## How to add somebody

1. Click {button:Add someone|primary}.
2. Under `Who`, leave `Somebody new` if this is a person the business has no record of. If they are already a customer, supplier or contact, pick their name from the list instead. Doing that keeps one record of them rather than two.
3. If you chose `Somebody new`, type their `Name`. Up to 120 characters.
4. Under `Signs in as`, leave `Nobody — they do not use the app` unless this person has an account here. If they do, pick it. Linking a sign-in means that when they log time, their own name is the one already picked for them.
5. Click {button:Add|primary}. You see `Added` and they appear in the list.

Each sign-in can only belong to one person on this list. Anybody who does not sign in needs nothing, so you can add as many of those as you like.

## How to give somebody a PIN

A PIN lets somebody punch on the shared clock by the door. They do not need a sign-in, an email or a phone — which is the whole point.

1. Click {button:Give a PIN|ghost} beside their name.
2. Type 4 to 8 digits. Not `1234`, not `0000`, and not a run of digits — those are refused, because they are the first ones anybody tries.
3. Click {button:Save|primary}. You see `Marta Quinn can use the shared clock`.
4. **Tell them what it is.** There is no way to send it and no way to read it back later — we keep only a scrambled copy, so even we cannot tell you what somebody's PIN is. If they forget it, set a new one.

{button:Remove PIN|ghost} takes it away again. Their name stops appearing on the shared clock and everything they have already worked stays exactly as it is — you can still log their hours by hand.

**A PIN does not identify anybody on its own**, because you tap your name before you type it. So two people can have the same four digits without it mattering, and nothing tells you whether a PIN is already in use.

## How to let somebody back in

Five wrong PINs in a row and that person's PIN stops answering for fifteen minutes. A `locked out` chip appears beside their name.

It clears itself when the fifteen minutes are up. To let them back in sooner, click {button:Let them try again|outline}. That does not change their PIN.

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

## How to set what somebody is paid

1. Scroll to `Pay rates` and click {button:Set a rate|outline}.
2. Pick the person under `Who`.
3. Put the hourly figure in `Hourly pay`, in dollars — `24.00`, or `22.50`.
4. Set `From` to the first day this rate applies. This is the important field: see below.
5. `Charged out at` is what a customer pays for the hour, if you bill for time. Leave it empty if you do not.
6. `On-costs` is a percent added on top for your payroll taxes and insurance. It is what the hour **costs you**, and it is never added to what the person is paid.
7. Click {button:Save|primary}. You see `Rate saved`.

## Why the date matters

**A change of pay is a new rate with a new start date, not an edit of the old one.** Set someone to $26 from the 1st of next month and everything worked before then is still worked out at their old rate. That is what stops a raise in March quietly making January's payroll wrong.

It also means a rate you backdate *will* re-price the weeks after that date — every week except those in a pay period you have already approved, which keep the figure you approved.

To remove a rate you typed wrongly, click {button:Remove|ghost} on its line. It asks first, because every unapproved week after that date goes back to whatever rate came before it.

## How to say how often people are paid

1. Scroll to `People are paid`.
2. Pick how often. For `Weekly`, `Twice a month` and `Monthly` you see `Saved` and nothing else is needed.
3. For `Every two weeks`, a box asks `When does a pay period start?`. Put in the first day of any one of your two-week periods — every other period is counted from it. If the date you give is not the day your week starts on, we move it back to the start of that week, so a period is always two whole weeks.
4. Click {button:Save|primary}. You see `Saved`.

Changing this never changes anybody's overtime. It changes how the [pay period](pay-period.md) screen groups the weeks up.

## How to send wages to your books

Tick `Send wages to the books when a period is locked`. From then on, locking a pay period writes one entry in your accounts:

- **Salaries & Wages** (account 6450) is charged with what the approved hours came to, **split by what the hours were for** — so a Profit & Loss by enterprise shows each one carrying its own labour.
- **Payroll Taxes** (6500) is charged with your on-costs, split the same way, if you have set an on-costs percentage.
- **Payroll Liabilities** (2300) is credited with the total, because at that moment you owe the money and have not paid it.

When your payroll provider's run actually goes out, enter it as a bill or a bank transaction against **2300**, and the two cancel. That is the whole point of the accrual: the cost lands in the fortnight that earned it rather than the day the bank moves.

Leave it off if your accountant keys payroll in from a report. Nothing is written and nothing changes.

**You cannot turn it off while wages are still sitting in your books.** Unlock those pay periods first — that takes each accrual back out properly — and the box will then clear. You see `Wages from this business are already in the books. Unlock those pay periods first, which takes them back out properly.`

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
| `An hourly rate like 22.50.` | The pay box was empty or was not a number. |
| `Burden is a whole percent between 0 and 200.` | On-costs must be a whole number in that range. |
| `Nobody has a rate yet.` | No rates have been set. Hours are still recorded and added up without them. |
| `A PIN is 4 to 8 digits.` | The PIN was empty, too short, too long, or had something other than digits in it. |
| `That PIN is too easy to guess. Avoid 1234, 0000 and runs of digits.` | Pick something less obvious. |
| `Marta Quinn can use the shared clock` | The PIN saved. |
| `Wages will go to your books` / `Wages will stay here` | The tick box saved. |
| `Wages from this business are already in the books…` | You tried to stop posting while an accrual is still standing. Unlock those periods first. |
| `Your chart of accounts does not have the payroll accounts this needs…` | 6450, 6500 or 2300 is missing, renamed away or duplicated. Re-provision your chart from Accounting. |
| `There is no default company to post wages to.` | Set a default company in Accounting first. |

## Not on this page

You cannot record what anybody **does** — a job title, a trade, a department. Ask us if you need it.

Wages go to one set of books: the company you have marked as your default in Accounting. If a second company employs its own people, Time does not yet know that.

There is no separate rounding for different people, and no way to round a punch up automatically at the end of a shift.

You cannot see what somebody's PIN is. We keep a scrambled copy and nothing can turn it back into digits — if it is forgotten, set a new one.

Pay is hourly only. There is no salary, no piece rate, no bonus and no shift differential, and rates are whole cents — `15.38`, not `15.375`.

The overtime rules are for the whole business. You cannot yet mark one person as salaried and exempt while the rest are hourly, and there is no ruleset for the 8-and-80 arrangement some healthcare employers use. Ask us if you need either.

## Who can do what

**Only owners can see or set pay rates at all.** That is enforced in the database, not just on the screen: a member of staff opening this page does not get a hidden panel, they get no panel, and the same is true of anybody reading the data another way. A support session from us counts as staff, so we see the hours and never the wages.

Owners can also add people, link and unlink sign-ins, mark somebody as having left, set all four settings on this page, and decide whether wages go to your books. Staff and accountants can read the list and the settings — but not the rates, and not the wages tick box, which is an owner's decision about money. Staff can still log hours and start and stop clocks for anybody on the list, over on [The week](week.md).
