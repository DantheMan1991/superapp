# Email setup

> What address your invoices and notifications go out from, how to send them from your own domain, how to host your own mailboxes in Yosher, and the log of what has been sent.
> **Route:** /dashboard/email
> **Order:** 10

This page is described as `What your customers see when the system emails them on your behalf.` It has four cards.

## Sending as

The first card shows the exact From line your customers see, for example `"Acme Builders" <notifications@mail.acmebuilders.com>`. Its description reads `Every invoice, share link and notification goes out with this address.`

Until you connect your own domain, mail goes out from a Yosher address with your business name on it, and the card says `Connect your domain below and mail will come from your address instead. Until then it sends from ours with your name on it, and replies still come back to you.` Once your domain is verified, a badge reads **Your own domain**.

Under it is a test. Type an address in **Send a test to** and click **Send test**. You see `Sent from` followed by the address it went from. The test email's subject is `Test email from [your business]` and it says that if the sender address looks right, your setup is working. Sending the same test twice within a minute gives `Already sent that one — check your inbox`.

## Your domain

This card is described as `Adding these DNS records proves you own the domain. Without them, mail claiming to be from you would be rejected as forged — which is exactly what that check is for.`

**Adding a domain.** Two fields: **Send as**, which starts as `notifications` and is the part before the @, and **At domain**, for example `mail.yourcompany.com`. Click **Add domain**. The help text explains why a subdomain is best: `A subdomain such as mail.yourcompany.com is best — it keeps this mail's reputation separate from the address you use every day, so a bad send can never affect your normal email.` If you use your main domain instead, a warning says so, but it is allowed.

On success you see `Domain added — now add the DNS records below`.

**The DNS records.** The card now shows your domain with a status badge and a table of records: **Type**, **Name** and **Value**, each with a copy button. Add each record at the company that manages your domain's DNS. The values come from the email provider, so they are different for every domain. The **Value** cell of an MX record ends with its priority.

Above the table: `Add these to your DNS, then check again. Changes usually appear within minutes but can take up to an hour.`

**Checking.** Click **Check DNS**. When the records are found you see `Verified — your mail now sends from your domain` and the badge changes to **Verified**. Otherwise `Not verified yet. DNS changes can take up to an hour to spread.` The page does not check on its own. A domain that verifies overnight shows as **Waiting for DNS** until you click the button. The third possible badge is **Failed**.

**Disconnect** removes the domain from Yosher, and mail goes back to the Yosher address: `Disconnected — mail falls back to the Yosher address`. There is no confirmation step.

Things to know: add only the records shown. Adding a second SPF or DMARC record of your own makes the check fail rather than tighten it. A domain can be verified for sending while your everyday mail still arrives somewhere else, which is exactly the split between this card and the next.

## Your own mailboxes

This card is described as `Real addresses on your own domain — yours to read here, on your phone, or in Outlook. This is separate from the sending setup above: that decides what leaves, this decides what arrives.`

**Adding your domain.** One field, **Your company domain**, for example `yourcompany.com`. The help text: `Use your main domain — the one your address already ends in. Adding it here changes nothing on its own: you will see exactly what to do next, and mail keeps arriving wherever it arrives today until you decide otherwise.` Click **Add domain**. You see `Added — nothing has changed yet.`, or `Added. Your mail currently goes to [provider] — nothing has changed yet.` when your mail already goes somewhere.

You cannot use the same domain you connected for sending above. If you try, the page tells you to host mailboxes on your main domain and keep the subdomain for notifications.

**Status.** The domain carries one badge: **Waiting for DNS**, **Ready to switch over**, **Receiving mail**, or **Rejected**. Until it is receiving mail, a note reads `Add these at your DNS provider. Mail keeps arriving where it does today until the MX record below actually changes — everything else here is preparation.` and the same kind of DNS table appears.

**Mailboxes.** The heading counts them, `Mailboxes (3)`. Create one with three fields: **Address**, the part before @, **Name**, and **Send setup link to**, which must be an address the person can already open. The help text: `They choose their own password from that link — it never passes through Yosher, so nobody here can read their mail. Send it to an address they can already open, not one at @[your domain].` Click **Create mailbox**. You see `[address] created — setup link sent to [their address]`.

Each mailbox row shows its address, name and status. `setup link sent` means the person has not set a password yet. To delete one, click the bin icon, type the full address to confirm, and click **Delete for good**. The empty list reads `None yet. Create everyone's mailbox before switching over, so no mail bounces during the change.`

**Switching over.** When the DNS check passes, a section headed **Switch mail over to Yosher** appears. Read its two warnings. The first, if you have not created mailboxes yet: `Create your mailboxes first.` Mail sent to an address that does not exist bounces back to the sender. The second: `This redirects every email sent to [your domain].` followed by where mail goes today, for example `Mail currently goes to Google Workspace. After this, it arrives here instead. Anything still sitting in the old system stays there — this moves future mail, not past mail.` Type your domain in the confirmation box and click **Switch mail over**. You see `[your domain] mail now arrives in Yosher`.

If the switch is refused, the message says why: the DNS records are not confirmed yet, or your MX record still points somewhere else and needs time to spread.

**Undoing it.** Once mail is arriving, a section headed **Undoing this** keeps the old mail records: `Mail used to go to [provider]. To send it back, replace the MX records at your DNS provider with exactly these. Keep this list — it is the only copy.` If the domain received no mail before, it says there is nothing to restore.

**The buttons.** **Check DNS** becomes **Re-check** once mail is arriving, and answers `DNS looks right — you can switch over when ready` or `Everything checks out`, or tells you what is still missing. **Stop managing this domain** removes it from Yosher; the mailboxes themselves stay at the mail host.

## Recent email

The last card lists the last 50 emails the system sent for you: **To**, **Subject**, **Status** and **Sent**. Its description: `What the system has sent for you, and what happened to it. A bounce here means the message never arrived.` Statuses are `queued`, `sent`, `delivered`, `bounced`, `complained` or `failed`. The list does not show why a message failed. Before anything has been sent it reads `Nothing sent yet.`

Sending has limits: 100 emails an hour for your business. If you hit it you see `That's the sending limit for now — try again shortly.` An attachment over 5 MB is refused with `That attachment is too large to email.`
