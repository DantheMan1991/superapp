# Team

> Who can get into your workspace, how to invite someone, how to limit what a person can open, and how to give an outside accountant read-only access to the books.
> **Route:** /dashboard/team
> **Order:** 10

Open **Team** under `Business` in the sidebar. The large panel is your business's membership, run by the sign-in service Yosher uses. Owners invite people and set roles there. Under it, owners mark an outside accountant and set what each person can open.

## What you see

- **The membership panel.** Three areas. `Members` lists everyone who has joined, with their role. `Invitations` is where you bring someone in, and where pending invitations wait. `General` holds the business's name and logo, and the options to leave or delete the organization where you are allowed to.
- **Roles.** Two kinds. An owner can change anything in Yosher, including the settings pages. A member is staff: they use the tools but cannot change business settings or approve money.
- **`What people can reach`.** Owners only, and only once somebody is a member. The card explains that everyone reaches every tool you have switched on, and that putting somebody on a level takes some of it away. Each row is a person, with `Reaches everything` on an owner, `You` on your own row, or a select naming their level. `Manage levels` opens Access. Until you have made a level the card says so and links you there.
- **`Accounting access`.** Owners only. The card reads `Mark your outside accountant or bookkeeper. Accountants can read everything, review and sign off closes, and export the books — they can never post or change anything.` It lists every member with their name and email. At the right of each row is one of three things: `Owner`, because owners always have full access; `You`, on your own row, because you cannot change your own access; or the caption `Accountant` with a switch.

## How to invite someone

1. In the panel, open `Invitations`.
2. Enter their email address, choose a role, and send. They get an email with a link.
3. Until they accept, they show as a pending invitation, which you can revoke. Once they accept, they appear under `Members` and in the `Accounting access` list.

## How to change a role or remove someone

1. Open `Members` in the panel.
2. Change the member's role, or remove them. Staff can see the list but cannot change it.

## How to limit what somebody can reach

Each person's row under `What people can reach` has a button showing where they stand today — `Every tool · every company` for most people. Click it to open **Access for** that person.

Two settings, and they are not the same kind of thing:

**`Level`** — which screens they can open: whole tools, and parts of tools. Pick one of your levels, or `Every tool`. Make levels under `Settings` → **Access**; see the Access guide.

**`Companies`** — which books they can see. Only appears once you keep more than one company. Tick the ones they work in; tick nothing and they see them all.

Then {button:Save|primary}.

- **It reaches them on their next page load.** Nobody is signed out.
- **Owners always reach everything** and cannot be limited. Make somebody staff first if you want to.
- **You cannot change your own**, the same rule as accountant access — a locked-out owner with nobody else to unlock them is a problem nothing in the product can fix.
- **`Level` hides menus. `Companies` hides money.** A level takes screens away. Companies goes deeper: entries, invoices, bills, bank rows and reports for a company they are not on are not given to them at all, on any screen, including ones built later.
- **Somebody on exactly one company stops seeing the company control entirely.** Reports, lists and statements simply cover their company, the way they do for a business that only ever had one.
- **What is shared stays shared.** Your chart of accounts, contacts, {{customer|plural|lower}} and {{vendor|plural|lower}} are one list for the whole business, so everybody still sees those.

## How to give an accountant read-only access

1. Find the person in `Accounting access`. They must have accepted their invitation first.
2. Turn on the `Accountant` switch on their row. You see `Marked as accountant — read and review access only.`
3. To take it away, turn the switch off. You see `Accountant access removed.`

What accountant access means:

- They can read everything in Accounting, review a month-end close and sign it off, and export the books.
- They can never post, edit or approve anything. If they try, Accounting tells them `Accountant access is read-only — reviews, sign-offs and exports only.`
- They have no mailbox, and the `Mail` row shows them no unread count.
- On What needs you they see only their own scheduling and work items, never bills or invoices.

Accountant access narrows what a person can do. It is for the outside professional, not for a staff member who also does the books.

Roles are kept by the sign-in service and copied into Yosher when an owner opens this page, at onboarding, and each morning. If you change a role in the panel and it does not show elsewhere yet, open this page again as an owner.

## Who can do what

Owners manage members, invitations, access levels and accountant access. Staff see the membership list, cannot change it, and see neither `Accounting access` nor `What people can reach`.
