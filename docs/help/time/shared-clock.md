# The shared clock

> One device by the door that several people punch on. Tap your name, type your PIN, and it clocks you in or out — whichever is next. For a farm, a shop floor or a pack house where most people do not carry the app.
> **Route:** /dashboard/m/time/clock
> **Order:** 115

Open **Time** {icon:clock}, then {button:Shared clock|outline} from [People](people.md). Leave a tablet or an old phone on that page by the door, and people punch on it as they arrive and leave.

Everybody's hours land in exactly the same place as hours typed by hand — the same week, the same pay period, the same overtime rules. The shared clock is a different **way in**, not a different set of books.

## Before it works

Two things have to be true, and both are done by an owner on [People](people.md):

1. **The person is on the list.** They do not need a sign-in. That is the point of the shared clock: a seasonal picker who has never opened the app still shows up on it.
2. **They have a PIN.** Click {button:Give a PIN|ghost} beside their name, type 4 to 8 digits, and tell them what it is.

**Only people with a PIN appear on the clock.** Somebody without one is not hidden by a setting — they simply have no way to use it, and the screen says so rather than showing a name that cannot be tapped.

## What you see

- **The list of names.** One tile per person with a PIN, big enough to hit with a gloved hand. Beside each name it says `out`, or `in since 7:02` if their clock is already running — so you can see where you stand before you tap anything.
- **The keypad.** Appears once you tap your name. Digits, {button:Clear|ghost} and a backspace, then one big button.
- **The dots.** Four grey dots above the keypad that fill in as you type. **Your digits are never shown**, because somebody is always standing behind you at a shared device.
- **{button:Clock in|primary} / {button:Clock out|primary}.** One button, and it already knows which. It stays greyed out until you have typed at least four digits.
- **{button:Not me|ghost}.** Backs out without punching. Use it if you tapped the wrong name.
- **{button:Name this device|ghost}.** At the bottom. See below.
- **{button:Time|outline}.** Back to the week. Not something a person punching needs.

## How to clock in or out

1. Tap your name.
2. Type your PIN.
3. Press the big button. It says `Clock in` or `Clock out` depending on where you stand.
4. The screen says what happened — `Marta Quinn · Clocked in at 7:02`, or `Clocked out. 7h 30m logged.` — and goes back to the list of names on its own after a few seconds.

**There is only one button, and it is never the wrong one.** You do not have to remember whether you are arriving or leaving; the clock already knows, because it knows whether your clock is running.

If your business rounds clocked time, the message tells you both figures: `You worked 7h 53m, logged 8h`. Rounding is always to the nearest, so it costs you as often as it pays you.

## How to name the device

Click {button:Name this device|ghost} at the bottom and type what it is — `Barn door`, `Milking parlour`, `Pack house`. Press {button:Done|outline}.

The name is stamped on every punch made from it from then on, which is what makes a disagreement about an afternoon answerable: you can see that somebody punched at the barn door and not at the pack house.

**It is kept by the device, not by us.** Two tablets in one business have two different names, and clearing the browser's data on that device forgets it. Nothing breaks if you never set one.

## If you get the PIN wrong

You see `That PIN is not right. Try again.` — and nothing else, whoever you are. The clock never says "that person has no PIN" or "no such person", because that would tell somebody which names are worth guessing at.

**After five wrong tries in a row, that person's PIN stops answering for fifteen minutes.** The screen says how long is left. It opens by itself, so nobody is stuck waiting for an owner — and an owner can also open it sooner with {button:Let them try again|outline} on [People](people.md), where a `locked out` chip appears beside the name.

A right PIN clears the count, so a forgetful week does not slowly add up to a lockout.

## Messages

| What you see | What it means |
| --- | --- |
| `Clocked in at 7:02` | Your clock is running. |
| `Clocked out. 7h 30m logged.` | The hours are recorded. |
| `Clocked out. You worked 7h 53m, logged 8h.` | Same, with your rounding applied. |
| `Too short to record. Nothing was logged.` | Your rounding took the time to nothing — a five-minute visit on a quarter-hour policy. The punch is still on record; the hours are not. |
| `That PIN is not right. Try again.` | Wrong PIN, no PIN set, or a name that is no longer on the list. |
| `Too many wrong tries. Try again in 12 minutes.` | Five wrong in a row. It opens by itself. |
| `Not recorded — these dates are closed for pay…` | Your clock crossed a pay period somebody has already been paid for. Your clock is still running. Tell whoever runs your payroll. |
| `No connection` | Nothing was sent. Press the button again when you have a signal. |
| `Nobody has a PIN yet.` | No PINs have been given out. An owner does that on People. |

## What happens when the signal drops

**Nothing is recorded twice.** Every punch carries an id the device makes before it sends anything, so pressing the button again after a timeout finds the punch you already started instead of making a second one.

**But it is not offline.** If the request does not get through, the screen says `No connection` and nothing was sent — it does not pretend the punch landed. A clock that lies about that is worse than one that fails honestly. Press the button again when you have a signal.

## Who can do what

**The device has to be signed in**, and whoever walks past it has whatever that sign-in has. So **sign the tablet in as a member of staff, never as an owner** — staff can record time, which is all a clock by a door needs, and cannot see pay rates, approve hours or reach your books.

The PIN decides which of several people is standing at the device. It is not a password and does not sign anybody in.

An accountant's access is read-only, so a device signed in that way shows a message instead of the clock.

## Not on this page

You cannot correct a punch here, see your own hours, or see what you are paid. All of that is on [The week](week.md), for somebody with a sign-in.

There is no photo, no fingerprint and no location stamp. If somebody lends out their PIN, the clock believes them.
