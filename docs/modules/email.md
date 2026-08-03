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

### 2026-07-27 (later still) — Slice 0: the module seam, and a probe that moved the roadmap

First slice of the Outlook-class mail client. Deliberately small in payload and
wide in reach: it lands the shared-chrome changes on their own, so a layout
regression is bisectable, and it closes two gaps that had been open since the
foundation shipped.

**The module exists now.** `email` is seeded (name **"Mail"**, sortOrder 35),
registered in `moduleRegistry`, and renders at `/dashboard/m/email` — the route
both OAuth routes have been redirecting to since the flow was built, and which
until now was a 404. The owner-only `/dashboard/email` link is relabelled
**"Email setup"**: two sidebar entries both called "Email" would have been a
coin toss every time. Slice 0's screen is the way in — connect a mailbox,
reconnect one that expired, disconnect — and it is honest that reading arrives
next.

**A copy correction worth keeping as a rule.** The module's first description
read "threads beside the job, the drawing set and the invoice". The founder cut
it immediately: *this is a core tool and should not be related to any specific
industry — that is what the add-ons are for.* Drawing sets are construction's
language, and putting them in a core module's description quietly tells a
plumber, a clinic and a machine shop that this was not built for them. Core
modules describe what every business has — jobs, customers, invoices. Anything
narrower belongs to a Layer 2 industry template, which is the whole reason that
layer exists. The same test applies to every core module's UI copy, not just
this one.

**Full-width layout, without naming a module in the shell.** Three panes fight
the shell's `max-w-6xl` clamp. Rather than special-casing a pathname,
`ModuleDefinition` gained `layout?: "standard" | "full"`; the dashboard layout
maps *enabled* modules that ask for it into path prefixes and hands them to
`AppShell`, which already knows the pathname because it is a client component.
A switched-off module therefore cannot widen the shell, and the next full-width
module is a flag rather than an edit to shared chrome. `<main>` also gained
`min-w-0` — without it a wide grid pushes the whole flex row past the viewport
instead of scrolling inside its own pane.

**The isolation gap is closed.** The mail tables had never been added to
`tests/tenant-isolation.test.ts` — step 5 of the AGENTS.md module workflow,
missed when the foundation landed. Thirteen tests now certify all seven tables,
in three groups matching the three policy shapes in `0042`: member-read tables
refuse member writes (a member who could write `mail_accounts` could point an
account at a token they control; one who could write
`mail_directory_accounts` could set a hash on a colleague's address — both are
authentication bypasses, not data errors), `mail_links`/`mail_annotations`
accept member writes but pin `tenant_id`, and every composite FK refuses a
cross-tenant target. The highest-value assertion is the plainest: **tenant A
cannot read tenant B's stored OAuth token.**

**`npm run jmap:probe` was extended, and immediately earned itself again.** It
now checks capabilities and server limits, the cheap-poll shape, threading
headers, body truncation, attachment/cid shapes, the download URL's host, and
identities — and prints a FINDINGS block naming anything the code assumes that
the server disagrees with. Run against the local Stalwart 0.16.15 it confirmed
three designs and **overturned two roadmap assumptions**:

Confirmed:

- **`Email/get {ids: []}` is tolerated** and returns just the state string. The
  cheap "has anything changed?" poll the sync design rests on is real.
- **`Identity/get` works**, and identities carry `textSignature`/`htmlSignature`
  — so signatures live on the mail server and need no table of ours.
- **`maxObjectsInGet` is 500**, exactly what `client.ts` hardcodes. But
  **`maxObjectsInSet` is also 500** and `maxCallsInRequest` is 16 — bulk
  operations need the same chunking `getEmails()` already does, and a batch
  cannot exceed sixteen method calls.

Overturned — both in the direction of *less* work, which is the rarer surprise:

- **Rules do not need ManageSieve.** The plan budgeted Slice 8 as "a different
  protocol on a different port with no client in this repo". This server
  advertises **`urn:ietf:params:jmap:sieve`** with a large extension set
  (`fileinto`, `imap4flags`, `regex`, `vacation`, `spamtest`, …). Rules are
  method calls on the client we already have.
- **Contacts and calendar are JMAP here, not CalDAV/CardDAV.** The server
  advertises `urn:ietf:params:jmap:contacts` and
  `urn:ietf:params:jmap:calendars` (plus `:parse`, `principals`,
  `principals:availability` for free/busy). The judgement that calendar belongs
  to the `scheduling` module still stands on product grounds — jobs and
  appointments are its remit — but the *protocol* cost of getting there is a
  fraction of what was assumed, and it can reuse this client rather than
  starting one.

Also advertised and worth knowing: `urn:ietf:params:jmap:websocket` and
`webpush-vapid` (push exists, though serverless still cannot hold a socket —
web push may be the way in later), `urn:ietf:params:jmap:blob`,
`:quota`, `:mail:share` (server-side ACLs, the right source of truth for
delegation), and `:filenode` — a WebDAV-ish file store this project has no use
for, since Documents already owns that job.

**What the probe could NOT confirm, and says so loudly**: the mailbox is empty,
so body truncation, charset decoding, `cid` shape, RFC 2047 attachment-name
encoding and the blob download's `Content-Length` are all still unproven. The
probe reports this as a finding rather than passing silently — an empty mailbox
must not read as a clean bill of health. **Send the local account a message
with an inline image and an attachment, then re-run, before Slice 2 renders
anything.**

One confirmed landmine already: the session advertises
`downloadUrl: https://mail.yosherdev.com/jmap/download/...` while the probe
reached `localhost:8080`. `downloadUrlFor()` uses the advertised value verbatim,
so attachments will 404 anywhere that hostname does not resolve — and because
the fetch is server-side, it reproduces nowhere useful. Same class of trap as
the `apiUrl` hostname finding, and the fix is the same: rebase onto the host
from the stored `jmapSessionUrl`.

### 2026-07-27 (later) — Slice 1: per-user mailbox isolation (`0043`)

The hole this closes was the largest thing standing between the foundation and
an inbox, and it was invisible from the outside: **per-user privacy existed only
in application code.**

`mail_accounts_member_read` scoped rows to the *tenant*, and every read in
`oauth/accounts.ts` ran under `withSystem()` — which sets
`app.role = 'superadmin'`, so the member policy never fired on the app path at
all. The guarantee "your mailbox is yours" was one forgotten `clerk_user_id`
predicate away from a colleague reading somebody's mail. Survivable while the
only caller was the OAuth callback; not survivable the moment a UI reads these
tables on every page render.

**A fourth RLS setting.** `app.clerk_user_id`, set by an optional
`withTenant(..., { userId })`, read by `app_current_user()`. It returns NULL
when unset, exactly like `app_current_tenant()`, so a caller who forgets it
reads **zero** rows rather than the whole tenant's — the same fail-closed
direction `app.tenant_role` was built with in `0024`, and the property any fifth
setting must also have. `withTenant` writes the value on every call, `""` when
absent, because on a pooled connection an unset variable is one still holding
whatever the previous transaction left behind.

`mail_thread_index` carries no user column of its own, so its policy reaches
through `mail_accounts` with an EXISTS. Worth understanding why that is safe
rather than merely correct: the subquery reads `mail_accounts`, so
`mail_accounts`' own policy applies to it, and the two compose — there is no
path where the thread policy is looser than the account policy it depends on,
and tightening the account policy later tightens this one automatically. A
subject line is not a body, but *"Re: your disciplinary hearing"* in a
colleague's thread list is still a leak.

**One policy got wider, deliberately.** `mail_accounts` gained a member DELETE
scoped to `(tenant, connecting user)`. Disconnecting your own mailbox is
ordinary work, and a scoped policy makes deleting a *colleague's* connection
structurally impossible rather than merely unimplemented — while removing a
`withSystem()` call from a user-triggered path, which is the direction S2 asks
for. Writes stay trusted-code-only: a member who could INSERT or UPDATE here
could point an account at a token they control, which is an authentication
bypass rather than a data error. The three remaining `withSystem()` calls now
each carry their justification at the call site.

Four new isolation tests, and they ask a different question from the rest of
that file. Everything else there asks "can tenant A read tenant B?"; these ask
the one the inbox actually turns on — **can one employee read a colleague's
mail?** Same tenant, same context, different person. The most valuable of them
is the plainest: a `select()` with no `where` clause at all, run as the wrong
user, returning nothing.

Also landed: `npm run db:migrate -- --dev` targets the Neon dev branch.
`docs/security.md` §8 requires every migration to run against both databases,
and the only previous way to reach the branch was editing `.env` or splicing a
connection string through the shell — which is how a dotenv banner once ended up
inside a URL. **`0043` has been applied to the dev branch; production is still
outstanding.**

### 2026-07-27 (later still) — Slice 2 groundwork: the client could never have worked

`npm run mail:fixture` was added — it delivers one deliberately awkward message
to the local Stalwart over SMTP (multipart/mixed → related → alternative, an
inline `cid:` image, a remote tracking pixel, a `<script>`, an `onerror`, a
`javascript:` link, an RFC 2047 encoded filename, a non-ASCII subject). It is
guarded to loopback only, because it speaks real SMTP.

With a real message in the box the probe could finally answer what it had been
refusing to guess at. **Four assumptions confirmed, one bug found, and one
thing that would have stopped the inbox working at all.**

Confirmed, and now golden fixtures in `tests/jmap.test.ts`:

- **`cid` comes back WITHOUT angle brackets.** Sent as
  `<logo-part-1@yosher.test>`, returned as `logo-part-1@yosher.test`. A cid map
  keyed on the bracketed form would have matched nothing — and would have failed
  as a *missing inline image*, not as an error.
- **Attachment names arrive RFC 2047 DECODED.** `=?utf-8?B?…?=` came back as
  `Facturación año.pdf`. No encoded-word decoder is needed.
- **Bodies arrive as decoded UTF-8.** No iconv step.
- **Inline parts DO appear in `attachments`**, distinguishable by
  `disposition: "inline"` — so the cid map and the attachment chips are built
  from one array.
- **The blob download returns `Content-Length`**, so an oversized attachment can
  be refused before streaming.
- **`messageId` / `inReplyTo` / `references` are string ARRAYS or null**, never
  bare strings, and absent means `null` rather than `[]`.

**The thing that would have stopped everything.** `createJmapClient` POSTs to
`session.apiUrl` verbatim, and Stalwart builds that from its **configured
hostname**, not the request's Host header — it advertised
`https://mail.yosherdev.com/jmap/` to a client that had reached it on
`localhost:8080`. That name does not resolve. So every method call and every
attachment fetch would have failed, and the earlier "verified against a live
server" claim was only ever true of the *probe*, which rebases by hand.

`discoverJmapSession` now rebases `apiUrl`, `downloadUrl`, `uploadUrl` and
`eventSourceUrl` onto the host discovery actually reached — the one address in
the session known to work, since the session came back from it. `JmapSession`
gained `sessionUrl` to record it. This is a deliberate deviation from a strict
reading of RFC 8620, which permits those URLs to live on another host: for a
single self-hosted server, a misconfigured hostname is far more likely than a
genuine split-host deployment, and the failure mode of trusting it is total.

**And the bug the test caught after the "fix".** The first rebasing used
`URL.pathname`, which **percent-encodes the RFC 6570 braces** — `{blobId}`
became `%7BblobId%7D`, so `downloadUrlFor`'s substitution matched nothing and
every attachment would still have 404'd, now with a URL that looked right.
Rebasing is done by string surgery on the authority instead, and there is a test
asserting the braces survive. Worth remembering: `new URL()` is not
round-trip-safe for templated URLs.

Also fixed here: `resolveBody` now carries `isTruncated` through to
`JmapEmail.bodyTruncated` and `client.ts` sets `maxBodyValueBytes` explicitly
(512 KB), so a long message is no longer silently cut mid-tag and shown as
whole; and `takeMethodResponse` now returns the JMAP `errorType` alongside its
English sentence, because the resync path has to branch on
`cannotCalculateChanges` and matching that on message text breaks the day the
copy improves.

### 2026-07-28 — The first real OAuth round trip, and a mailbox-identity bug

**The client has now authenticated for real.** Everything before this was
`jmap:probe`, which uses Basic auth and predates the OAuth flow; the
`authorizedClient()` → `createJmapClient()` path had never once run against a
server. It does now, end to end: token decrypted from `mail_accounts`, session
discovered, five folders listed, a message queried and fetched with bodies and
attachments, and `currentState()` answered.

Registering the client turned out to be one POST — Stalwart implements RFC 7591
Dynamic Client Registration and accepts it **unauthenticated**, so
`npm run mail:register-client` does it and is repeatable after a
`docker compose down -v`. It asks for a **public** client
(`token_endpoint_auth_method: "none"`); the flow already uses PKCE S256, and a
secret adds nothing a stolen code could not defeat. The server's advertised
scopes match `SCOPE_MAIL`/`offline_access` exactly.

**A bug the flow only revealed by being used.** The callback proved the token
opened *a* mailbox but never *the* mailbox being connected. Clicking Connect on
`info@` and authorizing as `admin@` would have recorded the shared box as
connected while every read returned the admin's personal mail — a mailbox that
looks right, reads wrong, and would then file correspondence into the thread
index under the wrong address. `sessionMatchesAddress()` now sits between "prove
the session opens" and "record the connection", comparing the mailbox address to
the session's `username` (RFC 8620's field for whose credentials these are),
falling back to `accountName`. **It refuses when the session offers neither** —
same asymmetry as everywhere else here: a false refusal costs a retry, a false
accept silently misfiles somebody's mail.

Deliberately deferred: a *legitimately* delegated shared mailbox appears in JMAP
as a second entry in `session.accounts`, not as the primary. Matching against
every account rather than just the primary is what Slice 10 needs; today, with
no delegation, refusing is correct.

> **Superseded 2026-08-02** — that is now built. `sessionMatchesAddress` was
> replaced by `matchSessionAccount()`, which matches across every account and
> returns the one that matched, so the connection stores the granted account's
> id rather than the primary. See the delegation entry at the end of this log.

Three environment traps, all now written into the code that hits them:

- **Stalwart rejects `http://localhost:3000` as a redirect URI.** RFC 8252 §7.3
  wants a loopback IP literal, because a hostname can be repointed by DNS or a
  hosts file and the redirect URI is where an auth code lands. Local dev
  therefore runs at `http://127.0.0.1:3000`, which is a different browser origin
  — expect to sign in again after switching.
- **`allowedDevOrigins` REPLACES Next's default allowlist rather than extending
  it.** Adding `["127.0.0.1"]` for HMR silently dropped `localhost`, and the
  symptom was `/sign-in` and `/sign-up` returning **404** while every other route
  kept working. Both origins are listed now, with a comment saying why.
- **A locally injected fixture lands in Junk, not the Inbox** — no SPF, no DKIM,
  unauthenticated SMTP from a domain that does not exist. That is the spam
  filter working. `mail:fixture` says so in its header.

### 2026-07-28 (later) — Slice 2a: the message-rendering pipeline

An HTML email is the most hostile input this platform accepts — anyone on the
internet can put arbitrary markup in front of a signed-in staff user, and unlike
an upload there is no gate to refuse it at. This is the layer that contains it.
All pure, all free of `server-only`, so the security-critical string handling is
testable without a network. 68 tests.

**Which control is load-bearing, written into `render/policy.ts` so nobody has
to re-derive it.** The body renders in an iframe pointed at its own route:

- Against script execution — the **absence of `allow-scripts`** in the sandbox
  attribute. A browser bit computed before any content parses, which nothing
  inside the document can flip. `script-src 'none'` and the sanitizer are
  defence in depth, not the boundary.
- Against tracking — the **response CSP** (`img-src 'self'`, `connect-src
  'none'`). The sanitizer's rewriting is what makes "show images" mean anything;
  the CSP is what enforces it.

`allow-same-origin` is present for exactly one reason: so the parent can read
`scrollHeight` and size the frame, avoiding a nested scrollbar in a reading
pane. It carries a boxed warning, because `allow-scripts` **together with**
`allow-same-origin` lets a framed document delete its own sandbox attribute —
that is not a weakened sandbox, it is none at all, on markup written by an
anonymous sender. A test asserts the two tokens never co-occur. If script inside
the frame is ever genuinely needed, the answer is a separate origin, not a token.

**The CSP has no permissive mode.** It is byte-identical whether or not images
are unblocked, because unblocking changes what the sanitizer *emits*, never what
the browser *permits* — proxied images are `'self'`. A toggle that widened the
policy would also re-open CSS exfiltration for the whole document.

**`sanitize-html` was added, and the justification is that it is NOT the
boundary.** With scripting already impossible, a bypass here is a rendering bug
rather than a compromise, which makes the pure-Node parser proportionate against
DOMPurify in a full DOM emulation. Hand-rolling was rejected outright: the
instinct to hand-roll pure parsers is right in this codebase for CSV, MX records
and JMAP payloads, and wrong for HTML, where mutation XSS lives in the
disagreements *between* parsers.

**The corpus found five real bugs in my own configuration**, which is the whole
argument for writing it. Every payload runs through the same invariants, so
adding one tests all of them:

- `allowedAttributes` is applied AFTER `transformTags`, so the `target` and
  `rel` the transform added were silently discarded — links shipped without
  `rel="noopener"`.
- An `exclusiveFilter` dropping src-less images also ate the `alt` text, which
  is often the only description of what was withheld.
- **`sanitize-html` does not filter `<style>` CONTENTS** — it treats them as
  text and hands them back untouched, so a stylesheet full of `@import` and
  remote `url()` sailed straight through. `textFilter` is never called for
  them. Cleaned in a post-pass over already-sanitized output.

Other decisions worth keeping: `sanitizeFileName` moved from
`documents/allowlist.ts` to `lib/file-headers.ts`, because mail needs it and
`src/modules/email/` may not import from `src/modules/documents/` — a filename
bound for a header is a header concern anyway. The attachment policy is
**inverted** relative to Documents: mail has no upload gate, so active types and
dangerous extensions are served as `application/octet-stream` + `attachment` +
`nosniff`, which no browser renders under any Content-Disposition quirk. PDFs
are never inline — the reading pane paints them with the existing `PdfCanvas`,
so there is one PDF path in the product. Signed URLs use labelled derivation
from `APP_ENCRYPTION_KEY` (`public-token.ts`'s pattern), with every field in the
payload — including the policy's own `disposition` and `servedType`, so a caller
cannot ask for a nicer one — joined by NUL so no two claims can serialize alike.

Also extracted: `src/lib/file-headers.ts`, so mail attachments and Vercel blobs
share one header block. `blob-stream.ts` had always warned that "adding a route
must not mean re-deriving this list", and a mail attachment cannot use it. A
golden test asserts the emitted set is byte-identical to what it built inline.

### 2026-07-28 (later still) — Slice 2b: the body and blob routes

Two routes, and the hostile fixture message now renders safely end to end.

**`GET /api/mail/[accountId]/messages/[emailId]/body`** — the document the
reading pane's iframe loads. Served as its own response precisely so it carries
its own CSP; a `srcdoc` document would inherit the embedder's, and this app has
none. No signature: `gateMailRoute` proves the account is the caller's through
RLS, so a fabricated `emailId` can only ever address the caller's own mail.

**`GET /api/mail/[accountId]/blob/[blobId]`** — attachments AND inline images
through ONE route, so the header block cannot drift between the two paths. This
one IS signed, and the reason is specific: the signed payload carries the
attachment policy's `servedType`, `fileName` and `disposition`, so a caller
cannot ask for `text/html; inline` and get active content rendered from our own
origin. Order of checks is the security — session and module and RLS-proved
account ownership, then the signature **before any I/O** (pure CPU, so a flood
costs no Neon query and no JMAP call), then the signed tenant/user against the
live session, only then the mail server. Everything that fails returns the same
404; a 403 would confirm a blob exists.

**`downloadBlob()` was added to the JMAP client rather than exposing the token.**
The route needs bytes, and the first version reached for `client.accessToken` —
which does not exist and must not. `accounts.ts` states that everything above it
"reads mail through `authorizedClient()` and never sees a credential", so the
fetch moved inside the client and the route streams the Response it returns.

**Verified against the real fixture message, in a browser, not just in tests:**

| | |
| --- | --- |
| `<script>`, `<iframe>`, `<form>` in output | 0, 0, 0 |
| tracker URL anywhere in the HTML | absent |
| `javascript:` link | text kept, `href` null |
| surviving links | `rel="noopener noreferrer nofollow"`, `target="_blank"` |
| inline `cid:` image | resolved to a signed blob URL, **200 image/png** |
| three remote images | blocked, `alt` preserved |
| frame CSP | exactly `MESSAGE_FRAME_CSP`, sandbox tokens matching |

And the signature was attacked from the app's own page. Swapping the type to
`text/html`, swapping the disposition, swapping the filename, dropping the
signature, moving the expiry, pointing at another blob, pointing at another
account — **404 every time**, with only the untouched claim serving.

One accidental proof worth recording: the first attempt to run that attack from
*inside* the message frame failed with "Failed to fetch" — `connect-src 'none'`
stopping the frame from making any request at all. The CSP demonstrating itself.

Remote images are **always blocked in this slice** and there is no unblock path
yet. Showing them safely means proxying them so the sender never learns the
reader's IP, and an SSRF-guarded proxy is its own piece of work; half-wiring a
toggle that loaded them directly would trade the entire point away for a button.

### 2026-07-28 (later still) — Slice 2c: the three-pane reading UI — **you can read your mail**

Folder rail, thread list, reading pane. Every one a server component; the only
client code is the frame that measures a height, the search box, and the action
bar. State lives entirely in the URL (`?mailbox=`, `?message=`, `?q=`, `?pos=`),
so a view is linkable, reloadable and works with the back button — and the
reading pane needs no client fetch, because the message came from the same load
that built the list.

`ModuleDefinition.Component` now receives `searchParams`. A module that keeps
view state in the URL — the house pattern — previously had no way to read its
own query string.

**Verified against the hostile fixture, in a browser:** folders listed with
unread counts, thread list populated, message opened, body rendered safely,
attachments offered with decoded names (`Facturación año.pdf`), and a
flag → server → unflag round trip confirmed by querying Stalwart directly
(`$flagged` appeared, the button flipped to "Unflag", clicking it removed the
keyword).

**Three bugs found by using it, all of which tests would not have caught:**

- **The message body rendered on a BLACK background.** `color-scheme: light
  dark` let the frame follow the OS while the app is light. Mail HTML is written
  assuming a white page — senders set text colours and leave the background
  alone — so a dark canvas produces black text on black. The frame is now
  forced light, and matches the app rather than the operating system.
- **The frame height measurement was circular.** `documentElement.scrollHeight`
  reports the height the frame ALREADY has, because the root element fills it.
  Measured directly: a 278px message inside a 600px frame reported 600 from the
  root and 278 from the body. Taking the larger pinned every short message at
  whatever height it started with. It measures the BODY now — which reports real
  content in both directions, so a frame can shrink as well as grow. Related:
  `overflow-y: hidden` was removed from the frame's root for the same reason,
  and the iframe uses `overflow: auto` rather than `hidden`, because a
  mis-measure should cost a scrollbar rather than the end of a message.
- **A backtick inside a CSS comment ended the template literal** it lived in.
  The stylesheet is a template literal; one stray backtick is a build error
  pointing at a line that looks fine.

Also recorded: `sanitize-html` warns that allowing `<style>` is "inherently
vulnerable", and it is right about its own guarantees — it does not filter style
contents at all. The warning is now answered explicitly with
`allowVulnerableTags: true` plus the reasoning, rather than left to train the
next reader to ignore console output: contents go through `stripHostileCss`,
CSS cannot reach script because the frame has `script-src 'none'` AND no
`allow-scripts`, and `position: fixed|sticky` is neutralized so a stylesheet
cannot paint over the app.

**Two environment lessons worth keeping**, both of which cost real time:

- **Never run `npm run build` while `next dev` is running.** They share `.next`,
  and the dev server starts serving blank pages until it is restarted.
- **A stale Turbopack tree silently detaches event handlers.** The flag button
  did nothing, logged nothing, and showed no toast — and there were two copies
  of the action bar in the DOM, one of them zero-sized. After a dev-server
  restart there was one button and it worked first time. When a click does
  nothing at all and the server logs are silent, suspect the bundler before the
  code.

### 2026-07-28 (later still) — Slice 3: remote images, behind an SSRF-guarded proxy

Remote images can now be shown, and showing them tells the sender nothing.

**Why a proxy rather than just loading them.** Loading a tracking pixel directly
hands the sender the reader's IP, user agent and the exact moment they opened
the message. Fetched server-side they learn only that somebody did. It also
keeps the frame's CSP absolute: every image is `'self'`, so `img-src 'self'`
never has to be relaxed and **the policy still has no permissive mode** — the
same string whether images are blocked or shown.

**The URL is never a parameter the caller chooses.** It lives inside a signed
claim minted during sanitization, bound to one tenant and one user, so the proxy
can only fetch addresses that already appeared in a message that person opened.
Without that this endpoint would be an open SSRF proxy wearing our server's
network position.

**`src/lib/net/ssrf.ts` is pure and heavily tested (22 cases)** because the
failure mode is silent — a wrong CIDR does not throw, it just lets an anonymous
sender reach something internal. Each blocked range is asserted at the address
below it, at both edges, and above. The ones that get missed, and why each is
handled: **IPv4-mapped** (`::ffff:127.0.0.1`), **NAT64** (`64:ff9b::7f00:1`) and
**6to4** (`2002:7f00:1::`) all carry an IPv4 address inside an IPv6 one, so a
checker that treats the families separately waves them through; and
`2130706433`, `0x7f000001`, `017700000001` and `127.1` are all spellings of
127.0.0.1 that the OS resolver accepts. Non-canonical forms are **refused rather
than decoded** — safer than trying to normalize every spelling.

**DNS rebinding is closed by construction, not by checking twice.** A hostname
that resolves publicly when validated can resolve to 127.0.0.1 when connected.
So `fetch-image.ts` uses `node:http` with a **custom `lookup`**: the validation
runs inside the resolver callback and returns the address it approved, so the
socket connects to exactly what was checked. `fetch()` offers no hook at that
point, which makes it unusable here however convenient it is elsewhere.

Also: redirects are manual and every hop is re-validated (max 3), 5 MB cap,
8 s timeout, no cookies / Referer / reader user-agent outbound, and the served
Content-Type comes from **magic-byte sniffing** rather than what the remote
server claimed — with SVG absent from the sniff table for the same reason it is
refused as an attachment.

**Verified end to end through a real message**, not just in unit tests. The
fixture now carries SSRF payloads, and with images unblocked every one returned
404 — cloud metadata, `10.0.0.1`, the IPv4-mapped and integer-encoded loopbacks,
a database port, and `127.0.0.1:8080`, which on this machine is the live
Stalwart admin API. Failures return 404 with no explanation, so nobody gets a
probe oracle for what our network can reach.

The "Show images" bar is rendered by the **parent, never inside the frame** — a
bar drawn by the message could be forged by the message, and a fake "images
blocked" notice is a perfectly good phishing button. Unblocking is per-message
and per-visit: `?images=1` is cleared when moving to another message or folder,
so consent never carries to mail nobody agreed to unblock.

**Deferred deliberately: the per-tenant daily byte cap** and its
`mail_fetch_events` table. The per-request caps (bytes, timeout, redirects,
type) are the security-critical ones and they are in. Volume is already bounded
by the signature — only URLs from messages a signed-in person actually opened —
so an unbounded-egress abuse path does not exist today. It becomes worth adding
when there are enough tenants for cost, rather than safety, to be the concern.

### 2026-07-28 (later) — Slice 4: sync, the unread badge, and freshness

Mail now updates itself, and the sidebar says how much is waiting. This is the
first **scheduled infrastructure** in the codebase — there was no cron, no
queue and no `vercel.json` before it.

**The constraint that shapes the badge.** `dashboard/layout.tsx` is
`force-dynamic` and renders on EVERY dashboard page. A JMAP call there would put
mail-server latency on the invoice list and the document browser — including for
tenants who have never opened Mail. So `mail_accounts.inbox_unread` (`0044`)
caches the number, sync writes it, and the layout does one indexed SELECT. The
count is stale by at most one sync interval, and accepting that staleness is the
entire reason the column exists.

It counts unread **conversations**, not messages: the app is conversation-first,
so a badge counting messages would say "7" over a list showing three rows. When
a mailbox needs reconnecting the badge becomes a **dot rather than a number** —
we cannot know how much mail sits behind a credential we can no longer use, so a
count there would be a guess. `getMailBadge` also swallows its own errors: a
badge is decoration and must never be why a dashboard page fails to render.

**Two writers, deliberately.** `indexFromEmails` piggybacks on the list view's
existing `queryEmails` call and costs **zero** extra round trips — it is the
primary writer in practice. It deliberately does NOT touch `lastState`, because
it has no idea whether it saw everything, and claiming a state it cannot vouch
for would make the next delta skip real changes. `syncMailAccount` is the
authoritative delta: `currentState()` first, and when the state matches what we
stored the run ends there — no changes call, no gets, no writes. That cheapness
is what makes polling viable at all.

The full-resync path branches on **`errorType === "cannotCalculateChanges"`**,
which is why `takeMethodResponse` was made to carry the JMAP error type back in
Slice 2. Matching that on the text of an English message would break the day
somebody improved the copy. A resync re-indexes the most recent 500 rather than
the whole mailbox: this is an aid for joining threads to business records, not
an archive.

**Two deliberate lies in `foldThreads`, both over-inclusive**, because the
mistakes are not symmetric. `hasAttachment` is sticky-true and `participants`
never shrinks: a filter that returns a thread with no attachment costs a click,
one that hides the thread carrying the file somebody needs costs the job.
Destroyed messages likewise do not delete thread rows — a thread whose last
message was deleted still answers "there was correspondence here", and a link
from an invoice to it should not evaporate. Ordering uses `receivedAt`, never
the spoofable `sentAt`; there is a test where a sender claims 2030.

**The poller is mounted on the mail route only**, never in the layout, or every
page in the product would poll a mail server. It pauses while the tab is hidden
(browsers throttle background timers anyway; pausing makes the intent explicit
and stops billing an invocation for a tab nobody is looking at), polls faster
focused than blurred, checks **immediately** on becoming visible — the
interaction that actually matters — jitters ±15% so N tabs do not align into a
thundering herd, backs off when quiet and again on failure, and **stops dead on
a credential error**, because a revoked token will not fix itself and retrying
it forever is how you get rate-limited by your own mail server.

**The cron route's authentication is the only thing between it and an anonymous
caller draining every tenant's mail server**, so it is the first check, uses a
constant-time compare, and **fails closed when `CRON_SECRET` is unset or too
short** — a cron that never runs is visible, an open endpoint is not. It returns
404 rather than 401, so a caller learns nothing about whether it exists. It also
accepts **no tenant or account id**: no caller-supplied targeting means no way to
aim it. Verified locally: no auth, a wrong same-length secret and a short bearer
all 404; only the real secret runs.

Verified end to end against the live server — `inbox_unread` went 0 → 1 when a
message was moved to the Inbox and marked unread, the state string advanced, the
badge rendered on `/dashboard` (a page that never touches the mail server), and
the needs-reauth dot rendered with `aria-label="Needs attention"`.

**Not done, and needed before this works in production:** `CRON_SECRET` must be
set in Vercel, and **`vercel.json` schedules every 10 minutes, which Vercel's
Hobby plan does not allow** — Hobby cron runs once per day. Confirm the plan or
widen the schedule, or the job silently will not run at the stated frequency.
The per-tenant daily byte cap from Slice 3 is still deferred.

### 2026-07-28 (later still) — Slice 5: the extension registry, and linking that means something

The differentiator. An inbox that cannot put a thread next to the invoice it is
about is a worse Gmail, and until now nothing could.

**P5 exists.** `docs/extension-model.md` §4 named five extension primitives and
said one of them — declared extension points — "does not exist yet and will be
needed first for nav contributions and entity-type registration". It exists now,
at `src/lib/mail-extensions/`. The other four primitives all let a layer *store*
something; this is the first that lets one *do* something. Documents contributes
files and folders, Accounting contributes invoices, bills, customers and
vendors, and neither knows the other is there.

The dependency graph is the same trick `src/modules/index.ts` plays for module
renderers: **mail imports the registry, never a module; a module imports
`types.ts`, never mail and never another module; `registry.ts` is the one file
where both are named.** `src/modules/email/` is the single exemption to the
second rule, and the exemption *is* the shape of a declared extension point —
mail declares the slot and therefore runs the registry that composes the
fillers. A filler that knew about the other fillers would not be one.

**Two rules in the contract are security rather than style.** `search` and
`resolve` take the CALLER'S `tx` — they never open their own, and never
`withSystem` — so what an extension can find is exactly what the person asking
may see. That is invariant S12 expressed as a function signature rather than a
promise. And every hook is optional, nothing may throw, and `resolve.ts` wraps
each one in `Promise.allSettled` plus a 2.5s timeout: a wedged extension costs
its own chips, never the inbox. There is a test that hangs one deliberately.

**Linking COPIES the message; it does not point at the mailbox.** Settled with
the founder earlier and recorded in Decisions below; this is the slice that
builds it. A mailbox is private per user (`0043`) and `mail_thread_index` holds
no bodies, so a bare link would show a colleague *"a thread called X, with these
people, last Tuesday"* and not one readable word. At link time the message and
its attachments are therefore filed into Documents and the link points at that
copy — which also closes the `attachments → Documents` loop this dossier has had
open since the hosted-mailbox build.

The copy is stored **twice, deliberately**. The `.eml` (`Email.blobId` is the
whole RFC 5322 message) is the snapshot: complete, standard, openable in any mail
client. A plain-text transcript goes into `documents.extracted_text`, which feeds
`search_tsv`, so "find the email where they agreed the price" works from the
Documents search box. Neither replaces the other — a lossy rendering filed as
*the record* would be a comfortable lie, since a dispute about what somebody
agreed to is settled by the message rather than by our pass over it, and an
`.eml` nobody can search for is a file nobody finds.

`message/rfc822` was added to the DMS allowlist for it. Safe for the same reason
`application/zip` is: absent from `INLINE_SAFE`, so it can only ever be served
`attachment` + `nosniff`, which no browser renders.

**The three consequences the decision carries, all built in.** The copy is a
point-in-time snapshot and both the picker and the reverse view say so in words
("a later reply is a new message, not an update to this one") — the alternative
is somebody trusting a stale record months later. Unlinking leaves the filed copy
in place: *"this email is not about that invoice after all"* and *"destroy this
record of correspondence"* are different intentions and only one was expressed,
so the toast says "the filed copy is still in Documents" rather than "removed".
And filing writes `mail.message_filed` / `mail.thread_linked` audit rows through
`logAuditInTx`, **inside** the transaction rather than fire-and-forget — the rest
of this module uses `logAudit` because an audit hiccup must not fail a read of
somebody's inbox, but this action publishes one person's private correspondence
to their colleagues, and that record must not be able to go missing while the
copy commits.

**The reverse view is two reads of one table.** "Emails on this invoice" walks
link → thread → filed copy, so no new join table was needed: it and "the invoice
on this email" are `mail_links` read from opposite ends, and an industry pack
registering a `job` type gets the view for free. It deliberately shows the FILED
COPIES rather than the threads, because the colleague reading the invoice is not
the person whose mailbox it lives in — the thread's own subject line is invisible
to them by RLS, correctly. It renders **nothing at all** when nothing is
attached; a permanently empty card on every invoice in the product would be an
advertisement rather than a feature.

**`0045`/`0046`: `mail_links.mail_account_id`, and the FK that had to be written
by hand.** A thread id is opaque and unique only inside one mail account, so two
connected accounts in one tenant that ever minted the same id would have had
their links merged. The table was still empty — the last free moment.

The column is NULLABLE, and the nullability is the design. The FK is
`ON DELETE SET NULL (mail_account_id)` — the column-list form (PG 15+) that
drizzle-kit cannot express, so `0046` is hand-written with the reasoning in it.
Two things turn on that:

- **The column list is load-bearing.** A composite FK's plain `SET NULL` nulls
  every key column, `tenant_id` included, which is NOT NULL — so disconnecting a
  mailbox would fail outright, at the worst possible moment: someone revoking
  access to their own private mail.
- **SET NULL rather than CASCADE** because the entire reason linking copies the
  message is that the link must survive the person who made it — their token
  expiring, their disconnecting the mailbox, their leaving the business — which
  is exactly when the correspondence behind an invoice is most wanted. CASCADE
  would delete it at that moment and quietly undo the design. There is an
  isolation test that disconnects a mailbox and asserts the link survives with
  `tenant_id` intact.

`NULLS DISTINCT` (the default) on the reshaped unique index is the deliberate
partner: orphaned links compare as distinct, so a SET NULL can never collide, so
a disconnect can never be blocked by a unique violation. Nothing in the app
inserts a null, which is what keeps the index total in practice.
`mail_annotations.version` landed alongside — an annotation is the one mail row
two writers genuinely race for, and last-write-wins on a jsonb blob loses one of
them silently.

**Module isolation is now a constraint rather than discipline.** `no-restricted-imports`
zones in `eslint.config.mjs`: no module may import another, only `registry.ts`
may import modules, and a contributing module may import only `types.ts`.
`docs/extension-model.md` said ship them with this slice or not at all, and it
was right — this codebase is built largely by agents reading nearby code to infer
what is allowed, so one cross-module import would have read as precedent forever.

The first version of those zones **failed immediately, and the failure was
mine**: `../documents/*` flagged `src/modules/accounting/documents/links.ts`,
which is accounting's own subdirectory, not the Documents module. From inside a
module subdirectory the single-level relative path points at a SIBLING, not at
another module. Dropped; two levels and beyond always clear the module root and
stay. Worth keeping because it generalizes — a lint pattern matches the import
STRING, not the resolved path, and the two are only the same from a file you are
not thinking about. Also deliberately unrestricted: `@/db/schema`. Tables are the
platform's, not a module's; what isolation protects is code coupling, and RLS
rather than an import graph is what decides who may read a row.

**Verified against a real Postgres, not only in unit tests.** A throwaway suite
seeded a tenant with an invoice, bill, customer, vendor, folder and filed message
on the dev branch and ran every hook under a real RLS context. Twelve
assertions, all passing — search reaching invoices through the customer join, a
bill found by its vendor's own number, batch `resolve` answering for all six
types in one pass, the two-hop reverse view returning the filed copy, a deleted
target leaving its link unresolved rather than vanishing, and a bare `%`
escaping to zero results rather than matching the table. The most valuable one
was the shortest: **an owners-only folder was invisible to a staff caller with no
predicate of ours anywhere in the extension** — RLS had already removed it before
the rows reached the code. That is the whole argument for hooks taking the
caller's transaction, demonstrated rather than asserted.

**And then verified in a browser, against the local Stalwart, end to end.** The
hostile fixture message was attached to a folder and every part of the path did
what it claims:

| | |
| --- | --- |
| filed `.eml` | `Invoice 4471 — façade works.eml`, `message/rfc822`, 4797 bytes |
| `extracted_text` | `Subject: … / From: Supplier Test <…>` — the transcript, non-ASCII intact |
| attachments filed | 2 (`Facturación año.pdf`, `notes.txt`), 0 rejected |
| inline `cid:` logo | **not** filed — it is part of the rendering, not a file |
| `metadata.mail` | kind, threadId, messageId, `rfcMessageId`, `filedAt` |
| `mail_links` rows | 2 per attach, both carrying `mail_account_id` |
| audit | `mail.message_filed` + `mail.thread_linked`, ids and counts only |

Two behaviours are worth recording because only a real round trip could show
them. **Idempotency by content hash works**: attaching the same message a second
time, to a different folder, reused the existing copy and reported "a copy was
already filed" rather than filing a duplicate — one message, two links, one
document. And **unlinking left the copy**, with the toast saying so in words:
*"Detached. The filed copy is still in Documents."*

One UI bug the browser found that no test would have: in a flex column,
`items-start` sizes children to their content, so `truncate` had nothing to
truncate against and a blob-suffixed file name pushed a horizontal scrollbar
across the picker. Mail is full of long file names, so that was the normal case
rather than the edge one.

**And a design mistake the founder found in about a minute, which no amount of
testing would have caught.** He attached an email to the "Admin" folder, opened
Admin, and there was no email in it — the copy had gone to the Documents Inbox.

The reasoning that produced it is in the code above, and it is *correct for the
case it was written for*: filing straight into a folder means guessing which one,
and a guess is a visibility decision, because folders carry
`effective_visibility` and a wrong guess either hides the correspondence or
publishes it wider than intended. All true — when you attach a thread to an
INVOICE, which names no folder.

It is simply false when you attach to a **folder**. There is no guess to avoid:
the destination *was* the instruction. A rule that was right about invoices got
applied to a case it had never been reasoned about, and the result was a feature
that quietly ignored what the person told it. **A justification is scoped to the
case that produced it; carrying it to a neighbouring case is not the same as
having thought about that case.**

The fix: `FiledMessageInput` now carries the attach `target`, passed through
neutrally — mail states what the person picked and expresses no opinion, and a
filing target ignores anything it does not recognise. Documents recognises
`folder` and files there (visibility inherited from the folder, exactly as an
upload's is, which is the narrowing direction and therefore the safe one);
everything else still lands in the Inbox. `FiledMessageResult` gained
`destinationLabel`, so the toast reports where the copy ACTUALLY went rather than
where the default would have put it — telling somebody the copy is in one place
while it sits in another is the specific failure that started this.

Two follow-ons, both found by testing the fix rather than by reasoning about it:
an already-filed copy still sitting in the Inbox is MOVED when a later attach
names a folder (the person has now said where it belongs; a copy already in a
folder is left alone, because that was a deliberate act), and the move takes the
**attachments with it** — they were filed by one act and splitting one email
across two locations is worse than either place on its own.

Still unproven: the reverse view has been verified at the query level (invoice →
thread → filed copy, against real Postgres) but never rendered on an invoice page
with real data, because the local tenant has no invoices.

### 2026-07-28 (later still) — Slice 6: compose, reply, forward, send (branch `claude/email-compose`)

The reader became a mail client.

**The risk was retired before anything was designed, which is the only reason
this slice was cheap.** The plan flagged one thing that could sink it: if the
token granted by `SCOPE_MAIL` did not cover
`urn:ietf:params:jmap:submission`, sending would fail *after* somebody had typed
a message, and fixing it would mean a scope change — which forces every
connected user to reconnect.

`npm run jmap:probe` could not answer it. It authenticates with Basic auth and
predates the OAuth flow, so it proves what the SERVER offers, not what the TOKEN
may do. A throwaway suite ran `Identity/get` through `authorizedClient()` with
the real stored connection instead, and that is the cheapest honest test
available: **the identity object belongs to the submission capability, not to
mail**, so a token that cannot send cannot list identities either. It answered
yes — one identity, `admin@yosher.test`, no scope change needed.

**The `using` array was hardcoded and would have broken everything.** `client.ts`
sent `using: [CORE, MAIL]` on every request. A server rejects a method whose
capability the request did not declare, so `EmailSubmission/set` *and*
`Identity/get` would have come back `unknownCapability` however well-formed they
were. It is per-call now — and deliberately not "always include submission",
because `using` is a statement about what a request needs, and on a server that
scopes tokens by capability, a read announcing it might send would fail for a
read-only token.

**Send is one round trip.** `Email/set create` builds the draft, an
`EmailSubmission/set` back-references it with `#draft`, and
`onSuccessUpdateEmail` strips `$draft` and moves it to Sent — one request, so
there is no window in which a draft exists that nobody decided to send. That
also collected the correction Slice 0 predicted: `onSuccessUpdateEmail` emits a
SECOND response under the same call id, so `takeMethodResponse` now takes an
optional method name. First-match happens to be right today; relying on ordering
a server may change is how a send starts reporting the wrong half of its result.

**A `/set` returns HTTP 200 with the failure inside it.** `readCreated` reads
`notCreated` and translates its own error vocabulary — `tooLarge`,
`forbiddenFrom`, `overQuota` — because treating 200 as success is precisely how
a message silently fails to send. When the draft is created but submission
fails, the message says so and names Drafts, rather than leaving somebody
retyping something that is already saved.

**The envelope guard, and why it is not a copy of `applyDevGuard`.** That one
rewrites the `to` HEADER and mangles the subject, which is right for a
transactional send where header and envelope are the same thing. It is wrong for
a composed message twice over: the message is filed into the person's own Sent
folder, so a rewritten header would leave a record of a message they never wrote;
and the point of testing compose is seeing the real thing.

So `guardComposedRecipients()` rewrites the **envelope** — SMTP `RCPT TO`, which
JMAP models as `EmailSubmission.envelope.rcptTo` — and leaves `To:`/`Cc:`
untouched. The developer sees a truthful message, Sent holds a truthful record,
delivery goes only to them. Headers and envelope disagreeing is not a trick: it
is how every mailing list, bcc and forwarding rule on the internet already works.
It refuses outright when `EMAIL_DEV_REDIRECT` is unset, and it reuses
`isLiveSendEnvironment()` for the third time — the trap that Vercel builds
previews with `NODE_ENV=production` is now encoded once and depended on by the
send spine, the mailbox host and the composer.

**The envelope is built in exactly one place.** `compose/send.ts` runs the guard
and hands the answer to the client; `JmapComposedMessage.envelopeRcptTo` is
populated on that one line and nowhere else. That is what makes "a preview cannot
mail a customer" a property rather than a habit — one door, with the guard in it.

**Attachments do not go through a server action.** Next caps an action's body at
4 MB, which would have made that the attachment limit for the whole product — a
limit nobody chose, that does not match the mail server's, and that would surface
as an inexplicable failure on a normal set of drawings. `POST
/api/mail/[accountId]/upload` streams to the session's `uploadUrl`; the bytes
never touch our storage, and only the returned `blobId` is kept.

**The recipient rules are where a mistake actually costs something**, so they are
pure and tested hard (45 cases). Reply-To beats From; reply-all keeps the
original To in To rather than demoting people to Cc; self is excluded
case-insensitively — and the case the naive rule breaks on, **replying to your
own sent message**, writes to the people you wrote to instead of producing a
draft addressed to nobody. Subject markers are stripped to a fixed point and
handle `Re[2]:`, `AW:`, `SV:`, while leaving "Review: Q3" and "Reference: 4471"
alone. A forward starts with NO recipients, deliberately: prefilling the
originals is how a private thread gets sent back to the people it was about, and
it carries no threading headers, or it lands inside the original conversation.

**Quoting never passes the original markup through.** A quoted body is
attacker-controlled markup about to be sent under our user's name — a different
threat from rendering it, since the danger is not script running here but our
user unknowingly forwarding something hostile over their own signature. So the
HTML path converts to text and re-emits escaped markup we built. Structure is
lost; the recipient already has the original, and the `.eml` filed by Slice 5 is
where a faithful copy lives.

**Two corrections worth keeping.** `stripMarkers` was capped at 20 iterations as
a guard against "unbounded loops on hostile input" — a hazard that did not exist,
since each pass strictly shortens the string. The cap quietly became a
correctness bug that left `Re: Re: Re: …` on absurd input. And clamping the
subject BEFORE stripping cut mid-marker and left a bare `Re` behind as though it
were the real subject; the length limit belongs on the output.

**Verified against the live server**: the composer prefills a real reply from the
hostile fixture — To resolved through Reply-To, `Re: Invoice 4471 — façade works`
with the ç and é intact, an attribution line stamped from `receivedAt` and a
`>`-quoted body — and **pressing Send was refused by the guard**, with
`inReplyTo` correctly derived from the parent, the specific reason in the server
log and the vague one on screen.

**Then `EMAIL_DEV_REDIRECT` was pointed at the local Stalwart mailbox and a real
message went out**, which proved the parts no unit test reaches:

| | |
| --- | --- |
| draft → submitted → filed | Sent Items **1**, Drafts empty — `$draft` stripped |
| actually delivered | Inbox **1 → 2**: it came back through real delivery |
| envelope redirected | went to `admin@yosher.test`, not to the supplier |
| **header left truthful** | the sent copy still reads **"To Supplier Test"** |
| threading | Stalwart put it in the parent's thread — the References chain held |

That fourth row is the one worth keeping. The envelope and the `To:` header
disagree on purpose, and the sent copy in the person's own folder is a record of
the message they actually wrote rather than of a redirect. `applyDevGuard` could
not have produced that, which is why this is a third answer rather than a reuse.

A pleasant consequence nobody designed: the Slice 5 chips appear on the reply
too. Links are per THREAD, so a new message in a linked conversation inherits
them — the invoice an email was attached to is still attached to the answer.

**A debugging lesson, recorded because I got it wrong first.** The Send button
appeared to do nothing: no toast, no server log. There were two copies of the
composer in the DOM, one zero-sized — the exact symptom the Slice 2c entry
attributes to a stale Turbopack tree — so I restarted the dev server, and it
persisted. Both readings were wrong. The zero-sized twin carries **no React keys
at all**, so it is inert non-React DOM rather than a second tree, and the visible
button had `onClick` attached the whole time. The action had run; the log had not
flushed when I looked. **Check whether the handler is actually attached
(`__reactProps$…`) before blaming the bundler** — it is one query and it settles
in seconds what a server restart cannot.

### 2026-07-28 (later still) — Slice 7: organise (branch `claude/email-organise`)

Multi-select and a bulk bar, three filter chips, folder creation, and saved
views. The slice that turns a working mail client into one somebody can keep
tidy.

**One shape, used three ways, so they cannot drift.** `organise/filters.ts`
owns `MailViewQuery`, and it is simultaneously what the URL carries, what
becomes a JMAP filter, and what a saved view stores. A saved search is
therefore not a second query language — it is these parameters written down.
That is Documents' saved-view decision applied again ("the stored jsonb never
becomes a WHERE clause on its own terms — it becomes a URL"), and it lands
harder here: **mail search runs on the mail server**, so the stored blob has no
path to SQL even in principle.

Two rules live in `toJmapFilter` because they are the ones that get
re-implemented wrongly:

- **A text term drops the folder.** Hunting for something you know exists and
  being told "no results" because you were standing in the wrong folder is the
  worst failure a mail search has. A search spans the account; a chip narrows
  the folder you are already in.
- **Unread is the ABSENCE of `$seen`,** not a keyword of its own. JMAP has no
  `isUnread`, and asking for `hasKeyword: "$unseen"` — which does not exist —
  would silently match nothing rather than erroring.

**`mail_saved_searches` is per-USER, and that is a data-model fact before it is
a privacy one.** `document_saved_views` is tenant-wide and shareable because it
names a folder id, and a folder id means the same thing to everybody in the
business. A mail search names a **JMAP mailbox id**, issued by the mail server
inside one person's account — hand it to a colleague and it points at a folder
that does not exist for them, or at a different one. The feature cannot be
shared because the identifiers are not shareable.

The privacy consequence follows anyway and is what decided the policy: the NAME
of a saved search is correspondence. *"Unread from the solicitor"* tells a
colleague what somebody is dealing with. So `0048` scopes it on
`app.clerk_user_id` — the second table in the schema to do so — with the same
fail-closed direction `0043` established.

It is **member-writable**, unlike the other per-user mail tables. `mail_accounts`
refuses member writes because a member who could write one could point an account
at a token they control, which is an authentication bypass. Nothing of the sort
is true here: the worst somebody can do to their own saved views is save a bad
one. The `WITH CHECK` pins `clerk_user_id` as well as `tenant_id`, so a member
cannot plant a view in a colleague's rail any more than they can read one out
of it.

**The risk the plan named, handled.** `Email/set` caps at `maxObjectsInSet` —
500 on this server — and exceeding it **errors rather than truncating**, so a
bulk flag over a big selection would have failed entirely rather than doing as
much as it could. `applyToEmails` chunks, the way `getEmails` already chunked
for `maxObjectsInGet`, and both `setKeyword` and `moveToMailbox` now go through
it. A failed chunk **does not discard the successful ones**: it stops and
reports what got through, because returning a bare error after moving 500 of 900
messages leaves somebody with no idea which half of their mailbox moved. The UI
says `"300 of 900 done — the mail server refused 600"` rather than "done".

**The selection is the one piece of state that does NOT belong in the URL.**
Everything else in this module is a parameter; a list of chosen message ids is
not something anybody wants to bookmark, share or restore with the back button,
and putting it there would make every checkbox a navigation. So `ThreadList`
became a client component, the rail stayed a server one, and the rows are still
links — selecting is a checkbox beside the link rather than a mode you enter.

"Select all" is scoped to the page **and says so**. "Select all" that silently
means all 4,000 in a folder is how people trash things they meant to read.

**Role folders cannot be renamed, and it is refused on the server.** Roles are
how `archive`, `trash`, `sent` and `drafts` are resolved throughout the module —
renaming one does not break its name, it breaks every lookup that depends on it.
`renameFolderAction` re-reads the folder list and checks `role !== null` rather
than trusting the UI to hide the option.

**Verified against the live Stalwart, in the browser:**

| | |
| --- | --- |
| filter chips | `?flagged=1` empty → bulk-flag → `?flagged=1` finds it |
| bulk action | `bulkAction({action:"flag"})` landed on the mail server |
| saved view | stored, listed in the rail, name auto-suggested as "unread, in Inbox" |
| folder create | "Quotes" appeared in the rail — and in every other mail app |

One detail worth recording because it is the design working rather than a gap:
**this Stalwart has no `archive` role folder**, so the bulk bar has no Archive
button. The button is conditional on the role resolving, so a mailbox without
one simply does not offer the action instead of offering one that fails.

### 2026-08-01 — Production: the module reads a real mailbox on our own server

**The loop closed.** A message sent from Gmail to `dan@m.yosherapp.com` arrived
at a Stalwart instance we run, and was read in Yosher. Every prior entry in this
log was written against a container on a laptop that could not receive mail from
the internet.

What that took, beyond the runbook (`docs/runbooks/mail-server.md` carries the
server-side detail): a Hetzner box, `m.yosherapp.com` as the mail domain with
the apex left on Migadu untouched, a Let's Encrypt certificate, migrations
`0041`–`0048` against production, the `email` module seeded and enabled, and
`STALWART_CLIENT_ID` from `mail:register-client`.

**A self-signed certificate is not cosmetic — it blocks the app.** SMTP tolerates
it through opportunistic TLS, so mail flowed for hours while the app could not
connect at all. Node rejects it outright (`verify error:num=18`). TLS is a
prerequisite for the module, not a finishing touch, and it is worth stating here
because the mail arriving made everything *look* finished.

**Three Migadu assumptions were baked into supposedly shared code**, all found in
the space of an hour by being the first caller that was not Migadu:

| Where | What | Fix |
| --- | --- | --- |
| `createHostedDomain()` | called `getMailboxHost()` with no argument, so every new domain was provisioned against Migadu whatever the platform ran — and the wizard then rendered Migadu's **MX** records for a Stalwart domain | #33, `defaultMailboxProvider()` reading `MAILBOX_PROVIDER` |
| `mxPointsAt()` | substring-matched the live MX against the **provider name**, which only works because Migadu's MX hostnames carry the brand. A self-hosted MX is the operator's own hostname, so the cutover refused itself while naming the correct destination as the wrong one | #35, `MailboxHost.mxNeedle()` |
| the SPF record the wizard suggests | `v=spf1 mx a:<host> -all` authorizes the server but not the relay it sends through, and hard-fails. Publishing it makes every relayed message fail SPF | **not fixed** — the right record depends on the relay, which is a design decision |

The pattern is worth naming: the seam existed in all three cases. `provider` was
already a column, `getMailboxHost` already took an argument, `mxPointsAt` already
took a needle. What was missing was any caller that exercised the second
implementation, so the defaults silently hard-coded the first one. **A seam with
one user is a seam that has never been tested.**

**Two gaps this surfaced, both unbuilt rather than broken:**

**The invite flow does not exist.** `createTenantMailbox()` validates the invite
address, sets `invitePending: true`, and returns — there is no send anywhere in
that path. The UI reports "setup link sent" regardless, driven purely by that
flag. So the copy asserts something that never happened, which is how it stayed
invisible.

**And it could not work if it did send.** The link would set a password in
`mail_directory_accounts`, the SQL directory table, while this Stalwart runs on
its **internal** directory (`Directory: None` on the domain, deliberately — the
runbook explains why the SQL route would have locked everyone out). The two
account stores do not meet. `afterMailboxCreated` writes to one and
authentication reads the other.

Consequence: **nobody but the founder can get a password on a mailbox**, because
his was set by hand in Stalwart's admin UI. Client onboarding needs the invite
sent, a set-password page, and a decision on which directory is authoritative —
either wire Stalwart to read the SQL directory, or teach the adapter to call
`x:Principal/set`. The latter is now a known quantity: the whole certificate
diagnosis was done through that API.

**`STALWART_MAIL_HOSTNAME` is documented in SETUP.md but not `.env.example`**,
which is why it surfaced as a runtime error mid-deploy rather than while filling
in config. Folded into the next docs change.

### 2026-08-01 (later) — Triage: a keyboard, a working star, and snooze

The first slice aimed at a mailbox somebody has to get through rather than one
they are admiring. Prompted by a straight comparison against Gmail's feature
surface; the gaps that mattered were triage speed, rules, compose polish and
labels, and this is the first of those.

**Attachment indicators were already built** — `hasAttachment` was on
`ThreadRow` and already drew a paperclip. Dropped from the plan rather than
reimplemented.

**The star was drawn and did nothing.** `row.flagged` rendered a filled flag
inside the row's `<Link>`. A `<button>` nested in a link is invalid HTML and
would have fought the navigation around it, so there was no way to flag from
the list at all — only from the bulk bar, having ticked something first. Moved
out to sit between the checkbox and the link. Optimistic, reverting on refusal:
flagging is a reflex performed while reading, and a star that fills in only
after a round trip reads as a click that missed, so people click again and
unflag what they just flagged.

**The keyboard** is `triage/keymap.ts` plus wiring, split so the rules are
testable without a DOM. Two of them are the whole feature. Escape is the only
key that survives a text field, because `e` inside the composer is a letter and
typing "There" into a reply must not archive the thread on the E and trash it
on the R. And modified keys are always declined — Ctrl-R is reload, Cmd-F is
find, and stealing those breaks the browser rather than extending it.

`moveCursor()` is pure for the same reason: edges in a key handler stay
invisible until somebody holds a key down. It clamps rather than wrapping,
because holding `j` at the bottom of a wrapping list teleports you to the top
and the next `#` deletes something you were not looking at.

#### Snooze, and the decision underneath it

**The message really moves**, into a folder called Snoozed on the mail server.
Hiding it in Yosher's list instead would have been a fraction of the code and
quietly wrong: the same mailbox is open on a phone and in Outlook, and mail
hidden in one client has not been dealt with — it has been dealt with in one
window.

That decision is what shapes `mail_snoozes` (`0049`/`0050`). The table is a
REMINDER, not custody. The mail server holds the truth, and losing every row
here would lose no mail — it would leave a pile of messages sitting in a
visible folder called Snoozed, waiting to be dragged back by hand. Every
failure path is chosen to land there.

**Third per-user table**, after `mail_accounts`/`mail_thread_index` (`0043`) and
`mail_saved_searches` (`0048`), and the reasoning stacks: the mailbox ids are
issued inside one person's account so they cannot be shared even in principle,
and a row is a diary entry saying what somebody is deferring and until when.

**Due times are computed in the BROWSER.** "Tomorrow morning" is a statement
about the user's calendar and the server's clock is UTC; resolving it
server-side would wake messages at 08:00 UTC, the middle of the night for a
good share of the people being reminded. The server bounds the instant rather
than recomputing it — it cannot, the timezone is not in the request. It
rejects past times instead of clamping them, because clamping to "now" would
move mail into a folder and straight back out, which reads as flickering rather
than as a bug worth reporting.

**Waking rides on the existing mail-sync cron** rather than getting one of its
own. Vercel's Hobby plan runs each cron ONCE A DAY, so a second job would mean
"later today" arriving tomorrow. Bounded separately and run last so a large
batch cannot eat the sync's 60 seconds.

**Idempotent by construction, in the one direction that matters.** The row is
deleted only after the mail server confirms the move. A run that dies halfway
leaves rows whose messages are already back, and the next run asks the server
to move them somewhere they already are — a no-op that reports success. The
other order would strand a message in Snoozed with nothing left to remember it.

**Not verified in a browser.** The dev server would need `.env`, which points
at the production database and a live mailbox, so exercising `e`, `#` and
snooze would archive, trash and hide real mail. 28 unit tests cover the keymap,
the cursor edges and every due-time boundary — snoozing at 11pm, on a Saturday,
asking for "next week" on a Monday — plus three isolation tests for the new
table. The wiring wants a preview deployment.

Open, and worth knowing: `j`/`k` does not scroll the cursor row into view; the
Snoozed folder has no view of its own, so a snoozed message is findable only by
opening that folder; and there is no un-snooze beyond moving it back by hand.

### 2026-08-01 (later still) — Auto-replies, and the badge that is the feature

Out-of-office, using `urn:ietf:params:jmap:vacationresponse` — one of three
capabilities the server was advertising and the product ignored. First half of
"rules and auto-replies"; Sieve rules follow separately, because turning user
input into a script the mail server executes deserves its own diff.

**The mail server sends these, not us.** That is the entire reason the feature
works: it fires while nobody is signed in, which is exactly when somebody is
away. So nothing is stored locally — `VacationResponse` is a JMAP singleton
with the fixed id `singleton`, updated in place, never created and never
destroyed.

**Verified against the live server before writing the client**, including the
failure shape: an invalid `fromDate` comes back as
`notUpdated.singleton.type = "invalidProperties"`, with `oldState` equal to
`newState`, so a refused write changes nothing.

**THE BADGE IS THE FEATURE.** The way an auto-reply goes wrong is never that it
failed to send — it is somebody getting back from a week away and leaving it on
for a fortnight, answering customers on their behalf. So the header reads the
setting on every mail page load and says so, at the cost of one extra JMAP
call. Reading it only when the form was open would have made the badge
impossible, which would have left the actual failure invisible.

`autoReplyState()` exists because `isEnabled` answers a different question from
"is this replying to anyone right now". A response enabled since March, with a
window that closed in April, is both on and inert. Calling that "On" is how
somebody believes their customers are being answered when they are not, so
scheduled and finished are distinct states with their own wording.

**Validation refuses an end date that has already passed.** That is the quiet
failure this module is shaped around: it saves, it reports success, and it
never sends anything. Nothing about using the product would reveal it.
Everything else in `validate.ts` is ordinary bounds — except that a DISABLED
reply is never validated at all, because somebody switching it off is not
somebody making a mistake, and refusing to save would trap them in a form they
are trying to leave.

**Dates cross the boundary twice and must not drift.** The form uses
`datetime-local`, which is wall-clock with no zone — correct, since "back on
Monday the 18th" is a statement about the person's calendar. It converts to an
absolute instant on submit and back to local on load. Appending a "Z" on the
way back would shift the window by the user's offset on every open-and-save.

**The audit row records whether it is on and whether it has a window — never
the subject or the body.** An out-of-office message is the most quotable thing
in a mailbox: it routinely says who is covering, where somebody is, and until
when. That belongs in the mail server, not in an audit row (S9).

A mail server that will not answer leaves the badge absent rather than claiming
the reply is off, and the form says so rather than showing a confident blank
one somebody might save over the top of.

Not verified in a browser, same constraint as the triage slices: the dev server
needs `.env`, which points at the production database and a live mailbox.
15 unit tests cover the validation and state machine, including both window
boundaries.

### 2026-08-01 (later still) — Rules: the compiler, and what the server caught

Second half of "rules and auto-replies". This lands the parts with teeth —
the Sieve compiler, `mail_rules` (`0051`/`0052`) and the JMAP script methods.
**The editing UI is not here**; it follows in its own PR.

**The compiler generates code the mail server executes.** Everything a user
types is interpolated into a program, which makes `sieveString()` the most
important function in the module. A quote that escapes its string does not
throw — it changes what happens to every message that arrives afterwards.
Backslash is escaped before quote (the other order re-escapes what the first
pass introduced), and control characters are stripped rather than escaped,
because a comment runs to the end of a line and nothing legitimate in "subject
contains" needs a newline.

**THE LESSON OF THIS SLICE: seventeen passing unit tests, and the output was
invalid.** The compiler emitted `require ["fileinto", "mailboxid"];` — which
is what RFC 9042 reads like — and Stalwart rejected the entire script with
`Undeclared capability 'mailbox' at line 7, column 12`, pointing at the
`:mailboxid` tag. Nothing in a unit test could have found that; the assertions
were checking the output matched what I believed correct. It was caught by
uploading a generated script to the real server and letting it compile.
The exact `require` line is now pinned in a test as the regression guard.

**Rules file by mailbox ID, not by name.** The server advertises the
`mailboxid` extension, so `fileinto :mailboxid "id" "Name"` survives a folder
being renamed, and carries the name only as the fallback for when the id stops
resolving — which is what stops a deleted folder turning into silently dropped
mail.

**Scripts are updated in place and never deleted.** The server refuses to
destroy an active script (`scriptIsActive: "Deactivate Sieve script before
deletion."`), so delete-then-recreate would need a window with NO rules
running, during which arriving mail lands unsorted. `putSieveScript()` looks
up the existing script by name and swaps its blob instead.

**The mail server goes first on every save.** If it refuses the script, nothing
is written to the database — so the rules somebody is looking at always
describe the script actually running. The other order leaves a list with no
relationship to how mail is being sorted, which is worse than a failed save.

**Every write recompiles everything.** There is no incremental path, because
`stop` makes rules order-dependent: a script assembled from a partial view of
them would sort mail differently from the list on screen.

**Two rule shapes are refused rather than emitted**, and reported as inert: one
with no tests (it would match EVERY message, filing a whole mailbox into one
folder on the strength of a half-finished form) and one with no action.

`mail_rules` is the fourth per-user table. The privacy argument is the usual
one, but the write side is sharper than on any table before it: a rule planted
in somebody else's script would file THEIR mail somewhere they never look,
server-side and invisible from the inbox. That is what the `WITH CHECK` on
`clerk_user_id` is holding.

Open: no UI yet, so rules can only be written through the action; `discard` is
deliberately not offered as an action; and the isolation suite has not been run.

### 2026-08-01 (later still) — The rules editor

The UI over the compiler from the previous entry. Reached from the header, and
it takes the reading pane like the composer and the auto-reply form.

**ONE FORM, ONE SAVE, for the whole list.** Rules are order-dependent —
`stop` means "and nothing after this" — so a per-rule save would let somebody
publish rule 3 while rules 1 and 2 sat unsaved, and the script would sort mail
differently from the list they were looking at. Saving everything at once is
the only version where what is on screen is what is running.

For the same reason the reorder buttons are not cosmetic, and the Save button
says what it does: *"Replaces the rules running on the mail server."* These
stop being a list in a form the moment it is pressed and start being a program.

**The editor refuses what the compiler would silently drop.** A rule with no
tests compiles to nothing, because a test-less rule matches EVERY message —
correct, but baffling if it happens without explanation. So the three
unfinishable shapes (no name, an empty condition, no action at all) are named
in the form instead, and Save is disabled until they are resolved.

**Rules are loaded only when the editor is open**, unlike the auto-reply
setting, which is read on every page load. Rules need no badge: the script is
already running on the mail server whether or not this page knows about it.
An auto-reply left on is invisible and costly, which is why that one is worth
a read on every load and this is not.

Not verified in a browser, and for a harder reason than the previous slices:
the dev server is behind Clerk, so seeing this page at all requires signing in,
and there is no way to do that here. The rendering, the reorder behaviour and
the folder select are unexercised.

Open: no way to test a rule against an existing message; no `discard` action,
deliberately; and the editor cannot show which rules the compiler considered
inert until after a save.

### 2026-08-01 (later still) — Rich text, and why the write path is the strict one

The composer sent `text/plain` until now. It sends a `multipart/alternative`
with bold, italic, underline, lists, links and quoting, and a plain-text
alternative derived from it. `htmlBody` had been wired through the whole path
since Slice 6 and unused; this is what fills it.

**THE ASYMMETRY THAT SHAPES ALL OF IT.** `render/sanitize.ts` is the read path
and `compose/html.ts` is its mirror, and the mirror is deliberately much
STRICTER — which is the opposite of what you would guess from the fact that
reading handles mail from anonymous strangers and composing handles what our own
user typed.

The read path has a sandbox behind it. Its own header says so: no
`allow-scripts`, `script-src 'none'`, so a bypass there is a rendering bug rather
than a compromise, and that is what makes a permissive allowlist — tables,
`<style>`, inline CSS, proxied remote images — proportionate.

**The write path has nothing behind it.** Whatever survives leaves our origin,
arrives in a stranger's client, and renders there under OUR USER'S From header.
No sandbox, no CSP we control, no second chance. `quote.ts` already stated the
threat for quoted bodies — "our user unknowingly forwarding something hostile
over their own signature" — and this generalizes it to everything the composer
can emit. So the rule for the allowlist is one sentence: **the composer emits
only what its own toolbar can produce.** No `<img>` (a pasted tracking pixel
would make our user's message track its recipient), no `<style>` and no `style`
attribute, no tables, no classes, no `target`/`rel`.

**Paste is plain text, always, and that is a control rather than a
convenience.** The default paste inserts the source document's markup straight
into the editable — stylesheets, pixels, hidden text, whatever the page carried
— which would then leave under somebody's own name. Intercepting it means
hostile markup never enters the document at all, so the server sanitizer is
defence in depth rather than the only guard. The cost is real and accepted:
pasting from Word or another email loses its formatting. It also means the
editor ships NO sanitizer to the browser, which is what kept a 200 KB library
out of the client bundle.

**`contenteditable` + `execCommand`, deprecated and chosen anyway.** There is no
replacement API, every browser still implements it, and the alternatives were a
300 KB editor framework or reimplementing selection and undo by hand. What makes
it safe is that nothing the component produces is trusted: execCommand emits
`<b>` in one browser and `<span style="font-weight:bold">` in another, and the
server normalizes both down to the same dozen tags. Browser variance is absorbed
rather than fought.

**ONE BODY, NOT TWO.** The composer edits an HTML document and the text
alternative is DERIVED from it at send time. Building a parallel plain-text
draft was the obvious design and is wrong: the two would disagree the moment
somebody edited or deleted the quote in the editor, which is a normal thing to
do, and the message would have gone out as one thing to clients that render HTML
and a different thing to clients that do not. `openingBody` is gone; the text
draft it built has no reader.

**SANITIZE, THEN DERIVE** — `compose/bodies.ts` exists to make that ordering
testable rather than a comment. Both orders read identically at the call site
and only one is right: derive from the submitted markup and the text part
carries the words the sanitizer removed, which is the exact shape of "the HTML
looks clean and the text part still has the phishing link in it". Half the
recipients would read a message nobody checked. It lives outside
`compose-actions.ts` because a `"use server"` module may only export async
functions — a constraint that did us a favour.

An HTML body that sanitizes to nothing visible is dropped rather than sent as an
empty part: a `multipart/alternative` whose HTML half is blank renders as an
empty message in every client that prefers HTML, which is most of them.

**Verified against the live server, because the last three slices were not.**
`npm run mail:probe-compose` creates a real draft with every construct the
toolbar can emit, reads back the MIME the server actually assembled, downloads
the raw RFC 5322, and destroys the draft. It WRITES, unlike `jmap:probe`, so it
is guarded to a loopback server for the same reason `mail:fixture` is. Against
Stalwart 0.16.15 every assumption held, which is the rarer outcome here:

| | |
| --- | --- |
| two `bodyValues` + `textBody`/`htmlBody` | accepted |
| what the server built | a real `multipart/alternative` |
| part order | `text/plain` first, `text/html` last — RFC 2046's worst-to-best |
| charsets | `utf-8` on both, `quoted-printable` transfer encoding |
| `Facturación año — £5` | survived end to end |
| `<blockquote>` | survived into the HTML part |
| `> ` prefixes | survived into the text part |

That matters because `client.ts` bets on the server assembling the MIME rather
than doing it by hand, and "implements the spec" and "behaves as you assumed"
are different claims. The probe cost one wrong guess of its own: **there is no
`primaryAccountId` field on a JMAP session.** RFC 8620 calls it
`primaryAccounts`, a map keyed by capability URI. `parse.ts` had it right; the
probe was written from memory and failed on its first call.

**Three bugs the tests found, all in the HTML→text converter, none of them
findable without asserting the exact output:**

- **A blank line between every list item.** `</li>` ended a line and `<li>`
  started one, and an empty flush was pushing a blank line. Fixed by making
  `gap()` the ONLY source of blank lines — a flush now emits a line or nothing.
- **The same for ordered lists**, which is the same bug and is listed separately
  only because the numbering made it look like a different one.
- **Quoted paragraph breaks vanished.** `quoteText` renders a blank line inside a
  quote as `>`, and the derived version dropped it — so a two-paragraph quote
  arrived as one. Fixed by distinguishing a HARD line ending (`<br>`, which the
  author asked for) from a soft one (a block boundary doing bookkeeping): a hard
  flush on an empty line inside a quote emits the prefix alone.

Two more hazards handled before they could bite. **RFC 3676's signature
separator is `-- ` WITH the trailing space**, and that space is what mail clients
fold a signature on — a blanket `trimEnd()` eats it and the signature gets quoted
back in every reply for the rest of the thread. And a `contenteditable`'s
non-breaking spaces are the browser's, not the author's; left alone they arrive
in a recipient's text part as bytes that look like spaces and do not wrap like
them.

**`quoteText` is now a specification rather than a caller.** Nothing in the
product calls it, but there is a test asserting that
`htmlToPlainText(sanitizeOutboundHtml(quoteHtml(m)))` produces the same
meaningful lines as `quoteText(m)` — the same role the golden test in
`file-headers.ts` plays for the blob header block. If the derived text
alternative ever stops being as good as the purpose-built one, that test says so.

**Signatures got half a fix, not a whole one.** The `signature` prop that was
already threaded into `Composer` carried only `textSignature`; the identity's
`htmlSignature` is now read alongside it and preferred, sanitized on the way in
because it is markup from the mail server heading into a message. So a signature
somebody built in another client keeps its links and layout instead of being
rebuilt from the text version. **Editing one still means using another client** —
that is the next slice.

**Not verified in a browser, and this slice has more riding on that than the
previous three.** The dev server needs `.env`, which points at the production
database and a live mailbox. The pure code is covered by 43 new tests and the
protocol by the probe, but every judgement inside `rich-text-editor.tsx` is
unexercised: whether the `onMouseDown` preventDefault really preserves the
selection across a toolbar click in each browser, whether the caret lands above
the quote on mount, what `formatBlock` does to a selection spanning two
paragraphs, and whether `execCommand` behaves at all under React 19's event
delegation. That file is the one to look at first on a preview deployment.

### 2026-08-02 — The rest of the toolbar, and how `style` was reopened safely

The founder opened Gmail beside Yosher and asked for a full review of the
compose surface rather than a feature or two. The previous slice shipped nine
controls; the live inventory found twenty-odd. This closes everything that is
not an inline image.

**Landed:** text and highlight colour, font family, font size, alignment,
indent/outdent, strikethrough, emoji, undo/redo, Ctrl-K and Ctrl-Shift-7/8,
browser spell check, a Bcc field, a link box that takes display text as well as a
URL, and plain-text mode.

**THE ONE REAL DECISION, and it is the whole slice.** The previous entry's
sanitizer dropped the `style` attribute wholesale, with the reasoning written
into `compose/html.ts`: the write path has no sandbox behind it, so hidden text,
white-on-white and `position:fixed` would leave our origin under the user's own
From header. Colour, font, size, alignment and indent are ALL style features.
Every one of them needed that attribute back.

The naive version opens it and teaches the sanitizer to judge declarations —
parse the CSS, decide what is hostile. That is the losing side of the problem
and it is how every "we filter dangerous CSS" bug gets written.

**What settled it was looking at Gmail rather than reasoning about it.** Its
fonts are a list of eleven. Its sizes are four named steps, not points. Its
colours are a fixed grid of swatches with no hex field anywhere. Alignment is
three buttons. **Every style feature in a mature composer is a fixed
enumeration, never free input** — which means the sanitizer never has to
understand CSS at all. It only has to RECOGNIZE it.

So `compose/formatting.ts` holds the tables, `ALLOWED_DECLARATIONS` is generated
from them, and `sanitizeStyle` keeps a declaration if and only if it is an exact
member of that set. `display:none` is not refused by a rule about hiding things;
it is simply not in any table. The same file builds the toolbar's menus, so
**the toolbar can only emit what the sanitizer accepts, because both read one
file** — structural rather than diligent. There is a test that walks every table
in both directions, so adding a swatch without the sanitizer learning about it
is a failing test rather than a message that silently loses its colour.

**Three things the browser does that the tables had to absorb.**

- **`execCommand` is handed `#cc4125` and the DOM returns `rgb(204, 65, 37)`.**
  A sanitizer comparing raw strings would have rejected every colour the toolbar
  had just applied, and the picker would have looked broken while being
  perfectly safe. `normalizeColor` exists for that one fact.
- **Colour, font and size come back as `<font>`**, not as CSS, because
  `styleWithCSS` is deliberately left OFF — that is also what makes bold come out
  as `<b>` rather than a span the style allowlist has to vouch for. So the
  sanitizer TRANSLATES `<font color|face|size>` into a span carrying one of our
  own declarations, and a `<font>` holding values we do not recognize becomes a
  bare span.
- **`rgba()` is refused rather than flattened.** Alpha is how text is made
  almost-invisible without ever naming a colour that looks wrong on inspection,
  and no swatch produces it.

**THE BUG THE TESTS FOUND, and it would have shipped.** `execCommand("indent")`
does not emit an indented div — it wraps the block in a `<blockquote>`, in every
engine. So Quote and Indent produce THE SAME TAG, and an indented paragraph would
have arrived in the recipient's client looking as though the writer were quoting
somebody. The first fix keyed off `type="cite"`… which `formatBlock` does not
emit either, so the Quote button became an indent instead. Two signals now, and
the DEFAULT is what makes it safe to get wrong: `type="cite"` means quote (the
toolbar stamps it onto the element `formatBlock` just made), a `border` reset
means indent (what the engines emit), and anything else defaults to quote —
because if the stamping fails, the person pressed Quote.

**A second bug from the same test run, and a sanitize-html fact worth keeping:
`transformTags["*"]` runs IN ADDITION to a tag's own transform, after it.** It is
not a fallback. The wildcard style filter was therefore re-filtering the quote
styling the `blockquote` transform had just emitted, and quotes shipped with no
left border. The tags are listed explicitly now. Same family as the
`allowedAttributes`-after-`transformTags` trap recorded in the previous entry:
this library's ordering is not what reading the option names suggests.

**Emoji were the cheapest thing on the list, for one reason: they are
characters.** `insertText`, no markup, no sanitizer rule, and they land in the
plain-text alternative for free. The `<img>`-based emoji some clients use would
have needed the opposite of everything `compose/html.ts` is built around. The
table is hand-written (~330 entries with search terms) rather than a dependency:
the full Unicode set is 1,900 characters and the libraries that ship it carry a
megabyte plus a picker with its own opinions.

**Plain-text mode converts rather than discards.** Switching into it runs the
same `htmlToPlainText` the send path already derives its text part with, so the
words survive and only the formatting goes — and switching back gives a rich
editor seeded with that text. Deliberately NOT sanitized client-side on the way:
`compose/html.ts` pulls in sanitize-html, and importing it from a client
component would have shipped a ~100 KB parser to every reader of the mail page.
It is unnecessary as well as expensive — paste is plain text, so the editor's
contents are only ever its own toolbar's output, and the server sanitizes on
send regardless.

**Two font-table bugs the invariant test caught**, both of the kind that only an
assertion over the whole table finds: `ALLOWED_DECLARATIONS` stored a lowercased
font stack while `sanitizeStyle` emitted the real one, so no font would ever have
matched; and "Serif" led with Georgia, which meant a bare `face="Georgia"` — what
`execCommand("fontName")` round-trips as — matched Serif first and the Georgia
menu entry was unreachable. No two stacks may lead with the same family, and
there is now a test saying so.

**Verified against the live server again.** `npm run mail:probe-compose` was
extended to carry colour, highlight, font, size, alignment, indent and emoji
through the real `Email/set`. Ten confirmations, no findings: the server still
builds a real `multipart/alternative` with `text/plain` first, and the inline
colour, the alignment and the emoji all survive the transfer encoding into the
sent parts. Emoji were worth checking specifically — they are four-byte UTF-8
sequences and a charset mistake shows up there first.

**Deliberately not built.** `justify` is absent: justified text in a mail client
produces rivers of whitespace on the narrow columns mail is read in, and it is
measurably worse for dyslexic readers. Templates need storage and are their own
slice. Confidential mode is Google-proprietary — expiry and SMS passcodes served
off their servers — and is not a JMAP feature.

**Accepted rather than fixed: a palette makes white-on-white reachable.** Gmail
allows it too. It is the sender's own message, and refusing the white swatch
would be strange in a product where somebody legitimately writes on a coloured
background.

**Still not verified in a browser**, and the surface that needs it grew rather
than shrank: nine controls became twenty-odd, six of them popovers with saved and
restored selections. `rich-text-editor.tsx` is the file to open first on a
preview deployment, and the specific things to try are a toolbar click with text
selected (does the selection survive), Quote versus Indent (do they render
differently in the received message), and the colour picker over a multi-block
selection.

### 2026-08-02 (later) — Inline images, and the MIME tree a `cid:` actually needs

The last thing on the Gmail compose review. A picture can now go IN the message
rather than beside it, from the laptop **or from the tenant's own Documents** —
the founder's addition, and the half a webmail cannot do.

**THE PROBE EARNED ITSELF AGAIN, AND THIS TIME BEFORE A LINE WAS WRITTEN.** The
plan was the obvious one: an attachment with `disposition: "inline"` and a `cid`,
which is exactly what RFC 8621 §4.1.4 describes. `npm run mail:probe-compose` was
extended to try it against the live server first, and the tree that came back
was:

```
multipart/mixed
├── multipart/alternative  (text/plain, text/html)
└── image/png              (inline, cid)
```

**The picture is a SIBLING of the alternative.** A `cid:` reference resolves
inside a `multipart/related` (RFC 2387), and in that shape it does not — so the
recipient gets a broken image with the file listed underneath as an attachment.
Every unit test in the world would have passed: the request matched the spec, the
server accepted it, the message existed. Only reading the MIME back showed it.

The fix is the same spec's other door. Supplying `bodyStructure` explicitly
instead of the convenience properties describes the tree yourself, and the probe
confirmed Stalwart honours it verbatim:

```
multipart/mixed
├── multipart/related
│   ├── multipart/alternative  (text/plain, text/html)
│   └── image/png              (inline, cid)
└── application/pdf            (a real attachment)
```

Boundaries, encodings and charsets stay the server's job — which is the part
worth not hand-rolling — and only the SHAPE becomes ours. The probe also checked
the thing that would have been worse than a broken image: `Email/get` still
reports an `htmlBody` part afterwards, so **our own reading pane still finds the
body it just sent**.

A real attachment stays OUTSIDE the related part. A PDF is not a resource the
body renders, and putting it inside invites clients to treat it as one and hide
it from the attachment list.

**`draftObject` moved out of `client.ts` into a pure `jmap/draft.ts`**, free of
`server-only`, mirroring `parse.ts` — and for the same reason. The probe could
not import `client.ts` at all (`server-only` throws outside a React server
context), so it had been sending a hand-written request. **A probe that verifies
a hand-written request proves the server behaves and proves nothing about the
client.** It calls `draftObject` now, so the tree on the wire is the tree the
composer sends, and the unit tests assert the same function.

**THE `<img>` RULE IS NOT "IMAGES ARE ALLOWED".** An `<img>` survives only if it
names a `data-cid` this message actually minted, and the `src` is then REBUILT
from that cid rather than read. There is no code path in which a caller-supplied
`src` reaches a recipient — so a tracking pixel cannot be smuggled through by
pairing it with a valid cid, which is the obvious attack on a naive version. The
allowlist comes from the send action's own `inlineImages` list, and its default
is an EMPTY set, so a caller who forgets to pass it loses images rather than
admitting unchecked ones.

Two halves are both needed, and the tests caught that: stripping the attributes
is what loses the URL, and an `exclusiveFilter` removing the element is what
stops a refused image shipping as a bare `<img>` that renders in the recipient's
client as a broken-image icon — which reads as "the sender attached something
that did not arrive" rather than as the nothing it actually is.

**The editor shows a signed preview URL, never the `cid:`.** A browser cannot
render `cid:`, so an editor that inserted the final form would show a broken
image for the whole time somebody was writing. The identity travels in
`data-cid` and the two are swapped once, at the boundary. The preview reuses the
existing signed blob route, so the composer's picture and a received message's
inline image travel one path rather than two.

**Only the pictures the SANITIZED body still references are attached.** Somebody
who inserts an image and then deletes it leaves the upload in the composer's
list; attaching it anyway would put a file in the message with nothing pointing
at it, which most clients show as an ordinary attachment. So the body decides,
not the list — and the composer never has to watch a contenteditable for
deletions.

**Documents, through the seam, and the seam is the security.** Mail may not
import the Documents module — `eslint.config.mjs` forbids it and that rule is
why `src/lib/mail-extensions/` exists — so `MailExtension` gained an optional
`images` capability with `search` and `open`. **Both take the CALLER'S `tx`**,
like `search`/`resolve` and unlike `filing`, which opens its own because it
writes blobs. This one only reads, so it inherits the caller's visibility for
free.

`extension.ts` therefore has NO visibility predicate in it — it filters on
tenant, status, type and size and nothing else. What keeps an owners-only
folder's photograph out of a staff user's picker is RLS, reached through that
transaction. **There is an isolation test asserting exactly that**: the same
code, the same call, a different row set for owner and staff, and null across
tenants. It is worth having because a refactor that opened its own `withTenant`
would still pass every unit test in the module.

`open()` returns null for "not yours" and "not there" identically, so it cannot
be used to probe for files in folders somebody cannot open. The permission check
runs inside the transaction; the bytes are fetched by a thunk AFTER it closes,
because network work never happens inside a transaction; and the upload to the
mail server happens last, so nothing is created anywhere until the caller has
been proved entitled to the file.

**SVG is refused**, the only interesting entry in the type list. It is a document
that can carry script and external references rather than a picture — the same
reason it is refused as a mail attachment and left out of the read path's
magic-byte sniff table — and this one leaves under the user's own name where
nothing of ours looks at it again.

**Content-IDs are minted SERVER-SIDE**, at upload. A client-chosen value would be
untrusted input in a MIME header and inside a `cid:` URL, so every later use
would have to treat it as such; minted here, `isValidCid` is an assertion rather
than a guard. The pattern is deliberately far narrower than RFC 2392 allows,
because anything carrying a quote, an angle bracket or whitespace would make it
a header-injection question.

**Gmail's third source — "Web Address (URL)" — is deliberately absent.** A remote
`<img>` in an outbound message is a tracking pixel aimed at the person you are
writing to, it reports whenever they open the mail, and it breaks the day the URL
stops resolving. There is no code path that copies a `src`, so there would be
nothing to hand it.

**An image is not nothing in the text part.** `htmlToPlainText` emits
`[image: alt text]`, because silently dropping it is how "see the photo below"
arrives with nothing below it for anyone reading the plain alternative.

Verified: 21 confirmations from the probe against the live server with no
findings, 22 new unit tests, and one isolation test against the dev branch.

**Not verified in a browser**, the same constraint as every slice since the
composer began. The specific things to try on a preview deployment: inserting a
picture with the caret mid-sentence, deleting an inserted picture and sending
(the attachment should not follow it), and whether the Documents picker's search
feels fast enough to leave debounced at 250 ms.

### 2026-08-02 (later still) — Signature editing, and a blank line between every line

Signatures have been READ since the composer was built — `Identity/get` returns
`textSignature` and `htmlSignature`, which is what prefills a reply. Changing one
still meant opening another mail client. This closes it.

**Probed before designing, and the spec genuinely did not settle it.** RFC 8621
§6 defines `Identity/set`, and it also says a server MAY refuse to create, update
or destroy identities — an identity can be a projection of an account rather than
a record, and `mayDelete` exists precisely because some of them are fixed. So
`mail:probe-compose` grew a fourth scenario before any form was written. Four
answers, all of them load-bearing:

- **`Identity/set` accepts a signature update.** Had it not, the feature would
  have needed its own table and the signature would have stopped applying to mail
  sent from Outlook and a phone — which is most of the value.
- **`textSignature` round-trips byte for byte**, trailing space and all. That
  matters more than it sounds: RFC 3676's separator is `-- ` WITH the space, and
  a server that trimmed it would silently break signature folding everywhere.
- **`htmlSignature` round-trips with its markup intact.**
- **The identity's ADDRESS is refused as immutable.** This is the one worth
  keeping. `Identity/set` can in principle move `email`, and an identity whose
  address could be rewritten would turn a signature form into a **send-as-anyone
  form** — inside a product whose entire hosted-mail design turns on not being
  able to do that. The server refuses it here, but "this server refuses it" is a
  fact about one server, so `setSignature()` constructs its update field by field
  and the caller cannot even ask. There is no object spread anywhere on that
  path, deliberately.

**A refused update is NOT an error response**, and that is the shape most likely
to be got wrong by the next person. `Identity/set` answers 200 with the id under
`notUpdated`, so a client that only checked the method response would report a
save that never happened — and for a signature that means every message
afterwards going out with the old one and nobody knowing why. `setSignature`
reads `notUpdated` explicitly and surfaces the server's own sentence.

**Nothing is stored locally.** The signature lives on the mail server's Identity,
so it applies to every client pointed at the mailbox. That is why this module has
never needed a signatures table, and it is the same reasoning as the auto-reply
and the Sieve rules: the mail server is the thing that is always running.

**The text version is DERIVED, never typed alongside.** Same rule as the message
body and for the same reason — two fields would disagree the moment somebody
edited one, and the recipient whose client prefers text would read a different
signature from everyone else, silently, for months. The action's schema has no
`textSignature` field at all, so there is nothing to disagree with.

**It goes through the same outbound sanitizer a message body does**, not a laxer
one on the grounds that it is "our own" content. It is the user's content and the
user can paste. And a signature is **the most-sent markup in the product**: a
body goes out once, this goes out on every message the person ever writes. A
mistake here is not one bad email, it is every email until somebody notices.

**No inline image in a signature**, and the reason is structural rather than
cautious: a `cid:` is minted per message and lives in that message's MIME, so a
stored signature referencing one would show a broken image on every mail it was
later pasted into. `prepareSignature` passes no cid allowlist, and
`RichTextEditor` grew optional `accountId`/`mailboxId` props so the picture
button is ABSENT rather than disabled — a control that cannot work is better
missing than present and broken.

**The separator is added rather than required.** Nobody types `-- ` on purpose
and a form that refused to save without it would be a puzzle, so it is prepended
when the first line is not already one. Recognition runs on the TEXT rendering
rather than by matching markup, because `<div>-- </div>`, `<p>--&nbsp;</p>` and a
bare `-- ` all mean the same thing depending on which client last edited it.

**THE BUG THIS SLICE FOUND, and it was in the message body all along.**
`htmlToPlainText` treated `</div>` exactly like `</p>` and put a blank line after
both. But a `<div>` carries **no default margin** — `<div>a</div><div>b</div>`
renders as two ADJACENT lines in every browser and mail client, while `<p>` has
one and renders with a gap.

That is not a corner case. **A contenteditable emits a `<div>` for every press of
Enter**, so it was the normal shape of anything typed in the composer: every
multi-line message has been going out with a blank line between every line in its
plain-text alternative since rich text shipped. It surfaced here only because a
three-line signature makes it obvious where a paragraph of prose does not.
Fixed, and pinned with a regression test asserting the div/p distinction in both
directions — plus one asserting a deliberate blank line still survives, since it
arrives as a `<br>` on an empty line rather than as a block boundary.

Also worth recording: `prepareSignature` is asserted **idempotent**. The form
loads what was saved and saves it again on every edit, so a transform that grew a
separator or a wrapper on each pass would compound quietly.

The editor is the composer's own, not a second one — a signature written in a
different control from the one it appears in is how a signature ends up looking
wrong only in real messages. There is no separate preview pane for the same
reason: everything the editor can produce is a declaration the sanitizer keeps,
so what is on screen is what gets saved, and a second rendering underneath would
only be somewhere for the two to disagree.

Reached from the mail header beside Rules, and it takes the reading pane like the
composer, the auto-reply form and the rules editor. Loaded only when opened,
unlike the auto-reply setting: a signature is not a state that can be wrong in
the background, so it needs no badge and no round trip on every inbox render.

Verified: 25 probe confirmations against the live server with no findings, and 15
new unit tests. **Not verified in a browser**, same constraint as every slice
since the composer began — the specific thing to try is the Clear button, which
remounts the editor by changing its React key, because `initialHtml` is applied
once on mount by design.

### 2026-08-02 (later still) — Contact autocomplete, from three places at once

The server has advertised `urn:ietf:params:jmap:contacts` since the very first
probe and nothing has ever used it. Recipient fields now suggest people while you
type — and the founder's instruction shaped the architecture more than the
feature: **a future CRM has to contribute its people too.**

**THE PROBE MATTERED MORE HERE THAN ANYWHERE SO FAR, because contacts is not a
published RFC.** It is a draft, and it changed object models mid-flight:

- the OLD draft has `Contact`, with `firstName`/`lastName` and
  `emails: [{ type, value }]` — an ARRAY
- the CURRENT one has `ContactCard`, following JSContact (RFC 9553), with
  `name: { components }` and `emails: { key: { address } }` — a keyed OBJECT

Those are not variations on a theme; they are different objects with different
method names. A parser written from the wrong one finds **no addresses at all**
and reports an empty address book — which looks exactly like a tenant who has not
added any contacts yet. `npm run mail:probe-contacts` asked instead:
`ContactCard/get` works and `Contact/get` answers `unknownMethod`.

**And the address book was empty, which the probe refused to treat as an
answer.** Slice 0 made precisely that mistake — an empty mailbox reading as a
clean bill of health — so this probe CREATES one card against a loopback server,
reads it back, and destroys it. Same guard as `mail:fixture`. Three things only a
real card could establish:

- `emails` is keyed by context and each value carries `address`.
- **the server COMPUTES `name.full`** ("Aoife Ó Braonáin") from the components.
  That matters because component order is locale-dependent, and assembling a
  display name by hand renames people. `full` is optional in the spec, so the
  parser prefers it and falls back — but the fallback is the worse answer and it
  is good to know it is rarely needed.
- a `text` filter matches on the address AND the name, **including a non-ASCII
  surname**. Without that, anybody with an accented name would be unfindable by
  typing their own name, and autocomplete would have had to download the whole
  address book and filter locally.

The live card is now a golden fixture in `tests/mail-contacts.test.ts`, verbatim,
including a test asserting the OLD draft's shape yields nothing — so a future
server speaking the other model fails loudly rather than silently.

**THREE SOURCES, AND THE RANKING IS THE FEATURE.** `contacts/rank.ts` is pure and
carries the one rule that decides whether a recipient box feels clever or stupid:
**somebody you have actually written to beats a directory entry.** Type three
letters and be offered a supplier from 2019 ahead of the person you emailed this
morning, and people stop reading the list. Everything else is tie-breaking — an
exact address beats everything, a match at the start of a local part or on any
word of a name beats one in the middle.

- **Recent correspondents** read `mail_thread_index`, which sync already
  maintains, so the best source costs no protocol call at all. The participants
  column was put there for display; this is a second use for data on hand.
- **The extension registry** — Accounting's customers and vendors today.
- **The mail server's address book** — one round trip, `ContactCard/query` with
  `#ids` back-referenced into `ContactCard/get`.

Deduplication is by lowercased address, and the merge rule is worth keeping:
**the better origin wins the slot, but the NAME comes from whichever entry has
one.** A recent correspondent is often a bare address while the customer record
for the same address carries the business's real name, so showing
`acme@example.com` when we know it is Acme Ltd would be a worse answer than
either source alone. The sublabel follows the name, so a row cannot read
"Acme Ltd · emailed today" with the name taken from somewhere else.

**The contact source is a capability on `MailExtension`, and it ships with a real
implementation rather than a placeholder.** The founder asked for a CRM to plug
in later; Accounting implements the same hook now, over customers and vendors.
That is deliberate: this dossier already records that **"a seam with one user is
a seam that has never been tested"**, learned the day three Migadu assumptions
turned out to be baked into supposedly shared code. A CRM is now a registry entry
and nothing else — Mail will never learn it exists.

Like `search`, `resolve` and the image source, it takes the CALLER'S `tx`, so
which people an extension can offer is exactly which rows the person composing
may read.

**THE PRIVACY PROPERTY, and it has its own isolation test.** Recent
correspondents come from a per-user table (migration 0043), so the suggestions
are who YOU have written to. An autocomplete that offered a colleague's
correspondents would leak **who somebody else writes to** — from a feature nobody
thinks of as sensitive, which is exactly how that kind of leak ships. The test
asserts all three directions: the owner sees their own, the colleague sees
nothing, and a caller who forgets `userId` sees nothing rather than everything.

Writing that test also demonstrated the other half: seeding participants needed
`withSystem`, because `mail_thread_index` is member-READ only. A member cannot
forge a correspondent into somebody's suggestions.

**The field stays a text field**, which is the load-bearing UI decision. Every
other composer turns recipients into chips, which moves the value into component
state and makes pasting six addresses out of a spreadsheet a fight. Suggestions
only ever replace the LAST FRAGMENT — everything after the final comma — so
what is already typed is untouched, `parseRecipients` still decides what an
address is, and somebody who ignores the dropdown gets exactly the behaviour they
had before. A suggestion is a shortcut, never a commitment.

Two client-side details that are bugs if missed. **A stale answer is dropped
rather than rendered**: server actions do not cancel, so a slow request for "da"
can resolve after a fast one for "dank" and repopulate the list backwards. And
**the list closes on an outside click rather than on blur**, because blur fires
before the click that picked a row — closing on blur means the list vanishes
before it can be used.

The results are stored WITH the query that produced them, so "are these still
about what is being typed?" is a comparison rather than a cleanup. That removed a
`setState` inside an effect, which React 19's lint rule correctly refuses, and it
also closes the window where a list from a previous fragment renders against a
new one.

`Promise.allSettled` across the sources: a directory that is slow or down costs
its own rows and never the suggestions from the other two.

Verified: the probe's four confirmations plus the golden fixture, 21 unit tests,
and two isolation tests against the dev branch. **Not verified in a browser** —
the things to try are arrow-key navigation, Tab to commit, and pasting a list of
addresses to confirm the dropdown stays out of the way.

### 2026-08-02 (later still) — Undo send and schedule send, and the answer that changed both

**THE PROBE DID NOT CONFIRM A DESIGN THIS TIME. IT DEMOLISHED ONE.**

Undo and schedule look like two features and are really one question: will the
mail server hold a message back? RFC 8621 §7 says a submission may carry
`sendAt`, and the capability advertises `maxDelayedSend` in seconds. The plan was
one line of JMAP. `npm run mail:probe-send` asked first, and Stalwart 0.16.15
answered:

```
"notCreated": { "s": {
  "type": "invalidProperties",
  "description": "Field could not be set.",
  "properties": ["sendAt"] } }
```

**Refused outright**, and the submission capability object is `{}` — no
`maxDelayedSend` at all. Neither feature could be built the obvious way, and the
failure mode of not asking is the worst one available: a server that ACCEPTED
`sendAt` and ignored it would have sent everything immediately while the UI
showed a countdown, and nobody would have found out until a customer received a
message hours early. The probe checks for exactly that third case too.

**SO BOTH FEATURES BECAME ONE SHAPE: create the draft now, decide later.** The
composer no longer sends — `holdComposedMessage` creates the message on the mail
server as a draft, and `schedule/actions.ts` decides what happens to it: release
after an undo window, queue for a time, or destroy.

That indirection buys the thing that makes a client-side delay acceptable at all.
**If the tab closes mid-countdown the message is not lost.** It is a finished
draft in Drafts, which is where anyone would look. A composer that held the text
in browser memory would lose it silently, having already said "Sending…" — the
one outcome worse than not offering undo.

**`mail_scheduled_sends` (`0053`/`0054`) is a REMINDER, not custody**, and the
comparison to `mail_snoozes` is exact. The message is a draft on the mail server;
these rows hold ids, an envelope and a time. **No body, no attachment, no
recipient name ever enters this database**, which keeps the invariant the whole
module rests on — bodies live on the mail server, reachable only with the token
that person authorized. Losing every row loses no writing: it leaves finished
messages in Drafts.

`envelope_rcpt_to` is the one column that looks like content and is not. It is
there because the release runs from a cron with no memory of the composer, and
`EMAIL_DEV_REDIRECT` refusing to mail a real customer from a preview has to hold
**at the moment the message actually leaves**, not when somebody pressed a
button. The guard therefore runs twice: at hold, so a blocked send fails fast
with the text still on screen, and at release, over the stored envelope.

**THE SWEEP'S ORDERING IS THE OPPOSITE OF THE SNOOZE SWEEP'S, deliberately.**
`wakeDueSnoozes` deletes its row only after the mail server confirms the move,
because waking twice is a no-op and stranding a message is not. `sendDueMessages`
deletes the row FIRST, in its own transaction, before submitting:

| | |
| --- | --- |
| row deleted, send fails | a finished message sits in Drafts, unsent — the person finds it and sends it by hand |
| send succeeds, row survives | **the next sweep sends it again**, to a customer, with no undoing it |

One is an inconvenience; the other is an apology. So the claim is taken before
the irreversible act rather than after it — the same reasoning the outbound
spine's idempotency key encodes, applied where no natural key exists.

It rides the mail-sync cron rather than getting its own, like snooze and for the
same Hobby-plan reason, and runs LAST of the three steps: it is the only one that
does something irreversible on somebody's behalf, so it takes what budget is left
rather than risking starving the sync. Its batch is smaller than the snooze cap
(50 against 200) because releasing a message is a full submission with an SMTP
handoff behind it, not a folder move.

**The fifth per-user table, and its `WITH CHECK` carries more weight than any
before it.** A forged row would make the sweep submit a draft **on somebody
else's behalf, from their address** — and the sweep runs under `withSystem`, so
RLS is not standing behind it. The policy refusing the insert is the only thing
between a member and queueing mail as a colleague. There is an isolation test for
exactly that, alongside the usual invisible-to-a-colleague and
fail-closed-without-`userId` assertions.

**Times are computed in the BROWSER**, the same call `triage/snooze-times.ts`
made and for the same reason: "tomorrow morning" is a statement about the user's
calendar and the server's clock is UTC. Resolving it server-side would schedule
mail for 08:00 UTC — the middle of the night for a good share of the people being
written to. The server BOUNDS the instant it receives; it cannot recompute it,
because the timezone is not in the request. It **rejects rather than clamps** in
both directions: clamping a past time to "now" would send immediately, which is
the one thing somebody choosing a schedule did not ask for.

Two smaller calls worth recording. **Undo destroys the draft** rather than
leaving it — somebody who pressed Undo has decided not to send this, and the text
is still in the composer they were looking at; a draft left after an explicit
cancel is litter, where one left after a FAILURE is a rescue. And the undo window
is asserted shorter than the minimum schedule, so the two features cannot claim
the same delay and leave neither obviously right.

Also: **`sendMessageAction` no longer audits `mail.sent`.** It logs `mail.held`,
because nothing has left. The send is audited by whichever action releases it, so
the log never claims a message went out because somebody pressed a button.

Verified: the probe's refusal (which is the finding), 12 unit tests over the time
boundaries, and 2 isolation tests against the dev branch. **Not verified in a
browser** — the things to try are pressing Undo at the very end of the window,
and closing the tab mid-window to confirm the draft is really there.

**Not applied to production**: `0053` and `0054` are on the dev branch only.
`docs/security.md` §8 requires both.

### 2026-08-02 (later still) — Labels, and the table that was not needed

Labels were the most architectural thing left on the Gmail list — the one that
was going to change how `organise/filters.ts` models where a message lives.

**It changed nothing, and that is the finding.** `npm run mail:probe-labels`
asked the live server which of two mechanisms it supports, and **both work**:

- **Multi-mailbox membership.** `Email.mailboxIds` is a MAP, not a value, so a
  message being in several places at once is native to JMAP rather than
  something to build. The probe confirmed it end to end: a message added to a
  second mailbox **stayed in the inbox**, `Email/query` found it from both
  sides, and removing the second left the first alone.
- **Custom keywords.** They round-trip and `Email/query` filters on them with
  `hasKeyword`.

Multi-mailbox membership won, and the reason is the module's founding property
rather than anything technical: **a keyword is invisible to every other mail
client.** Everything else this module does — rules, snooze, the auto-reply,
signatures — applies on a phone and in Outlook because the mail server owns it.
A label that existed only inside our UI would be the single piece of organising
that did not travel, and the first time somebody sorted their mail on a phone
they would find it gone.

**So a label IS a mailbox, and the difference from a folder is the VERB:**

- *move* — replace the membership; the message leaves where it was
- *label* — add a membership; the message stays

No table, no migration, no second model of where a message lives, and every
existing query works unchanged: the folder rail lists them, `inMailbox` finds
them, the Sieve compiler's `fileinto` already targets them, and search spans
them. The chips on a row are DERIVED from `mailboxIds`, which the list view was
already fetching — so showing a label costs nothing and can never drift from the
truth, because it *is* the truth.

**What "labelable" means, since JMAP offers no flag.** Structural roles are
excluded — inbox, sent, drafts, trash, junk, archive and the rest — because a
message being in the inbox is not a tag somebody applied, it is where the server
put it. Showing "Inbox" as a chip on every row in the inbox is noise, and
offering "apply Drafts" is a mistake somebody could actually make. `mayAddItems`
does the rest: a read-only shared folder never reaches the menu, since offering a
label that fails on apply is worse than not offering it.

Each row's chips are its memberships **minus the folder being viewed**. That
subtraction is the whole of the presentation logic — inside a folder, saying
every row is in that folder tells nobody anything, while the other places it
lives are exactly what a chip is for. In a SEARCH there is no current folder and
every membership shows, because "where is this?" is the question a search result
raises.

**THREE STATES IN THE BULK MENU, not two.** Every selected message has a label,
some do, or none do. Collapsing "some" into either of the others is how a bulk
action quietly strips a label from the messages that already had it — so a
partial label draws a dash, and clicking it ADDS to everything rather than
toggling. Adding is the reading people expect and the one that never destroys
information.

**The patch syntax is a safety property, not a micro-optimisation.**
`mailboxIds/<id>` touches only the ids named; sending a whole `mailboxIds`
object would overwrite memberships this client never knew about — a folder
another client filed it into, or the inbox itself.

**And the orphan guard, which is the one genuinely new failure this feature
creates.** A message whose `mailboxIds` becomes empty is not deleted, it is
ORPHANED: visible in no folder, reachable only by search. It is reachable in
practice rather than theoretically — a rule that files into a label and removes
the inbox leaves a message whose only home is that label, and taking the label
off is an ordinary click. So a removal that would empty a message is skipped,
the messages are RE-READ from the server rather than trusting the browser's idea
of where they live, and the toast says how many were left alone. A bulk action
that silently does less than it claims is the kind of lie that costs somebody an
afternoon.

**One structural note.** `applyLabels` on the JMAP client builds its own patch
rather than importing `labelPatch` from the module: `src/lib` is the platform and
`src/modules` sits above it, so a dependency in that direction would invert the
graph the whole extension seam is built on. There is a golden test asserting the
two copies agree — the same role the header-block test plays for
`file-headers.ts`.

Verified: six probe confirmations with no findings, and 18 unit tests. No new
tables, so no migration and no isolation changes. **Not verified in a browser** —
the things to try are the partial-label dash across a mixed selection, and
whether the chips crowd a narrow thread list.

### 2026-08-02 (later still) — The search builder, and the probe that had to be debugged first

From, To, Subject, Body, a date range and a folder, on top of the quick search
box and the three filter chips. A saved search picks them all up for free,
because a saved search was already "these parameters, written down".

**THE PROBE IS THE INTERESTING PART, TWICE OVER.**

RFC 8621 §4.4.1 defines about fifteen filter conditions and a server need not
implement them all. There are three outcomes per field and **only the third is
dangerous**: supported, honestly rejected (fine — hide the field), or **accepted
and silently ignored**. A `from` condition that is dropped turns "find mail from
Dan" into "here is everything", which reads as a *bad search* rather than a bug.
Nobody reports that; they stop using the search.

So `npm run mail:probe-search` checks every condition **twice**: it must match a
message built to match, AND exclude a decoy built not to. A condition that
returns both is being ignored, whatever the response said.

**Then the probe itself turned out to be wrong, three times, and that is the
lesson worth keeping.** Its first run reported `from`, `header` and `minSize` as
broken. Two of those were my bugs:

- `minSize: 1` matches every message, so it looked "accepted but ignored" — a
  probe bug that presents exactly as the server bug the script exists to catch.
  It now sizes the two messages and picks a value between them.
- The target was dated 2020 so `before` could be tested, and an old message
  falls outside a small result page. "Not in the first 100 results" reads
  identically to "condition not supported".

**And the third was real, but not what it said.** `from` failed; then on the next
run `to` failed too, and `from` passed. Whichever condition ran FIRST failed.
**The server's full-text index is asynchronous** — a message just created is not
findable by text for a moment. Bisecting it took four hand-written checks against
the live server, and it is worth knowing well beyond this feature: anything that
files a message and immediately searches for it will intermittently find nothing.
The probe now settles for three seconds before asserting.

With that fixed, thirteen conditions are confirmed working against a decoy:
`from`, `to`, `subject`, `body`, `text`, `hasKeyword`, `notKeyword`, `before`,
`after`, `minSize`, and the `AND` / `OR` / `NOT` operators. **`header` is the one
that never behaved**, so it is not offered — an unreliable field is worse than an
absent one.

**AND THE OPERATORS TURNED OUT NOT TO BE NEEDED, which is the better outcome.**
The first implementation built `{operator: "AND", conditions: [...]}` and broke
three existing tests. The tests were right: RFC 8621 already ANDs the properties
*within a single* `FilterCondition`, so every field the builder offers composes
in one flat object. The operator plumbing was removed from `JmapEmailFilter` and
`serializeFilter` rather than left in unused — this file's own rule is that
typing unused fields invites drift nobody notices. OR and NOT are verified and
available the day the builder grows an "any of these" mode.

**The folder rule changed in exactly one direction.** A quick search still spans
the account: being told "no results" because you were standing in the wrong
folder is the worst failure a mail search has, and that reasoning has been in
`toJmapFilter` since Slice 7. But somebody who opens the BUILDER and picks a
folder has said where to look, and ignoring that would be its own kind of wrong.
So an explicit folder from the builder is honoured; the *fallback* folder is
still dropped the moment any search term exists. "Anywhere" is the default in the
select, for the same reason.

**Dates include both ends.** A date input gives a calendar day; JMAP wants an
instant. `before` becomes the start of the NEXT day, so "before 3 August"
includes everything sent on the 3rd — which is what the words mean to a person
and not what a naive conversion produces. The panel says "Both dates are
included" rather than leaving it to be discovered.

**It writes to the URL**, like every other piece of state in this module, so an
advanced search is linkable, reloadable, works with the back button, and is
saveable with no second model. `describeView` names each field, so saving one
still does not require inventing a name. And `parseMailView` already re-parses
stored blobs with `.catch()` on every field and Zod's default strip — so a
hand-edited saved search cannot smuggle `header`, or anything else, into a
filter. There is a test asserting exactly that.

Verified: thirteen conditions confirmed against a decoy on the live server, 18
new unit tests, and the 20 existing organise tests still passing unchanged.
**Not verified in a browser** — worth checking that the panel does not overflow
on a phone, and that the date inputs render sensibly outside Chrome.

### 2026-08-02 (later still) — Delegation, and the property that survived it

A shared mailbox — `info@`, `accounts@` — reached through somebody's OWN
credentials instead of a password three people know. `sessionMatchesAddress`
refused it: it compared only against the session's primary account, so a person
granted access to `info@` was turned away at the OAuth callback.

**THE PROBE ANSWERED SIX QUESTIONS AND FOUND THE SEVENTH.**
`npm run mail:probe-delegation` creates a Group principal, a delegate, and the
grant between them, then signs in AS THE DELEGATE. Eleven confirmations:

| | |
| --- | --- |
| a shared mailbox | a first-class `@type: Group` principal with its own address |
| the delegate's session | **two** entries in `accounts`, one token |
| the management id vs the session id | the same string |
| `accounts[id].name` | the ADDRESS, not a display name |
| `isPersonal` | false on the shared box, true on their own |
| read, file, flag on the shared account | all work |
| an Identity for the shared address | present — so a reply comes FROM `info@` |

**THE NEGATIVE IS THE ONE WORTH HAVING.** Every read in this app passes an
`accountId` to the server. If naming somebody else's id were enough, the column
this slice relies on would be the only thing between one person and another's
mail — and a column is not a permission. Naming a non-granted account returns
`forbidden`, and the session lists only what the token may use. **The account
list is itself the entitlement**, which is what makes matching across it safe.

**NO MIGRATION, AND NO NEW COLUMN.** `mail_accounts.jmap_account_id` has existed
since the first slice, storing `primaryAccountId` — and *nothing read it*, because
`createJmapClient` re-derived the primary from the session on every call. So the
fix is not a schema change, it is making the stored value load-bearing: the
callback stores the id that MATCHED, and the client takes an explicit account.
The same shape as the labels slice's "table that was not needed", arrived at from
the other direction — this one was already there.

**WHAT A SHARED MAILBOX DOES TO THE PER-USER RLS: nothing, and that is the
finding.** Five tables are scoped to one person and "your mail is yours" was the
founding property. Delegation does not weaken it because **it was never one row
per mailbox** — the unique index is `(tenant, mailbox, clerk_user_id)` and its
comment has said "a shared box legitimately has several rows" since Slice 1. Each
person granted `info@` gets their own row, their own token, their own account id,
and everything hanging off `mail_account_id` stays theirs. **The property becomes
"your ACCESS is yours"**, and the mail — which lives on the mail server — is
genuinely shared. Three isolation tests name it, because a later migration
"tidying" that index to one row per mailbox would pass every other test in the
file and make a shared mailbox impossible to connect twice.

**THE SEVENTH QUESTION, WHICH THE PROBE WAS EXTENDED TO ASK AND WHICH CHANGED THE
SLICE.** Three features store nothing of ours: rules are a Sieve script,
auto-reply is a VacationResponse, signature is on an Identity. All three are
**singletons PER ACCOUNT**, and the probe confirmed a delegate can write all
three on the shared account. So one person's change applies to everybody.

The line that decides what to do about it is not "does it touch shared state" —
snooze moves a message and scheduled send leaves a draft, and both are fine. It
is:

> **A feature may act on a shared mailbox when its effect is VISIBLE to everyone
> using it. Not when the effect is invisible AND the record of it is private.**

- *snooze* — the message is in a Snoozed folder everyone can see. Allowed.
- *scheduled send* — the draft is in the shared Drafts. Allowed.
- *auto-reply, signature* — shared, and **no per-user table of ours to
  contradict them**. Allowed, with a notice naming the mailbox. A shared box is
  the case an auto-reply most exists for; refusing would be safe and useless.
- **rules — REFUSED.** `mail_rules` IS per-user. A rule would be recorded
  privately and act publicly, the only person able to see it existed would be
  its author, and the next colleague to open the editor would see an empty list
  and publish over the script silently, because publishing writes the whole
  script from that person's rows. Fixing it means moving `mail_rules` to
  per-mailbox RLS — a policy change with its own certification, so a slice
  rather than a line. Refused in the action AND at `?rules=1`, since that URL is
  typed and bookmarked; the link is absent rather than disabled.

**A REVOKED GRANT MUST FAIL CLOSED, and the tempting fallback is the worst
available behaviour.** The session is re-discovered on every call, so the stored
id is re-checked every time. If it is gone, falling back to the primary would
show the person their OWN mail under the shared box's name, silently — the exact
bug the identity check exists to prevent, arriving later and by another route.
It marks the connection `revoked`, which is deliberately NOT `needs_reauth`:
that one means "click Connect", which here would take somebody round the OAuth
loop successfully and leave them where they started. The fix is somebody else's.

**Two bugs that were already there and only delegation makes visible.**
`selfAddress` came from the session's `username` — the token holder — so a
reply-all from `info@` would have kept `info@` in the recipients (the mailbox
mailing itself) while dropping the reader's own address. And `selfAddresses()`
in sync had the same fault, which would have listed `info@` as a participant on
every thread in its own inbox. Both now read the address of the account being
ACTED ON, which is identical to the old value for a personal mailbox.

**`isDelegated` is `accountId !== primaryAccountId`, NOT `isPersonal`.** The
flag is optional and this parser defaults it closed, so keying off it would mark
every mailbox on a server that omits it as delegated — refusing rules for
everybody to guard a case that server does not have. "The primary account" is
RFC 8620's own term for the account the credentials belong to; it cannot be
absent. The probe confirmed the two agree here.

**Ambiguity is refused rather than resolved.** Two accounts claiming one address
returns null instead of the first match, on this file's standing rule that a
false refusal costs a retry and a false accept files one person's correspondence
under another's name.

**A correction to the undo/schedule entry above.** It records the submission
capability as `{}` with "no `maxDelayedSend` at all". That is true of the
SESSION-level capabilities object and not of the per-account one, which
advertises `maxDelayedSend: 2592000`. The conclusion is unchanged and is now
better evidenced: the server advertises delayed send at the account level **and
still refuses `sendAt` with `invalidProperties`**, which is a sharper instance
of the same lesson rather than a different one.

Also fixed in the probe itself: destroying a group while somebody is still a
member is refused with `objectIsLinked`, and a destroy list is processed in
order — so the member has to go first, or cleanup silently leaves the shared box
behind while reporting success. It now sweeps `probe-*` leftovers on startup too,
because a probe that creates principals will be killed halfway at least once.

Verified: 11 probe confirmations plus the shared-settings finding against a live
Stalwart 0.16.15 (the same version production runs), 16 new unit tests including
a golden fixture of a real delegated session, and 3 new isolation tests — 114
passing against the dev branch. **Not verified in a browser**, the same
constraint as every slice since the composer: the things to try are the Shared
badge on a delegated box, the notice on the auto-reply and signature forms, and
`?rules=1` typed by hand on a shared mailbox.

### 2026-08-03 — Templates, and the first thing that does not travel

Canned responses: save the reply you keep writing, insert it while composing.
The last item from the Gmail compose review, and the only one that needed
storage rather than markup.

**THE PROBE WAS RUN TO TALK ME OUT OF THE TABLE, and it failed — which is the
useful outcome.** Every organising feature in this module lives on the mail
server on purpose: rules are a Sieve script, the auto-reply is a
VacationResponse, the signature is on an Identity, a label IS a mailbox. That is
why they all work on a phone. A table is the one shape that does not travel, so
`npm run mail:probe-templates` asked the server first, and the answer was yes on
every mechanical question:

| | |
| --- | --- |
| a `$draft` message in a mailbox of its own | accepted — literally Gmail's original canned responses |
| does it pollute the Drafts folder? | **no** — the mailbox decides where it shows, not the keyword |
| does the markup round-trip? | intact |
| `FileNode/set` (the advertised, never-used file store) | also works |

**And it is still the wrong home, for a reason no amount of protocol support
fixes: every one of those locations is scoped to ONE ACCOUNT.** The delegation
slice established that naming an account you were not granted returns
`forbidden`. So sharing the company's payment-terms wording with a colleague
would mean granting them the mailbox holding it — and every message in it.
**There is no way to share the wording without sharing the correspondence**, and
a template that dies when its author leaves is not a business asset.

**So `mail_templates` (`0055`/`0056`) is the first mail table scoped to the
BUSINESS rather than to one person.** Five tables before it are per-user, and
every one of those migrations gives the same two reasons — the rows hold
correspondence, or they hold ids the mail server issued inside one account. A
template holds neither. It is boilerplate somebody wrote *so that* it would be
reused, and a copy per employee is the problem it exists to solve. There is no
`clerk_user_id` and no `mail_account_id` either: the same wording is available
from a personal box and from a shared `info@` without being stored twice.

**The accepted cost, stated plainly: a template does NOT appear on a phone or in
Outlook**, and it is the first mail feature since Slice 0 of which that is true.
Usable by the whole company beat usable in another client — the opposite of how
every previous call in this module went, which is why it is worth writing down.

The dossier's own open item predicted "a per-user table". It was wrong on the
scope, and `document_templates` (`0033`/`0034`) had already settled the same
question the same way for the other module that has templates — tenant-scoped,
`member_all`, author recorded rather than enforced. A colleague correcting the
payment terms is somebody doing their job.

**INSERT, NEVER REPLACE**, and it is the one decision a user would notice.
Replacing the body is the obvious reading of "apply a template" and is wrong the
first time somebody uses one in a REPLY: the quoted message and the signature
are already in that editor, and both would vanish. `RichTextEditorHandle` grew
`insertHtml`, which puts the markup at the caret. In plain-text mode the text
rendering goes in instead — via the same `htmlToPlainText` the send path already
derives its text alternative with, rather than a second converter.

**The subject is filled only when empty**, so applying a template to a reply
cannot rewrite "Re: …", and a template with no subject of its own never touches
it either way. The form says so rather than leaving it to be discovered, because
the other reading — "this template sets the subject" — is the one that would
quietly damage a thread.

**Sanitized on WRITE as well as at send.** The send path sanitizes every body
regardless, so this is not the guarantee; it is what stops the editor showing
one thing and the recipient receiving another, which for a template repeats on
every use. Same reasoning the signature slice recorded, and a template is in the
same class — markup written once and sent many times.

**No inline images, and it is the signature's rule rather than a new one.** A
`cid:` is minted per message and lives in that message's MIME, so a stored
template referencing one would show a broken image on every mail it was later
inserted into. No cid allowlist is passed, so the sanitizer's default empty set
drops them, and the editor has no picture button because `accountId`/`mailboxId`
are not passed to it.

**A BUG THE TESTS FOUND, and the fix was to correct the claim rather than the
code.** `prepareTemplateBody` slices its input to the cap and then sanitizes —
and 20,000 characters in came back as 20,004 out, because the slice cut through
a tag and the sanitizer closed it. Truncating the sanitized result instead would
reintroduce exactly the unbalanced markup it had just fixed. So the cap is on the
INPUT, the doc comment says so, and the test asserts the property that actually
matters: a paste twice the size and one ten times the size store the *same*
bounded amount.

**Two isolation tests assert the OPPOSITE of every other mail test**, and that is
deliberate. The rest of the file proves a colleague sees nothing; these prove a
colleague DOES see the business's templates, and that omitting `{ userId }`
still returns them. A suite that only ever asserts "the colleague sees nothing"
would pass just as well if the policy were broken shut — and a template nobody
else can read is the feature not working. A third still asserts they never cross
a tenant, and a fourth pins the folded-name unique index.

Reached from the mail header beside Signature, and it takes the reading pane
like the composer, the rules editor and the auto-reply form. Templates are
loaded when the manager is open OR a composer is — a local indexed SELECT rather
than a protocol call, which is what being in our own database buys.

Verified: 5 probe confirmations and the finding that decided the design, 14 new
unit tests, and 4 new isolation tests — 118 passing against the dev branch.
**Not verified in a browser** — the things to try are inserting a template
mid-sentence in a reply (the quote must survive), applying one in plain-text
mode, and the name collision message.

**Not applied to production**: `0055` and `0056` are on the dev branch only.
`docs/security.md` §8 requires both.

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
| `mail_links` | Thread ↔ business entity | **MEMBER WRITABLE** — the deliberate exception. `entity_type` carries no whitelist so a future layer needs no migration. `mail_account_id` (`0045`) is what makes an opaque thread id unambiguous inside a tenant; its composite FK is hand-written in `0046` because it needs `ON DELETE SET NULL (mail_account_id)` — the link must SURVIVE a disconnected mailbox, and the column list is what stops the same rule nulling `tenant_id`. Unique on `(tenant_id, mail_account_id, thread_id, entity_type, entity_id)`, NULLS DISTINCT on purpose |
| `mail_saved_searches` | A named mail view, per person | **PER-USER** (`0048`), the second table scoped on `app.clerk_user_id` — and for a data-model reason before a privacy one: a mail search names a JMAP mailbox id, which only exists inside one account, so it *cannot* be shared the way `document_saved_views` can. The privacy consequence follows anyway: the NAME of a search is correspondence. **MEMBER WRITABLE**, unlike the other per-user mail tables; `WITH CHECK` pins `clerk_user_id` as well as `tenant_id`. `query` is re-parsed with Zod on read and becomes a JMAP filter, never SQL |
| `mail_scheduled_sends` | A message written and held, waiting to go out | **PER-USER** (`0053`/`0054`), the fifth. A REMINDER, not custody: the message is a draft on the mail server and these rows hold ids, an envelope and a time — no body, no attachment, no recipient name, so the module's founding invariant survives. Exists because `mail:probe-send` found the server REFUSES `sendAt` (`invalidProperties`), so a delay cannot be a future-dated JMAP submission. Its `WITH CHECK` carries more weight than any other per-user table's: the sweep runs under `withSystem`, so this policy is the only thing stopping a member queueing mail as a colleague, from their address |
| `mail_annotations` | Extension-contributed metadata per thread | **MEMBER WRITABLE**. One row per extension per thread, so a layer can be reprocessed or removed without touching another's work. `version` (`0045`) is the optimistic-concurrency counter — a reprocess and a user edit genuinely race here, and last-write-wins on jsonb loses one silently |

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
The extension seam (`src/lib/mail-extensions/`, neutral ground OUTSIDE
`src/modules/` — everything under `src/modules/<slug>/` is a module and subject
to the isolation rule):

- `types.ts` — the contract, and primitive **P5**. Imports NOTHING from
  `src/modules/**`, and must not. Read the header before adding a hook: it says
  which two rules are security rather than style.
- `registry.ts` — the composition root, and the ONLY file that may import
  modules. Exactly what `src/modules/index.ts` is for module renderers.
- `resolve.ts` — enabled-filter, entity-type index, batch resolve, and the
  `Promise.allSettled` + timeout wrapper that keeps one wedged extension from
  taking the reading pane with it.
- `src/modules/documents/mail/extension.ts` — files and folders, plus the
  **filing** capability: `.eml` snapshot + transcript into the DMS Inbox.
- `src/modules/accounting/mail/extension.ts` — invoices, bills, customers,
  vendors.
- `src/modules/email/links.ts` — `mail_links` reads and writes, including the
  two-hop join behind "emails on this invoice".
- `src/modules/email/filing.ts` — the only place in the linking path that speaks
  JMAP; turns a live message into the neutral payload a filing target takes.
Composing (`src/modules/email/compose/`, all pure and free of `server-only`):

- `html.ts` — **`sanitizeOutboundHtml`, the write path's sanitizer.** Read its
  header before widening anything: it explains why this allowlist is far
  stricter than the reading pane's, which is that the read path has a sandbox
  behind it and this one has nothing. The `<blockquote>` styling is EMITTED by
  `transformTags` rather than allowed through, so no caller-supplied CSS ever
  reaches a recipient.
- `to-text.ts` — `htmlToPlainText`, the alternative a person actually reads. Not
  `render/transcript.ts`'s `htmlToText`, which flattens for a tsvector and drops
  hrefs, list numbering and quote depth. The quote depth is the one that matters:
  it is what makes a plain-text reply chain survive four exchanges.
- `formatting.ts` — **the tables**: fonts, sizes, palette, alignments, indent
  steps, and the `ALLOWED_DECLARATIONS` set generated from them. Read by the
  toolbar to build its menus AND by the sanitizer to build its allowlist, which
  is what makes "the toolbar can only emit what the sanitizer accepts" true by
  construction. Adding a swatch is one edit here; a test walks both directions.
- `emoji.ts` — a hand-written table, not a dependency. Emoji needed no sanitizer
  rule at all because they are characters rather than images.
- `link-url.ts` — `normalizeLinkInput`. Pure and separate from the editor so the
  security-relevant half of a client component is testable without a DOM.
- `organise/filters.ts` — the ONE shape used three ways: the URL, the JMAP
  filter and a saved search. Every field in its vocabulary was verified against
  the live server before being offered; `header` is absent because it never
  behaved. Read the folder rule before changing it.
- `scripts/jmap-search-probe.ts` — `npm run mail:probe-search`. Checks each
  condition against a target AND a decoy, because the dangerous outcome is a
  filter that is accepted and ignored. **It also proved the server's full-text
  index is asynchronous**, which is why it settles before asserting — anything
  that files a message and immediately searches for it will intermittently find
  nothing.
- `organise/labels.ts` — **the whole of labels**, pure and with no table behind
  it. A label IS a mailbox; the difference from a folder is the verb. Read the
  header before adding anything: it records why keywords were rejected, and the
  orphan guard is the one genuinely new failure the feature creates.
- `scripts/jmap-labels-probe.ts` — `npm run mail:probe-labels`. Writes, so
  loopback-only. Run it against any new mail server: whether a message may be in
  two mailboxes at once decides whether labels can exist at all.
- `schedule/times.ts` — pure. The offered times, and the bounds the server
  applies to what the browser computed. Rejects rather than clamps, in both
  directions; the header says why each direction matters.
- `schedule/sweep.ts` — releases due messages on the mail-sync cron. **Read its
  header before changing the ordering**: it deletes the row BEFORE submitting,
  which is the opposite of the snooze sweep, because sending twice is the
  failure that cannot be undone.
- `compose/send.ts` — `holdComposedMessage` / `releaseHeldMessage`. The composer
  no longer sends; it holds, and something else decides. The envelope guard runs
  in both, because a scheduled message is released days later by a cron.
- `scripts/jmap-send-probe.ts` — `npm run mail:probe-send`. **Submits**, so
  loopback-only and self-addressed. Run it against any new mail server: whether
  it honours `sendAt` decides what undo and schedule can even be.
- `contacts/rank.ts` — **the ranking**, pure. One rule decides whether the
  recipient box feels clever or stupid: somebody you have written to beats a
  directory entry. Read it before adding a fourth source.
- `contacts/recent.ts` — correspondents from `mail_thread_index`. Per-user by
  RLS; the caller MUST pass `{ userId }` or it returns nothing, which is the
  fail-closed direction.
- `contacts/actions.ts` — fans out across the three sources with
  `Promise.allSettled`, so a slow directory costs its own rows and nothing else.
- `scripts/jmap-contacts-probe.ts` — `npm run mail:probe-contacts`. Read-only
  except against loopback, where it creates one card to learn the real shape.
  Run it against any new server: contacts is a DRAFT with two incompatible
  object models, and picking the wrong one reports an empty address book rather
  than an error.
- `signature/validate.ts` — `prepareSignature`: sanitize, derive the text half,
  and add the RFC 3676 separator. Pure, and asserted idempotent because the form
  re-saves what it loaded. Read its header before relaxing anything: a signature
  is the most-sent markup in the product.
- `signature/load.ts` — picks the identity by the SAME rule `read.ts` uses, and
  that agreement is the point: editing a signature the composer would not choose
  saves successfully and changes nothing anybody can see.
- `inline.ts` — the inline-image rules: types (no SVG), caps, and the
  server-minted Content-ID. Shared by the upload route, the Documents insert
  action, the send action and the sanitizer's caller, so those four cannot
  disagree about what a picture is.
- `src/lib/email/jmap/draft.ts` — **`draftObject`, the request builder**, moved
  out of `client.ts` and free of `server-only` for the same reason `parse.ts`
  is. It decides whether a message is described with the convenience properties
  or an explicit `bodyStructure`; read its comment before changing either. The
  probe imports it, so what goes on the wire is what ships.
- `bodies.ts` — the sanitize-THEN-derive ordering, in a file of its own so a test
  can assert it. Outside `compose-actions.ts` because a `"use server"` module may
  only export async functions.
- `quote.ts` — attribution, quoting and forwarding in both forms, plus
  `openingBodyHtml`. `quoteText` has no caller in the product any more; it is the
  SPECIFICATION the derived text alternative is asserted against.
- `components/rich-text-editor.tsx` — the only client-side piece. Two rules in it
  are security rather than style (paste-as-plain-text, and never handing
  `createLink` raw input); the header says which and why.
- `scripts/jmap-compose-probe.ts` — `npm run mail:probe-compose`. **Writes**, so
  it is loopback-guarded like `mail:fixture`. Run it whenever the composed
  message shape changes; it is what proves the server builds the
  `multipart/alternative` rather than the spec saying it should.

- `src/modules/email/render/transcript.ts` — pure. HTML → searchable text. The
  header explains why hand-rolling a stripper is fine here when hand-rolling a
  *sanitizer* is not.
- `eslint.config.mjs` — the isolation zones. The only thing actually enforcing
  any of the above.

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

**A mailbox is private to one person; linking a thread is an act of publishing.**
Settled with the founder on 2026-07-27, and it decides what `mail_links` means.

The privacy model has two independent layers. Bodies never enter this database
— they stay on the mail server, reachable only with the token that person
authorized themselves, so a colleague has no credential to leak. `mail_accounts`
is then scoped per user in RLS on top of that. Shared mailboxes (`info@`,
`accounts@` — `mailboxes.clerk_user_id is null`) are the deliberate exception,
and the platform operator holding both the encryption key and the mail server is
the honest caveat that applies to every hosted mail product.

That privacy is what creates the problem linking has to solve.
`mail_thread_index` holds **no bodies** on purpose, so a link on its own would
show a colleague opening an invoice only *"a thread called 'Re: quote revision',
these three people, last Tuesday"* — and not one readable word, because the body
still needs the other person's token. A link that cannot be read is not the
feature.

**So linking COPIES the message into the tenant's space rather than pointing at
the mailbox.** At link time the message and its attachments are filed into
Documents — the same "attachments → Documents" loop this dossier has had open
since the hosted-mailbox build — and the link points at that copy. What this
buys, and what the alternative loses:

- It is an **explicit publish**, not a silent widening of who may read somebody's
  private mail. The person doing it knows they are doing it.
- It **survives** the linking user's token expiring, their disconnecting the
  mailbox, or their leaving the business — which is precisely when the
  correspondence behind an invoice is most wanted.
- It needs **no standing credential**. Serving a linked thread through the
  linker's token would mean the app holding an indefinite loan of one person's
  mailbox, and every such read failing the day they revoke it.
- It inherits Documents' RLS, retention, search and audit instead of inventing a
  second visibility model for mail bodies — which would be a second place to be
  wrong about who may read what.

Consequences to build in when Slice 5 lands: the filed copy is a **point-in-time
snapshot** and the UI must say so (a later reply is a new message, not an edit
of the old one); unlinking should leave the filed copy in place with its own
delete, since removing a link is not the same intent as destroying a record; and
the filing action needs an audit entry naming who published what.

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

**Reading mail inside Yosher works.** On `claude/email-inbox`, verified against a
local Stalwart 0.16.15 end to end: connect a mailbox over OAuth, list folders,
read a message with its body safely rendered, download attachments, and flag or
archive or trash it — with every change landing on the mail server, confirmed by
querying it directly rather than by trusting the UI.

Remote images work too, blocked by default and shown through an SSRF-guarded
proxy so the sender never learns who opened the message.

Sync, the unread badge and background freshness are in as of Slice 4.

**Entity linking is in as of Slice 5**, and it is the reason this module exists
rather than a tab pointed at Gmail: a message can be attached to an invoice, a
bill, a customer, a vendor, a file or a folder; attaching files a readable copy
into Documents; and the invoice's own page shows what was attached. The seam
other modules build on (`src/lib/mail-extensions/`) is live, and module isolation
is enforced by ESLint rather than by discipline.

**Compose, reply, forward and send are in as of Slice 6**, and the token was
proved to carry the submission scope before any of it was designed. Sending is
refused locally until `EMAIL_DEV_REDIRECT` is set — that is the envelope guard,
not a bug.

**Organising is in as of Slice 7**: multi-select with a bulk bar, unread/flagged/
has-files chips, folder creation, and per-user saved views.

**Out-of-office and rules are in**, both executed by the mail server rather than
by us — `vacationresponse` for the first, a compiled Sieve script for the second
— so they fire while nobody is signed in, which is the only time either matters.

**Composing is rich text**, and as of 2026-08-02 the toolbar is complete bar
inline images: bold, italic, underline, strikethrough, text and highlight colour,
font, size, alignment, indent, lists, links, quoting, emoji, undo/redo and a
plain-text mode. Everything goes out as a `multipart/alternative` whose text part
is derived from the HTML rather than typed alongside it, and the MIME the server
assembles has been read back off a live draft (`npm run mail:probe-compose`)
rather than assumed from RFC 8621.

The `style` attribute is open, narrowly: `compose/formatting.ts` enumerates every
declaration the toolbar can produce and the sanitizer accepts nothing else, so
both sides read one file and cannot drift. That is the property to preserve when
adding any further formatting control.

**Inline images are in.** A picture goes in the body from the laptop or from the
tenant's own Documents, through the `src/lib/mail-extensions/` seam. The MIME is
an explicit `multipart/related` because the convenience properties produce
`multipart/mixed`, where a `cid:` reference does not resolve — found by probing
the live server before the feature was designed.

**Signature editing is in.** Written to the mail server's Identity, so it applies
on a phone and in Outlook too; the text half is derived from the HTML; and the
identity's address was proved immutable before the form was built, which is what
stops a signature form becoming a send-as-anyone form.

**Contact autocomplete is in**, from three sources at once: recent
correspondents (per-user, from `mail_thread_index`), the extension registry
(Accounting's customers and vendors today, a CRM later) and the mail server's own
`ContactCard` address book.

**Undo send and schedule send are in**, both as a draft created on the mail
server plus a decision recorded separately — because `mail:probe-send` found this
server refuses `sendAt` outright. An interrupted undo window therefore leaves a
finished message in Drafts rather than losing it.

**Labels are in**, and they needed no table: JMAP's `mailboxIds` is a map, so a
label is a mailbox and the difference from a folder is whether the old
membership is removed. Chips derive from data the list view already had.

**The advanced search builder is in**: from, to, subject, body, a date range and
a folder, on top of the quick search and the chips. Saved searches picked it up
for free, since a saved search was already these parameters written down.

**Real-time push is closed rather than pending** — see
[ADR 0005](../decisions/0005-polling-over-push-for-mail-freshness.md). A socket
needs a process that outlives a request and serverless has none; the staleness
people would actually feel is the cron cadence, which is a plan question.

Delegation (a shared `info@` through somebody's own credentials) and templates
were both built on 2026-08-02/03 — see the build log. What is NOT built yet:
placeholders in templates, and granting delegation from inside Yosher rather
than in the mail server's admin.

Everything so far has been proven against ONE server, ONE account and ONE
message. That is a real limit: no multi-account switching, no thread expansion
(a conversation shows its most recent message), no bulk selection, and token
refresh has never been exercised because the first token has not expired.

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
  next to the job, the customer and the invoice is.
- **Migadu keys are not configured**, so nothing provisions yet.
- **No aliases or identities.** `info@` forwarding to three people, and
  send-as for a shared address, both need the alias and identity endpoints —
  wired in the API docs, not in the adapter.
- **`reconcileMailboxes()` reports drift but never repairs it.** Deliberate:
  auto-deleting local rows hides real mailboxes, and auto-creating remote ones
  resurrects addresses somebody removed on purpose. Nothing surfaces it in the
  UI yet, though — it is callable and unreachable.
- **No password-set flow for a Stalwart mailbox, and it blocks the SQL
  directory.** `stalwartHost.afterMailboxCreated` always writes
  `passwordHash: null`, there is no hashing dependency, and no invitation flow
  was ever built — Migadu's host sent those setup links itself and Stalwart has
  no equivalent. So pointing Stalwart's SQL directory at Neon today would
  authenticate against a table where every `password_hash` is null: an account
  nobody can log into. Needs a token/email/form flow plus a hashing choice
  verified against Stalwart's supported list. Until then use Stalwart's internal
  directory (see `docs/runbooks/mail-server.md`).
- **Password hash format is unconfirmed.** `mail_directory_accounts.password_hash`
  holds a PHC string, but the algorithms Stalwart will actually verify have not
  been checked against a running server. Guessing produces an account nobody
  can log into. Confirm before wiring the invitation flow.
- **`npm run db:create-mail-role` has never been run.** It prints a live
  connection string, so it belongs in the operator's terminal, not a transcript.
  Run it when the server exists; it self-verifies the role cannot read tenant
  tables and aborts if it can.
- **Annotations and reading-pane panels are declared but unused.** The registry
  contributes linkable entity types and filing; `mail_annotations` still has no
  writer, and no extension contributes a panel or an action to the reading pane.
  Both are hooks waiting for a first caller — an industry pack extracting drawing
  numbers is the obvious one — and adding them is a change to `types.ts` plus a
  render site, not a change to the model.
- **The picker searches; it does not browse.** Typing finds a record by number or
  name. There is no "recent invoices" list for somebody who cannot remember what
  the thing is called, and no way to create the record you meant to attach to
  from inside the dialog.
- **Filing lands everything in the DMS Inbox.** Deliberate — choosing a folder
  would be guessing at a visibility decision, since folders carry
  `effective_visibility` and the wrong guess either hides the correspondence or
  publishes it wider than intended. But it does mean somebody has to file it
  afterwards, and a busy inbox is where filed emails will pile up.
- **A filed copy has no deep link.** The DMS has no per-document page, so a chip
  points at the folder (or the Inbox) the file lives in rather than at the file.
  Fine today; worth revisiting when Documents grows a detail route.
- **Filing and linking are two transactions.** Blob writes must happen outside a
  transaction (house rule), so the copy commits before the links do. If the
  second write fails, the copy exists unlinked in the Documents inbox — a real
  artifact, not corruption, and the retry is idempotent by content hash. Narrow
  enough to accept; not zero.
- **Idempotency is by content hash, checked twice rather than arbitrated.**
  `documents.blob_pathname` carries a random suffix by design, so there is no
  unique key to conflict on. A genuine double-submit inside the same moment can
  produce two copies. The cost is a duplicate row in an inbox, not a wrong
  answer.
- **Linking is available to any member, and it publishes.** Attaching a thread
  copies somebody's private correspondence somewhere their colleagues can read
  it. That is the point, it is audited, and the person doing it is the person
  whose mailbox it is — but there is no owner-only mode and no way to un-publish
  except deleting the document. Revisit if a client asks.
- **There is no production Stalwart, and that is now the only thing between the
  inbox and a person using it.** `STALWART_BASE_URL` points at a Docker
  container on one laptop. `yosherapp.com`'s mailboxes are at Migadu, which has
  no OAuth — which is why Stalwart was chosen in the first place — so the app
  cannot read them. Eight slices of mail client are waiting on one box.
  **`docs/runbooks/mail-server.md`** is the procedure, and the two things that
  decide whether it works are port-25 egress and the fact that a fresh IP has no
  sending reputation. The answer to the second is to relay outbound through
  Migadu rather than reversing the original evaluation.
- **`EMAIL_DEV_REDIRECT` must be set wherever compose is used outside
  production.** Locally it is now `admin@yosher.test`, the Stalwart mailbox in
  Docker, so a test send round-trips without leaving the machine. **It is not set
  in Vercel Preview**, so compose on a branch deployment will refuse — which is
  the safe direction, and is also the first thing somebody will report as a bug.
- **No folder rename, move or delete in the UI.** `renameMailbox` is on the
  client and `renameFolderAction` refuses role folders, but nothing calls them
  yet — the rail creates and lists, nothing more. Deleting a folder is the one
  worth thinking hardest about: it destroys mail at the host.
- **Saved views cannot be reordered or renamed.** `sort_order` exists on the
  table and is always 0.
- **"Select all" is page-scoped, with no "select all N matching".** The honest
  limitation: doing it properly means an `Email/query` for ids without bodies,
  and a bulk action over thousands of ids that somebody triggered with one
  click deserves a confirmation step that does not exist yet.
- **No drafts UI.** `saveDraft()` exists on the client and nothing calls it —
  closing the composer discards what you typed. Drafts live on the SERVER by
  design (a local table would desync with the same mailbox open in Outlook), so
  this is a surface, not a schema change.
- **One signature per mailbox, not per identity.** The editor writes to the
  identity the composer sends from. A mailbox with several send addresses shows a
  note saying so; a picker is unbuilt, and needs the composer to grow an identity
  chooser first or the two would disagree.
- **No signature images.** A `cid:` is minted per message, so a stored signature
  referencing one would show a broken image on every mail it was pasted into.
  Doing it properly means re-attaching the picture to each message at send time.
- **No "signature off for this message" toggle**, and no per-reply variant.
- **Nothing WRITES to the address book.** Autocomplete reads `ContactCard`; there
  is no "add to contacts" from a message, so the directory only ever grows
  through another client. Recent correspondents cover the common case, which is
  why this has not bitten.
- **No contact groups.** `AddressBook/get` works but `ContactGroup/get` is
  `unknownMethod` on this server, so "email the whole site team" has nothing to
  resolve against.
- **Recent correspondents include people you only ever RECEIVED from**, since
  `mail_thread_index` participants do not record direction. A newsletter sender
  you have never written to can therefore be suggested. Fixing it means storing
  direction at sync time, which is a schema change for a small win.
- **The rich composer has never run in a browser**, and the surface needing it
  grew with the toolbar slice: nine controls became twenty-odd, six of them
  popovers that save and restore a selection. Every pure part is tested and the
  protocol is probed, but `rich-text-editor.tsx` itself is unexercised. First
  thing to look at on a preview deployment, and specifically: a toolbar click
  with text selected (does the selection survive), Quote versus Indent (do they
  render differently in the received message), and the colour picker over a
  selection spanning two blocks.
- **Pasting into the composer loses formatting**, deliberately — paste is
  inserted as plain text so hostile markup cannot enter the document. Keeping it
  would mean shipping a sanitizer to the browser AND trusting it, and the thing
  being pasted is routinely another email. Revisit only with a sanitize-on-paste
  that runs the same allowlist as the server.
- **Inline images are never resized or re-encoded.** A 9 MB photograph straight
  off a phone is sent at 9 MB, with only a `max-width` to keep it from blowing
  out the layout. Downscaling server-side would be the kind thing to do and
  needs a decision about what the sender is entitled to expect back.
- **A deleted inline image's blob stays on the mail server.** The send path
  attaches only the pictures the body still references, so nothing wrong reaches
  the recipient, but the orphaned upload is not cleaned up. The mail server's
  own blob expiry is what collects it.
- **No drag-and-drop or paste of an image into the composer.** Paste is plain
  text by design, and an image on the clipboard is currently dropped silently
  rather than offered — which is the one place that rule reads as a bug.
- **Templates have no placeholders.** They insert fixed wording; there is no
  `{{customer}}` or invoice number. That is the obvious next step and the one
  that would make them better than Gmail's rather than equal to them, since
  filling a template from a business object is the whole reason this module sits
  next to Accounting. Unbuilt on purpose — the substitution, the field picker
  and the "what if the object is missing" case are a slice of their own.
- **A template does not appear on a phone or in Outlook.** The first mail
  feature since Slice 0 of which that is true, and it is the accepted price of
  being shareable across the business — see the build log for why no
  mail-server location can hold one. Anyone who works mostly from another client
  gets no benefit from them.
- **Clicking a thread while a settings pane is open leaves the pane up.** The
  header links clear each other, but a row click only sets `message`, so the
  third column keeps showing Templates/Signature/Rules. Pre-existing — templates
  behave exactly like the signature pane here — and it is a papercut rather than
  a bug, but it is the kind that reads as the app ignoring a click.
- **Any member can edit or delete any template**, matching `document_templates`.
  Fine while a tenant is a handful of people who know each other; a business
  with thirty staff would want the author, or an owner, to be the only one who
  can delete.
- **No `justify` alignment**, deliberately: it produces rivers of whitespace on
  the narrow columns mail is read in and is worse for dyslexic readers.
- **Confidential mode has no equivalent and probably never will.** It is
  Google-proprietary — expiry and SMS passcodes served off their own servers —
  rather than anything JMAP describes.
- **A colour palette makes white-on-white text reachable**, and that is accepted
  rather than fixed. It is the sender's own message, and refusing the white
  swatch would be strange in a product where somebody legitimately writes on a
  coloured background.
- **The editor does not warn when the sanitizer will change what you wrote.**
  With paste-as-text and a fixed toolbar the divergence should be nil, but if it
  ever is not, the message simply arrives as less than it looked like.
- **A scheduled send is only as punctual as the cron.** The sweep rides the
  mail-sync schedule. `vercel.json` asks for every 10 minutes; Vercel's Hobby
  plan runs cron once a day. **The founder moved to Pro on 2026-08-02**, which
  restores minute-level cron — verify the first scheduled send actually goes out
  on time before relying on it.
- **Search is not instant after filing.** The server's full-text index is
  asynchronous (found by `mail:probe-search`), so a message just moved or filed
  can be missing from results for a moment. Nothing in the UI says so, and the
  honest fix is probably to say nothing — but it is why a search that "should"
  match sometimes does not.
- **No `header` search**, and no OR/NOT in the builder. Both are available on the
  server; the builder only ever means "all of these".
- **A label cannot be created from the label menu** — only from the folder rail,
  since a label IS a folder. That is honest but it means "label as something
  new" is two steps.
- **No colours on labels**, and JMAP has nowhere to put one. It would need a
  per-user table mapping mailbox id to colour, which is the drift the current
  design avoids entirely.
- **No nested labels in the menu.** Mailboxes have a `parentId` and the menu
  renders a flat sorted list, so a deep folder tree reads as a long list.
- **No list of what is queued.** A scheduled message can be cancelled only by
  finding its draft; there is no "Scheduled" view showing what is waiting, which
  is the obvious next piece.
- **The undo window is client-side.** Closing the tab inside it leaves the
  message in Drafts unsent — recoverable and honest, but it does mean "Sending…"
  can end in a draft rather than a sent message.
- **Send is not idempotent.** A double-submit is guarded only by the disabled
  button — unlike the outbound spine, which derives an idempotency key from what
  the message IS. A composed message has no such natural key, and inventing one
  from a hash of the body would refuse a legitimate "same message, sent twice".
- **Truncation is carried but not yet surfaced.** `JmapEmail.bodyTruncated` is
  populated; the reading pane still needs to render a "message shortened — view
  original" affordance rather than showing a partial body as whole.
- **`0043`, `0044`, `0045` and `0046` have not been applied to production yet.**
  All four are on the dev branch and the isolation suite passes against it.
  `docs/security.md` §8 requires both databases. Run `npm run db:migrate` (no
  flag) against production before deploying this branch — and note it applies
  every pending migration, so run it as a deploy step rather than mid-build.
- **Rules are refused on a shared mailbox**, and this is the one thing
  delegation takes away rather than adds. A Sieve script is a singleton per
  ACCOUNT while `mail_rules` is per-user, so a rule saved against `info@` would
  be recorded privately and act publicly — and the next colleague to publish
  would overwrite it without ever seeing it. Fixing it means moving `mail_rules`
  from per-user to per-mailbox RLS, which is a policy change with its own
  isolation certification. Auto-reply and signature ARE allowed there, labelled
  as shared, because neither has a per-user table to contradict.
- **A read-only grant is parsed but not acted on.** `isReadOnly` is carried
  through from the session and defaults closed, but nothing branches on it yet,
  so a mailbox somebody may only read would offer Archive and Reply and fail at
  the server. `myRights` already covers the per-folder case; this is the
  per-account one.
- **Nobody can grant delegation from inside Yosher.** The access itself is
  granted on the mail server (a Group principal, with the person as a member),
  and `mail_directory_accounts` already carries `account_type: individual |
  group` but nothing writes the membership. Until there is a UI for it, adding
  somebody to `info@` is a manual step in Stalwart's admin.
- **Token refresh has not been exercised.** The stored token is still inside its
  first expiry window, so `needsRefresh` → `refreshAccessToken` has never run
  against the live server. Worth forcing before relying on it.
- **Real-time will be state polling, not push.** JMAP push needs a long-lived
  server-side connection that serverless cannot hold. Comparing the account's
  state string is one small request; an SSE proxy on Vercel's streaming runtime
  is a later optimization, not a prerequisite.
- **The `attachments → Documents` join is wired, but only on demand.** Slice 5
  files a message and its attachments into the DMS when somebody attaches the
  thread to a record. There is still no automatic path — a hosted mailbox does
  not file attachments the way `in.yosherapp.com` does for inbound mail, and it
  should not: filing every attachment anybody receives would publish a mailbox
  rather than a message. A per-folder rule ("everything from this sender") is the
  shape that would work, and it is unbuilt.
- **One hosted domain per tenant.** A client with two trading names needs two,
  and the unique index on `tenant_id` says no.
- **Deliverability for hosted mailboxes is Migadu's**, not ours — which is the
  point — but outbound from a hosted mailbox does not currently relay through
  the `sendEmail()` spine, so it bypasses the send log, the caps and the dev
  guard. Anything the *platform* sends still goes through the spine; this only
  concerns a human sending from their own mailbox.
