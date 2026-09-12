# 0048 — A phone holds a grant that may only tell, and it dies with the membership

- **Date:** 2026-09-12
- **Status:** Accepted
- **Affects:** `src/lib/device-grants/` (the second gate), `src/app/api/device/tell/`, `device_grants` + `device_grant_uses`, `src/lib/tell-sources/model.ts` (the cooldown key)

## Context

The founder asked for voice: *"Hey Yosher, move Lot Dexter 1 to paddock 5"*,
*"clock me in"*, **without opening the app**. The platform question underneath
it is narrower and older than speech — **can something write to a tenant's
data with no session behind it, and can that be made safe?**

Two of the three examples already worked, typed. ADR 0036 (`paste-targets`)
and ADR 0039 (`tell-sources`) built the intent layer: a pack declares the
actions it can be told, the model picks and fills one, a person confirms, and
the pack's own verb records it. `proposeTold` and `recordTold` take a plain
`TellCtx` — `{ tenantId, userId, role, today }` — and touch Clerk nowhere.
**The only Clerk-shaped thing in the whole path is `gate()` in
`tell-sources/actions.ts`.**

So the work was never a second pipeline. It was a second way in.

What has no answer yet is the credential. A Siri App Intent fires with the
phone locked and the app closed: no cookie, no Clerk session, no web view.
`schedule_feed_tokens` is the only precedent — the one unauthenticated route
that serves tenant data — and it only READS.

## Decision

**A phone holds a grant: a bearer token, bound to one person in one business,
that may only tell.** `POST /api/device/tell` presents it in an Authorization
header; `redeemGrant()` turns it into the same `TellCtx` a session would
produce; everything past that point is the path that already existed.

Five things make it safe, and each answers a specific way this goes wrong.

### It never gets owner

Clerk owns owner-vs-member and this path has no Clerk session to ask;
`memberships.role` only separates the outside accountant from everybody else.
Asking Clerk's API on every sentence would put a network hop on the hot path
for the privilege of granting MORE. So: least privilege. `roleForGrant()`
returns `staff` or `expert` and never `owner`, `withTenant` is handed that and
nothing else, and **an owner speaking to their phone gets what a staff member
gets.** Anything needing owner is simply not speakable. `expert` is carried
through rather than flattened, because expert is not a lesser staff — it is a
different member, read-only in the core modules, and promoting one here would
hand the outside accountant writes their own screens refuse them.

### It dies with the membership, not with the expiry

The founder's answer to *"would anybody go and revoke a departed worker's
phone?"* was **no**, so nothing here may depend on somebody remembering.

Expiry is 30 days, slid forward on every use. That covers the phone dropped in
the slurry pit and **it does not cover the person who left** — sliding expiry
rewards use, and somebody still talking to it every morning renews their own
credential forever.

What people DO do when somebody leaves is take them out of the workspace,
because that is how you stop them reading the books. So `redeemGrant()` INNER
JOINs `profiles` and `memberships`, both of which `removeMembership()` hard-
deletes on `organizationMembership.deleted`. **Revoking a phone is never a
separate act.** `tests/device-grants-redeem.test.ts` names that case and it is
the one test in the file that must never be deleted.

A missing membership therefore **refuses here, where `lookupTenantAndRole()`
degrades to `staff`.** That degrade is right for the web — a fresh
organisation whose webhook has not landed must not lock its own owner out —
and copying it here would be a hole in exactly the row whose absence is meant
to kill the credential.

### The model still never writes

ADR 0039's rule has not moved. Two calls: one proposes and returns a readback,
one records what a person said yes to. The new problem voice introduces is
that **ADR 0039's other rule — a choice resolves by label, never by nearest —
assumes a screen.** On a screen an unmatched word sits as a hint beside an
empty field and somebody taps it. In a pocket there is nothing to tap. So an
unresolved field parks the whole sentence and the readback says which word
matched nothing. A wrong write nobody witnessed is the worst thing this can
produce.

### The proposal is a signed blob, not a row

Between the two calls the cards live in the phone's hands, signed with a
purpose-separated key (`signProposal`, `src/lib/public-token.ts`), carrying a
five-minute expiry and the grant that made them. No proposals table, no sweep
to clean it, and no dependence on both calls reaching the same serverless
instance — which an in-process map would get silently wrong.

Five minutes because the failure it prevents is the surprising one: you say
*"move Dexter 1 to paddock 5"*, a gate needs shutting, and an hour later in
the truck "yes" means something else entirely. It also keeps "yes"
unambiguous — inside five minutes there is only ever one thing it could mean.

### The phone's clock is not believed, and its retries are recognised

`claimed_at` is user-settable and for a clock-in the difference is wages, so
it is clamped to ±15 minutes of the server's and both are stored. Inside the
tolerance the phone wins, and it must: a sentence queued in a barn with no
signal may not arrive for hours, and its real time is the one it was spoken
at.

`device_grant_uses` is unique on `(grant_id, idempotency_key)`, so a phone
retrying an offline queue does not punch the clock twice. **The row holds the
action slugs and never what the person said** — a sentence can name a customer
or a price, and this row long outlives the proposal (S9, the rule `audit_log`
follows).

## What this changed that was already there

**The tell cooldown is now keyed per person, not per tenant.** Behind a screen
the difference never showed: one person, one button, and the button disables
itself. A phone has no button, and five farmhands saying "clock me in" at
seven in the morning are five independent callers — a tenant-wide five-second
window would answer the first and refuse the other four, silently, from their
pockets. The comment always said it existed to stop "a double submit", which
is a per-person concern. `paste-targets` keeps the per-tenant key
deliberately: a paste is a desk activity behind a dialog that disables itself.

## Alternatives considered

- **A phone number people call or text.** Cheapest by a mile, no native work,
  works on a flip phone. Rejected by the founder: *"this has to be legit from
  day one."*
- **A custom "Hey Yosher" wake word on both platforms.** Not possible on iOS:
  Apple reserves the always-on audio coprocessor for Siri and there is no
  public API for a third-party hotword from a locked screen. Android can do
  it with a foreground service and a local model, and may later; the grant is
  the same either way, which is why this ADR is about the credential and not
  about the microphone.
- **Reuse the Clerk session via a long-lived refresh token.** The intent runs
  headless with no web view to refresh in, and it would carry the person's
  FULL authority — including owner — into a bearer token in a pocket.
- **Ask Clerk for the org role on every sentence.** A network hop on the hot
  path, for the privilege of granting more than least privilege wants to.
- **Store proposals in a table.** A third table, a TTL sweep, and rows holding
  what somebody said. The signature does the same job with none of it.
- **An owner-read policy on `device_grants`,** so an owner can see every phone
  pointed at their business. Genuinely wanted, and deliberately not in this
  slice: it needs a screen to put it on, and a policy is easier to loosen
  later than to tighten. Recorded as an open item in
  [identity-and-roles.md](../modules/identity-and-roles.md).

## Consequences

- Migrations `0319` (tables) and `0320` (RLS). `0319` is hand-reordered: a
  composite FK and the unique index it points at, born in one migration, must
  be emitted index-first. 0276 hit the same wall.
- The posture on both tables is `push_devices`' — your own rows in your own
  tenant — not an ordinary tenant table's, because a grant is a credential.
  `device_grants` has no DELETE policy (revoked, never removed) and
  `device_grant_uses` has neither UPDATE nor DELETE (append-only, like
  `audit_log`).
- `/dashboard/settings/phone` is the first page under `/dashboard/settings`
  that is NOT owner-only, and it is linked from the **Business** nav group
  rather than the owner-gated **Settings** one. A farmhand who cannot set
  their own phone up cannot use the feature at all.
- **Nothing native exists yet, and the endpoint is driveable with curl.** That
  ordering is the point: the security-weighted half is provable before a line
  of Swift is written.
- **A refusal is a 200.** A voice client that gets a non-2xx says "something
  went wrong" and discards the body, including the sentence explaining what to
  do instead. Non-2xx is kept for what the person cannot act on — a bad
  credential, a malformed body, too many sentences.
- The idempotency check is check-then-act, so two genuinely simultaneous
  duplicate requests from one phone could both record. The realistic retry —
  an offline outbox reconnecting seconds or hours later — is fully covered,
  and a phone retries sequentially. Written down rather than claimed away.
- `tell-sources` still has ONE filler, so what a phone can say today is
  livestock's four actions. "Clock me in" needs a `time` source, which is the
  next slice.
