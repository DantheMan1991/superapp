# Mail infrastructure

> The server side of the inbox: the Stalwart instance Yosher runs, the SES
> relay it sends through, and the DNS that makes both deliverable. The Mail
> module ([email.md](email.md)) is the product; this is the plumbing it sits
> on. Operational steps live in
> [runbooks/mail-server.md](../runbooks/mail-server.md); the reasoning for
> self-hosting at all is [ADR 0003](../decisions/0003-self-hosted-mail-over-provider-apis.md).
> Status: live (single server, no redundancy) · Scope: `platform`

## Build log

Newest first. One entry per session/PR that touched this area. Every PR
that changes it MUST add an entry here (rule in AGENTS.md).

### 2026-08-01 — What it actually took to get Stalwart serving (`3463a13`)
- The install log written up in the runbook §3.3 so the next one is an hour,
  not a day.
- The loop closed the same day: mail sent from Gmail arrived at
  `dan@m.yosherapp.com` and was read in Yosher. Recorded in
  [email.md](email.md) — every earlier entry there was written against a
  container on a laptop that could not receive from the internet.
- **A self-signed certificate blocks the app even though mail keeps flowing.**
  SMTP tolerates it through opportunistic TLS; Node rejects it outright
  (`verify error:num=18`). Mail arriving made everything look finished while
  the module could not connect at all. TLS is a prerequisite, not a polish
  step.

### 2026-07-30 — Stalwart on a real server (`bbdbf13`, `007afdb`)
- Hetzner box, Ubuntu 24.04, `m.yosherapp.com` as the mail domain with the
  apex left on Migadu untouched. Let's Encrypt via ACME.
- Ports 25, 443 and 993 confirmed serving from the internet.
  **Inbound port 25 reachability was the thing that could have made
  self-hosting impossible, and it is confirmed.**
- `npm run mail:register-client` issues `STALWART_CLIENT_ID`.
- **The SQL directory was left unwired on purpose** (`007afdb`): pointing
  Stalwart's directory at the app database would have locked every user out.

### 2026-07-30 — SES as the relay, and the egress is live (`88b3ca7`)
- Amazon SES (Essentials, `us-east-2`) chosen over Resend as the outbound
  relay. Resend's plan walls at ten verified domains — one per client domain
  — which caps the business at ten clients; SES allows 10,000 per region.
- DKIM CNAMEs ×3, `bounce.yosherapp.com` MX + SPF live and verified.
- **A custom MAIL FROM subdomain is why the root SPF never had to change.**
  The envelope sender lands on `bounce.yosherapp.com`, so SES's `include:`
  goes on that subdomain's record. `yosherapp.com` still reads
  `v=spf1 include:spf.migadu.com -all` and Migadu keeps receiving. SPF and
  DKIM both align, so DMARC has two independent ways to pass.
- **SES suggests adding a DMARC record; adding it would have created a
  second one, and DMARC fails closed on duplicates.** Skipped.

### 2026-07-28 — The runbook (`11e0080`)
- The plan for putting Stalwart on the internet, written before the server
  existed.
- **The earlier claim that outbound port-25 blocking was the likely
  project-killer was wrong**, and the runbook says so in place rather than
  quietly deleting it. Outbound goes to SES on 587. Inbound 25, which nobody
  blocks, is what receiving needs.

## Data model

No tables. This is infrastructure — the module's tables are in
[email.md](email.md). What stands in for a schema here is DNS:

| Record | Purpose | Rule |
| --- | --- | --- |
| `<token>._domainkey.yosherapp.com` CNAME ×3 | SES DKIM | Live |
| `bounce.yosherapp.com` MX + TXT | SES custom MAIL FROM | Live — the reason root SPF is untouched |
| `yosherapp.com` SPF | Still `include:spf.migadu.com -all` | **Do not edit** |
| `_dmarc.yosherapp.com` | `v=DMARC1; p=none;` | **Exactly one record.** Stays at `p=none` while the infrastructure moves |
| `m.yosherapp.com` | The mail domain Stalwart serves | Apex MX stays on Migadu |
| `jmap.yosherapp.com` | The app's JMAP endpoint (TLS, no MX) | Needs matching reverse DNS on the VPS IP |

## Key files & seams

- `docs/runbooks/mail-server.md` — the operational procedure, step by step
- `scripts/mail-register-client.ts` (`npm run mail:register-client`)
- `STALWART_BASE_URL`, `STALWART_CLIENT_ID` — the app's side of the seam
- `src/lib/email/` — the send path that hands off to the relay

## Decisions & gotchas

- **Sending and receiving are different records.** `yosherapp.com` is verified
  for sending through SES while its MX still points at Migadu. The MX cutover
  is a separate, later decision.
- **Never expose port 8080** — that is Stalwart's admin UI. Firewall allows
  25, 443, 587, 993 only.
- **Missing reverse DNS alone is enough for some receivers to reject you.**
  PTR must resolve to the HELO hostname.
- **DMARC tightens later, as its own deliberate step.** Tighten too early and
  the first misconfiguration lands in spam with no warning.
- Relaying human correspondence is neither transactional nor marketing mail,
  which is why a relay service was the right category and a transactional API
  was not.

## Open items

- **SES enforces at the account level.** One compromised client mailbox
  spamming could suspend outbound for every client. Mitigation designed but
  not built: a configuration set per tenant so the reputation dashboard shows
  whose mail is causing it.
- **One server, no redundancy.** A reboot is a mail outage. Receiving retries
  for days, so it is survivable — but this is not a mail *service* yet.
- **No backups.** Stalwart's store holds the only copy of received mail and
  nothing in this repo backs it up.
- **Token refresh has never been exercised** — the first token has not
  expired. Force it before relying on it.
- Everything is proven against one account and one message: no multi-account
  switching, no delegation.
