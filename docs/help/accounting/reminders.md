# Reminders

> Chasing unpaid invoices on a schedule: the switch, the schedule, the list of what goes out next, the test button, and what the customer receives.
> **Route:** /dashboard/m/accounting/sales/reminders
> **Order:** 120

## What it does

**Sales** in the strip, then the **Reminders** pill. The line under the title reads `Chase unpaid invoices on a schedule you set. Reminders go out around 8am in your business's timezone.` A badge at the right reads **On** or **Off**.

A reminder emails the customer a copy of the invoice, as a PDF, on the days you choose around its due date. Only owners can change the settings. Staff and accountants see whether reminders are on, the schedule, and `Only the owner can change this.`

## The settings

**Send reminders automatically** is the switch. Under it: `Emails your customer a copy of the invoice on the days below. Nothing is sent while this is off, and a paid, voided or muted invoice is never chased.`

**Schedule** lists each reminder as a pill: `3 days before due`, `On the due date`, `7 days after due`. The X on a pill removes it. To add one, enter the **Days** and choose **When**: `before the due date`, `on the due date` or `after the due date`, then click **Add**. Days is hidden for `on the due date`. Up to eight, within 60 days before and 365 after.

Click **Save**. It stays greyed out until something has changed, and `Unsaved changes` shows beside it while it has. You see `Reminders are on` or `Reminders are off`.

The switch cannot be turned on with an empty schedule: `Add at least one reminder before turning reminders on.` The switch and the schedule are saved together, so on always means something.

## Next reminders

The table lists every invoice a reminder is due for: **Invoice**, **Customer**, **Due**, **Balance** and **Next reminder**, with the date and which reminder it is, and `· 2 sent` once some have gone. It is worked out fresh each time, the same way the morning run works it out, so what you see is what will go. While reminders are off the heading adds `— nothing will send while reminders are off`.

An invoice appears here when it is issued, unpaid, has a due date, and neither it nor its customer is muted. When none qualify: **Nothing to chase** and `Invoices appear here once they are issued, unpaid, and have a due date the schedule can act on.`

**Test**, on each row, emails that reminder to you instead of the customer, word for word, so you can read one before switching reminders on. You see `Test reminder sent to [your address]`. It works whether reminders are on or off.

## What the customer receives

The subject is `Reminder: invoice INV-0009 from [your business]` before the due date, `Due today: invoice INV-0009 from [your business]` on the day, and `Overdue: invoice INV-0009 from [your business]` after it.

The email greets the customer by name and says, for example, `This is a reminder that invoice INV-0009 for 640.00 was due on 2026-08-14, 12 days ago.` Your invoice memo follows if there is one. An overdue reminder ends `If you have already sent payment, please ignore this message.`; the others end `A copy is attached for your records.` The invoice is attached as it was issued.

## When it goes, and the rules

Reminders go out around 8am in your business's time zone, an hour after the morning summary, so you read that an invoice is overdue before your customer does. Up to 50 go out a day; any beyond that follow the next day, most overdue first.

- Each reminder in the schedule goes at most once per invoice, and only the latest one that applies. Turning reminders on over old invoices sends one email per invoice, not one for every date it has passed.
- An invoice that is 30 days overdue is never told it is due in three days.
- Once the last reminder in the schedule has gone, the invoice is not chased again unless you add a later one.
- An invoice with no due date is never chased. Neither is a paid, voided or draft invoice.
- **Mute** on an invoice's page silences that invoice; **Never send reminders** on a customer silences every invoice of theirs.
- If a morning's run is missed, the reminder simply goes the next day.
