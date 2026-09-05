# Security model and standards

> **Read before:** adding a table, writing a server action or route handler,
> touching auth, handling a secret, integrating a third party, or building a
> pack. If you are about to write code that reads or writes tenant data, this
> file is not optional.
> **Update when:** an invariant changes, a new trust boundary appears, or a new
> class of sensitive data enters the system. Same PR, not later.

This platform holds a small business's mail, its books, its bank feed and its
contracts — in one database, next to its competitors'. A tenant-isolation
failure here is not a bug, it is the end of the company. Everything below is
written to make that failure structurally hard rather than merely unlikely.

---

## 1. What we are protecting

Classify data before you decide how to handle it. The class drives the rules.

| Class | What | Where | Blast radius |
| --- | --- | --- | --- |
| **C1 — Client mail** | Full mailbox contents: bodies, attachments, addresses, threads | `mail_*` tables, Stalwart over JMAP | Catastrophic. This is the client's real correspondence. |
| **C2 — Financial** | Ledger, invoices, payables, bank transactions, Plaid tokens | `accounting` module tables | Catastrophic. Money movement + banking credentials. |
| **C3 — Documents** | Contracts, insurance certs, licenses, IDs, site photos | `documents` tables, Vercel Blob | Severe. Often contains C4 inside it. |
| **C4 — Identity / PII** | Users, emails, org membership, contact records | `profiles`, `memberships`, Clerk | Severe. Regulated in several jurisdictions. |
| **C5 — Platform secrets** | `APP_ENCRYPTION_KEY`, provider keys, mailbox OAuth tokens, DB URLs | env, `mailboxes.*_encrypted` | Total. Compromise degrades every class above. |

Two consequences worth stating plainly:

- **There is no "low sensitivity" tenant table.** Even a lookup table joins to
  something in C1–C4. Every tenant table gets the full treatment.
- **C5 protects C1–C4.** A leaked `APP_ENCRYPTION_KEY` is not a C5 incident, it
  is a C2 incident with extra steps.

---

## 2. Defence in depth — the five controls

No single control is trusted. Each assumes the one above it has already failed.

```
  1. Identity          Clerk. Middleware guarantees "signed in". Nothing more.
        ↓
  2. Authorization     requireTenant / requireTenantOwner / requireSuperAdmin
        ↓              Server-side, every request, no exceptions.
  3. Tenant isolation  withTenant() opens a tx and sets RLS context
        ↓
  4. Database RLS      FORCE ROW LEVEL SECURITY. No context → no rows.
        ↓              The backstop that catches a forgotten WHERE clause.
  5. Audit             logAudit / logAuditInTx. Detection when 1–4 fail.
```

The middleware is **not** a control. It answers "is this person signed in",
which tells you nothing about which tenant they may read. Never rely on it for
authorization.

### How RLS actually works here

Four transaction-local settings, read by every policy
(`drizzle/0001_rls.sql`, extended in `drizzle/0024` and `drizzle/0043`):

| Setting | Values | Meaning |
| --- | --- | --- |
| `app.role` | `superadmin` \| `member` | God view, or scoped to one tenant |
| `app.tenant_id` | uuid | Which tenant, when `member` |
| `app.tenant_role` | `owner` \| `staff` \| `expert` | Lets a policy separate owners from staff. For a request this comes from Clerk; for a background job it comes from `memberships.role`, which is why that column is `withSystem`-write-only (S6) |
| `app.clerk_user_id` | Clerk user id | Lets a policy scope rows to **one person** inside a tenant |

Set only by `withTenant()` / `withSystem()` in [src/db/index.ts](../src/db/index.ts),
only after authorization has already happened. Unset context yields **zero
rows**, including for the table owner — that is what `FORCE` buys.

### Tenant-scoped is not always enough

`app.clerk_user_id` exists because some data belongs to a *person*, not to the
business. A mailbox is the case that forced it: `dan@` is private
correspondence, and a policy that only asked "same tenant?" would let any
colleague read it. `mail_accounts` and `mail_thread_index` therefore scope on
both tenant and user (`drizzle/0043`).

Reach for this whenever a row would embarrass someone if a co-worker read it.
The default is still tenant-scoping — most business data is genuinely the
business's — so the question to ask is "whose record is this?", not "can I add
a filter?".

Both extra settings share one property, and any new one must too: **a caller who
forgets the option is denied, never granted.** `role` defaults to `staff`;
`userId` defaults to empty, which `app_current_user()` turns into `NULL`, which
matches no row. Forgetting returns nothing rather than everything.

### Why the app connects as `app_user`

Neon's owner role carries `BYPASSRLS`. If the app connected as the owner, every
policy in the system would be decorative. So:

- `DATABASE_URL` → `app_user`, **no** `BYPASSRLS`. What the app uses.
- `DATABASE_URL_OWNER` → Neon owner. Migrations and seeds only, never runtime.

`npm run db:create-role` creates and rotates `app_user`. If you ever find
runtime code reading `DATABASE_URL_OWNER`, that is a P0.

---

## 3. Non-negotiable invariants

Numbered so they can be cited in review and in ADRs.

**S1 — Every tenant-scoped query goes through `withTenant()`.**
No raw `db.select()` on a tenant table. No exceptions for "just a count".

**S2 — `withSystem()` requires a justification at the call site.**
Legal callers: after `requireSuperAdmin()`, or trusted sync code (Clerk/Stripe
webhooks, `tenant-sync.ts`, `logAudit`, seeds, migrations). Anything else is a
bug. Never call it with user-controlled intent — "look up the tenant for this
id the client sent" is exactly the shape of the vulnerability.

**S3 — `app.tenant_role` and `app.clerk_user_id` never come from user input.**
Only from `requireTenant()` / `resolveTenantContext()`. `withTenant()` defaults
`role` to `staff` and `userId` to empty, the least privileged values, so
forgetting either option **denies a read and can never grant one**. Preserve
that direction in any new code. Passing a user id the caller was handed by the
client is the same class of bug as passing a role — the id must come from the
session.

**S4 — Authorization is re-checked server-side on every request.**
Server actions and route handlers each authorize independently. A page having
authorized its own render grants nothing to the action it submits to. Client
state is never evidence.

**S5 — Zod-validate every boundary.**
Server actions, route handlers, webhooks, JMAP responses, AI tool output. Parse
into a typed shape; never index into unvalidated input.

**S6 — Role degrades downward, never upward.**
Clerk `org:admin` is always `owner`. A missing membership row resolves to
`staff`, never `expert`. Any new role resolution keeps this property.

For anything with a session, **Clerk is the authority** — `requireTenant()`
reads `orgRole`, and `memberships` decides only expert-vs-staff. Code running
without one (crons, sweeps) has no such authority to consult, so it reads
`memberships.role`, and two things make that safe:

- `role = 'owner'` is writable **only under `withSystem()`** — the member
  UPDATE policy is narrowed to non-owner rows and staff/expert values
  (`drizzle/0085`). A tenant transaction cannot mint an owner.
- `clerk_role_synced_at` records when Clerk last confirmed the row. A job that
  intends to act as somebody **reconciles first**
  (`reconcileTenantMemberships()`) and treats a stale row as `staff`.

The failure that motivates both: a dropped demotion webhook leaves a row saying
`owner` for someone Clerk now calls a member. A job trusting it reads
owners-only data on their behalf — and if it emails, the disclosure cannot be
withdrawn. Never widen this to "the DB says owner, so they are one" for a live
request; that is an upward grant from cached data. See
[modules/identity-and-roles.md](modules/identity-and-roles.md).

**S7 — Billing state is written only from trusted Stripe data.**
The signature-verified webhook, or a server→Stripe reconcile
(`src/lib/billing-sync.ts`). Never from client input. Card data never touches
this server.

**This now covers TWO opposite directions, and conflating them is its own bug
class.** `subscriptions` is the PLATFORM charging the TENANT.
`payment_accounts` is the TENANT charging THEIR customer — Stripe Connect, one
connected account per legal entity ([ADR 0015](decisions/0015-a-connected-account-belongs-to-a-company.md)).
Same SDK, same platform secret key, separate routes, separate signing secrets.

On `payment_accounts` the rule is enforced by POLICY rather than by care:
**members hold a SELECT policy and nothing else**, so no tenant transaction can
write the table. The `card_payments` capability status is the outcome of a KYC
review this platform does not perform, and the app asserting it is the whole
class of bug — a farm told it can take a card, and a customer's card declined at
a stall. Note the denial is SILENT: with no member UPDATE policy an UPDATE
matches zero rows rather than raising. Only the INSERT is loud.

That side also runs on Stripe's **Accounts v2** API, whose events are THIN —
they carry a reference, not an object — so the webhook must fetch the account
before it can write anything. S7 therefore holds by construction there rather
than by discipline: there is no payload to be tempted to trust.

**A tenant's own Stripe secret key is never stored, never asked for, never
seen.** The connected account id (`acct_…`) is an identifier; the authority to
act on it comes from the platform key plus `stripeAccount`. A per-client secret
key would be a C5 secret granting unlimited authority over that client's money,
and it is the shortcut ADR 0015 exists to refuse.

**Since 2026-09-02 the same table carries a second provider, Square, and S7
reads "trusted PROVIDER data".** `payment_accounts.provider` says which;
CHECK constraints stop a row lying about it. Square has no Connect: the client
authorises Yosher through OAuth and the app holds a **per-company access token
in `payment_credentials`** — encrypted (S8), and in a table with **NO member
policy at all**, so a tenant transaction cannot read even its own ciphertext.
That token is not the secret key above: it is scoped to what the seller
consented to, expires in thirty days unless renewed, and the seller revokes it
from Square, which tells us (`oauth.authorization.revoked`). The lib decrypts
it in exactly one function. [ADR 0017](decisions/0017-the-square-account-the-farm-already-has.md)
weighs the trade.

**S8 — Secrets at rest are encrypted with `encryptSecret()`.**
AES-256-GCM, random IV, auth tag stored alongside — tampering fails loudly.
One key, `APP_ENCRYPTION_KEY`. Plaid access tokens, mailbox OAuth tokens and
Square OAuth tokens (`payment_credentials`) use it. Do not introduce a second
key; do not hand-roll crypto. Note that since the Square tokens, a rotation of
this key touches a client's money, not only its mail and bank feed.

**S9 — Audit identifiers, never contents.**
`logAudit()` takes actions, ids and coarse metadata. Never a message body, an
amount that reveals a balance, a filename that reveals a client, a token.

**`meta` IS RENDERED, so this rule has teeth it did not have before.** Since
2026-08-20 `/admin/audit` shows what each action recorded, under the action —
and a correction shows what it moved from and to. Anything put in `meta` is now
readable by a superadmin on one page rather than sitting in a column nobody
opened. That is the point: an audit trail nobody can read is not one. It also
means a careless `meta` is now a visible leak rather than a latent one, so the
rule above is checked at the call site, not at the renderer.

**S10 — Financial mutations audit inside their own transaction.**
Use `logAuditInTx()`. A ledger change must not be able to commit unaudited, and
an audit failure must roll the mutation back. `logAudit()` swallows errors by
design and is therefore wrong for money.

**S11 — Tests never touch production.**
`TEST_DATABASE_URL` is required; `tests/setup/database-guard.ts` enforces it by
replacing `DATABASE_URL` for the run. A skipped isolation run is not a passing
one.

**S12 — A pack may never widen access to core data.**
Extensions add tables and columns. They do not get to relax a core policy,
bypass `effective_visibility`, or read another pack's rows. See
[extension-model.md](extension-model.md).

---

## 4. Checklists

Paste these into the PR. They are the actual gate.

### Adding a table

- [ ] `tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE`
- [ ] `npm run db:generate` for the table, then a second `--custom` migration
      for policies — Drizzle does not generate RLS
- [ ] `ENABLE ROW LEVEL SECURITY` **and** `FORCE ROW LEVEL SECURITY`
- [ ] Superadmin policy: `USING (app_is_superadmin()) WITH CHECK (app_is_superadmin())`
- [ ] Member policy scoped by `app_current_tenant()`
- [ ] Decide writability deliberately: read-only to members? owner-only? If the
      row is visibility-bearing, the policy reads `app.tenant_role`
- [ ] Unique/lookup indexes lead with `tenant_id`
- [ ] Added to `tests/isolation/<area>.test.ts` — a two-tenant read AND write
      attempt, both denied
- [ ] Migration run against **both** the dev branch and production
- [ ] Row added to the module dossier's Data model table

### Adding a server action

- [ ] `"use server"` and the file cannot be imported by a client component
- [ ] `requireTenant()` (or `requireTenantOwner()`) — first statement
- [ ] `requireModuleEnabled()` if it belongs to a module
- [ ] Zod schema parses the input before anything else touches it
- [ ] All DB access inside `withTenant(ctx.tenant.id, fn, { role: ctx.role })`
- [ ] Passing `{ role: ctx.role }` if the query reads anything visibility-bearing
- [ ] Ids from the client are treated as *claims* — the `withTenant` scope is
      what proves ownership, so never `withSystem` a client-supplied id
- [ ] `logAudit()` / `logAuditInTx()` for anything sensitive or financial
- [ ] Errors do not leak internals to the client (no raw PG errors)
- [ ] **In a capability pack**: the op declares a write level through
      `allowsWrite()` (`src/lib/packs/authorize.ts`) rather than testing
      `ctx.role` by hand. Ask *is this a decision, or is it a chore?* Anything
      that creates a cost object is a decision — `upsertDimensionMember`
      requires the owner role, so the write would succeed where its cost object
      could not

### Adding a route handler (`src/app/api/**`)

- [ ] `resolveTenantContext()` — the non-redirecting variant. A route handler
      that `redirect()`s is a bug
- [ ] Returns 401/404 JSON, and **404 rather than 403** for another tenant's
      resource — do not confirm existence
- [ ] Zod on body, query and params
- [ ] Public/unauthenticated routes (webhooks, `/s/[token]`, inbound mail) are
      listed in §6 with their verification mechanism
- [ ] No sensitive data in URLs or query strings — they land in logs

### Integrating a third party

- [ ] Client is lazy, so `npm run build` stays green without keys
- [ ] Inbound calls verified: signature (Stripe, Clerk, Resend), or a
      single-use token we minted
- [ ] Outbound credentials from env, encrypted at rest if stored per tenant
- [ ] Failure mode is fail-closed
- [ ] Added to the trust boundary table in §6
- [ ] Documented in SETUP.md and the module dossier

---

## 5. Secrets and keys

| Secret | Purpose | Rotation |
| --- | --- | --- |
| `APP_ENCRYPTION_KEY` | Encrypts Plaid + mailbox tokens (S8) | Decrypt-all / re-encrypt runbook. There is no v2 key format yet — adding one is a designed change, not an improvisation. |
| `DATABASE_URL` | Runtime, `app_user` | `npm run db:create-role` |
| `DATABASE_URL_OWNER` | Migrations only | Neon console |
| `CLERK_SECRET_KEY`, webhook secret | Identity | Clerk dashboard |
| `STRIPE_SECRET_KEY`, webhook secret | Billing — the platform charging the tenant | Stripe dashboard |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | Connect events — the tenant's own connected accounts. A SEPARATE endpoint with a separate secret, because Stripe only delivers `account.updated` to a Connect-enabled one | Stripe dashboard |
| `SQUARE_APPLICATION_ID`, `SQUARE_APPLICATION_SECRET` | The tenant's own Square account, via OAuth (ADR 0017). The secret is sent to Square at code exchange and on revoke, and never anywhere else. `SQUARE_ENVIRONMENT` picks sandbox (the default) or production | Square Developer Console |
| `SQUARE_WEBHOOK_SIGNATURE_KEY` | Square events. HMAC-SHA256 over the notification URL plus the raw body, so `NEXT_PUBLIC_APP_URL` must match the URL registered in the console exactly | Square Developer Console |
| `ANTHROPIC_API_KEY` | Copilot, extraction | Anthropic console |
| `PLAID_*` | Bank feed | Plaid dashboard |
| Stalwart / JMAP creds | Mailbox access | Per-deployment |

Rules:

- `.env` is never committed. `.env.example` carries names and shapes, never values.
- No secret reaches a client component. `import "server-only"` on any module
  that touches one.
- No secret in an error message, a log line, an audit row, or an AI prompt.
- Key material is read lazily inside a function, never at module scope — that
  is what keeps the build green without keys.

### Never log

Message bodies · attachment contents · account or routing numbers · Plaid or
OAuth tokens · `APP_ENCRYPTION_KEY` or any ciphertext · full document contents ·
share-link tokens · raw webhook payloads · anything that identifies a client by
name in a platform-level log.

Log instead: tenant id, actor id, action, target type + id, counts, durations.

---

## 6. Trust boundaries

Every path into the system, and what makes it trustworthy.

| Entry point | Authenticated by | Notes |
| --- | --- | --- |
| Dashboard pages | Clerk session → `requireTenant()` | Middleware only checks signed-in |
| Server actions | Clerk session → `require*()` | Re-checked per action (S4) |
| `src/app/api/**` | `resolveTenantContext()` | JSON 401/404, no redirects |
| Clerk webhook | Svix signature | Trusted sync → `withSystem()` legal. Deliveries are **not ordered**: when an event's prerequisite hasn't arrived, answer 5xx so svix retries. A 200 that wrote nothing loses the row for good |
| Stripe webhook | Stripe signature | Only trusted source of billing state (S7). The PLATFORM charging the TENANT |
| Stripe **Connect** webhook | Stripe signature, own secret | `/api/webhooks/stripe/connect`. The TENANT charging THEIR customer, over Accounts v2. A v2 notification carries only a REFERENCE, so the handler re-reads the account from the API — the event is a nudge and the data is always a server→Stripe read. The tenant is resolved from our own row by account id, never from the event or from Stripe metadata |
| Square webhook | Square signature (`x-square-hmacsha256-signature`), own key | `/api/webhooks/square`. The TENANT charging THEIR customer through their own Square account. HMAC-SHA256 over notification URL + raw body, verified in a pure function with a known-vector test. Today only `oauth.authorization.revoked` does anything — it closes the rows for that merchant and blanks their tokens. The tenant is resolved from our own row by merchant id, never from the payload |
| Square OAuth callback | State cookie (encrypted, httpOnly, single-use) + signed-in OWNER matches the tenant that started it + code exchanged with the application secret | `/api/payments/square/callback`. Nothing is stored until the new token has read the merchant back from Square's API, which is also the only trusted answer to WHICH account was authorised |
| Resend inbound mail | Signature + address token | Token is the tenant claim; validate before use |
| `/s/[token]` share links | Unguessable token + expiry + limits | **Unauthenticated by design.** Scope tightly, log access |
| `/health-check` | Public | Prospect funnel. No tenant data. Treat all input as hostile |
| `/sites/[slug]`, `/hosted/[slug]` (tenant websites) | Public | **Unauthenticated by design** (ADR 0019). `slug → tenant` is one `withSystem` lookup returning identifiers; pages are then read in that tenant's context as `staff` through the member policies. Only the PUBLISHED snapshot is rendered, from typed sections, never markup. **A link an owner types is one of four shapes** — an in-site path (never `//host`), `http(s)://`, `mailto:`, `tel:` — refused by the schema on save and, at render, turned into plain words by `resolveHref` if a stored row holds anything else (`src/lib/sites/links.ts`; since Marketing 6c, before which a stored `javascript:` href was a stored XSS on this origin). `src/proxy.ts` rewrites `<slug>.<SITE_DOMAIN>` to `/hosted/…` |
| `/sites/[slug]/draft` | Clerk session → `resolveTenantContext()` | The draft preview. 404 for a site that is not the caller's tenant's |
| `/sites/[slug]/logo` | Public | The brand's logo, addressed by the site; the one blob stream with a public cache header (ADR 0018) |
| `/domain/[host]` (a domain the business connected) | Public | **Unauthenticated by design** (ADR 0020). `src/proxy.ts` rewrites every hostname that is not the platform's own here; `host → tenant` is one `withSystem` lookup over `site_domains`, `active` rows only (Vercel's word), then the tenant's context as `staff`. A hostname nobody connected is a 404 |
| The enquiry form on any site route (`submitSiteEnquiry`) | Public | **The one unauthenticated WRITE into a tenant** (ADR 0021). Honeypot, Zod, then `slug → tenant` through the same trusted lookup as the renderer; refused unless the site is `published`. The write runs as `staff` inside that tenant with no user, through the shared party and Work doors, so the member policies bound it. Caps per IP per hour and platform-wide per day in `public_access_attempts` (`src/lib/public-caps.ts`), and per site per day on `site_enquiries`. The business is emailed to its own addresses, never to the visitor's |
| `POST /api/sites/view` (the page-view beacon) | Public | **The second unauthenticated write into a tenant, and the smaller** (ADR 0022). A browser on a published site posts `{ site, path, first }`; Zod, then `slug → tenant` through the trusted lookup, only a published page of that site counts, and the write is an increment on one `site_page_views` row as `staff`. No cookie, no IP, no user agent: the browser says whether it is its first view today. Always 204, so the beacon cannot ask which addresses exist |
| `/sites/[slug]/images/[id]`, `/domain/[host]/images/[id]` (a site's photos) | Public | **A PUBLISHED site's photo only** (ADR 0023): the same trusted lookup as the pages, then a `staff` read of `site_images` and a blob stream with a public cache header. One derivative the platform made, metadata stripped; never an upload, never an SVG. `src/proxy.ts` maps `/images/<id>` here on a site host |
| `/api/marketing/sites/images/[id]` | Clerk session → `resolveTenantContext()` | A site photo for members: the editor's picker and the draft preview. RLS proves the row is the tenant's; another tenant's id is the same 404 as none |
| `/api/marketing/sites/upload` | Clerk session, owner, Marketing enabled | The presigned-upload door for photos, the brand logo's twin: a token bounded to the tenant's `sites/<tenant>/photos/` prefix, the photo types and 12MB. Registration (`registerSitePhotoAction`) re-reads the real bytes and keeps only the derivative |
| Vercel Domains API | `VERCEL_API_TOKEN`, project-scoped | Outbound only, from owner actions; every response Zod-parsed (S5). The token adds and removes domains on THIS project and nothing else |
| JMAP → Stalwart | Per-mailbox credentials | Outbound; responses are untrusted input → Zod (S5) |
| AI responses | None | Model output is **never** trusted. Validate, never `eval`, never let it choose a tenant id |

Two recurring traps:

- **Token-bearing URLs are credentials.** Share links and inbound addresses
  grant access to whoever holds them. Never log them, never put them in an
  audit `meta` blob, and prefer short expiries.
- **Untrusted content reaches the model.** Mail bodies and uploaded documents
  flow into Claude prompts. Treat any instruction inside them as data. The model
  may summarize a document; it may never be given authority to act on
  instructions found inside one.

---

## 7. Module and pack security

Modules are seams, not sandboxes. There is no runtime isolation between them —
a module is trusted code sharing one database. That makes review the control:

- A pack's tables follow §4 exactly. `tenant_id`, FORCE RLS, isolation test.
- A pack extends core data through the sanctioned primitives only (open
  taxonomy columns, `metadata` jsonb, link tables carrying `extension_slug`).
  See [extension-model.md](extension-model.md).
- A pack **never** relaxes a core policy. If a pack needs data it cannot see,
  the answer is a new column with its own policy, not a widened one.
- `requireModuleEnabled()` is an entitlement check, not a security boundary.
  It stops a tenant using something unpaid; it does not stop cross-tenant reads.
  RLS does that.

---

## 8. Pre-merge security gate

```bash
npm run test:isolation
```

Required before any deploy. Needs `TEST_DATABASE_URL` (+
`TEST_DATABASE_URL_OWNER`) pointing at a non-production database — a Neon
branch takes a minute to create. If the run **skips**, it has told you nothing;
that is a red build, not a green one.

Also required:

```bash
npm run build
```

After migrating, prove the database actually has what the migration claimed —
against **both** databases, `--dev` and without:

```bash
npm run db:verify-rls -- --dev
```

Every table must report ENABLED, FORCED and at least one policy; the script
exits non-zero if any does not. "Migrations complete" is not evidence. A
partial migration once left a table on production with RLS switched off, and
nothing surfaced it, because RLS failing open is indistinguishable from RLS
working right up until two tenants share a query. Pass a table name
(`npm run db:verify-rls -- memberships`) to dump its policies and read them
back.

Then confirm by hand for any PR touching data access:

1. Every new table appears in `tests/isolation/`.
2. Every new `withSystem()` call has a justification comment.
3. Every new server action starts with a `require*()` call.
4. The migration has been run against **both** databases (dev branch + prod),
   and `verify-rls.ts` was run against both afterwards.

---

## 9. Known gaps and accepted risk

Honesty here is what keeps the rest of the document credible.

- **Single encryption key, no versioned format.** Rotation is a manual
  decrypt/re-encrypt runbook. Acceptable at current scale; revisit before the
  first enterprise client asks about key rotation.
- **No rate limiting** on public surfaces (`/health-check`, `/s/[token]`).
  Brute-forcing a share token is impractical but not impossible.
- **Audit log is append-only by convention**, not by policy — a superadmin
  context could in principle delete rows.
- **No automated dependency scanning** in CI yet.
- **Blob storage authorization is app-enforced**, not storage-enforced. Vercel
  Blob URLs are unguessable but not tenant-scoped at the storage layer.
- **Role drift is detected only when something reconciles.** A missed Clerk
  membership webhook leaves `memberships.role` wrong until `/onboarding`, the
  Team page, or a job runs `reconcileTenantMemberships()`. Nothing alerts on it.
  Harmless for live requests (Clerk is the authority) — the exposure is limited
  to background code, which is required to reconcile before acting (S6).

Add to this list rather than quietly carrying an undocumented risk. An item
here is a decision; an item missing from here is an accident.
