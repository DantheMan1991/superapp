# The pay period

> One pay period, broken into the weeks inside it, with each person's regular and overtime hours. This is the screen to read before you run payroll.
> **Route:** /dashboard/m/time/pay
> **Order:** 115

Open **Time** {icon:clock} in the sidebar, then click {button:Pay period|outline}. You land on the period today falls in. Move between periods with {button:← Previous|ghost} and {button:Next →|ghost}.

The important thing on this screen is that a period is shown **as its weeks**, never as one number. Overtime is worked out for each week on its own, so a fortnight of 80 hours is not the same as two 40-hour weeks. If somebody worked 30 hours one week and 50 the next, that is ten hours of overtime, and adding the fortnight up first would hide it.

## What you see

- **The heading.** `Pay period`, and under it the whole period added up: regular hours, then overtime, then double time, then anything paid but not worked. Parts with nothing in them are left out, so a quiet period reads as one figure.
- **{button:Time|outline}.** Takes you back to the week.
- **The period bar.** The dates of the period you are reading, like `Aug 30 – Sep 12, 2026`. `This period` sits beside it when you are on the current one. {button:← Previous|ghost} and {button:Next →|ghost} move a whole period at a time, and a {button:This period|outline} button appears once you have moved away.
- **The explanation.** A line under the bar saying how overtime was worked out, in the words of the rules you picked on [People](people.md), and what happens to a week that starts in one period and ends in another.
- **A week.** One block per week the period pays, oldest first, headed `Week of Sep 6 – Sep 12` with a count of the people in it.
- **A person.** One line per person per week: their name, then `40h regular`, then `10h overtime` and `1h double time` when there are any, then any hours paid but not worked. When a week produced no overtime at all, the line says `no overtime` so you can see it was checked rather than missed.

## How your pay periods are decided

You set this on [People](people.md), under `People are paid`:

| You chose | A period is |
| --- | --- |
| `Weekly` | One week. The only setting where the period and the week are the same thing. |
| `Every two weeks` | Two whole weeks, counted from a starting date you give us. |
| `Twice a month` | The 1st to the 15th, and the 16th to the end of the month. |
| `Monthly` | The calendar month. |

The last two do not line up with weeks at all, so a week will sometimes start in one period and finish in the next. **That week is paid in the period it ends in.** It is never split in half, because splitting it would mean deciding which of the hours were the overtime ones, and there is no true answer to that.

## How to check a period before payroll

1. Open **Time** {icon:clock}, then {button:Pay period|outline}.
2. Use {button:← Previous|ghost} if the period you are paying has already finished.
3. Read down each week and check the overtime against what you expect.
4. If something looks wrong, click {button:Time|outline} and move to that week to see the individual entries behind it.

Nobody has to approve anything yet, and nothing is locked. Approving a period, so that it stops changing under you after payroll, is coming.

## Messages

| Message | What it means |
| --- | --- |
| `Nothing in this period` | No hours were logged between these dates. |
| `Nothing was logged in this week.` | One week inside the period is empty. The others may not be. |
| `no overtime` | That person's week was checked and stayed under every threshold. |

## Not on this page

You cannot approve or lock a period, and you cannot see what anybody is paid — this screen deals in hours, not money. There is no export for your payroll provider yet. All three are coming. Ask us where it is up to.

## Who can do what

Everybody can read this page, accountants included. It has no controls to use. The settings behind it — how often people are paid, and which overtime rules apply — are owner-only and live on [People](people.md).
