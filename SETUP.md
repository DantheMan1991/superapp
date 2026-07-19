# SuperApp — Setup

One-time setup to go from cloned repo to a running platform. Budget ~30–45
minutes; all three services have free tiers that are fine for development.

## 1. Install and configure

```bash
npm install
copy .env.example .env
```

Fill `.env` as you complete the steps below. **Never commit `.env`.**

## 2. Neon (database)

1. Create a project at [neon.tech](https://neon.tech) (Postgres 16+).
2. Copy the **pooled connection string** into `DATABASE_URL`.
3. Create a **second branch** in Neon called `dev` and use its connection
   string locally — keep the primary branch for production. (Separate
   environments, separate data.)
4. Run migrations and seed the module registry:

```bash
npm run db:migrate
npm run db:seed
```

## 3. Clerk (auth)

1. Create an application at [clerk.com](https://clerk.com).
2. **Enable Organizations**: Configure → Organization Settings → Enable.
   This is what makes a client business a tenant — the app does not work
   without it.
3. Copy the publishable + secret keys into `.env`.
4. Add your own email to `SUPER_ADMIN_EMAILS` — that's what unlocks `/admin`.
5. Webhook (needed for org/user sync in production; local dev works without
   it because onboarding syncs idempotently):
   - Clerk dashboard → Webhooks → Add endpoint → `https://<your-domain>/api/webhooks/clerk`
   - Subscribe to: `user.*`, `organization.*`, `organizationMembership.*`
   - Copy the signing secret into `CLERK_WEBHOOK_SECRET`.
6. Recommended: Configure → Multi-factor → enable TOTP, and turn it on for
   your own (super admin) account.

## 4. Stripe (billing)

1. Create the products in the Stripe dashboard (test mode first):
   - **Operations** — recurring monthly (Tier 2)
   - **Business Office** — recurring monthly (Tier 3)
   - **Onboarding** — one-time
2. Copy each price ID (`price_…`) into the matching `STRIPE_PRICE_*` var.
3. Copy the secret key into `STRIPE_SECRET_KEY`.
4. Webhook: Developers → Webhooks → Add endpoint →
   `https://<your-domain>/api/webhooks/stripe`
   - Events: `checkout.session.completed`, `customer.subscription.created`,
     `customer.subscription.updated`, `customer.subscription.deleted`
   - Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.
   - Local dev: `stripe listen --forward-to localhost:3000/api/webhooks/stripe`
     and use the secret it prints.

## 5. Run it

```bash
npm run dev
```

- `/` — landing page
- `/sign-up` → `/onboarding` — self-serve client path (creates the org → tenant)
- `/admin` — your cockpit (requires your email in `SUPER_ADMIN_EMAILS`)
- `/dashboard` — what a client sees
- Enable the **Hello Module** for a tenant from `/admin/tenants/<id>` to see
  a module render end to end.

## 6. Certify the shell

```bash
npm run test:isolation
```

This is the two-tenants-can't-see-each-other test — the Phase 1 definition
of done. Run it against a dev/staging database, never production. Wire it
into CI so it gates every deploy.

## 7. Deploy (Vercel)

1. Push the repo to GitHub, import into Vercel.
2. Set every var from `.env.example` in Vercel project settings (use
   production keys and the primary Neon branch).
3. Point the Clerk and Stripe webhooks at the production domain.
4. After first deploy: create your account, confirm `/admin` loads, run
   through onboarding with a test org, and verify the webhooks show
   deliveries in both dashboards.

## Operational notes

- **Backups**: Neon has point-in-time restore; do a practice restore once so
  it's a procedure, not a hope.
- **Key rotation**: every secret lives only in `.env`/Vercel env — rotating
  means issuing a new key in the provider dashboard and updating one place.
- **Audit log**: `/admin/audit` records admin access, module toggles, and
  billing events from day one.
