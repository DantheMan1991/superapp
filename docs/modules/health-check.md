# Health check (public AI interview)

> The lead funnel: an anonymous visitor has a real conversation with Claude
> about how their business runs, gets a written assessment, and — if they
> leave contact details — lands in the OPERATOR tenant's CRM as a business, a
> contact, a deal, a follow-up and a Discovery record (ADR 0041, ADR 0042).
> The public front of the same machinery `/admin/audits` uses internally.
> Status: live · Scope: `platform`

## Build log

Newest first. One entry per session/PR that touched this area. Every PR
that changes it MUST add an entry here (rule in AGENTS.md).

### 2026-09-09 — A lead lands as a lead (`claude/back-office-2-discovery-comes-home`, back-office slice 2)

- **Promotion no longer mints a workspace.** `promoteSession` used to write a
  prospect `tenants` row, a `subscriptions` row and an `audits` row under
  `withSystem` — a stranger modelled as a workspace. It now lands in the
  OPERATOR tenant (ADR 0041) as `staff` with no user, through the doors every
  member action uses — the enquiry's shape (ADR 0021): the business party,
  the person (matched by email when the operator already knows the inbox),
  the contact point, the discovery record (`audits`, now the operator's table
  with `party_id`), the leads slot with a proposition (ADR 0042 — the CRM
  opens the deal, joins the contact, leaves the note), a follow-up due today,
  an audit-log row. One transaction.
- **The session is claimed first.** Only an `awaiting_contact` row takes the
  contact and flips to `completed`, atomically, so a double submit finds the
  first claim and gets the same assessment back; a landing that fails hands
  the claim back so the visitor can retry; no operator named answers
  `unavailable` (the visitor sees the same generic message).
- **The operator is told** — its owners' addresses, Reply-To the visitor,
  `kind: health_check`, idempotent per audit and recipient. Closes the Open
  item below that said nobody was.
- **The assessment becomes the record's intake notes** once written, so the
  founder's Discovery copilot starts from what the visitor was told.
- `tests/interview.test.ts` rewritten for the landing; the promotion test
  obtains the operator rather than minting one.

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
| `audits` | The Discovery record created on promotion | The OPERATOR tenant's row since back-office slice 2 (`tenant_id` = operator, `party_id` = the business party); `superadmin_all` + `member_all` |
| `parties`, `party_contact_points`, `crm_*`, `work_items` (in the operator tenant) | What one landing writes: the business, the person, the email, the record, the deal, the affiliation, the note, the follow-up | Through the shared doors and the leads slot; nothing platform-level is written any more |
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
- **The claim is the idempotency anchor, and `audit_id` the proof.** A
  double-submitted contact form finds the session already `completed` and
  returns the existing assessment; `audit_id` is set once the landing has
  happened, and a claim whose landing failed is handed back.
- Only the session's own row is touched under `withSystem` — it is
  platform-level, an anonymous visitor's. Everything the lead becomes is
  written inside the operator tenant's context as `staff`, so the member
  policies bound what a stranger's form may write.

## Open items

- **No expiry sweep.** `expired` is a valid state but nothing walks the table
  to set it, and nothing deletes old transcripts.
- Assessment failure leaves `assessment` null with no retry path for the
  visitor.
- No measurement of the funnel: starts, completions and promotions are not
  counted anywhere.
