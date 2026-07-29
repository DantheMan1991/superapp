# Runbook — putting Stalwart on the internet

> **Read before:** buying a server for the inbox. The two things that decide
> whether this works are in §1, and neither of them is DNS.
> **Update when:** a step turns out to be wrong, or the hosting choice changes.

Slices 0–7 built a mail client. It reads a Docker container on one laptop
(`STALWART_BASE_URL=http://127.0.0.1:8080`). This is what stands between that
and a mailbox a person can actually use.

---

## 1. The two things that will actually stop you

Everything else here is ordinary sysadmin work. These two are why "just rent a
VPS" is not the whole answer, and they need deciding **before** money is spent.

### 1.1 Port 25 outbound is blocked almost everywhere

A mail server that cannot open outbound connections on port 25 cannot deliver
mail to anybody. Most providers block it by default to stop spam:

| Provider | Outbound 25 |
| --- | --- |
| DigitalOcean | Blocked. Unblock is discretionary and often refused |
| Vultr | Blocked on new accounts |
| Google Cloud | Blocked permanently, no exceptions |
| AWS EC2 | Throttled; unblock form, usually granted |
| Oracle Cloud | Blocked |
| **Hetzner** | Blocked at signup, **unblocked on request** — usually granted for an aged account with a reason |
| **Fly.io** | Allowed with a dedicated IPv4 |
| OVH / Scaleway | Generally allowed |

**Check this before paying for anything.** Discovering it after the box is
built is the single most common way this project stalls.

### 1.2 A fresh IP has no sending reputation — and this project already decided that matters

The original evaluation (dossier, 2026-07-26) rejected running mail servers with
one line: *"deliverability is a multi-year reputation problem."* That judgement
has not been overturned. Stalwart was chosen for the **inbox** — because Migadu
offers no OAuth and so the app could never read those mailboxes — not because
self-hosted delivery became a good idea.

A new VPS IP will land in spam at Gmail and be rejected outright by some
providers, whatever the SPF/DKIM/DMARC say.

**So do not send directly from Stalwart.** Split the two jobs:

```
   inbound mail  ──MX──▶  Stalwart  ──▶  stored, read over JMAP by Yosher
   outbound mail          Stalwart  ──relay──▶  Migadu (or SES/Postmark)
                                                  ↑ reputation already earned
```

Stalwart handles receiving, storage, IMAP/JMAP and OAuth — the parts we need and
the parts nobody else will give us. Outbound relays through a smarthost whose
reputation is somebody else's problem. Migadu is already paid for and already
delivers for `yosherapp.com`, which makes it the obvious first choice.

This preserves the original evaluation instead of quietly reversing it, and it
means a bad week for the VPS costs you *receiving*, not your sending reputation.

---

## 2. The domain decision

**Live state, verified by DNS lookup on 2026-07-28:**

| Name | MX | What depends on it |
| --- | --- | --- |
| `yosherapp.com` | `aspmx1/2.migadu.com` | The real mailboxes. **Working.** |
| `in.yosherapp.com` | `inbound-smtp.us-east-1.amazonaws.com` | **Documents email-in — shipped and in use.** |
| `mail.yosherapp.com` | none | Reserved: `EMAIL_FROM_DOMAIN`, the Resend sending domain |

Three rules fall out of that:

1. **Do not touch `in.yosherapp.com`.** It carries the folder-inbound feature.
   The dossier already records this trap: DNS panels list every record for a
   domain in one flat list, so a mail host's "remove any pre-existing MX
   records" reads as though it means all of them. It means the host being
   configured.
2. **Do not use `mail.yosherapp.com`.** `EMAIL_FROM_DOMAIN` is already set to it
   in Vercel. Pointing an MX there would collide with the sending domain.
3. **Do not move `yosherapp.com`'s MX yet.** That is the takeover the dossier
   warns about — *"when an MX cutover breaks, the business stops receiving, and
   nobody notices for hours because a quiet inbox looks exactly like a quiet
   day."*

### Recommended: prove it on a name nothing depends on

Give Stalwart its own subdomain for the **HTTPS/JMAP endpoint**, and host mail
for a **separate name** to start:

```
jmap.yosherapp.com   A → <VPS IP>     the app connects here (TLS, no MX)
m.yosherapp.com      MX → jmap.yosherapp.com    addresses live here
```

Addresses are then `dan@m.yosherapp.com`. Not beautiful, and it does not have to
be — it proves the whole loop (receive → store → OAuth → read in Yosher → reply)
without putting a single working mailbox at risk. Moving `yosherapp.com` off
Migadu afterwards is the *same procedure* run once more, with the
already-built cutover flow, `previous_mx` capture and all.

---

## 3. Steps

### 3.1 Server

Smallest thing that works: 2 vCPU / 4 GB / 40 GB SSD. Hetzner CX22 (~€4/mo) or
equivalent. Ubuntu 24.04.

- Request the port-25 unblock **first**, and wait for it.
- Set a **PTR / reverse DNS** record for the IP to `jmap.yosherapp.com`. Missing
  rDNS alone is enough for some receivers to reject you.
- Firewall: allow 25, 443, 587, 993. Do **not** expose 8080 — the admin UI.

### 3.2 DNS

```
jmap.yosherapp.com.   A     <VPS IP>
m.yosherapp.com.      MX 10 jmap.yosherapp.com.
m.yosherapp.com.      TXT   "v=spf1 include:spf.migadu.com -all"     ← the RELAY, not the VPS
_dmarc.m.yosherapp.com. TXT "v=DMARC1; p=none; rua=mailto:…"
```

Two notes that will otherwise cost an afternoon:

- **SPF names the smarthost, not the VPS**, because the smarthost is what
  actually connects to the recipient. Getting this backwards is why relayed mail
  fails SPF.
- **`p=none` to start.** The dossier's rule: keep DMARC permissive while mail
  infrastructure is changing and tighten later as its own step, or the first
  misconfiguration starts landing in spam with no warning. Note DMARC at the
  organizational domain covers subdomains unless `sp=` overrides it — so
  `yosherapp.com`'s existing `p=none` already applies here.
- DKIM comes **from Stalwart** once it generates a key; add that record after
  §3.3.

### 3.3 Stalwart

Follow the vendor's install; the parts specific to us:

- **Hostname must have a real TLD.** The setup wizard silently rejects
  `localhost` and `mail.yosher.test` and reverts the field to the container id
  without saying why — recorded in the dossier and worth an hour of nobody's
  time to rediscover.
- TLS via ACME/Let's Encrypt on `jmap.yosherapp.com`. **Do not skip this:** the
  JMAP client is server-side `fetch`, which will not accept a self-signed
  certificate, and the failure looks like "couldn't reach the mail server".
- **Directory: SQL, pointed at Neon**, reading `mail_directory_accounts`. That
  table and `npm run db:create-mail-role` already exist for exactly this. The
  role has SELECT on that one table and nothing else, and the script *proves*
  the boundary by connecting as it and confirming it cannot read `tenants`,
  `documents`, `invoices` or `mail_accounts`.
  - `npm run db:create-mail-role` **has never been run.** It prints a live
    connection string, so run it in your own terminal, not in a transcript.
  - **Password hash format is still unconfirmed** (open item in the dossier).
    Verify Stalwart accepts what `mail_directory_accounts.password_hash` holds
    *before* provisioning anybody — guessing produces an account nobody can log
    into.
- **Outbound relay** to Migadu on 587 with the Migadu credentials, per §1.2.
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
| `CRON_SECRET` | 32+ random bytes | Sync **fails closed** without it |
| `EMAIL_DEV_REDIRECT` | your own address | **Preview only.** Compose refuses to send without it |
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

- **Deliverability is still the smarthost's**, which is the point. If Migadu
  ever stops relaying, outbound stops — the same dependency the send spine
  already has.
- **One server, no redundancy.** A VPS reboot is a mail outage. Receiving mail
  retries for days, so this is survivable, but it is not a mail *service* yet.
- **Backups are yours now.** Stalwart's store holds the only copy of received
  mail. Nothing in this repo backs it up.
- **Token refresh has never been exercised** — the first token has not expired.
  Force it before relying on it.
- **Everything is proven against one account and one message.** No multi-account
  switching, no delegation, no thread expansion.
