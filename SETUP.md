# SuperApp — Complete Setup Guide (click-by-click)

This walks you from a cloned repo to a fully working platform, assuming
you've never used Neon, Clerk, or Stripe before. Budget 30–45 minutes.
Everything uses free tiers.

**The big picture:** the app is done, but it rents three pieces of
infrastructure — a database (Neon), login/accounts (Clerk), and billing
(Stripe). Each one gives you a few text keys. You paste those keys into a
file called `.env`, and the app comes alive.

You only strictly need **Neon + Clerk** to run and test the app. Stripe can
wait until you care about the payment button.

---

## Part 0 — Create your `.env` file (2 min)

1. Open a terminal in the project folder
   (`C:\Users\kubot\Documents\Superapp`). Easiest way: open the folder in
   File Explorer, click the address bar, type `cmd`, press Enter.
2. Run:
   ```
   copy .env.example .env
   ```
3. Open the new `.env` file in any text editor (Notepad is fine, VS Code is
   nicer). You'll see a list of `NAME=` lines. As you go through the parts
   below, you'll paste values after the `=` signs. No quotes, no spaces
   around the `=`.

A finished `.env` looks like this (fake values):

```
DATABASE_URL=postgresql://neondb_owner:npg_aB3xY...@ep-cool-lab-a5xyz-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_bG92ZWx5LWZveC0xMi5jbGVyay5hY2NvdW50cy5kZXYk
CLERK_SECRET_KEY=sk_test_AbCdEfGh123...
CLERK_WEBHOOK_SECRET=
SUPER_ADMIN_EMAILS=danr.houser91@gmail.com
STRIPE_SECRET_KEY=sk_test_51Abc...
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_OPERATIONS=price_1AbcDef...
STRIPE_PRICE_BUSINESS_OFFICE=price_1GhiJkl...
STRIPE_PRICE_ONBOARDING=price_1MnoPqr...
STRIPE_PRICE_HOURS_5=price_1StuVwx...
STRIPE_PRICE_HOURS_10=price_1YzaBcd...
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Empty lines are fine — the webhook secrets stay empty for local use.

> ⚠️ `.env` holds secrets. It's already in `.gitignore` so it will never be
> uploaded to GitHub. Don't email it, screenshot it, or paste it into chats.

---

## Part 1 — Neon: the database (10 min)

Neon is hosted Postgres. The app stores all its data here.

### 1.1 Create the account and project

1. Go to **https://neon.tech** → click **Sign up**. Signing up with your
   Google account is fastest.
2. After signup, Neon asks you to **create a project**. If it doesn't, click
   **New project**.
   - **Project name:** `superapp`
   - **Postgres version:** whatever it defaults to (16 or 17) is fine.
   - **Region:** pick the one closest to you (e.g. *US East (Ohio)*).
3. Click **Create**. You'll land on the project dashboard.

### 1.2 Get the connection string

1. On the project dashboard, find the **Connect** button or the
   **Connection string / Connection details** panel (front and center on a
   new project).
2. There's a dropdown that switches between **Pooled connection** and
   **Direct connection** — choose **Pooled** (it usually is by default; the
   hostname will contain `-pooler`).
3. Make sure the toggle/checkbox to **show password** is on, so the string
   contains the real password instead of a placeholder.
4. Click the **copy** icon. You now have something like:
   ```
   postgresql://neondb_owner:npg_xxxxx@ep-something-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```
5. Paste it into `.env` as the value of `DATABASE_URL`.

### 1.3 Create the tables and the app's database role

Back in your terminal, run these three commands one after the other:

```
npm run db:migrate
npm run db:seed
npm run db:create-role
```

Expected output: `db:migrate` prints "Running migrations…" then "Migrations
complete." — `db:seed` prints "Seeded 7 modules." — `db:create-role` prints
"app_user role created" and ".env updated".

**Why the third command matters:** Neon's default database login has a
special power that lets it *bypass row-level security* — the very protection
that keeps one client from seeing another's data. `db:create-role` creates a
restricted `app_user` login without that power, points the app at it, and
keeps the original owner login (as `DATABASE_URL_OWNER`) for migrations
only. The isolation test in Part 3.6 fails loudly if this step was skipped —
that's by design.

**If you get an error:**
- `DATABASE_URL is not set` → the `.env` file isn't named exactly `.env`, or
  you're in the wrong folder.
- `password authentication failed` → the copied string had a placeholder
  instead of the real password. Redo step 1.2 with "show password" on.
- `fetch failed` / timeout → check your internet; Neon free-tier databases
  also auto-suspend when idle — just run the command again, the first
  connection wakes it up.

Done with Neon. You won't need its dashboard again except to look at data.

---

## Part 2 — Clerk: login and accounts (10 min)

Clerk handles sign-up, sign-in, passwords, and — critically —
**Organizations**, which is how the app models each client business.

### 2.1 Create the application

1. Go to **https://clerk.com** → **Sign up** (Google sign-in is fine).
2. You'll be prompted to **Create application**:
   - **Application name:** `SuperApp`
   - **Sign-in options:** leave **Email** on. Turn **Google** on too if you
     want one-click sign-in. Everything else can stay off.
3. Click **Create application**.

### 2.2 Copy the API keys

Right after creating the app, Clerk shows a **quickstart / API keys screen**
(if you navigated away: left sidebar → **Developers** → **API keys**).

1. Copy the **Publishable key** (starts `pk_test_`) → paste into `.env` as
   `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`.
2. Copy the **Secret key** (starts `sk_test_`; you may have to click an eye
   icon to reveal it) → paste into `.env` as `CLERK_SECRET_KEY`.

### 2.3 Enable Organizations — DO NOT SKIP

This is the single most important switch. Without it, nobody can create a
business and the app loops at onboarding.

1. In the Clerk dashboard left sidebar, click **Configure** (or the gear
   icon), then look for **Organization settings** (sometimes just
   **Organizations**).
2. Flip **Enable organizations** to **on**. Accept the defaults it offers.
3. That's it — no other org settings matter for now.

### 2.4 Make yourself the platform owner

In `.env`, set:

```
SUPER_ADMIN_EMAILS=danr.houser91@gmail.com
```

Any account that signs in with this email gets the `/admin` god view. You
can list several emails separated by commas. **Use this exact email when
you sign up in the app later.**

### 2.5 Skip the webhook (for now)

`CLERK_WEBHOOK_SECRET` stays empty. Webhooks need a public URL, which
localhost doesn't have. The app is built to work without it locally — it
syncs organizations to the database during onboarding on its own. You'll
set the webhook up when you deploy to Vercel (Part 6).

---

## Part 3 — First run and full test drive (10 min)

### 3.1 Start the app

```
npm run dev
```

Wait for `Ready` (first start takes ~10-20 seconds), then open
**http://localhost:3000** in your browser. Leave this terminal window open —
it IS the server; closing it stops the app. (Stop it anytime with Ctrl+C.)

### 3.2 Walk through it as your first client

1. On the landing page, click **Get started** / **Sign up**.
2. Sign up with **danr.houser91@gmail.com** (the super-admin email). Clerk
   will email you a verification code — enter it.
3. You'll be redirected to **onboarding**: it asks for a business name.
   Enter something like `Test Flippers LLC` and create it.
4. You land on the **client dashboard** — mostly empty, with an Overview
   page. This is what a client sees on day one. Working as intended.

### 3.3 Put on your platform-owner hat

1. Go to **http://localhost:3000/admin** (also linked at the bottom of the
   dashboard sidebar: "← Platform admin").
2. You should see the admin cockpit with **Test Flippers LLC** in the client
   list. If you got bounced back to /dashboard instead: your signed-in email
   doesn't match `SUPER_ADMIN_EMAILS` exactly — fix `.env`, restart the dev
   server (Ctrl+C, `npm run dev`), sign out and back in.
3. Click the client's name to open its detail page. Try each control:
   - Flip the **Hello Module** switch **on**. (The others say "coming soon" —
     they're the named-but-empty slots from the strategy doc.)
   - Add a **note** ("met at the farm show, wants books cleaned up").
   - Change the **status** dropdown to `active`.
4. Check **/admin/audit** — every one of those actions is already in the
   audit log.

### 3.4 See a module render for the client

1. Go back to **/dashboard** — **Hello Module** now appears in the sidebar.
   That's the module registry doing its job: admin toggles, client sees.
2. Open it and add a couple of notes. These rows are stored with the
   tenant's ID under row-level security.

### 3.5 Prove tenant isolation by hand

1. Open a **private/incognito window** (so you get a fresh session).
2. Sign up with a *different* email address, create a second business
   (`Rival Roofing`).
3. Look around its dashboard: no Hello Module (not enabled for them), no
   notes, no trace of Test Flippers LLC.
4. Back in your normal window, /admin now lists both businesses — only you
   see across tenants.

### 3.6 Run the automated isolation test

Stop the dev server if you like (not required) and run:

```
npm run test:isolation
```

This creates two throwaway tenants directly in the database, then attempts
cross-tenant reads, writes, updates, and deletes — asserting Postgres blocks
every one. All tests green = the shell is certified. This is the test that
must pass before any deploy, forever.

---

## Part 4 — Stripe: billing (15 min, OPTIONAL — do whenever)

Everything above works without Stripe. Add this when you want the
**Billing** page's subscribe button to actually work.

### 4.1 Account and secret key

1. Go to **https://stripe.com** → **Sign up**. You can explore without
   completing business verification — new accounts start in **test mode**
   (fake money, test cards).
2. Confirm you're in **test mode**: there's a toggle labeled *Test mode* in
   the top-right of the dashboard — it should be ON (orange).
3. Left sidebar → **Developers** → **API keys**2. Copy the **Secret key**
   (starts `sk_test_`) → `.env` as `STRIPE_SECRET_KEY`. (You don't need the
   publishable key — the app uses Stripe-hosted checkout.)

### 4.2 Create the five products

Repeat this five times (sidebar → **Product catalog** → **Add product**):

| Product name | Price | Billing type |
|---|---|---|
| Operations | e.g. $1,000.00 | **Recurring**, Monthly |
| Business Office | e.g. $3,500.00 | **Recurring**, Monthly |
| Onboarding | e.g. $2,500.00 | **One-off** |
| Extra hours — 5 hour block | e.g. $500.00 | **One-off** |
| Extra hours — 10 hour block | e.g. $900.00 | **One-off** |

(The amounts are yours to choose — they're just test mode numbers for now.
The hour blocks are the retainer top-ups clients buy from their Hours page.)

After saving each product, open it and find its **price** — it has an ID
like `price_1Abc...` (click the price row, or use the ⋯ menu → *Copy price
ID*). Paste each into the matching `.env` line:

```
STRIPE_PRICE_OPERATIONS=price_...      ← Operations monthly
STRIPE_PRICE_BUSINESS_OFFICE=price_... ← Business Office monthly
STRIPE_PRICE_ONBOARDING=price_...      ← Onboarding one-off
STRIPE_PRICE_HOURS_5=price_...         ← 5-hour block one-off
STRIPE_PRICE_HOURS_10=price_...        ← 10-hour block one-off
```

### 4.3 Try a test checkout

1. Restart the dev server (Ctrl+C, `npm run dev`) so it picks up the new
   `.env` values.
2. In the app: **/dashboard/billing** → pick a plan → **Subscribe**. You'll
   be sent to a Stripe-hosted payment page.
3. Pay with Stripe's test card: number **4242 4242 4242 4242**, any future
   expiry date, any 3-digit CVC, any name/ZIP.

### 4.4 Subscription status syncing (optional locally)

The app refreshes subscription status straight from Stripe whenever the
Billing page loads, so local checkouts show up as **active** on their own —
no extra tooling needed. In production, webhooks (Part 6) do this in
real time.

If you want true webhook delivery locally anyway, use the **Stripe CLI**:

1. Install: **https://docs.stripe.com/stripe-cli** (Windows: download the
   `.exe` zip, or `scoop install stripe` if you use Scoop).
2. Run `stripe login` (opens a browser to approve).
3. In a second terminal, leave this running while you test:
   ```
   stripe listen --forward-to localhost:3000/api/webhooks/stripe
   ```
4. It prints `whsec_...` — put that in `.env` as `STRIPE_WEBHOOK_SECRET`
   and restart the dev server.
5. Redo a checkout — the subscription badge in /admin flips to **active**.

If you skip 4.4, checkouts still succeed in Stripe; the status shown inside
the app just won't update until webhooks exist (which you'll get for free
once deployed).

---

## Part 4.5 — Anthropic: the Discovery copilot (5 min)

The **Discovery** tool in your admin cockpit (`/admin/audits`) uses Claude to
help you analyze prospects and generate audit reports. It needs its own API
key:

1. Go to **https://console.anthropic.com** and sign up (or sign in).
2. You may need to add billing (Settings → Billing) — API usage is
   pay-per-use. A full discovery engagement (conversation + report) typically
   costs a few dollars; there's no subscription.
3. Left sidebar → **API keys** → **Create key** → name it `superapp` → copy
   the key (starts `sk-ant-`). It's shown only once.
4. Paste it into `.env` as `ANTHROPIC_API_KEY` and restart the dev server.
5. If deployed: also add `ANTHROPIC_API_KEY` to the Vercel environment
   variables and redeploy.

Everything else in the app works without this key — only the Discovery
copilot needs it.

## Part 4.6 — Banking: encryption key + Plaid (accounting module)

The accounting module's Banking tool needs two more things in `.env`:

1. **`APP_ENCRYPTION_KEY`** — encrypts Plaid access tokens at rest.
   Generate one (32 random bytes, base64):
   ```
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```
   Paste the output as `APP_ENCRYPTION_KEY=...`. Treat it like a password —
   if it's lost, connected banks must simply be reconnected (no data loss).

2. **Plaid** (live bank connections; CSV import works without it):
   - Sign up at **https://dashboard.plaid.com** (free).
   - Copy the **client_id** and the **Sandbox secret** from the keys page:
     ```
     PLAID_CLIENT_ID=...
     PLAID_SECRET=...
     PLAID_ENV=sandbox
     ```
   - Sandbox connects to fake test banks (username `user_good`, password
     `pass_good`) — perfect for trying the flow end to end.
   - **For real banks**: apply for Production access in the Plaid dashboard
     (approval takes days and has per-connection pricing — apply early),
     then switch `PLAID_SECRET` to the production secret and
     `PLAID_ENV=production`. Add all three to Vercel env when deploying.

3. **Vercel Blob** (receipt/bill storage for the Receipts tool):
   - In the Vercel dashboard -> your project -> **Storage** -> **Create
     Database** -> **Blob**. Set access to **Private**.
   - Copy the store's read-write token:
     ```
     BLOB_READ_WRITE_TOKEN=vercel_blob_rw_...
     ```
   - Works locally too - the token is all the SDK needs.

4. **Resend inbound email** (email-in for the Receipts tool; uploads work
   without it). DNS propagation can take 24-48h - start early:
   - Sign up at **https://resend.com** -> **Domains** -> add a *receiving*
     domain (e.g. `in.yourdomain.com`) -> add the MX record it shows you at
     your DNS host and wait for it to verify.
   - **Webhooks** -> add endpoint `https://<your-app>/api/inbound/resend`
     for the `email.received` event -> copy the signing secret.
   - **API Keys** -> create one (needed to download attachments).
     ```
     RESEND_API_KEY=re_...
     RESEND_INBOUND_WEBHOOK_SECRET=whsec_...
     INBOUND_EMAIL_DOMAIN=in.yourdomain.com
     ```
   - The webhook needs a public URL, so the live email flow only works on
     a deployment (a Vercel preview is fine). Everything else - uploads,
     extraction, attaching - works locally.

Restart the dev server after editing `.env`.

## Part 5 — Common problems

| Symptom | Cause → fix |
|---|---|
| Browser shows "Publishable key is invalid" or auth pages blank | Clerk keys missing/typo'd in `.env` → recopy both keys, restart dev server |
| Sign-up works but onboarding can't create a business | Organizations not enabled in Clerk → Part 2.3 |
| `/admin` bounces me to `/dashboard` | Signed-in email ≠ `SUPER_ADMIN_EMAILS` (must match exactly), or server not restarted after editing `.env` |
| `DATABASE_URL is not set` | `.env` misnamed (check it's not `.env.txt`) or wrong folder |
| `relation "tenants" does not exist` | Migrations never ran → `npm run db:migrate` |
| Module list empty in /admin | Seed never ran → `npm run db:seed` |
| First page load after idle is slow | Neon free tier wakes from suspend — normal, ~2s once |
| Changed `.env` but nothing changed | The dev server only reads `.env` at startup → Ctrl+C, `npm run dev` |

**Golden rule: every time you edit `.env`, restart the dev server.**

---

## Part 6 — Deploy to the internet (Vercel) — when you're ready

Not needed for local testing. Summary for later:

1. **https://vercel.com** → sign up with your GitHub account → **Import**
   the `superapp` repository. Framework auto-detects as Next.js.
2. In the import screen's **Environment Variables** section, add every
   variable from your `.env` (for real clients you'd eventually switch to
   Clerk/Stripe *live* keys, but test keys are fine to start). Use the
   `app_user` `DATABASE_URL` — the deployed app must never run as the
   database owner (Part 1.3). `DATABASE_URL_OWNER` is not needed on Vercel.
3. Deploy. You'll get a URL like `https://superapp-xyz.vercel.app`.
4. Set `NEXT_PUBLIC_APP_URL` to that URL (Vercel → Settings → Environment
   Variables) and redeploy.
5. Now wire the webhooks (they finally have a public URL to reach):
   - **Clerk** → Configure → Webhooks → **Add endpoint** →
     `https://<your-url>/api/webhooks/clerk` → subscribe to all `user`,
     `organization`, and `organizationMembership` events → copy the
     **Signing secret** into Vercel env as `CLERK_WEBHOOK_SECRET`.
   - **Stripe** → Developers → Webhooks → **Add endpoint** →
     `https://<your-url>/api/webhooks/stripe` → select events
     `checkout.session.completed` and the three
     `customer.subscription.*` events → copy the signing secret into
     Vercel env as `STRIPE_WEBHOOK_SECRET`. (Hour-block purchases ride the
     same `checkout.session.completed` event — no extra events needed.)
6. Redeploy once more, then run the Part 3 walkthrough against the live URL.

---

## Public health-check interview (`/health-check`)

The landing page links to a free AI "Business Health Check" — an anonymous
guided interview (~10 questions) that ends with an on-screen assessment and
drops the prospect + transcript into **Admin → Discovery** as a self-serve
lead (badge on the list). Setup:

- Set `INTERVIEW_IP_SALT` in `.env` and Vercel env — any long random string
  (e.g. `openssl rand -hex 32`). Visitor IPs are hashed with this salt for
  rate limiting; **raw IPs are never stored**. Without the salt the page
  fails closed and shows the at-capacity message.
- Uses the same `ANTHROPIC_API_KEY`. Built-in guardrails: 3 interviews per
  IP per day, 50 per day platform-wide (this ceiling is also the Claude
  budget cap), 12-exchange max per interview, 5s between messages.
- IP detection trusts the first `x-forwarded-for` hop — correct on Vercel;
  revisit if the app ever moves behind a different proxy.

---

## Outbound email (invoices, share links, notifications)

Everything the platform sends on a client's behalf goes through one spine, and
the point of it is **which address the mail comes from**.

You cannot simply put a client's address in the `From` header. Mail claiming to
be from `acmebuilders.com` but signed with our keys fails SPF/DKIM alignment,
DMARC rejects it, and it lands in spam or is dropped. Sending as someone
requires their DNS to say you may. So there are two honest identities:

- **Their domain** (once verified) — `invoices@mail.acmebuilders.com`. The
  owner adds DNS records at **Dashboard → Email**, which come straight from
  Resend's API; the app re-checks with Resend and never takes the tenant's word
  for it.
- **Platform fallback** (until then) — `"Acme Builders" <notifications@…>`
  with `Reply-To` pointing at the business, so it still reads as the client and
  replies still reach them.

Setup:

- `EMAIL_FROM_DOMAIN` — the platform's own sending domain, verified in Resend
  (e.g. `mail.yosherapp.com`). Without it, sending refuses with a pointed
  message.
- `EMAIL_DEV_REDIRECT` — **everywhere except real production, every recipient
  is rewritten to this address**, with the real one moved into the subject
  line. If it is not set, sending refuses entirely. This is what stops someone
  running the share-email flow against a seeded local database — or from a
  branch preview — and mailing a real client. Do not remove it.
  Set it on **Preview and Development** in Vercel, not Production.
  Note the trap it exists to avoid: Vercel builds previews with
  `NODE_ENV=production`, so the guard keys on `VERCEL_ENV` instead. A preview
  deployment is treated as non-production and redirects.
- `RESEND_EVENTS_WEBHOOK_SECRET` — add a webhook in Resend pointing at
  `https://<your-app>/api/email/events` for `email.delivered`, `email.bounced`
  and `email.complained`, and paste its signing secret here. Without it,
  bounces are invisible — and an unnoticed bounce is the most common way an
  email workflow dies silently.
- Guardrails: 100 messages per tenant per hour, 2000 platform-wide per day
  (this ceiling is also the provider bill's ceiling), and an idempotency key
  per message so a double-click or a retry cannot send twice.
- A **subdomain** (`mail.acme.com`) is strongly preferred over the root domain:
  it keeps this traffic's sending reputation separate from the owner's everyday
  email, so a bad send never affects their normal mail.

### Hosted mailboxes (Migadu)

Separate from everything above. The sending setup decides what *leaves*; this
decides what *arrives* — real mailboxes on a client's own domain, reachable
over IMAP from a phone or Outlook.

- `MIGADU_ACCOUNT_EMAIL` — the Migadu account's login address.
- `MIGADU_API_KEY` — generate at **Migadu → My Account → API Keys**. Used as
  HTTP Basic auth against `https://api.migadu.com/v1`. Without both, every
  provider call returns "isn't configured yet" and the UI degrades to a
  readable message rather than a stack trace — nothing provisions.

  **Set these on Production only.** Not Preview, not Development. Vercel env
  var changes only apply to new deployments, so redeploy after adding them.

### Reading mail (the inbox)

- **No new key.** OAuth tokens in `mail_accounts` are encrypted with the
  existing `APP_ENCRYPTION_KEY` through `src/lib/crypto.ts` — the same
  AES-256-GCM that has protected Plaid access tokens since the banking module
  shipped. A second key was considered and rejected: both would live in the
  same environment on the same server, reachable by the same compromise, so it
  would be two things to rotate and no additional protection.

  **The key must never be stored in the database it protects.** An access token
  reads someone's mail until it expires and a refresh token mints more
  indefinitely, which makes these the most dangerous values on the platform —
  worse than a password hash, which cannot be replayed. Keeping the key in the
  environment is what makes a Postgres dump, a leaked backup or an over-broad
  RLS policy yield ciphertext instead of mailboxes, and it is why the
  `member_read` policy on `mail_accounts` is acceptable rather than alarming.

  Rotating it invalidates every stored mailbox connection; people reconnect and
  no mail is lost. It would also invalidate stored Plaid tokens — worth knowing
  before rotating.

- `STALWART_BASE_URL` — where the mail server lives, e.g.
  `https://mail.acme.com` or `http://localhost:8080` in development. Used for
  OpenID discovery and for the JMAP session endpoint.
- `STALWART_CLIENT_ID` / `STALWART_CLIENT_SECRET` — Yosher's OAuth client on
  that server. Register it at the server's `/auth/register` endpoint or in its
  admin UI, with the redirect URI **exactly**
  `<NEXT_PUBLIC_APP_URL>/api/email/oauth/callback`. A mismatched redirect URI
  produces one of the least helpful errors in the protocol.
- `STALWART_MAIL_HOSTNAME` — the server's public hostname, used to build the MX
  and SPF records the domain wizard shows.

Without these the inbox reports "isn't set up yet" and nothing connects.

**Endpoints are discovered, not hardcoded.** The flow reads
`/.well-known/openid-configuration`, which means no config drift between
environments — and it is the same shape Google and Microsoft need, so the
deferred connectors land in `src/lib/email/oauth/config.ts` rather than beside
the flow.

One live-server quirk worth knowing: **Stalwart builds every advertised URL
from its configured hostname, not the request's Host header.** Discovery
rebases them onto the URL actually reached, which is a no-op in production and
also what any reverse-proxy deployment needs.

- **Local development server**: `docker/stalwart/compose.yml` runs Stalwart on
  localhost with no DNS, no domain and no cost. `npm run jmap:probe` (read-only)
  dumps live JMAP responses; run it whenever a shape here is in doubt.

**What is blocked outside production**, and why each answer differs
(`src/lib/email/mailbox/guard.ts`):

- **MX cutover — refused, no escape hatch.** There is no legitimate reason to
  redirect a domain's mail from a branch deployment, and the mistake cannot be
  undone from inside the app.
- **Mailbox deletion — refused.** It destroys the correspondence inside the
  mailbox at the host. Nothing to divert, nothing to take back.
- **Mailbox creation — allowed, but the setup invitation is redirected** to
  `EMAIL_DEV_REDIRECT`, and refused outright if that is unset. Creating a
  mailbox is reversible; mailing a stranger a link to claim an address is not.
  Same variable as the send guard on purpose — one thing to configure.

This reuses `isLiveSendEnvironment()`, which keys on `VERCEL_ENV` rather than
`NODE_ENV` because Vercel builds previews with `NODE_ENV=production`. A preview
is treated as non-production and blocked.

Verify the connection before trusting the app with it:

```
npm run mailbox:probe -- yourdomain.com
```

Strictly read-only (every request is a GET), safe against a live domain. It
prints the raw shapes of `/records`, `/diagnostics` and `/mailboxes` so they can
be checked against the normalizers in `src/lib/email/mailbox/migadu.ts`, which
were written from the published docs rather than from live responses.

**The MX record is the dangerous one.** Pointing a domain's MX at the mail host
redirects everything that domain receives. Unlike a sending domain — which is
additive, because nothing worked there before — this is a takeover, and undoing
it means editing DNS at the registrar and waiting for it to spread. The app
therefore stages it (create → publish → check → activate), snapshots the
domain's existing MX at creation time as `mailbox_domains.previous_mx`, and
requires the owner to type the domain name to confirm. See
`docs/modules/email.md` for the full reasoning.

**Watch out when publishing records:** DNS panels list every record for a
domain in one flat list, so a subdomain's MX (for example `in.yosherapp.com`,
which carries the shipped documents email-in feature) sits right next to the
root. Migadu's instructions say to remove pre-existing MX records — they mean
on the host being configured (`@`), not on subdomains. Deleting a subdomain's
MX breaks inbound filing silently.

Two records where a duplicate is worse than none, because a second one makes
the check fail entirely rather than picking the stricter:

- **SPF** — only one `v=spf1` TXT per name. Adding a second sender means
  merging `include:` terms into the existing record, never adding another.
- **DMARC** — only one record at `_dmarc.<domain>`. Keep it at `p=none` while
  mail infrastructure is changing; tighten to `quarantine` and then `reject`
  only once every sender for the domain is verified, or your own mail starts
  landing in spam with no warning.
- Share links with a passcode **cannot** be emailed. A link and its passcode in
  one message is one factor, not two.

---

## Emailing files into a Documents folder

Any folder can be given its own forwarding address —
`docs-<token>@in.yosherapp.com` — from **Documents → Browse → folder menu →
Email files here**. A subcontractor or supplier emails attachments there and
they land in that folder, already filed. No login, and no change for them.

This uses the **inbound** domain (`INBOUND_EMAIL_DOMAIN`) that the receipts
inbox already needs, so it works without a paid sending plan.

Worth understanding before handing addresses out:

- An address is an **anonymous write surface**. Anyone who has it can put files
  in that folder. Addresses are therefore off by default and only an owner can
  create one.
- **Turning one off is immediate**, and switching it on again issues a
  *different* address — the old one stops working. That is the fix if an
  address ever leaks.
- **Owners-only folders cannot have one**, and if a folder is made owners-only
  later, delivery to its existing address stops.
- Guardrails: 100 emailed files per folder per hour, the same upload allowlist
  as manual uploads (re-checked against the real downloaded bytes), and
  signature logos and tracking pixels are filtered out by size and disposition.

---

## Document share links (`/s/...`)

The Documents module can hand out a link that lets a client, subcontractor or
inspector open a file or a job folder **without signing in**. Setup:

- Set `SHARE_SECRET` in `.env` and Vercel env — one long random string, at
  least 32 characters (e.g. `openssl rand -base64 48`). Three separate values
  are derived from it by label: the key that hashes share tokens, the key that
  hashes visitor IPs, and the key that signs passcode-unlock cookies. Without
  it, share links **fail closed** — creating one errors and every existing
  link answers "no longer available".
- Also uses the existing `APP_ENCRYPTION_KEY`. The token is stored twice: as
  a keyed hash for lookup, and encrypted so an owner can copy the URL again
  later. Neither key lives in the database, so a database-only compromise
  yields no working links.
- **Rotating `SHARE_SECRET` invalidates every outstanding link at once.** That
  is the emergency lever if a link is ever leaked at scale; for a single link,
  use "Turn off link" on Documents → Shared links.
- Built-in guardrails: links must expire (30 days max by default, per tenant),
  60 unknown-token guesses per IP per hour, 20 failed passcodes per IP per
  hour, a link locks after 10 wrong passcodes, 5GB per link per day of egress,
  500 active links per tenant.
- Owners-only folders and files **cannot** be shared externally at all. Move
  the file somewhere shared, or turn owners-only off, first.
- `src/app/robots.ts` disallows `/s/`. That is politeness, not protection —
  the real controls are the 256-bit token, the expiry, and `noindex`.

---

## Operational notes (read once, remember later)

- **Backups:** Neon has point-in-time restore on paid plans; on free tier,
  export periodically. Do one practice restore before you have real client
  data — a backup you've never restored is a hope, not a backup.
- **Key rotation:** every secret lives only in `.env` (local) and Vercel env
  (prod). If a key ever leaks, issue a new one in that provider's dashboard
  and update those two places.
- **MFA:** turn on multi-factor for your own accounts on Neon, Clerk,
  Stripe, GitHub, and Vercel. Your accounts ARE the platform.
- **Audit log:** `/admin/audit` records admin access, module toggles, and
  billing events from day one.
