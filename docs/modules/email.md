# Email (outbound spine)

> Everything the platform sends on a client's behalf — share links today,
> invoices and signature requests next — goes through one seam. Its whole
> reason for existing is **which address the mail comes from**: a client's own
> domain wherever possible, never an anonymous third-party address.
> Status: `live` · Scope: `platform` <!-- keep Status on ONE line — /admin/docs parses it -->


## Build log

Newest first. One entry per session/PR that touched this module. Every PR
that changes this module MUST add an entry here (rule in AGENTS.md).

### 2026-07-25 — Initial build: send seam + tenant sending domains (branch `claude/email-spine`)

Two tables (`0030`/`0031`), a transport seam, an owner-only DNS wizard at
`/dashboard/email`, a delivery webhook, and share-link emailing as the first
caller.

Founder framing that set the direction: outbound tooling that mails from a
strange third-party address is exactly what he did *not* want. A parallel
session ("Email system with company domains") had already landed on connecting
Microsoft first and treating the mail source as a swappable adapter — this
build is the piece underneath both: one `sendEmail()` seam that resolves a
per-tenant sender identity, so a future "send through their connected mailbox"
transport slots in without touching a single caller.

## Data model

| Table | Purpose | Notes (RLS, invariants, FKs) |
| --- | --- | --- |
| `email_domains` | A tenant's verified sending domain | One per tenant, and a domain can only be claimed once platform-wide. `dns_records` jsonb feeds the wizard. **`member_read` only** — a member who could set `status='verified'` could make the app send as a domain they never proved they own |
| `outbound_emails` | The send log | `(tenant_id, idempotency_key)` unique is what makes a retry a no-op. Recipient addresses stored in the CLEAR (see Decisions). **`member_read` only** — a forgeable "delivered" is worse than no log |

## Key files & seams

- `src/lib/email/identity.ts` — pure. Decides From/Reply-To. The highest-value
  tests in this area point here.
- `src/lib/email/send.ts` — the seam every caller uses: dev guard, caps,
  idempotency claim, provider call, log row.
- `src/lib/email/domains.ts` — provider domain create/verify/read. All writes
  under `withSystem`.
- `src/app/dashboard/email/` — owner-only wizard and send log.
- `src/app/api/email/events/route.ts` — svix-verified delivery webhook.
- First caller: `emailShareAction` in `src/modules/documents/share-actions.ts`.

## Decisions & gotchas

**You cannot fake the From header.** This is the fact the whole design turns
on. Mail claiming to be from `acmebuilders.com` but signed by our keys fails
SPF/DKIM alignment and DMARC rejects it. Sending as someone requires their DNS
to say you may — hence a verification wizard rather than a text field.

**The fallback is deliberately not anonymous.** Before a tenant verifies
anything, mail goes out as `"Acme Builders" <notifications@…>` with `Reply-To`
pointed at the business. That is a long way from `noreply@sometool.com`, and it
means the feature is useful on day one rather than after a DNS chore.

**A subdomain is strongly preferred** (`mail.acme.com`, not `acme.com`). It
keeps this traffic's sending reputation separate from the owner's everyday
email, so a bad send can never poison their personal mail. The UI says so and
warns — but does not block — when a root domain is used.

**Display names are sanitized before they reach a header.** A tenant named
`Acme" <evil@attacker.com>` must not become a second address. There is a test.

**Recipient addresses are stored in the clear, on purpose.** They are the
tenant's own record of their own correspondence, behind RLS, and a send log
that cannot tell you who you sent to is not a send log. They are kept OUT of
the audit log, which is identifiers-only and superadmin-visible — so
`share.emailed` records a recipient *count*, never the addresses.

**The dev guard is not a nicety.** Outside production every recipient is
rewritten to `EMAIL_DEV_REDIRECT` with the real address moved into the subject,
and if that variable is missing, sending refuses outright. Without it the first
person to exercise the share-email flow against a seeded local database mails a
real client, and that is not recoverable.

**Idempotency keys are derived from what the message IS**
(`share:<id>:<recipient>`), never from a timestamp or a random value — that is
what makes a double-click or an action retry a no-op instead of a second email.

**Network work happens after the transaction commits.** The idempotency claim,
the caps and the queued row are one transaction; the provider call is not
inside it. Same house rule as blob ingestion.

**Passcode-protected share links cannot be emailed at all.** A link and its
passcode in one message is one factor and a longer email.

**Bounces are the point of the webhook.** An unnoticed bounce is the most
common way an email workflow dies silently — the sender believes the invoice
went out and nobody finds out until someone chases payment.

## Current state (2026-07-25)

**Nothing actually sends yet, on purpose.** The spine, the wizard and the send
log are built and deployed, but `mail.yosherapp.com` has not been added to
Resend — that needs a paid plan (the free tier's one domain is already spent on
`in.yosherapp.com` for inbound), and the founder is deliberately waiting until
there is real business to justify it.

So today: creating, copying, revoking and opening share links all work
normally; only "Email link" fails, and it fails at the provider with the reason
recorded in `outbound_emails.error`. Nothing sends automatically, so nothing
breaks unprompted.

`EMAIL_FROM_DOMAIN` is already set in Vercel to `mail.yosherapp.com`, so when
the domain is eventually verified in Resend, sending starts working with no
code or config change.

## Open items

- **One transport only.** The seam exists but there is a single implementation
  (provider API, tenant domain or platform domain). The strategic next one is
  **send through the tenant's connected Microsoft 365 mailbox** — the message
  is genuinely from them, lands in their Sent folder, and threads properly.
  Graph needs admin consent and no third-party audit. Google needs CASA or
  domain-wide delegation, which is why Microsoft goes first.
- **No HTML templates yet** — messages are plain text. Fine for a share link,
  thin for an invoice.
- **No per-tenant "from" presets** beyond one local part; invoices and share
  links share an address.
- **Domain disconnection leaves the provider-side domain in place**, on
  purpose: deleting it would invalidate anything already sent and re-adding
  would issue different DKIM keys.
- **No bounce-driven suppression list.** A hard bounce is recorded but nothing
  stops a later send to the same address.
- **Verification is manual** — the owner presses "Check DNS". No background
  poller, so a domain that verifies overnight shows as pending until someone
  looks.
