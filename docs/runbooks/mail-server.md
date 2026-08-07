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

### 3.3 Stalwart — what actually happened, 2026-07-30

The install took far longer than it should have. Recorded so it does not
repeat.

**The config file is tiny, and it IS the DataStore object.** Stalwart docs say
`config.json` "only needs to contain the DataStore object", and that is literal.
Everything else — hostname, directory, accounts, TLS — lives inside the store,
which is why `--console` also needs `--config` to open. The whole file:

```json
{
  "@type": "RocksDb",
  "path": "/var/lib/stalwart/data"
}
```

Wrapping it in a `storage` object with per-role paths fails with
`missing field '@type' at line 9 column 1`, where line 9 is the closing brace —
meaning it wanted `@type` at the TOP level.

**Bind-mount `/etc/stalwart`, do not use a named volume.** You will edit this
file, and reaching inside a named volume to do that is miserable.

**Without a config file the server sits in bootstrap mode** on port 8080 with a
listener named `http-recovery`, reporting `hostname = <container id>`. The web
UI in that state authenticates over OAuth with a PKCE challenge in the URL, and
**every container restart wipes the server-side OAuth state**. Reloading a
`/login?...code_challenge=...` URL after a restart therefore fails, and the UI
reports it as "Invalid username or password" because that is the only error it
draws. Hours went into that one sentence.

**`STALWART_RECOVERY_ADMIN=user:password` is real** and documented, and when set
no temporary password is generated. It is a rescue credential, not a login —
take it back out of the compose file once a real admin exists.

**`STALWART_PUBLIC_URL` is REQUIRED, and omitting it locks you out of the admin
UI.** This cost a second evening. With no hostname configured the server builds
every OAuth, OIDC and JMAP discovery URL from the container id:

```
issuer                   https://1053706f429e
authorization_endpoint   https://1053706f429e/login
token_endpoint           https://1053706f429e/auth/token
```

The admin UI is an OAuth client. It posts your credentials, the server accepts
them and returns a code, and then the browser tries to redeem that code against
a hostname that resolves nowhere. The UI draws the resulting failure as
"Invalid username or password" — the same string as a genuinely wrong password,
on a completely healthy server with a completely valid credential. Set it in
the compose environment alongside the recovery admin:

```yaml
STALWART_PUBLIC_URL: "https://jmap.yosherapp.com"
```

Setting the hostname is not cosmetic housekeeping for SMTP HELO. It is a
prerequisite for logging in at all.

**Test a credential without a browser — do this BEFORE touching anything.**
The login form posts to `/api/auth`, which is POST-only (a GET returns 404 and
means nothing):

```bash
curl -sk -X POST https://<host>/api/auth -H "Content-Type: application/json" \
  -d '{"type":"authCode","accountName":"admin","accountSecret":"<pw>",
       "clientId":"webadmin","redirectUri":"https://<host>/admin/oauth/callback"}'
```

A valid credential returns `{"type":"authenticated","client_code":...,"iss":...}`
and an invalid one returns `{"type":"failure"}`. **Both are HTTP 200** — read
the body, not the status. Always run it a second time with a deliberately wrong
password as a control, then read `iss` in the success response: that is where
the hostname bug announces itself.

**The admin UI lives at `/admin/`.** The root 302-redirects to `/account`, which
is the end-user login and authenticates against the mail directory — so the
recovery admin is correctly rejected there. **`/account/` is self-service only
(settings, credentials, mailbox counters, sieve). Stalwart ships no webmail**,
so there is no way to read a message in a browser. Use an IMAP client on 993,
or Yosher — which is the point.

**Stalwart logs NOTHING once it has a config file.** No stdout, nothing in
Observability, not even at boot. Telemetry subscribers are opt-in and none
exists by default. **Configure one before doing anything else** — Settings →
Telemetry, console subscriber at `info`. Every hard problem here (the OAuth
hostname, ACME's silence) was diagnosed by probing from outside because the
server would not speak. That is a terrible way to run a mail server and it
wasted two evenings.

**ACME certificates are bound to Domain records, not configured server-wide,
and are NOT obtained on demand via SNI.** The AcmeProvider only holds the
account; each Domain sets `certificateManagement` to `Automatic` carrying an
`acmeProviderId`. A provider with a registered Let's Encrypt account and no
domain referencing it sits idle forever and says nothing. Because the cert is
needed for the HTTPS host rather than the mail domain, **create a Domain record
for `jmap.yosherapp.com` purely to own the certificate** — the mail domain
(`m.yosherapp.com`) has only an MX record, so TLS-ALPN-01 has nothing to
connect to on 443 and would fail.

**A self-signed cert is NOT cosmetic — it blocks the app.** SMTP tolerates it
via opportunistic TLS, so mail flows fine. Node.js does not: every JMAP call
from Yosher fails verification (`verify error:num=18`). TLS is a prerequisite
for connecting the app, not a finishing touch.

**ACME errors are NEVER written to the log. They live on the task object.**
This is the single most expensive thing on this page. The log only ever repeats
`WARN No TLS certificates available (tls.no-certificates-available) total = 0`,
which tells you nothing. The real error is in `x:Task/get`:

```
@type: AcmeRenewal, attemptNumber: 1, @type(status): Retry
failureReason: "Status: invalid; Challenge type: tls-alpn-01,
  error: DNS problem: NXDOMAIN looking up A for ua-auto-config.jmap.yosherapp.com"
```

**The cause: Stalwart adds its own auto-configuration hostnames to the
certificate request** (`ua-auto-config.`, `autoconfig.`, `autodiscover.` — see
the domain's `dnsZoneFile` property for the full list). None of them exist in
DNS, and Let's Encrypt fails the WHOLE order if any single identifier does not
resolve. **The fix is to pin `certificateManagement.subjectAlternativeNames` to
exactly the hostname you want**, which constrains the request to that one name.
Adding the CNAMEs also works but is not necessary.

**A failed AcmeRenewal task does NOT retry on its own** even once `due` has
passed. Destroy it and re-trigger, or nothing happens no matter how many times
you restart:

```
x:Task/set   {"destroy": ["<taskId>"]}
x:Domain/set {"update": {"<id>": {"certificateManagement": {"@type": "Manual"}}}}
x:Domain/set {"update": {"<id>": {"certificateManagement": {"@type": "Automatic",
               "acmeProviderId": "...", "subjectAlternativeNames": {"host": true}}}}}
```

Issuance then takes seconds. Verify with
`curl -s -o /dev/null -w "%{ssl_verify_result}"` (no `-k`) — `0` means a strict
client such as Node will accept it.

**Logging writes to a FILE and the directory must exist AND be writable by uid
2000.** The default tracer is `{"@type":"Log","path":"/var/log/stalwart",
"enable":true,"level":"info"}` — nothing goes to stdout, so `docker compose
logs` is always empty, and Observability in the UI is Enterprise-only
(`x:Trace` returns `forbidden`). Bind-mount `./logs:/var/log/stalwart` in
compose and `chown -R 2000:2000 logs`. Without the chown the container cannot
write and fails silently.

**The management API is JMAP with `x:`-prefixed types**, not `/api/*` (those all
404). Useful ones: `x:Domain`, `x:AcmeProvider`, `x:Certificate`, `x:Task`,
`x:NetworkListener`, `x:Tracer`, `x:Principal`. Get a bearer token via
`/api/auth` then `/auth/token`, and POST to `/jmap/` with
`using: ["urn:ietf:params:jmap:core","urn:stalwart:jmap"]`. This is how the
whole certificate problem was diagnosed without shell access.

**`Emails → Delivery tests` bypasses outbound routing** and traces DIRECT MX
delivery, so it never exercises the relay. On Hetzner it always fails —
outbound port 25 is blocked (IPv4 connections hang the full 30s, the signature
of a silent drop; IPv6 returns `Network is unreachable (os error 101)` because
the box has no IPv6 route). **This is expected and is not a relay failure.**
Testing the SES relay requires a real queued message. Do not request the
Hetzner port-25 unblock: nothing needs it, and an unused open egress port is
only useful to an attacker.

**Do not use SES "Mail Manager SMTP"** even though the console marks it
Recommended. It bills per message processed and rotates the password via
Secrets Manager; Stalwart stores a static secret and cannot follow a rotation,
so outbound would fail silently on rotation day. Use **IAM SMTP credentials**.

**`docker compose up -d --force-recreate` did not reliably recreate the
container.** It printed only `Started`, and a stale container kept an old
environment. `docker compose down` then `up -d` prints `Removed`, which is the
one to trust when an env var change must land.

**`docker compose logs --tail N` shows accumulated crash-loop output.** A fixed
container that is `Up (healthy)` will still show pages of the old error. Check
`docker ps` status and probe the ports from outside before believing the log.

### 3.3b Verified working, 2026-07-30

```
220 <hostname> Stalwart ESMTP at your service     ← inbound 25, from the internet
```

Ports 25, 443 and 993 serving. 80 and 587 still closed, expected until ACME and
submission are configured. **Inbound port 25 reachability is the thing that
could have made self-hosting impossible, and it is confirmed.**

Still to do: hostname (currently the container id, and receivers check HELO
against reverse DNS), TLS via ACME, the mail domain, a mailbox, the SES relay,
and `npm run mail:register-client`.

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

**`vercel.json` asks for `*/10 * * * *`, and the plan now allows it.** This
used to read "confirm the tier": Hobby runs cron once per day, so the job
silently did not run at the stated frequency. The founder confirmed on
2026-08-06 that the account is off Hobby, so the configured schedule is the
real one.

**Worth verifying once against actual invocation logs rather than assuming.**
If the job really was running daily before, then mail sync, snooze wakes,
scheduled sends and auto-filing were all landing up to 24 hours late and are
now ~144× more frequent — a real change in load on Stalwart and on the
database, arriving without any deploy. The tab poller keeps an open mail tab
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
