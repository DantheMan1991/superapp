# Email setup

> The address your invoices and notifications go out from, how to send them from your own domain, how to host your own mailboxes in Yosher, and the log of what has been sent.
> **Route:** /dashboard/email
> **Order:** 10

Open **Email setup** under `Settings` in the sidebar. Owners only. The page reads `What your customers see when the system emails them on your behalf.` It has four cards: what you send as, your sending domain, your own mailboxes, and the recent email log.

## What you see

- **`Sending as`.** The exact From line your customers see, such as `"Acme Builders" <notifications@mail.acmebuilders.com>`, and the note `Every invoice, share link and notification goes out with this address.` Until you connect your domain, mail goes out from a Yosher address with your business name on it, and the card says `Connect your domain below and mail will come from your address instead. Until then it sends from ours with your name on it, and replies still come back to you.` Once your domain is verified, the card carries {badge:Your own domain|primary}. Under it, a field `Send a test to` and {button:Send test|outline}.
- **`Your domain`.** `Adding these DNS records proves you own the domain. Without them, mail claiming to be from you would be rejected as forged — which is exactly what that check is for.` Before a domain is added: the fields `Send as`, which starts as `notifications`, and `At domain`, and {button:Add domain|primary}. After: your domain with {badge:Waiting for DNS|secondary}, {badge:Verified|primary} or {badge:Failed|secondary}, a table of records with `Type`, `Name` and `Value` columns and a copy button on each, {button:Check DNS|outline|refresh} while it is unverified, and {button:Disconnect|outline}.
- **`Your own mailboxes`.** `Real addresses on your own domain — yours to read here, on your phone, or in Outlook. This is separate from the sending setup above: that decides what leaves, this decides what arrives.` Before a domain is added: the field `Your company domain` and {button:Add domain|primary}. After: the domain with {badge:Waiting for DNS|secondary}, {badge:Ready to switch over|secondary}, {badge:Receiving mail|primary} or {badge:Rejected|secondary}, a DNS table, the `Mailboxes` list with its count, the form for a new mailbox, and, once the DNS check passes, the section `Switch mail over to Yosher`.
- **`Recent email`.** `What the system has sent for you, and what happened to it. A bounce here means the message never arrived.` The last 50 emails, with `To`, `Subject`, `Status` and `Sent`. A status is `queued`, `sent`, `delivered`, `bounced`, `complained` or `failed`. The list does not say why a message failed.

## How to send a test email

1. Type an address in `Send a test to`.
2. Click {button:Send test|outline}. You see `Sent from` followed by the address it went from.
3. Open the email. Its subject is `Test email from [your business]`, and it says that if the sender address looks right, your setup is working.

## How to send from your own domain

1. In `Your domain`, leave `Send as` as `notifications` or change it. It is the part before the @.
2. In `At domain`, type a subdomain, such as `mail.yourcompany.com`. The help text says why: `A subdomain such as mail.yourcompany.com is best — it keeps this mail's reputation separate from the address you use every day, so a bad send can never affect your normal email.` Your main domain is allowed, with a warning.
3. Click {button:Add domain|primary}. You see `Domain added — now add the DNS records below`.
4. Add each record in the table at the company that manages your domain's DNS. Use the copy buttons. The values come from the email provider, so they are different for every domain, and the `Value` of an MX record ends with its priority. Add only the records shown: a second SPF or DMARC record of your own makes the check fail.
5. Click {button:Check DNS|outline|refresh}. When the records are found you see `Verified — your mail now sends from your domain` and the badge changes to {badge:Verified|primary}. The page does not check on its own, so a domain that verifies overnight shows {badge:Waiting for DNS|secondary} until you click.

To go back to the Yosher address, click {button:Disconnect|outline}. There is no confirmation. You see `Disconnected — mail falls back to the Yosher address`.

## How to host your mailboxes in Yosher

1. In `Your own mailboxes`, type your main domain in `Your company domain`, the one your address already ends in. The help text: `Use your main domain — the one your address already ends in. Adding it here changes nothing on its own: you will see exactly what to do next, and mail keeps arriving wherever it arrives today until you decide otherwise.`
2. Click {button:Add domain|primary}. You see `Added — nothing has changed yet.`, or `Added. Your mail currently goes to [provider] — nothing has changed yet.` You cannot use the domain you connected for sending above; the page tells you to keep the subdomain for notifications.
3. Add the DNS records shown, except the MX record. The note reads `Add these at your DNS provider. Mail keeps arriving where it does today until the MX record below actually changes — everything else here is preparation.`
4. Create every mailbox before you switch over, so no mail bounces. For each one, fill in `Address`, the part before the @, `Name`, and `Send setup link to`, an address the person can already open. The help text: `They choose their own password from that link — it never passes through Yosher, so nobody here can read their mail. Send it to an address they can already open, not one at @[your domain].` Click {button:Create mailbox|primary}. You see `[address] created — setup link sent to [their address]`. A row reading `setup link sent` means the person has not set a password yet.
5. Click {button:Check DNS|outline|refresh}. When it answers `DNS looks right — you can switch over when ready`, the section `Switch mail over to Yosher` appears.
6. Read its two warnings. `Create your mailboxes first.` appears if you have not, because mail to an address that does not exist bounces. `This redirects every email sent to [your domain].` is followed by where mail goes today, for example `Mail currently goes to Google Workspace. After this, it arrives here instead. Anything still sitting in the old system stays there — this moves future mail, not past mail.`
7. Type your domain in the confirmation box and click {button:Switch mail over|primary}. You see `[your domain] mail now arrives in Yosher`. If the switch is refused, the message says why: the DNS records are not confirmed yet, or your MX record still points somewhere else and needs time to spread.

Once mail is arriving, {button:Check DNS|outline|refresh} becomes {button:Re-check|outline|refresh} and answers `Everything checks out`, or says what is missing. A section headed `Undoing this` keeps the old mail records: `Mail used to go to [provider]. To send it back, replace the MX records at your DNS provider with exactly these. Keep this list — it is the only copy.` If the domain received no mail before, it says there is nothing to restore. {button:Stop managing this domain|outline} removes the domain from Yosher and shows `Removed from Yosher. The mailboxes still exist at the mail host.`

## How to delete a mailbox

1. Click {button:Delete|ghost|trash} on the mailbox's row.
2. Type the full address in the box that appears, then click {button:Delete for good|destructive}. {button:Cancel|outline} backs out. You see `[address] deleted`.

## Messages

| Message | What it means |
| --- | --- |
| `Already sent that one — check your inbox` | You sent the same test twice within a minute. Look for the first one. |
| `Not verified yet. DNS changes can take up to an hour to spread.` | The records were not found yet. Wait, then click {button:Check DNS|outline|refresh} again. |
| `None yet. Create everyone's mailbox before switching over, so no mail bounces during the change.` | No mailboxes exist yet. Create them before you switch over. |
| `Nothing sent yet.` | The system has not sent any email for you yet. |
| `That's the sending limit for now — try again shortly.` | Your business has sent 100 emails in the last hour. Wait a little. |
| `That attachment is too large to email.` | An attachment over 5 MB was refused. |

## Not on this page

The log does not show why a message failed. Ask us and we can look it up.

Reading the mail that arrives at these addresses is a different screen. Connect an address to yourself in [Connecting your mailbox](../email/connect.md), then read it in [Your mailbox](../email/mailbox.md).

## Who can do what

Only owners see this page.
