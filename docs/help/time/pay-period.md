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
- **Where the hours went.** A panel listing everything the period's hours were booked to, biggest first, with `Not booked to anything` at the end when some were not. It only appears once at least one hour has been booked to something.
- **The explanation.** A line under the bar saying how overtime was worked out, in the words of the rules you picked on [People](people.md), and what happens to a week that starts in one period and ends in another.
- **A week.** One block per week the period pays, oldest first, headed `Week of Sep 6 – Sep 12` with a count of the people in it.
- **A person.** One line per person per week: their name, then `40h regular`, then `10h overtime` and `1h double time` when there are any, then any hours paid but not worked. When a week produced no overtime at all, the line says `no overtime` so you can see it was checked rather than missed.
- **Where each person has got to.** On the first week each person appears in, the end of their line shows one of: {button:Send for approval|outline}, a {badge:Waiting for approval|warning} chip with {button:Approve|primary} and {button:Send back|ghost} beside it, or an {badge:Approved|success} chip. It appears once per person for the whole period, not once per week.
- **{button:Lock period|primary}.** Top right, beside the dates. Stops every hour in these dates from being changed. Owners only, and it asks before it does it.

## How your pay periods are decided

You set this on [People](people.md), under `People are paid`:

| You chose | A period is |
| --- | --- |
| `Weekly` | One week. The only setting where the period and the week are the same thing. |
| `Every two weeks` | Two whole weeks, counted from a starting date you give us. |
| `Twice a month` | The 1st to the 15th, and the 16th to the end of the month. |
| `Monthly` | The calendar month. |

The last two do not line up with weeks at all, so a week will sometimes start in one period and finish in the next. **That week is paid in the period it ends in.** It is never split in half, because splitting it would mean deciding which of the hours were the overtime ones, and there is no true answer to that.

## How to run a period, start to finish

1. Open **Time** {icon:clock}, then {button:Pay period|outline}. Use {button:← Previous|ghost} if the period you are paying has already finished.
2. Read down each week and check the overtime against what you expect. If something looks wrong, click {button:Time|outline}, move to that week and fix the entries behind it.
3. When somebody's hours are ready, click {button:Send for approval|outline} on their line. Anybody can do this, including the person themselves.
4. As the owner, click {button:Approve|primary}. A box tells you exactly what you are agreeing to, like `40h regular · 10h overtime`. Those figures are **saved as they stand**, and are what a pay run quotes. If the hours are not right, click {button:Send back|ghost} instead and they go back to being unsubmitted.
5. Once everybody is approved and you have run payroll, click {button:Lock period|primary}. It asks first, because of what it does next.

## What locking does

From the moment you lock, **nothing in those dates can be changed or deleted**. On the week screen every day inside the period gets a {badge:Locked|warning} chip, and the {button:Edit|ghost} button on each row becomes {button:Correct|ghost}.

That is on purpose. Once you have paid somebody for Tuesday, the record has to keep saying what you paid them — otherwise next month you cannot tell what actually happened from what somebody tidied up afterwards.

**So a mistake found later is not an edit, it is a correction.** Click {button:Correct|ghost} on the entry, say how much was missed, and it is added as a new entry in the first period that is still open. The original stays exactly as it was, and the two are linked. You see `Correction added to the open period`.

If the period you are standing in is itself locked, the correction goes to the first day of the next one — the box tells you which date it is using before you save.

You can {button:Unlock period|outline} at any time, and it does not ask. Unlocking just puts things back the way they were.

## Reading "Where the hours went"

Each line is one thing your hours were booked to, and how long went to it. Only hours actually **worked** are counted — paid leave is not labour on anything.

**These figures do not add up to the total, and that is on purpose.** An hour can be booked to more than one kind of thing at once — a field *and* a line of business, say — and it counts under each, because both answers are true. Ask "how much went to the north field" and "how much went to beef" separately; do not add them together.

`Not booked to anything` is not a fault. It is just the hours nobody said what they were for, and it is the figure to watch if you want a complete picture.

## Who approves what

Sending hours for approval is something anybody can do. **Approving is the owner's**, and so is locking. That split is the point of having two steps: somebody who could approve their own hours would be certifying nothing.

## Messages

| Message | What it means |
| --- | --- |
| `Nothing in this period` | No hours were logged between these dates. |
| `Nothing was logged in this week.` | One week inside the period is empty. The others may not be. |
| `no overtime` | That person's week was checked and stayed under every threshold. |
| `This period is locked.` | Nothing in these dates can be changed. Corrections go in the open period. |
| `This period has already been sent for approval.` | Somebody submitted it while your page was open. Reload the page. |
| `That timesheet has already been approved.` | The same, after an approval. Reload the page. |
| `That pay period is locked.` | You tried to change an hour inside a locked period. Use {button:Correct|ghost} instead. |
| `That entry can still be edited` | You tried to correct an entry whose period is open. Change it rather than correcting it. |

## Not on this page

You cannot see what anybody is paid — this screen deals in hours, never money — and there is no export for your payroll provider yet. Both are coming. Ask us where it is up to.

A period is either locked or it is not; you cannot lock one person's hours and leave another's open.

## Who can do what

Everybody can read this page, accountants included. Staff can send hours for approval, including their own. **Only owners can approve, send back, or lock and unlock a period.** Accountants can change nothing. The settings behind it — how often people are paid, and which overtime rules apply — are owner-only and live on [People](people.md).
