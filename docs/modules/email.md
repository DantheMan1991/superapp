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

### 2026-07-26 (later) — Reconciled against the live API; `yosherapp.com` hosted

`yosherapp.com` is now active at Migadu. Its root had **no MX and no SPF**, so
the cutover was the zero-risk case — nothing to lose. `in.yosherapp.com` (the
shipped documents email-in path, MX → Resend/SES) was left untouched, which is
the trap that setup presents: DNS panels list every record for a domain in one
flat list, and Migadu's "remove any pre-existing MX records" means *on the host
being configured*, not on subdomains.

`npm run mailbox:probe -- <domain>` was added (`scripts/migadu-probe.ts`,
strictly read-only) and immediately earned itself: **both response shapes the
adapter had guessed at were wrong.**

- **`/records` is not a list.** It is an object keyed by purpose —
  `dns_verification`, `mx_records`, `dkim`, `spf`, `dmarc` — where some keys
  hold one record and some hold an array. The array-shaped reader returned
  `[]`, i.e. an empty DNS wizard that looked like a host with nothing to set up.
- **`/diagnostics` nests under `checks`.** The gate read `root.mx`; the field
  is `root.checks.mx`. `mxOk` was therefore permanently false and **the cutover
  could never have unlocked**, no matter how correct the DNS was.

That second one is the design working as intended: an unrecognized shape fails
closed, so a wrong guess became a button that stayed disabled rather than a
business's mail redirected on a misread response.

Pure parsing moved to `migadu-parse.ts` (free of `server-only`, the same reason
`mx.ts` is) and the live payloads are now golden fixtures in
`tests/mailbox.test.ts`. This is the lesson worth keeping: a normalizer that
returns `[]` for an unexpected shape looks perfectly healthy against invented
input, so only real payloads prove it.

Also added: **adoption**. `createDomain` now does `GET /domains/{d}` first and
picks up a domain that already exists rather than failing on it — the normal
path for a domain set up in the host's panel first, and for any client
mid-migration. Detected with a GET rather than by matching the text of a POST
error, since error strings are the least stable part of any API. An adopted
domain still walks the local check → cutover flow, because trusting the host's
"active" would skip the `previous_mx` capture the CHECK constraint depends on.

### 2026-07-26 (later still) — Inbox foundation: schema, RLS, JMAP client (branch `claude/email-inbox`)

First slice of the mail *client* — the tool the whole email effort was always
aiming at. Read-only inbox is the milestone; this lands the parts that can be
built correctly before a mail server exists.

**Why the host changed.** Reading a mailbox over IMAP requires that mailbox's
password, and provisioning was deliberately built so no credential exists
anywhere in this system. Migadu exposes no app passwords, OAuth, or delegated
access, so the inbox was blocked by a property we had shipped on purpose.
Stalwart resolves it: app passwords, API keys, and a **built-in OAuth 2.0 /
OIDC server**, so a user authorizes Yosher on their own mail server and we
store a token instead of a password. The property survives rather than being
reversed.

Migadu was chosen on pricing, provisioning API and protocol — never on "can the
platform read the mailboxes?", which was the goal from the first conversation.
That is the evaluation mistake worth remembering: **check the vendor against
the destination, not against the step in front of you.**

**JMAP is why this is tractable.** RFC 8621 puts threading, search, delta sync,
MIME parsing and charset decoding on the *server*. An IMAP client would have
meant implementing all of it. We implement presentation and the Yosher-native
data, nothing more.

Landed: five tables + RLS (`0041`/`0042`), the JMAP client and its pure parsing
layer, `scripts/create-mail-role.ts`, and 42 tests.

Deferred deliberately: the Stalwart `MailboxHost` adapter. Domain registration
is not in Stalwart's documented management API, and writing it blind is exactly
what produced two wrong response shapes on Migadu. It waits for a server to
probe.

### 2026-07-27 — Local Stalwart, and the JMAP client verified against it

Stalwart 0.16.15 running in Docker locally (`docker/stalwart/compose.yml`), so
the mail client can be built and proved with no VPS, no DNS, no domain and no
money. The only thing a real server adds is receiving mail from the internet.

`npm run jmap:probe` (read-only) confirmed the design's two biggest bets:

- **`parseSession` and `parseMailbox` match live responses exactly.**
- **The `#ids` back-reference works** — `Email/query` and `Email/get` really do
  complete in one round trip, which is the difference between this client and
  one as slow as the IMAP it replaced.

Three findings that only a live server could have produced:

- **Stalwart builds its URLs from the CONFIGURED HOSTNAME, not the request's
  Host header.** The session advertises `apiUrl: https://<hostname>/jmap/`, so
  a spec-following client chases a name that may not resolve. Harmless in
  production where the hostname is real; locally the probe rebases onto the
  host it actually reached. Worth remembering behind any proxy.
- **Every default mailbox comes back with `sortOrder: 0`.** Sorting by
  sortOrder then name puts "Deleted Items" first and buries the Inbox third.
  `compareMailboxes()` now breaks the tie by role — and still defers to a
  server that expresses a real preference.
- **`maxObjectsInGet` is 500**, and exceeding it errors rather than truncating.
  `getEmails()` chunks, so a long thread fails for nobody.

Also confirmed: the account directory offers a **SQL Database** type with fully
customizable Login and Recipient queries, so `mail_directory_accounts` works
as-is. It needs its own Postgres store pointed at Neon, separate from the
RocksDB store holding the mail — exactly the isolation the design wanted.

Setup wizard gotcha: it **rejects any hostname without a real TLD** —
`localhost` and `mail.yosher.test` were both refused, and the field silently
reverts to the container id rather than saying why.

### 2026-07-27 (later) — Connect a mailbox: OAuth flow + the Stalwart adapter

The two halves that make "connect a mailbox" real.

**OAuth.** Discovery-driven rather than hardcoded, so it works against any
instance and is the same shape Google and Microsoft need — the deferred
connectors land in `oauth/config.ts` rather than beside the flow. PKCE with
S256 even though this is a confidential client: one hash, and it protects
against a code intercepted at the redirect and replayed by somebody who never
had the secret. Scopes are mail + `offline_access` and nothing else, though the
server offers contacts and calendars too.

The pending authorization rides in an **encrypted, httpOnly, single-use
cookie** — the PKCE verifier cannot travel in a URL without defeating the point
of PKCE, and a `pending_oauth` table would need a purge job while still being a
cookie in disguise. `takePending()` clears it whether or not it validates, so a
replayed callback finds nothing.

The callback's check order IS the security of the flow: consume the cookie,
compare state, confirm the tenant still matches, and only then exchange the
code. It also **proves the token opens the mailbox before recording the
connection** — storing one that turns out not to work produces a mailbox that
looks connected and fails on every read.

**The Stalwart adapter is a different shape from Migadu's, and that is the
point.** Migadu is somebody else's API over HTTP. Stalwart authenticates against
our own database, so provisioning is a row in `mail_directory_accounts` and
there is no network call. The callers in `mailboxes.ts` and `provisioning.ts`
cannot tell the difference, which is what the interface was for.

That surfaced a real ordering conflict. A remote host must be called FIRST — if
the provider refuses, no local row should exist. A database-backed host must be
called SECOND, because its directory row carries a composite FK to the very
mailbox being created. Rather than drop that FK (it is what stops a stale
directory row becoming an auth bypass) or put `if (provider === 'stalwart')`
into shared code, `MailboxHost` gained an optional **`afterMailboxCreated()`**
hook. No-op for remote hosts; the real work for database-backed ones.

Two places the Stalwart adapter is deliberately honest about doing nothing:
`createDomain` records intent and returns `pending`, because domain
registration is not in Stalwart's management API and returning success for work
that did not happen is worse than saying so. `activateDomain` is a no-op with a
real meaning — Stalwart accepts mail as soon as MX points at it, so the cutover
already happened when DNS changed; the step survives because it is where the
owner's consent is recorded and `mx_cutover_at` gets stamped.

Also: mailbox token encryption was collapsed into the existing
`APP_ENCRYPTION_KEY` and `src/lib/crypto.ts` rather than introducing a second
key. Both would live in the same environment on the same server — two things to
rotate, no additional protection. Consequence: rotating that key now
invalidates Plaid tokens AND mailbox connections.

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
| `mail_directory_accounts` | **The only table the mail server can read** | Stalwart authenticates against it as `stalwart_directory`, a role with SELECT here and nothing else. Holds addresses and password hashes — no business data — so a compromised mail server leaks a bounded thing. Login unique platform-wide. **`member_read` + a `current_user`-keyed mail-server policy** |
| `mail_accounts` | A person's OAuth connection to a mailbox | Tokens encrypted with a key held in the environment, never in this database. Separate from `mailboxes` on purpose: that table says an address exists, this says someone authorized us to read it. **`member_read` only** |
| `mail_thread_index` | Thin thread index — subject, participants, dates | **Not a mirror.** No bodies, no search index. Exists so a module can ask "every thread on this invoice" as a SQL join instead of N+1 protocol calls. **`member_read` only** |
| `mail_links` | Thread ↔ business entity | **MEMBER WRITABLE** — the deliberate exception. `entity_type` carries no whitelist so a future layer needs no migration |
| `mail_annotations` | Extension-contributed metadata per thread | **MEMBER WRITABLE**. One row per extension per thread, so a layer can be reprocessed or removed without touching another's work |

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
- `migadu-parse.ts` — pure response parsing, free of `server-only` so it is
  testable without a network. `normalizeRecords()` and
  `normalizeDiagnostics()` live here; between them they decide what the DNS
  wizard shows and whether a cutover is allowed, which makes them the
  highest-value functions in this directory. Verified against live payloads,
  which are golden fixtures in `tests/mailbox.test.ts`.
- `guard.ts` — what the mailbox path refuses to do outside production. Pure,
  takes the environment explicitly, tested against the Vercel preview trap.

The inbox (`src/lib/email/jmap/`):

- `types.ts` — JMAP object shapes, modelled from RFC 8620/8621. Only the subset
  the inbox reads; typing unused fields invites drift nobody notices.
- `parse.ts` — pure response parsing, free of `server-only`. Two rules run
  through it: never invent data (a missing subject is `""`, not
  "(no subject)"), and never throw (a malformed message parses to null and gets
  skipped, so one bad row costs one row).
- `client.ts` — the protocol. Batches method calls with `#ids`
  back-references so a list view is **one** round trip that queries and fetches
  together; doing it as two is how a JMAP client ends up as slow as the IMAP
  one it replaced.
- `scripts/create-mail-role.ts` — `npm run db:create-mail-role`. Creates the
  mail server's Postgres role and then **proves** the boundary: connects as it,
  confirms it can read the directory, and confirms it cannot read `tenants`,
  `documents`, `invoices` or `mail_accounts`. A grant wider than intended fails
  here rather than in production.
- `scripts/migadu-probe.ts` — `npm run mailbox:probe -- <domain>`. Read-only
  (every request a GET), safe against a live domain. Run it whenever a shape
  here is in doubt; it prints the current truth.
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

**The mailbox path shipped without an environment guard, and that was a worse
hole than the one `EMAIL_DEV_REDIRECT` was written for.** The send spine has
refused to mail real people outside production since day one; the mailbox code
had nothing equivalent, so a branch preview with credentials could reach a real
mail host and act on a real domain. `guard.ts` closes it with three different
answers, chosen by how recoverable each mistake is:

- **Cutover — refused outside production, no escape hatch.** Redirecting a
  domain's mail from a preview is never legitimate, and undoing it means
  editing DNS at a registrar while the business's mail goes nowhere.
- **Mailbox deletion — refused.** It destroys correspondence at the host.
- **Mailbox creation — allowed, invitation redirected** to
  `EMAIL_DEV_REDIRECT`, refused if unset. Creating a mailbox is reversible;
  mailing a real person a link to claim an address is not. The flow stays
  testable end to end, and only the message to a human is diverted.

Reuses `isLiveSendEnvironment()` rather than reimplementing it: it encodes the
trap that Vercel builds previews with `NODE_ENV=production`, and two copies of
that logic would drift silently.

**Two DNS records where a duplicate is worse than none.** SPF and DMARC both
fail *closed* when a name carries two records — receivers cannot pick the
stricter, so they treat the check as broken rather than applying either. This
bites during setup because a mail host's instructions describe a greenfield
domain:

- **SPF** — one `v=spf1` TXT per name, ever. A second sender means merging
  `include:` terms into the existing record, never adding another.
- **DMARC** — one record at `_dmarc.<domain>`. Migadu's setup page offers
  `p=quarantine`; `yosherapp.com` already carried `p=none`, so that row was
  deliberately skipped. Keep DMARC permissive while mail infrastructure is
  changing and tighten afterwards as its own step, or the first misconfigured
  sender starts landing in spam with no warning. DMARC at the organizational
  domain also covers subdomains unless `sp=` overrides it, so tightening the
  root would have caught `mail.yosherapp.com` — the not-yet-verified Resend
  sending domain — too.

**A subdomain's MX is not the root's MX, and DNS panels hide that.** Every
record for a domain shows in one flat list, so `in.yosherapp.com`'s MX sits
directly beside the root's. Migadu's "remove any pre-existing MX records"
means on the host being configured (`@`). Deleting the subdomain's row instead
would silently kill inbound document filing — no error anywhere, just
drawings that stop arriving.

**Response shapes are only real once a live call proves them.** Both
normalizers in the first build were written from published docs and both were
wrong: `/records` is a keyed object rather than a list, and `/diagnostics`
nests under `checks`. Neither could have been caught by unit tests, because a
normalizer that returns `[]` for an unfamiliar shape looks perfectly healthy
against invented input. Hence `npm run mailbox:probe` and golden fixtures
copied verbatim from a live response. The `/diagnostics` miss is also the
fail-closed rule paying for itself — the wrong guess produced a cutover button
that never unlocked, rather than a redirect performed on a misread reply.

**drizzle-kit emits all FKs before all indexes.** Fine when the referenced
table already exists, fatal when both tables are created in one migration: the
composite FK on `mailboxes` needs the unique index on
`mailbox_domains(tenant_id, id)` to exist first. `0039` is hand-reordered, with
a comment saying so. Expect this again for any future pair of new tables joined
by a composite tenant FK.

## Current state (2026-07-26)

**`yosherapp.com` is live at Migadu** — verification, MX, DKIM and SPF all
published at Vercel DNS, diagnostics green on every check, and the default
`admin@yosherapp.com` (Postmaster) mailbox exists. DMARC deliberately left at
the pre-existing `p=none`; see Decisions.

`MIGADU_ACCOUNT_EMAIL` and `MIGADU_API_KEY` are set locally in `.env`, and go
on **Production only** in Vercel — the guards below make a preview refuse the
dangerous operations anyway, but there is no reason for a branch deployment to
hold live mail-host credentials in the first place.

The adapter has been reconciled against live responses, but **the app's own
flow has not been walked end to end yet** — nothing has gone through
`/dashboard/email` to create a domain row, run a check, or provision a mailbox
through the UI. The parsing is verified; the round trip is not.

**The inbox is under way on `claude/email-inbox`.** Schema, RLS, the JMAP client
and its parsing layer are built and tested; nothing is wired to a UI yet and
there is no Stalwart server to talk to. Reading mail inside Yosher does not work
yet — a hosted mailbox is still used over IMAP from a phone or Outlook.

**Migadu stays running throughout.** `yosherapp.com` is live on it and there is
no reason to cut a working domain over to an unproven self-hosted server. The
`MailboxHost` interface already accepted `'stalwart'` in its provider CHECK, so
the pivot costs one new adapter rather than a rewrite.

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
- **No Stalwart adapter yet, and deliberately so.** `getMailboxHost()` still
  throws for `'stalwart'`. Mailbox creation via SQL-directory insert is
  verified and buildable; **domain registration is not in Stalwart's documented
  management API**, and writing that blind is precisely what produced two wrong
  response shapes on Migadu. It waits for a server to probe. Build
  `scripts/jmap-probe.ts` first, as `mailbox:probe` was.
- **Password hash format is unconfirmed.** `mail_directory_accounts.password_hash`
  holds a PHC string, but the algorithms Stalwart will actually verify have not
  been checked against a running server. Guessing produces an account nobody
  can log into. Confirm before wiring the invitation flow.
- **`npm run db:create-mail-role` has never been run.** It prints a live
  connection string, so it belongs in the operator's terminal, not a transcript.
  Run it when the server exists; it self-verifies the role cannot read tenant
  tables and aborts if it can.
- **No OAuth flow, no UI, no extension registry.** Phase 1's remaining three
  pieces.
- **Real-time will be state polling, not push.** JMAP push needs a long-lived
  server-side connection that serverless cannot hold. Comparing the account's
  state string is one small request; an SSE proxy on Vercel's streaming runtime
  is a later optimization, not a prerequisite.
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
