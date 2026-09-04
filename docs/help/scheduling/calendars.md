# Your calendars

> Where you add calendars, decide who can see them, and set up a link that puts your schedule on your phone.
> **Route:** /dashboard/m/scheduling/calendars
> **Order:** 20

Open **Scheduling** and click {button:Calendars|outline|calendar-days}. That button is the only way here. {button:Back to the calendar|ghost|chevron-left} takes you back.

The heading reads `Everything you keep time in. Each one is private until you share it.`

## What you see

Three sections, each of which disappears when it has nothing in it.

- **`My calendars`** — `Private unless you share them.`
- **`Shared with me`** — `What colleagues have given you access to.`
- **`Business calendars`** — `Owned by the workspace rather than a person.`

Each row has a colour dot, the name, and badges: {badge:Main|secondary} on the one you were given when you joined, {badge:Archived|outline} on one you have put away, and on a calendar somebody else owns, a badge naming your access.

On calendars you administer, three buttons sit at the right: {icon:share} to share, {icon:pencil} to rename or recolour, and an archive button. **Your main calendar has no archive button**, because it is where anything lands when nobody chose a calendar.

At the bottom, `Subscribe from another calendar`.

## How to add a calendar

1. Click {button:New calendar|primary|plus}.
2. Type a `Name`, up to 80 characters.
3. Pick a `Colour` from the six. It is the colour every event on it will be, for you and for everybody you share it with.
4. Click {button:Save|primary}. You see `Calendar created`.

The dialog keeps what you last typed, so check the name and the colour before adding a second one.

**Renaming the calendar you were given does not work today.** It arrives without a colour, and saving without clicking a colour fails with `Invalid input`. **Click a colour swatch first** and it saves. We are fixing it.

## How to share a calendar

Click {icon:share}. The dialog reads `Sharing applies to the whole calendar. Anything you mark private on a single event stays visible only to you and the people on it.`

- **The top row is everybody in the business.** Set it to `Not shared`, `Free/busy only`, `Titles and locations`, `All details` or `Can edit`.
- **Below it, one row per person** you have named, each with its own level and an {icon:x} to take access away.
- **At the bottom, `Add someone`.** Pick a colleague, choose a level, click {icon:plus}. It starts on `All details`.

**Every change applies the moment you pick it.** There is no Save, and taking access away asks for no confirmation.

If somebody has both a personal grant and the everyone grant, the more generous one wins.

### What the levels mean

| Level | What they get |
| --- | --- |
| `Free/busy only` | Your times, every event reading `Busy`. |
| `Titles and locations` | Plus what each is called and where. |
| `All details` | The whole event, notes included. |
| `Can edit` | Plus adding and changing events on it. |

**`Can edit` does not let them share it on**, rename it, recolour it or archive it. That stays with you.

**Nobody else can administer your calendar, including the business owner.** An owner who needs your schedule has to be granted access like anybody else, and you can see and remove that row.

A person you have shared with sees your calendar under `Shared with me` with a badge naming their level, and no buttons. **They cannot see who else you have shared it with.**

Your accountant cannot be given access to a calendar at all.

## How to archive one

Click the archive button. You see `Calendar archived` and the row goes, unless you click {button:Show 1 archived calendar|ghost}. Restoring puts it back.

**Archiving does not hide its events.** They keep appearing on the calendar and they keep going out in your subscribe link. Archiving takes the calendar out of this list and nothing more. If you need events hidden, take away the sharing instead, and tell us.

## How to put your calendar on your phone

The card at the bottom reads `Add your Yosher calendar to the calendar app on your phone or laptop. It updates on its own and is read-only there — you cannot add or change anything from that side.`

1. Type what it is for into `What is it for?`, such as `iPhone`. This is only a note to yourself.
2. Click {button:Create link|primary}.
3. **Copy the address immediately.** It is shown once and never again.
4. Paste it into your calendar app as a subscription.

**Treat that address like a password.** The screen says so when it appears: `Anyone with this link can read your calendar without signing in. Treat it like a password, and revoke it if it gets out.` **That warning is gone once you reload the page**, so read it while it is there.

Three things worth knowing that the screen does not say:

- **The link carries everything you can see**, not just your own calendar. That includes calendars colleagues have shared with you and events you were merely invited to, all merged together and named `Yosher`.
- **It covers a month back and a year ahead.**
- **You can have five links at once.** The sixth is refused with `you already have 5 subscribe links — revoke one first`.

To turn one off, click the {icon:x} on its row. It goes immediately, with no confirmation, and you see `Link revoked`. The screen tells you the truth about what that does: `Revoking stops any new downloads. A device that already has a copy may keep showing it until it next refreshes.`

There is no way to change a link's address. Revoke it and make another.

**Your links are yours alone.** Nobody else can list them or revoke them, not even the business owner. If somebody leaves, their links stop working when their access does.

## Messages

| Message | What it means |
| --- | --- |
| `Calendar created` / `Calendar updated` | Saved. |
| `Calendar archived` / `Calendar restored` | It is out of, or back in, the list. Its events are unaffected either way. |
| `Sharing updated` | The level applied at once. |
| `Access removed` | That person can no longer see it. |
| `Copied` | The address is on your clipboard. Paste it somewhere before you leave the page. |
| `Link revoked` | No new downloads. A device that already has it may keep showing it. |
| `Copy this now — it is not shown again.` | Exactly that. There is no way to see it later. |
| `your main calendar cannot be archived` | It is where things land when no calendar is chosen. |
| `only its owner can change this calendar` | You have been given access, not ownership. |
| `this is already your calendar` | You cannot grant yourself access to your own. |
| `you already have 5 subscribe links — revoke one first` | Five is the limit. |
| `Invalid input` | Something is missing. Most often a calendar with no colour. |
| `accountant access is read-only` | Accountants cannot change anything here. |

## Not on this page

- Archiving a calendar does not hide its events, from the calendar or from a subscribe link.
- You cannot make a business calendar. Ask us if you need one.
- Nothing asks you to confirm before archiving, removing somebody's access, or revoking a link.
- A person you shared with cannot see who else you shared with.
- You cannot subscribe to one calendar on its own. A link carries everything you can see.
- The address cannot be changed or shown again. Revoke and make another.
- Somebody who has left the workspace shows as a long string of letters and numbers in the share list.
- If you need any of this, ask us.

## Who can do what

Everyone keeps their own calendars, shares them, and makes their own subscribe links. Only a business owner administers a business calendar.

Accountants see this page with every button enabled and every one of them fails with `accountant access is read-only`. Nothing warns them first, and they cannot be granted access to anybody's calendar.
