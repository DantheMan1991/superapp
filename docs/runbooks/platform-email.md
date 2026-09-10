# Runbook — the platform's own email

> **Read before:** adding a DNS record to the platform's domain, changing
> `EMAIL_FROM_DOMAIN`, or working out why nothing the platform sends is
> arriving. §1 is which system owns what, and getting that wrong is how the
> damage happens; §2 is the one that breaks; §3 is standing it up.
> **Update when:** a subdomain changes hands, or a step turns out to be wrong.

## 1. Four mail systems, one domain

The platform's domain carries several unrelated mail systems. They look alike
from a DNS panel and they are not, so **read this table before touching a
record**.

| Subdomain | Owner | What it does |
| --- | --- | --- |
| `mail.` | **Resend** | What the PLATFORM sends: share links, invoices, reminders, the daily digest, website enquiries, health-check leads. `EMAIL_FROM_DOMAIN` |
| `in.` | **Resend inbound** | Receipts emailed into Accounting — `receipts-{token}@in.…`, handled by `/api/inbound/resend`. `INBOUND_EMAIL_DOMAIN` |
| `m.` | **Stalwart** | The mail domain a TENANT's own mailboxes live on — a different product, read inside Yosher. See [mail-server.md](mail-server.md) |
| `bounce.` | **SES** | The custom MAIL FROM for Stalwart's outbound relay. The reason the apex SPF is untouched |
| `jmap.` | **Stalwart** | The app's JMAP endpoint |
| `clerk.` | **Clerk** | Sign-in |
| the APEX | **Migadu** | The founder's own mailbox. `MX` → migadu, `SPF` → `include:spf.migadu.com -all` |

### The rules that keep them apart

- **Never add or edit a record on the apex for any of this.** The apex SPF is
  `include:spf.migadu.com -all` and [mail-infrastructure.md](../modules/mail-infrastructure.md)
  marks it *do not edit*. Every subdomain carries its own SPF, so nothing a
  sending provider needs belongs on the apex.
- **`_dmarc` is exactly one record**, at `p=none`, on the apex. Subdomains
  inherit it. If a provider offers to add a DMARC record, decline — two
  `_dmarc` records at one name is an invalid policy and mail starts failing
  everywhere at once.
- **A sending domain is always a subdomain.** It keeps this mail's reputation
  separate from the address the business reads every day: a bad send can never
  take down the founder's own inbox.

## 2. The failure this runbook exists for

**Symptom.** Nothing the platform sends arrives. No error anywhere a person
looks — no red banner, no alert. The daily digest simply stops.

**Where to look.** `outbound_emails` is the send log, and it records the
refusal:

```sql
select status, count(*) from outbound_emails
where created_at > now() - interval '14 days' group by status;

select kind, status, from_address, error, created_at
from outbound_emails order by created_at desc limit 5;
```

`status = 'failed'` with `error` reading *"The <domain> domain is not
verified"* means exactly what it says: `EMAIL_FROM_DOMAIN` names a domain
Resend has not verified. **Every send is rejected and nothing else reports
it.** In September 2026 that state ran for two days and 44 messages —
including every daily digest — before anybody noticed, because the only
evidence was a column in a table nobody was reading.

**Two ways to be in it:**

1. The domain was never verified in Resend.
2. It was verified, but under a different name than `EMAIL_FROM_DOMAIN`
   holds. Resend verifying `mail.example.com` while the variable says
   `example.com` fails exactly the same way, with the same message.

**Worth building one day:** nothing watches this. A failed-send count on the
console's health signals, or an alert on the first failure of a day, would
turn a two-day silence into a two-minute one. Recorded as an open item in
[email.md](../modules/email.md).

## 3. Standing up a sending domain

Done once per deployment. The example is the production one, set up
2026-09-10.

1. **Resend → Domains → Add Domain.** Enter the SUBDOMAIN —
   `mail.yosherapp.com`, not `yosherapp.com`.
2. **Open Advanced options and check the region.** Match whatever the inbound
   domain already uses (`us-east-1` here — read it off the `in.` MX record:
   `nslookup -type=MX in.yosherapp.com`). The region cannot be changed
   afterwards without re-adding the domain.
3. **Add the DNS records.** Resend shows three:

   | Type | Name | Purpose |
   | --- | --- | --- |
   | TXT | `resend._domainkey.mail` | DKIM public key |
   | TXT | `send.mail` | SPF, `v=spf1 include:amazonses.com ~all` |
   | MX | `send.mail` | Bounces, `feedback-smtp.<region>.amazonses.com` |

   **Auto configure is the safer option** where the DNS host supports it
   (Vercel does). Not for convenience: every one of these names is relative,
   and a DNS panel that appends the zone turns a pasted
   `send.mail.example.com` into `send.mail.example.com.example.com`.
   Verification then hangs with nothing explaining why. The integration cannot
   make that mistake; a person reliably can.

   Read the consent dialog before allowing it. It should list **three records,
   all under the subdomain, and no DMARC**. Anything on the apex is a reason
   to cancel and do it by hand.

4. **Take a baseline first if you are letting a provider write to DNS**, so
   "did it touch anything else" is answerable rather than a matter of trust:

   ```bash
   nslookup -type=TXT yosherapp.com 8.8.8.8         # apex SPF
   nslookup -type=MX  yosherapp.com 8.8.8.8         # apex MX
   nslookup -type=TXT _dmarc.yosherapp.com 8.8.8.8  # exactly one
   ```

5. **Check the records resolve before pressing Verify.** Resend's own poller
   lags — it says "this may take a few hours" while the records are already
   live — and a mistyped name is far quicker to find here than through a
   failed verification:

   ```bash
   nslookup -type=TXT resend._domainkey.mail.yosherapp.com 8.8.8.8
   nslookup -type=TXT send.mail.yosherapp.com 8.8.8.8
   nslookup -type=MX  send.mail.yosherapp.com 8.8.8.8
   ```

   Compare the DKIM value's tail against what Resend shows — a truncated key
   verifies as absent.

6. **Set `EMAIL_FROM_DOMAIN` on the host to the domain you just verified**,
   character for character, and redeploy if it changed.

7. **Prove it.** *Email setup → Send a test to → your address.* It sends a
   real message down the real path — deliberately, since a test through a
   different path proves nothing. A success toast names the address it sent
   from.

   Then confirm from the log, because the toast only says the API accepted it:

   ```sql
   select kind, status, from_address, error from outbound_emails
   order by created_at desc limit 3;
   ```

   A row reading `sent` with an empty `error` is the proof.

   **Re-clicking inside the same minute does nothing.** The idempotency key is
   bucketed to the minute, so a second click returns the first result. After
   fixing something, wait for the minute to turn before retrying or you will
   read a cached failure as a live one.

8. **Watch one unattended send.** The button proves the path with a person on
   it; the daily digest proves it with nobody there. If tomorrow's digest is
   `sent`, the job is done.

## Notes

- **Resend was rejected as the relay for TENANT mail** and chosen for the
  platform's own — its plan walls at ten verified domains, which is one per
  client domain ([mail-infrastructure.md](../modules/mail-infrastructure.md)).
  Tenant sending goes through SES. Do not consolidate them without re-reading
  that decision.
- **A tenant can connect its own sending domain**, and then its mail leaves as
  `invoices@mail.theirdomain.com` rather than from ours
  ([ADR 0020](../decisions/0020-a-connected-domain-is-records-only.md)).
  `EMAIL_FROM_DOMAIN` is the fallback every tenant uses until they do, so it
  is never unused.
- **Outside production every recipient is rewritten** to `EMAIL_DEV_REDIRECT`,
  and sending refuses outright when that is unset. A branch preview cannot
  mail a real customer.
