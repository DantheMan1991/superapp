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

**Composing is rich text**: bold, italic, underline, lists, links and quoting,
sent as a `multipart/alternative` whose text part is derived from the HTML rather
than typed alongside it. The MIME the server assembles has been read back off a
live draft (`npm run mail:probe-compose`), not assumed from RFC 8621.

What is NOT built yet, in priority order: **signature editing** (they are read
from the server's Identity and prefilled, never written), contact autocomplete —
the server has advertised `urn:ietf:params:jmap:contacts` since the first probe
and nothing uses it — undo/schedule send, labels, websocket push
(`urn:ietf:params:jmap:websocket`, `supportsPush`), and an advanced search
builder. Then delegation.

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
- **No Bcc field.** The action accepts it and the form does not offer it.
- **No signature editing.** Signatures are read from the mail server's Identity
  and prefilled — `htmlSignature` preferred over `textSignature` since rich text
  landed — but changing one still means using another client.
- **The rich composer has never run in a browser.** Every pure part is tested and
  the protocol is probed, but `rich-text-editor.tsx` itself is unexercised:
  toolbar-click selection preservation, where the caret lands on mount,
  `formatBlock` over a multi-paragraph selection, and whether `execCommand`
  behaves under React 19's event delegation at all. First thing to look at on a
  preview deployment.
- **Pasting into the composer loses formatting**, deliberately — paste is
  inserted as plain text so hostile markup cannot enter the document. Keeping it
  would mean shipping a sanitizer to the browser AND trusting it, and the thing
  being pasted is routinely another email. Revisit only with a sanitize-on-paste
  that runs the same allowlist as the server.
- **No image insertion in a composed message**, and it is not a small gap to
  close: an inline image means uploading a blob, minting a `cid:`, and emitting
  `multipart/related` around the alternative. `<img>` is not in the outbound
  allowlist at all until that exists.
- **No plain-text mode.** Every message now goes as `multipart/alternative`.
  Mailing lists and a few correspondents genuinely want text only, and the
  toggle would be cheap — the text part is already derived and correct.
- **No font, colour, size or alignment controls**, on purpose for now: they are
  the `style`-attribute features, and the outbound sanitizer strips `style`
  wholesale. Adding any one of them means a narrow, regex-validated style
  allowlist rather than opening the attribute.
- **The editor does not warn when the sanitizer will change what you wrote.**
  With paste-as-text and a fixed toolbar the divergence should be nil, but if it
  ever is not, the message simply arrives as less than it looked like.
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
- **A delegated shared mailbox cannot be connected yet.** `sessionMatchesAddress`
  compares against the session's primary account only, so someone granted access
  to `info@` through their own credentials is refused. JMAP exposes that case as
  a second entry in `session.accounts`; matching across all of them (and storing
  the matching `accountId` rather than the primary) is Slice 10's work.
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
