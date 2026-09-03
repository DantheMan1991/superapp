# Reminders

> Chasing unpaid invoices on a schedule: the switch, the schedule, the list of what goes out next, the test button, and what the customer receives.
> **Route:** /dashboard/m/accounting/sales/reminders
> **Order:** 120

Open **Sales** in the accounting menu and click the `Reminders` pill. The line under the title reads `Chase unpaid invoices on a schedule you set. Reminders go out around 8am in your business's timezone.` A reminder emails the customer a copy of the invoice, as a PDF, on the days you choose around its due date. Only owners can change the settings.

## What you see

- **The badge at the right of the title.** `On` or `Off`.
- **`Send reminders automatically`.** The switch. Under it: `Emails your customer a copy of the invoice on the days below. Nothing is sent while this is off, and a paid, voided or muted invoice is never chased.`
- **`Schedule`.** Each reminder as a pill: `3 days before due`, `On the due date`, `7 days after due`, each with an {icon:x} to remove it. Under them, `Days`, `When` (`before the due date`, `on the due date` or `after the due date`) and {button:Add|outline}. `Days` is hidden for `on the due date`. Up to eight, within 60 days before and 365 after.
- **{button:Save|primary}.** Gray until something has changed, with `Unsaved changes` beside it while it has.
- **`Next reminders`.** Every invoice a reminder is due for: `Invoice`, `Customer`, `Due`, `Balance` and `Next reminder`, with the date and which reminder it is, and `· 2 sent` once some have gone. It is worked out fresh each time, the same way the morning run works it out, so what you see is what will go. While reminders are off the heading adds `— nothing will send while reminders are off`. Each row has {button:Test|ghost|send}.
- **What staff and accountants see.** Whether reminders are on, the schedule, and `Only the owner can change this.`

## How to set up reminders

1. Build the schedule. Type `Days`, choose `When`, and click {button:Add|outline}. Remove a pill with its {icon:x}.
2. Turn on `Send reminders automatically`. The switch cannot be turned on with an empty schedule.
3. Click {button:Save|primary}. You see `Reminders are on`. The switch and the schedule are saved together, so on always means something.

## How to read a reminder before any go out

1. Find an invoice under `Next reminders` and click {button:Test|ghost|send}.
2. The reminder is emailed to you instead of the customer, word for word. You see `Test reminder sent to [your address]`. It works whether reminders are on or off.

## How the reminders behave

- They go out around 8am in your business's time zone, an hour after the morning summary, so you read that an invoice is overdue before your customer does. Up to 50 go out a day; any beyond that follow the next day, most overdue first.
- Each reminder in the schedule goes at most once per invoice, and only the latest one that applies. Turning reminders on over old invoices sends one email per invoice, not one for every date it has passed. An invoice that is 30 days overdue is never told it is due in three days.
- Once the last reminder in the schedule has gone, the invoice is not chased again unless you add a later one.
- An invoice appears under `Next reminders` when it is issued, unpaid, has a due date, and neither it nor its customer is muted. An invoice with no due date is never chased. Neither is a paid, voided or draft invoice.
- {button:Mute|outline} on an invoice's page silences that invoice; `Never send reminders` on a customer silences every invoice of theirs.
- If a morning's run is missed, the reminder goes the next day.

The customer receives a subject of `Reminder: invoice INV-0009 from [your business]` before the due date, `Due today: invoice INV-0009 from [your business]` on the day, and `Overdue: invoice INV-0009 from [your business]` after it. The email greets them by name and says, for example, `This is a reminder that invoice INV-0009 for 640.00 was due on 2026-08-14, 12 days ago.` Your invoice memo follows if there is one. An overdue reminder ends `If you have already sent payment, please ignore this message.`; the others end `A copy is attached for your records.` The invoice is attached as it was issued.

## Messages

| Message | What it means |
| --- | --- |
| `Add at least one reminder before turning reminders on.` | The schedule is empty. Add a reminder first. |
| `Nothing to chase` and `Invoices appear here once they are issued, unpaid, and have a due date the schedule can act on.` | No invoice qualifies for a reminder right now. |
| `Reminders are off` | You saved with the switch off. Nothing will send. |

## Not on this page

There is no per-customer schedule. One schedule serves every invoice. Ask us if you need more than that.

## Who can do what

Only owners change the switch and the schedule. Staff and accountants see the settings and the next reminders, and can use {button:Test|ghost|send}.
