# Runbook — moving Yosher to a production Clerk instance

> **Read before:** touching the Clerk dashboard for production, or running any
> `clerk:*` script. §1 is why; §2 is who does what; §3 is the order, and the
> order is the whole point.
> **Update when:** a step turns out to be wrong, or Clerk moves something in
> its dashboard.

## 1. Why (found 2026-09-05)

yosherapp.com signs people in against a Clerk **development** instance. The
live sign-in card carries Clerk's "Development mode" badge, the publishable key
is `pk_test_…`, and the Frontend API is `premium-reptile-72.clerk.accounts.dev`.
A development instance:

- caps the number of users;
- uses Clerk's shared OAuth credentials, so the Google consent screen is not
  Yosher's;
- carries sessions in URL tokens because its cookies are third-party — which
  works in a browser tab and is fragile inside an iOS webview, so the store
  wrapper cannot be built on it;
- shows that badge to every app reviewer.

**A production instance starts empty, and every id changes.** Users,
organizations and memberships do not move with the keys. This platform mirrors
those ids: `profiles.clerk_user_id`, `tenants.clerk_org_id`, and a
`*_clerk_user_id` column on roughly forty tables recording who created, owns
or changed a row. So the move is: recreate the people on the new instance,
then rewrite the mirror — and close the platform for the minutes in between,
because `/onboarding` would otherwise mint a duplicate tenant for an
organization the database has never heard of.

Scope on 2026-09-05: two users, two organizations (Hilltop Farm, Test), one
pending invitation. The procedure is the same at two hundred; only the
run time changes.

## 2. Who does what

| The founder, in dashboards | The scripts, from a laptop with the repo |
| --- | --- |
| Create the production instance; DNS; OAuth credentials; app name | `npm run clerk:export` — snapshot the development instance |
| Export the users CSV (password hashes) from the development instance | `npm run clerk:import` — recreate people and organizations, write the id mapping |
| Set the Vercel environment variables; redeploy twice | `npm run clerk:remap` — rewrite every id the database mirrors |
| Create the webhook endpoint on the production instance | |

Keys never travel through chat. `CLERK_TARGET_SECRET_KEY` goes in `.env.local`
on the laptop that runs the scripts and nowhere else; the Vercel values are
pasted into Vercel.

## 3. The order

### Step 0 — merge the PR that carries this runbook

The maintenance switch (`MAINTENANCE_MODE`, `src/lib/maintenance.ts`) has to
be live before the cutover starts, or there is nothing to close the site
with. It is inert until the variable is set. The `authorizedParties`
allowlist is inert until the publishable key is a `pk_live_` one. Nothing in
the PR needs a migration.

### Step 1 — founder: build the production instance (days before, no downtime)

1. Clerk dashboard → the instance switcher at the top (it says
   **Development**) → **Create production instance** → **Clone development
   settings**. SSO connections, integrations and paths do not clone; the rest
   does.
2. **Domains**: the primary domain is `yosherapp.com`. Clerk lists the DNS
   records it needs — a CNAME for the Frontend API (`clerk.yosherapp.com`),
   one for the account portal (`accounts.yosherapp.com`, harmless even though
   the app has its own sign-in pages), and the mail records it sends
   invitations and codes from (`clkmail.yosherapp.com` plus two DKIM CNAMEs).
   Add every record it lists, wherever yosherapp.com's DNS lives. Wait for each
   to verify, then **Deploy certificates**. Usually minutes; Clerk warns up to
   48 hours.
3. **SSO connections → Google → Use custom credentials.** Create an OAuth
   client in Google Cloud Console (type *Web application*; authorized
   redirect URI = the one Clerk shows, on `clerk.yosherapp.com`) and paste the
   client ID and secret. **Turn GitHub off** — it is a Clerk default nobody
   running a farm signs in with. Apple comes later with the iOS app; it needs a
   Services ID and key from the Apple developer account.
4. **Email, phone, username**: leave as cloned (email address + password).
   **Paths** did not clone either, and need nothing: the app pins sign-in,
   sign-up and after-sign-out in code (`<ClerkProvider>` in
   `src/app/layout.tsx`), because Clerk is deprecating the dashboard page and
   an unset production instance sends people to the hosted Account Portal.
5. **Organizations**: confirm *Enable organizations* is on in the production
   instance. It clones, but the app loops at onboarding without it — verify.
6. **Configure → Settings → Application name**: `Yosher`, not `SuperApp`. Do
   the development instance too while there.
7. **Do not create the webhook endpoint yet** — Step 5.
8. **API keys**: copy the `pk_live_…` and `sk_live_…` keys.
   - On the laptop: `CLERK_TARGET_SECRET_KEY=sk_live_…` in `.env.local`.
     Not `.env` (that stays on the development instance for local work).
   - In Vercel → Settings → Environment Variables, **Production only**:
     `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_…`, `CLERK_SECRET_KEY=sk_live_…`,
     `MAINTENANCE_MODE=1`. **Do not redeploy yet.** Preview and Development
     keep the `pk_test_` keys.
9. Switch back to the **development** instance → Configure → Settings →
   **Export all users** → save the CSV outside the repo. It carries password
   hashes; it is deleted in Step 3.

### Step 2 — scripts: export (read-only, any time after Step 1)

```bash
npm run clerk:export
```

Reads `.env.local` then `.env` — `CLERK_SECRET_KEY` there is the development instance — and writes
`clerk-migration/snapshot.json` (gitignored). Check the printout: the users,
the organizations, who is in which, the pending invitation.

### Step 3 — scripts: import into the production instance (no downtime)

Creating people on the production instance does not touch the live site,
which is still on the development one.

```bash
npm run clerk:import -- --dry-run --passwords C:/path/to/users.csv
```

Then, when the dry run reads right:

```bash
npm run clerk:import -- --passwords C:/path/to/users.csv
```

- Every user is created with `external_id` = their old id and the addresses
  marked verified, with the password hash carried when the CSV has one. A
  rerun finds them instead of doubling them.
- A Google or GitHub link does not move — Clerk cannot recreate consent. The
  first Google sign-in on the new instance links to the recreated account by
  its verified email.
- Organizations keep their name and slug and remember their old id in
  `public_metadata.migrated_from_org_id`; memberships keep their roles.
- Pending invitations are **not** re-sent unless `--with-invitations` is
  passed, because sending one emails the invitee. Re-invite from the Team
  page after the cutover instead.
- The result is `clerk-migration/mapping.json`: old id → new id. Keep it; it
  is the rollback.

Check the production instance in the dashboard: users, organizations,
members. Then delete the CSV.

### Step 4 — scripts: plan the rewrite (read-only against production)

```bash
npm run clerk:remap -- --dry-run
```

Expect every id-bearing column listed with a count and **0 unmapped**. An
unmapped id belongs to someone who was deleted from Clerk before the export;
their rows keep an id no instance resolves, which is harmless, and the real
run needs `--allow-unmapped` to proceed past them. Anything else unexpected —
stop here; nothing has been written.

### Step 5 — the cutover (about ten minutes; everyone is signed out)

Pick a quiet hour. Customer marketing sites stay up throughout; only the
platform's own hosts close.

1. **Founder**: Vercel → Deployments → **Redeploy** the current production
   deployment, so the variables from Step 1.8 apply. Wait for it to be live.
   yosherapp.com now shows *Back in a few minutes*.
2. **Scripts**:

   ```bash
   npm run clerk:remap
   ```

   One transaction. It ends with *Done. Verified: no old ids remain in the
   rewritten columns.* If it refuses, read why; nothing was written.
3. **Founder**: production instance → **Webhooks → Add endpoint** →
   `https://yosherapp.com/api/webhooks/clerk`, subscribed to `user.created`,
   `user.updated`, `organization.created`, `organization.updated`,
   `organization.deleted`, `organizationMembership.created`,
   `organizationMembership.updated`, `organizationMembership.deleted`. Copy
   its signing secret into Vercel Production as `CLERK_WEBHOOK_SECRET`.
4. **Founder**: Vercel → set `MAINTENANCE_MODE` to empty (or delete it) →
   **Redeploy**.
5. **Both**: sign in at yosherapp.com and check —
   - the card says *Sign in to Yosher* with no *Development mode* badge;
   - the existing password works (hash carried), or Google signs in and lands
     on the same account;
   - `/dashboard` opens the right business, `/dashboard/team` lists the
     members with their roles, `/dashboard/settings` loads;
   - `/admin` opens for the superadmin — `SUPER_ADMIN_EMAILS` is unchanged
     and is by address, not id;
   - a Vercel log line does not mention `authorized party`. If it does,
     `NEXT_PUBLIC_APP_URL` does not match the host in the browser; set it to
     `https://yosherapp.com`.

### Step 6 — afterwards

- Re-send the pending invitation from the Team page.
- Local development keeps the development instance: `.env` is unchanged, and
  the Neon dev branch mirrors the development ids, so **do not** run
  `clerk:remap -- --dev`.
- Keep `clerk-migration/mapping.json` until the development instance is
  retired. Never commit the folder.
- Record the date in `docs/modules/identity-and-roles.md`'s build log.

## 4. Rollback

- **Before Step 5**: nothing to undo. The production instance is unused;
  delete or ignore it.
- **During or after Step 5**: in Vercel put the `pk_test_` / `sk_test_` keys
  and the old `CLERK_WEBHOOK_SECRET` back, set `MAINTENANCE_MODE=1`, redeploy;
  run `npm run clerk:remap -- --reverse`; clear `MAINTENANCE_MODE`, redeploy.
  The development instance still has everyone.

## 5. Traps

- **Nobody signs in on the production keys before the remap is done.** That
  is what maintenance mode is for. A sign-in in that window reaches
  `/onboarding`, which creates a tenant for the unknown organization id — a
  duplicate of the real one, with an empty ledger.
- **Vercel variables apply on redeploy, never on save.** Every "set" above is
  followed by a redeploy for a reason.
- **The webhook endpoint is created after the import**, or the import's
  `user.created` / `organization.created` events queue up against the old
  signing secret and replay later. They would be idempotent and harmless, but
  confusing at exactly the wrong moment.
- **`authorizedParties` goes live with the `pk_live_` key.** It is derived
  from `NEXT_PUBLIC_APP_URL` (with its www twin) and the deployment's own
  Vercel hosts. A wrong app URL locks everyone out with a clear log line, and
  the fix is the variable, not code.
- **`--dev` remaps the dev branch, which is wrong for as long as laptops use
  the development instance.** The flag exists for symmetry with `db:migrate`
  and for the day the development instance is retired.
- **Organization slugs may be off on the production instance.** Clerk made
  them optional, and a fresh instance has them disabled. The import drops the
  slug and says so; nothing in the app reads Clerk's slug, because a tenant
  carries its own.
- **The password CSV is the only artefact that must not exist afterwards.**
  Outside the repo, deleted after Step 3.

## 6. Checklist

- [ ] PR merged; `MAINTENANCE_MODE` and `authorizedParties` live and inert
- [ ] Production instance created, cloned, domain `yosherapp.com`
- [ ] DNS records verified; certificates deployed
- [ ] Google custom credentials; GitHub off; app name `Yosher`
- [ ] Organizations enabled on the production instance
- [ ] Vercel Production: `pk_live_`, `sk_live_`, `MAINTENANCE_MODE=1` — not yet redeployed
- [ ] `clerk:export` printout matches expectations
- [ ] `clerk:import` done; production instance checked; CSV deleted
- [ ] `clerk:remap -- --dry-run`: 0 unmapped
- [ ] Redeploy → maintenance page up
- [ ] `clerk:remap` → verified
- [ ] Webhook endpoint created; `CLERK_WEBHOOK_SECRET` set
- [ ] `MAINTENANCE_MODE` cleared → redeploy
- [ ] Sign-in, dashboard, team, admin checked
- [ ] Invitation re-sent; build log updated
