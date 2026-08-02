# Health check (public AI interview)

> The lead funnel: an anonymous visitor has a real conversation with Claude
> about how their business runs, gets a written assessment, and — if they
> leave contact details — becomes a prospect tenant with a Discovery audit
> already attached for the superadmin to pick up. The public front of the
> same machinery `/admin/audits` uses internally.
> Status: live · Scope: `platform`

## Build log

Newest first. One entry per session/PR that touched this area. Every PR
that changes it MUST add an entry here (rule in AGENTS.md).

### 2026-07-28 — Folded into the public site (`4ba0de7`, PR #28)
- Moved under the `(marketing)` route group so it inherits the site header,
  nav and footer instead of standing alone.

### 2026-07-24 — Public AI discovery interview (`8b15459`, PR #7)
- `interview_sessions` (migration 0022, superadmin-only RLS) holds the
  conversation *before* it is a lead. The row id doubles as the bearer token
  the visitor's browser holds — an unguessable uuid, no cookie, no account.
- Interview turns and the final assessment run through `getClaude()` with
  separate token budgets (`INTERVIEW_TURN_MAX_TOKENS`, `ASSESSMENT_MAX_TOKENS`).
- Promotion (`promoteSession`): creates a prospect `tenants` row with
  `clerk_org_id = null`, writes an `audits` row from the transcript, and
  stamps `audit_id` back on the session — all in one `withSystem`
  transaction.
- Abuse controls, all server-enforced: per-IP daily cap, platform-wide daily
  cap, per-session exchange cap, and a per-session turn cooldown.

## Data model

| Table | Purpose | Notes (RLS, invariants, FKs) |
| --- | --- | --- |
| `interview_sessions` | The anonymous conversation, its state and the generated assessment | Superadmin-only RLS (0022). `state` CHECK: `active` / `awaiting_contact` / `completed` / `expired`. Partial unique index on `audit_id` where not null = the double-submit anchor. Never stores a raw IP |
| `audits` | The Discovery record created on promotion | Platform-level, superadmin-only RLS |
| `tenants` | Prospect row, `clerk_org_id = null` until they actually sign up | Slug uniqueness resolved by `uniqueTenantSlug` |
| `public_access_attempts` | Rate-limit ledger shared with the contact form | Counted inside the insert transaction |

## Key files & seams

- `src/app/(marketing)/health-check/` — `page.tsx`, `health-check-chat.tsx`,
  `actions.ts` (the public server actions)
- `src/lib/interview.ts` — session lifecycle, caps, model calls, promotion
- `src/lib/interview-prompt.ts` — prompts and the token/length constants
- `src/lib/interview-validate.ts` — model-output validation
- `src/lib/discovery.ts` — the superadmin-side Discovery copilot prompts

## Decisions & gotchas

- **This is the platform's only unauthenticated mutation surface** besides
  signature-verified webhooks. There is deliberately no `requireX` — there is
  no session to require. The defences are the caps, the unguessable uuid, Zod
  at every boundary, and no validity oracles.
- **No validity oracles:** a missing session, an expired one and someone
  else's uuid all answer with the same generic message. Distinguishing them
  would turn the endpoint into a session-id scanner.
- **Fail closed without `INTERVIEW_IP_SALT`.** No salt means no abuse keying
  at all, so the feature disables itself and says "at capacity" rather than
  running unprotected.
- **Raw IPs are never stored** — `ip_hash = sha256(SALT + ip)`. The salt is
  what stops the hash being a reversible lookup over the IPv4 space.
- **`audit_id` is the idempotency anchor.** A double-submitted contact form
  returns the existing promotion instead of creating a second prospect.
- Sessions are promoted under `withSystem` because a prospect has no tenant
  context yet — this is trusted sync code, one of the sanctioned uses.

## Open items

- **No expiry sweep.** `expired` is a valid state but nothing walks the table
  to set it, and nothing deletes old transcripts.
- **No notification on promotion** — a new prospect sits in `/admin/audits`
  until a superadmin happens to look.
- Assessment failure leaves `assessment` null with no retry path for the
  visitor.
- No measurement of the funnel: starts, completions and promotions are not
  counted anywhere.
