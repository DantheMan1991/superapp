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

### 4.2 Create the three products

Repeat this three times (sidebar → **Product catalog** → **Add product**):

| Product name | Price | Billing type |
|---|---|---|
| Operations | e.g. $1,000.00 | **Recurring**, Monthly |
| Business Office | e.g. $3,500.00 | **Recurring**, Monthly |
| Onboarding | e.g. $2,500.00 | **One-off** |

(The amounts are yours to choose — they're just test mode numbers for now.)

After saving each product, open it and find its **price** — it has an ID
like `price_1Abc...` (click the price row, or use the ⋯ menu → *Copy price
ID*). Paste each into the matching `.env` line:

```
STRIPE_PRICE_OPERATIONS=price_...      ← Operations monthly
STRIPE_PRICE_BUSINESS_OFFICE=price_... ← Business Office monthly
STRIPE_PRICE_ONBOARDING=price_...      ← Onboarding one-off
```

### 4.3 Try a test checkout

1. Restart the dev server (Ctrl+C, `npm run dev`) so it picks up the new
   `.env` values.
2. In the app: **/dashboard/billing** → pick a plan → **Subscribe**. You'll
   be sent to a Stripe-hosted payment page.
3. Pay with Stripe's test card: number **4242 4242 4242 4242**, any future
   expiry date, any 3-digit CVC, any name/ZIP.

### 4.4 Subscription status syncing (webhook — needs one extra tool)

After a test payment, the *client's subscription status in the app* updates
via webhook. Locally that requires the **Stripe CLI**:

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
     Vercel env as `STRIPE_WEBHOOK_SECRET`.
6. Redeploy once more, then run the Part 3 walkthrough against the live URL.

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
