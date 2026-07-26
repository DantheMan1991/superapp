# Email (outbound spine + hosted mailboxes)

> Everything the platform sends on a client's behalf — share links today,
> invoices and signature requests next — goes through one seam. Its whole
> reason for existing is **which address the mail comes from**: a client's own
> domain wherever possible, never an anonymous third-party address. As of
> 2026-07-26 it also **hosts** mailboxes on that domain.
> Status: `live` · Scope: `platform` <!-- keep Status on ONE line — /admin/docs parses it -->


## Build log

Newest first. One entry per session/PR that touched this module. Every PR
that changes this module MUST add an entry here (rule in AGENTS.md).

### 2026-07-26 — Hosted mailboxes: provisioning + MX cutover (branch `claude/email-mailboxes`)

Real mailboxes on the client's own domain, hosted by us rather than connected
to theirs. Two tables (`0039`/`0040`), a provider-agnostic `MailboxHost` seam
with a Migadu implementation, a four-step cutover flow, and an owner-only admin
section on the existing `/dashboard/email` page.

**How we got here.** The founder asked whether a Gmail-like system on client
domains was possible, and the session worked through three routes: run your own
mail servers (rejected — deliverability is a multi-year reputation problem),
connect the mailbox the client already has via Gmail API / Microsoft Graph, or
host the mailboxes ourselves. The connector route is the strategically obvious
one and is still the plan for clients already on Workspace/365 — but Google's
CASA security assessment gates Gmail's restricted scopes behind an annual paid
audit, and the founder chose to do the in-house route first and wait on both
connectors.

Provider evaluation, for the record: **Fastmail** has the best API in the
business (JMAP) but no real multi-tenant provisioning. **Zoho** is per-seat,
which taxes every new head at a client, and building a business-operations
platform on a company that sells a competing one is avoidable risk.
**Stalwart** is the right end-state if volume ever makes per-message pricing
worse than running a box. **Migadu** won for now: flat-rate by message volume
with unlimited domains and mailboxes, so onboarding a twelve-person client
costs nothing extra, and a complete provisioning API.

Scope deliberately stopped at "mailboxes exist and mail arrives". No inbox UI,
no sync, no reading or sending from inside the app — that is the next build.

**A correction worth recording**: mid-session the Migadu API docs page listed
only mailboxes/identities/aliases/rewrites, and the design briefly assumed
domain creation was admin-panel-only. It is not — `POST /v1/domains`,
`/records`, `/diagnostics` and `/activate` all exist, and `/activate` being a
separate call is what makes a staged cutover possible at all.

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
| `email_domains` | A tenant's verified **sending** domain | One per tenant, and a domain can only be claimed once platform-wide. `dns_records` jsonb feeds the wizard. **`member_read` only** — a member who could set `status='verified'` could make the app send as a domain they never proved they own |
| `outbound_emails` | The send log | `(tenant_id, idempotency_key)` unique is what makes a retry a no-op. Recipient addresses stored in the CLEAR (see Decisions). **`member_read` only** — a forgeable "delivered" is worse than no log |
| `mailbox_domains` | A domain whose **MX we host** | One per tenant, unique platform-wide. `previous_mx` is the rollback record (see Decisions) and `mx_cutover_at` is stamped at activation — a CHECK forbids `status='active'` without it. **`member_read` only** — a member who could write `status` could assert a cutover that never happened, or erase `previous_mx` |
| `mailboxes` | One real address on a hosted domain | Composite FK `(tenant_id, mailbox_domain_id)` makes hanging a mailbox off another tenant's domain structurally impossible. Unique on `(mailbox_domain_id, local_part)`. **No credential of any kind is stored.** **`member_read` only** |

## Key files & seams

- `src/lib/email/identity.ts` — pure. Decides From/Reply-To. The highest-value
  tests in this area point here.
- `src/lib/email/send.ts` — the seam every caller uses: dev guard, caps,
  idempotency claim, provider call, log row.
- `src/lib/email/domains.ts` — **sending** domain create/verify/read. All writes
  under `withSystem`.
- `src/app/dashboard/email/` — owner-only wizard, send log, and the hosted
  mailbox admin section.
- `src/app/api/email/events/route.ts` — svix-verified delivery webhook.
- First caller: `emailShareAction` in `src/modules/documents/share-actions.ts`.

Hosted mailboxes (`src/lib/email/mailbox/`):

- `types.ts` — the `MailboxHost` interface. Expressed only in terms every mail
  host has, so a Stalwart implementation can satisfy it unchanged.
- `migadu.ts` — the one implementation. Everything Migadu-shaped is confined
  here: Basic auth, booleans-as-strings, and an activation endpoint that is a
  GET which mutates.
- `mx.ts` — pure. Reads and describes a domain's live MX. Testable without a
  database or a network; `describeMxProvider()` is what turns a hostname into
  "Google Workspace" in the warning copy.
- `provisioning.ts` — the four-step flow and both cutover gates.
- `mailboxes.ts` — per-address create/delete plus `reconcileMailboxes()`.
- `src/app/dashboard/email/mailbox-actions.ts` — owner-only server actions.

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

### Hosted mailboxes

**Sending is additive; receiving is a takeover.** This is the asymmetry the
whole mailbox design turns on, and the reason `mailbox_domains` is a separate
table from `email_domains` rather than a few more columns. When a sending
domain breaks, notifications stop going out. When an MX cutover breaks, the
business stops *receiving* — orders, RFIs, remittances — and nobody notices for
hours, because a quiet inbox looks exactly like a quiet day.

**`previous_mx` is captured at domain creation, never at cutover.** The moment
the owner publishes new records at their registrar, the old MX answer is gone
from DNS and unrecoverable. Snapshotting at cutover time would already be too
late. The `onConflictDoUpdate` in `createHostedDomain` deliberately does NOT
overwrite it — re-running setup after records are published would otherwise
capture *our own* MX as the thing to roll back to, which is worse than having
no rollback at all because it looks like one.

**Rollback is information, not a button.** Restoring MX means editing the
tenant's registrar, which we have no access to and should not want. What the
app owes them is the exact previous records, on screen, during an outage —
rather than a person trying to remember Google's MX hostnames while their mail
is down.

**Mailboxes are created BEFORE the MX flips.** If mail arrives for an address
the host has never heard of, it does not queue politely — it bounces, and the
sender is told the address does not exist. `mailboxes.ts` therefore works at
`pending`/`dns_ready`, and the cutover panel refuses to look ready while zero
mailboxes exist.

**Two independent sources must agree before a cutover.** The host's own
diagnostics *and* a public DNS lookup. Activating a domain whose MX still
points at Google does not fail loudly — it creates a split where the host
believes it is authoritative and no mail ever arrives, which is the hardest
class of email fault to diagnose.

**Unparseable diagnostics mean NOT ready.** `normalizeDiagnostics()` defaults
every field to false when it cannot understand the payload. The two possible
mistakes are wildly asymmetric: a false "not ready" costs one more click, while
a false "ready" invites someone to redirect a business's entire mail flow on
the strength of a response shape we failed to parse.

**No mailbox credential exists anywhere in this system.** Provisioning uses
Migadu's invitation flow (`password_method: "invitation"`), so the host mails a
setup link and the person chooses their own password. A mailbox password is
strictly more dangerous than an app password — it reads the mail that resets
every other account the business owns. The invitation address is validated to
be *off* the domain being provisioned, or it would be a locked-room puzzle.

**Cutover and mailbox deletion require typing the name out.** Proportionate,
not decorative: the cutover is the only action in the product that cannot be
undone from inside the product, and deleting a mailbox destroys correspondence
at the host.

**Migadu's API has no domain DELETE, on purpose, and neither do we.**
Disconnecting forgets the domain locally and cascades the mailbox rows; the
actual mailboxes stay reachable at the host while the owner sorts out where
their mail should live. Same reasoning that kept the sending-domain teardown
local.

**drizzle-kit emits all FKs before all indexes.** Fine when the referenced
table already exists, fatal when both tables are created in one migration: the
composite FK on `mailboxes` needs the unique index on
`mailbox_domains(tenant_id, id)` to exist first. `0039` is hand-reordered, with
a comment saying so. Expect this again for any future pair of new tables joined
by a composite tenant FK.

## Current state (2026-07-26)

**Hosted mailboxes are built but not connected.** `MIGADU_ACCOUNT_EMAIL` and
`MIGADU_API_KEY` are not set, so every provider call returns the same
"isn't configured yet" result the Resend paths use, and the UI degrades to a
readable error rather than a stack trace. Nothing provisions until those exist.

Scope stops at provisioning and cutover. There is no inbox: no sync, no
threading, no reading or replying inside Yosher. A mailbox created here is used
through IMAP on a phone or in Outlook until that lands.

### Sending (unchanged from 2026-07-25)

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
  looks. Applies to hosted domains too.

### Hosted mailboxes

- **No inbox.** The next build: sync, threading, read and reply. Until then a
  hosted mailbox is used over IMAP from a phone or Outlook, and Yosher only
  administers it. This is also where the module earns its keep — an inbox that
  is just a worse Gmail is not worth a tab switch; one where the thread sits
  next to the job, the drawing set and the invoice is.
- **Migadu keys are not configured**, so nothing provisions yet.
- **No aliases or identities.** `info@` forwarding to three people, and
  send-as for a shared address, both need the alias and identity endpoints —
  wired in the API docs, not in the adapter.
- **`reconcileMailboxes()` reports drift but never repairs it.** Deliberate:
  auto-deleting local rows hides real mailboxes, and auto-creating remote ones
  resurrects addresses somebody removed on purpose. Nothing surfaces it in the
  UI yet, though — it is callable and unreachable.
- **No Stalwart adapter.** `'stalwart'` is allowed by the provider CHECK and
  `getMailboxHost()` throws for it. The interface exists so that migration is a
  data move; the trigger to actually build it is message volume making
  per-message pricing worse than running a box.
- **The `attachments → Documents` join is not wired.** Inbound mail already
  files into DMS folders via `in.yosherapp.com`; hosted mailboxes do not feed
  that path yet. Closing that loop is what makes Email and Documents worth more
  together than apart.
- **One hosted domain per tenant.** A client with two trading names needs two,
  and the unique index on `tenant_id` says no.
- **Deliverability for hosted mailboxes is Migadu's**, not ours — which is the
  point — but outbound from a hosted mailbox does not currently relay through
  the `sendEmail()` spine, so it bypasses the send log, the caps and the dev
  guard. Anything the *platform* sends still goes through the spine; this only
  concerns a human sending from their own mailbox.
