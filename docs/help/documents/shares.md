# Shared links

> Letting someone outside the business open a file or a folder without signing in: making a link, what the person receives, the list of links, activity, emailing a link, and turning one off.
> **Route:** /dashboard/m/documents/shares
> **Order:** 80

Open **Shared links** in the Documents menu. The line under the title reads `Anyone holding one of these can open what it points at, without signing in. Turning a link off takes effect immediately.` Links are made from Browse: open a file's or a folder's menu there and click `Share link…`. This page lists every link the business has made and is where you copy one again, watch who opened it, or turn it off.

## What you see

- **The list.** The newest 200 links, live and dead. `Label`, the name you gave the link, with {badge:Passcode|secondary} when it needs one and {badge:View only|secondary} when downloading is off. `Points at`, the folder's path, or `A file`. `Status`: {badge:Active|primary}, {badge:Expired|secondary}, {badge:Revoked|secondary}, {badge:Suspended — folder visibility changed|secondary} when the folder was made owners-only after the link was made, or {badge:Locked — too many passcode attempts|secondary}. `Expires`, the date. `Opened`, `Never` or how many times and when, such as `3× · 9/1/2026`. A reload counts as an open.
- **The menu on each link, {icon:more-horizontal}.** `Copy link`, `Activity…`, `Email link…` on a link without a passcode, `Reset passcode attempts` for owners on a locked link, and `Turn off link`.

## How to make a link

1. On Browse, open the menu of the file or folder and click `Share link…`. The dialog is `Share “[name]”` and reads `Creates a link anyone can open without signing in. Only what you pick here is reachable.`
2. Give it a `Label`, `Shown to whoever opens the link, and how you'll recognise it later.` Leave it blank to use the file's or folder's name.
3. Pick `Expires after`: `7 days`, `30 days` or `90 days`, up to what your business allows.
4. Leave `Allow downloading` on, or turn it off: `Off shows files in the browser and hides the download button. It makes saving inconvenient, not impossible.`
5. Turn on `Require a passcode` if you want one, and type it, `At least 4 characters`. The note reads `Give it to them by phone or text — not in the same email as the link.`
6. Click {button:Create link|primary}. The dialog reads `Link ready` and `Anyone with this link can open it until it expires. You can copy it again later from Shared links, or turn it off there.` Click {button:Copy|outline|copy}. You see `Link copied`. Click {button:Done|primary}.

A link to a folder opens every file in it and in its subfolders, and files added later. A link to a file always opens the current version. Owners-only files and folders cannot be shared.

## How to send a link

1. Click {icon:more-horizontal} on the link and then `Copy link`. You see `Link copied`. Paste it into your own email or message. This is the sure way.
2. Or click `Email link…`. The dialog reads `Goes out from your business's address. Separate multiple recipients with commas.` Type the addresses in `To`, up to ten, and a `Message (optional)`, then click {button:Send|primary}. You see `Sent from [your address]`. The email names your business, carries your message and the link, and says when the link stops working. It goes from your business's own address once your sending domain is set up on the Email setup page. A link with a passcode cannot be emailed, so that the link and the passcode never travel together.

## What the person receives

- The page reads `Shared by [your business]`, the label, and `This link stops working on October 3, 2026.`, with `View only.` when downloading is off. Under it, the files, each opening in a new tab, with a `Download` link when downloading is allowed. A folder link lists every file in the folder and its subfolders as one list, up to 500.
- With a passcode, they first see `This link needs a passcode` and `[your business] sent you a passcode separately.` They type it and click {button:Open|primary}. It is remembered for an hour in their browser. After ten wrong tries the link locks until an owner resets it.
- A link that has expired, been turned off, locked, or whose file or folder was trashed or made owners-only shows `This link is no longer available.` and `Links expire, and the sender can turn one off at any time. Ask whoever sent it for a new one.` The page says nothing about which.
- Each link can serve up to 5 GB of downloads a day.

## How to see who opened a link

1. Click {icon:more-horizontal} and then `Activity…`. The panel is `Link activity`.
2. Read the summary, such as `12 events from 3 different places`, and the entries: `Opened the link`, `Entered the passcode`, `Downloaded a file`, `Wrong passcode`, `Asked for something not in this link` and `Blocked — download limit reached`, each with the file when there was one, the time, and a short code for where it came from. The last 100 events are shown.

The notes under the list say it: `Codes like a1b2c3 group opens that came from the same place. They are derived from a one-way hash and cannot be turned back into an address.` and `An open means the link was requested — email security scanners often follow links before the recipient does, and that looks the same here as a person.`

## How to turn a link off

1. Click {icon:more-horizontal} and then `Turn off link`. There is no confirmation. You see `Link turned off`.
2. Anyone opening it from then on sees `This link is no longer available.` A link cannot be turned back on; make a new one.

## How to unlock a link

1. Owners: on a link showing {badge:Locked — too many passcode attempts|secondary}, click {icon:more-horizontal} and then `Reset passcode attempts`. You see `Passcode attempts reset`.

## Messages

| Message | What it means |
| --- | --- |
| `Share something` and `Open a file or folder in Browse and create a link. Anyone holding it can see what it points at without signing in.` | No link has been made yet. |
| `Nobody has opened this link yet.` | The activity panel of a link nobody has used. |
| `A passcode needs at least 4 characters` | Make the passcode longer. |
| `Owners-only files and folders can't be shared outside the business. Move it somewhere shared first, or turn off owners-only.` | The file or folder is hidden from staff, so it cannot go outside the business. |
| `That's longer than this business allows a link to live.` | Pick a shorter expiry. |
| `That's the maximum number of active links.` | The business has 500 live links. Turn some off. |
| `Sharing is switched off for this business.` | Ask us. |
| `This link has a passcode, so it can't be emailed — send the passcode separately, by phone or text.` | Copy the link instead. |
| `That link no longer exists.` | The link was turned off before your page refreshed. |
| `This changed since you opened it — reload and try again.` | Somebody else changed the link while your menu was open. |

## Not on this page

Links are made on Browse, not here. A file's name is not shown in `Points at`; the label is how you tell links apart, so give each a good one. There is no limit on the number of opens, no custom expiry date, no way to edit a link after it is made, and no way to turn one back on. Activity shows the last 100 events with no export.

## Who can do what

Everyone sees the list. Owners and staff make, copy, email and turn off links. Only an owner resets a locked link. Accountants can read the list and open `Activity…`, which is why they are on this page. `Copy link`, `Email link…`, the lock reset and `Turn off` are not drawn for them — copying is a write here, because the app records that the link was revealed.
