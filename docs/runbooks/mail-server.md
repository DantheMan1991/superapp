# Runbook — putting Stalwart on the internet

> **Read before:** buying a server for the inbox. §1 is the reasoning the whole
> shape rests on; §3 is what is left to do.
> **Update when:** a step turns out to be wrong, or the hosting choice changes.

Slices 0–7 built a mail client. It reads a Docker container on one laptop
(`STALWART_BASE_URL=http://127.0.0.1:8080`). This is what stands between that
and a mailbox a person can actually use.

---

## 1. The decision this runbook rests on

Everything else here is ordinary sysadmin work. This is the part that was
actually contentious, and it was settled before any money was spent.

### 1.1 A fresh IP has no sending reputation — and this project already ruled on that

The original evaluation (dossier, 2026-07-26) rejected running mail servers in
one line: *"deliverability is a multi-year reputation problem."* That judgement
was never overturned. Stalwart was chosen for the **inbox** — because Migadu
offers no OAuth, so the app could never read those mailboxes — not because
self-hosted *delivery* became a good idea.

A new VPS IP lands in spam at Gmail and gets rejected outright by some
providers, whatever the SPF/DKIM/DMARC say. And it fails **silently**: the
sender sees "Sent", the recipient never sees anything, and nobody finds out
until an invoice goes unpaid.

**So Stalwart does not deliver mail itself.** The two jobs are split:

```
   inbound   ──MX──▶  Stalwart  ──▶  stored, read over JMAP by Yosher
   outbound            Stalwart  ──relay :587──▶  Amazon SES  ──▶  the internet
                                                   ↑ reputation already earned
```

Stalwart handles receiving, storage, IMAP/JMAP and OAuth — the parts we need and
that nobody else will give us. Egress goes through a relay whose reputation is
somebody else's problem. This preserves the original evaluation rather than
quietly reversing it: a bad week for the VPS costs you *receiving*, not your
sending reputation.

Stalwart supports this natively — Settings → SMTP → Outbound → Relay Hosts. Its
own documentation names the reason: relays are useful *"when the originating
server should not perform direct delivery, for example because of firewall
constraints or IP-reputation issues."*

### 1.2 Why SES and not Resend

Resend was the first instinct because it is already in the stack. That was the
wrong test — the same one that picked Migadu, which the dossier already names:
**check the vendor against the destination, not against the step in front of
you.**

Every client domain must be *verified at the relay*, so "number of verified
domains" is the client ceiling:

| | Verified domains | Cost |
| --- | --- | --- |
| Resend Free | 1 | already spent on `in.yosherapp.com` |
| Resend Pro | **10** | $20–35/mo |
| Resend Scale | 1,000 | $90–1,150/mo |
| **Amazon SES (Essentials)** | **10,000 per region** | $0.16 per 1,000 |

Resend Pro walls you at ten clients. At 20 clients (~66k emails/month) SES
Essentials is about **$10/month** against Resend Scale's **$90+**.

Fit matters more than price: Resend divides the world into *Transactional* and
*Marketing*, and relaying a mail server's human correspondence is neither. SES is
literally a relay service. Resend keeps the jobs it is built for — the
transactional spine and inbound-to-Documents.

**On the SES plan:** take **Essentials**. Pro adds $105/month *and* a higher
per-email rate, and its headline feature is **Dedicated IPs** — a dedicated IP
starts with zero reputation, which is the exact problem SES was chosen to avoid.

### 1.3 Port 25 is not the blocker it looks like

Most providers block **outbound** 25 to stop spam, and an earlier draft of this
runbook called that the likely project-killer. With a relay it mostly evaporates:

- **Receiving** — other servers connect *to* you on 25. Nobody blocks inbound.
- **Sending** — you connect *out* to SES on **587**, not to the world on 25.

So no unblock request is needed. Do not go asking for one.

---

## 2. Domains

**Live state, verified by DNS lookup 2026-07-28:**

| Name | Purpose | Status |
| --- | --- | --- |
| `yosherapp.com` | MX at Migadu — the working mailboxes | Untouched |
| `in.yosherapp.com` | MX at SES inbound — **shipped documents email-in** | **Never touch** |
| `mail.yosherapp.com` | Reserved: `EMAIL_FROM_DOMAIN`, Resend sending domain | Leave alone |
| `bounce.yosherapp.com` | SES custom MAIL FROM | **Live** |
| `jmap.yosherapp.com` | Stalwart's HTTPS/JMAP endpoint | Awaiting the VPS |

**Sending and receiving are independent**, and separating them is what made this
safe. SES verification is about sending; MX is about receiving. `yosherapp.com`
is verified for sending through SES **while its MX still points at Migadu** —
nothing broke, and the cutover became a separate decision to make later on its
own merits.

The `in.yosherapp.com` rule is worth restating because the dossier already
records the trap: DNS panels list every record for a domain in one flat list, so
a mail host's "remove any pre-existing MX records" reads as though it means all
of them. It means the host being configured.

---

## 3. Steps

### 3.1 Server

Smallest thing that works: 2 vCPU / 4 GB / 40 GB SSD. Hetzner CX22 (~€4/mo) or
equivalent. Ubuntu 24.04.

- **You do NOT need an outbound port-25 unblock.** Outbound goes to SES on 587;
  inbound 25 (which nobody blocks) is what receiving needs. An earlier draft of
  this runbook said the unblock was the likely project-killer — that was written
  before the relay decision and is wrong.
- Set a **PTR / reverse DNS** record for the IP to `jmap.yosherapp.com`. Missing
  rDNS alone is enough for some receivers to reject you.
- Firewall: allow 25, 443, 587, 993. Do **not** expose 8080 — the admin UI.

### 3.2 DNS

**Egress is DONE.** Amazon SES was chosen over Resend as the relay (see §1.2), the
domain identity is `yosherapp.com` in **us-east-2**, and these are live and
verified as of 2026-07-28:

```
<token>._domainkey.yosherapp.com.  CNAME  <token>.dkim.amazonses.com   × 3
bounce.yosherapp.com.              MX 10  feedback-smtp.us-east-2.amazonses.com
bounce.yosherapp.com.              TXT    "v=spf1 include:amazonses.com ~all"
```

A custom **MAIL FROM** subdomain (`bounce`) was used deliberately, and it is the
reason the root SPF never had to be edited: the envelope sender lands on
`bounce.yosherapp.com`, so SES's `include:` goes on that subdomain's own record.
`yosherapp.com`'s SPF still reads `v=spf1 include:spf.migadu.com -all`, untouched,
and Migadu keeps receiving. Both SPF and DKIM align, so DMARC has two
independent ways to pass rather than resting on DKIM alone.

`_dmarc.yosherapp.com` already carried `v=DMARC1; p=none;`. SES lists a DMARC
record among its suggestions; **adding it would have created a second one**, and
DMARC fails closed on duplicates — it was skipped.

Still to add, once the VPS exists:

```
jmap.yosherapp.com.   A     <VPS IP>        the app's JMAP endpoint (TLS, no MX)
```

Plus reverse DNS on the VPS IP → `jmap.yosherapp.com`.

The MX cutover for `yosherapp.com` (Migadu → Stalwart) is a **separate, later**
decision. Sending and receiving are different records; the egress above works
regardless of where MX points.

One rule that still applies to everything above: **DMARC stays at `p=none`**
while this infrastructure is changing, and tightens later as its own deliberate
step. The dossier's reasoning holds — tighten too early and the first
misconfiguration starts landing in spam with no warning. DMARC at the
organizational domain covers subdomains unless `sp=` overrides it, so the
existing `p=none` already applies to `bounce.` and anything else added here.

### 3.3 Stalwart

Follow the vendor's install; the parts specific to us:

- **Hostname must have a real TLD.** The setup wizard silently rejects
  `localhost` and `mail.yosher.test` and reverts the field to the container id
  without saying why — recorded in the dossier and worth an hour of nobody's
  time to rediscover.
- TLS via ACME/Let's Encrypt on `jmap.yosherapp.com`. **Do not skip this:** the
  JMAP client is server-side `fetch`, which will not accept a self-signed
  certificate, and the failure looks like "couldn't reach the mail server".
- **Do NOT wire the SQL directory yet. Use Stalwart's own internal directory**
  and create your mailbox by hand in the admin UI.

  This reverses what an earlier draft of this runbook said, and the reason is
  concrete: **nothing in this codebase ever writes a password hash.**
  `stalwartHost.afterMailboxCreated` always inserts `passwordHash: null`, there
  is no hashing dependency in `package.json`, and **no invitation flow was ever
  built for Stalwart.** Migadu's host sent those setup links itself; Stalwart has
  no equivalent, and Yosher never grew one.

  So a SQL-backed directory pointed at Neon today would authenticate against a
  table whose `password_hash` is null for every row — an account nobody can ever
  log into. That is the failure the schema comment warned about, arriving from a
  direction it did not anticipate: not a wrong hash format, but no hash at all.

  The SQL directory is for **programmatic multi-tenant provisioning**, which is a
  later problem and needs three things first: a password-set flow (token, email,
  form), a hashing choice verified against Stalwart's supported list, and
  `npm run db:create-mail-role`. None of it is needed to prove the loop with one
  mailbox.

- **Outbound relay to Amazon SES** on 587 (Settings → SMTP → Outbound → Relay
  Hosts, then Routing), using SMTP credentials generated in the SES console —
  which are NOT your AWS keys. Region **us-east-2**, matching where the domain
  identity is verified. See §1.1 for why this is not optional.
- Take the admin password from the **first-run log**. Never the fixed
  `STALWART_RECOVERY_ADMIN` from `docker/stalwart/compose.yml` — that exists
  because the container is bound to localhost and holds nothing real.

### 3.4 Register the OAuth client

```bash
STALWART_BASE_URL=https://jmap.yosherapp.com NEXT_PUBLIC_APP_URL=https://<app> npm run mail:register-client
```

Stalwart implements RFC 7591 dynamic registration and accepts it
unauthenticated, so this is one POST. It asks for a **public** client
(`token_endpoint_auth_method: "none"`) because the flow already uses PKCE S256.

The redirect URI must match `NEXT_PUBLIC_APP_URL` **exactly**. The loopback-IP
rule that forces `127.0.0.1:3000` locally does not apply to a real HTTPS
origin — production uses the normal hostname.

### 3.5 Vercel

| Variable | Value | Notes |
| --- | --- | --- |
| `STALWART_BASE_URL` | `https://jmap.yosherapp.com` | |
| `STALWART_CLIENT_ID` | from §3.4 | |
| `CRON_SECRET` | 32+ random bytes | **DONE** (Production, confirmed 2026-07-28) |
| `EMAIL_DEV_REDIRECT` | your own address | **DONE** (Development + Preview, confirmed 2026-07-28) |
| `APP_ENCRYPTION_KEY` | already set | Mailbox tokens depend on it |

Rotating `APP_ENCRYPTION_KEY` now invalidates Plaid tokens **and** every mailbox
connection. One key, deliberately — two would live in the same environment on
the same server.

### 3.6 Migrations, and the cron trap

```bash
npm run db:migrate          # production. 0041–0048 are outstanding.
```

Eight migrations, two of which rewrite RLS policies (`0043`, `0048`). They are
applied to the dev branch and the isolation suite passes against it;
`docs/security.md` §8 requires both.

**`vercel.json` asks for `*/10 * * * *`. Vercel's Hobby plan runs cron once per
day.** On Hobby the job silently will not run at the stated frequency. Confirm
the tier or widen the schedule — the tab poller still keeps an open mail tab
fresh either way, so the cron is what serves everyone *else*.

---

## 4. Proving it, in order

Stop at the first failure; each step depends on the one above.

1. `dig MX m.yosherapp.com` resolves to `jmap.yosherapp.com`.
2. `openssl s_client -connect jmap.yosherapp.com:443` shows a valid chain.
3. Send mail from an outside account to an address on `m.yosherapp.com` and see
   it arrive in Stalwart's admin UI. **This is the step the local container
   could never do**, and the only genuinely new capability a server adds.
4. `npm run jmap:probe` against the real host. It is read-only and prints a
   FINDINGS block naming anything the code assumes that the server disagrees
   with — it has earned itself twice, catching two wrong response shapes and a
   hostname that would have 404'd every attachment.
5. Connect the mailbox in Yosher over OAuth. The callback proves the token opens
   *the* mailbox, not merely *a* mailbox.
6. Read the message. Reply to it, and confirm the reply arrives at the outside
   account — that exercises the relay from §1.2.
7. Check `mail_accounts.inbox_unread` moves, and that `/api/cron/mail-sync`
   returns 404 without the secret and runs with it.

---

## 5. What this does not solve

- **Deliverability is still the relay's**, which is the point. If SES suspends
  the account, outbound stops — and SES enforces at the ACCOUNT level, so one
  compromised client mailbox spamming could take out every client's sending.
  Mitigate with a configuration set per tenant so the reputation dashboard shows
  whose mail is causing it, and watch the bounce/complaint rates.
- **One server, no redundancy.** A VPS reboot is a mail outage. Receiving mail
  retries for days, so this is survivable, but it is not a mail *service* yet.
- **Backups are yours now.** Stalwart's store holds the only copy of received
  mail. Nothing in this repo backs it up.
- **Token refresh has never been exercised** — the first token has not expired.
  Force it before relying on it.
- **Everything is proven against one account and one message.** No multi-account
  switching, no delegation, no thread expansion.
