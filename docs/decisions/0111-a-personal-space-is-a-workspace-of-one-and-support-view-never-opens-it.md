# 0111 — A personal space is a workspace of one, and support view never opens it

- **Date:** 2026-09-27
- **Status:** Accepted
- **Affects:** Tenancy (`tenants`), onboarding, the dashboard rail and switcher,
  support view (`auth.ts`, back-office slice 4), the module catalogue. First
  consumer: the fitness tool ([modules/fitness.md](../modules/fitness.md)).

## Context

The founder wants Yosher to hold a person's own life beside their business:
workouts first, then recipes and meal planning. It is also to be sold to
people who have no business on Yosher. Everything in the platform today
belongs to a tenant, a tenant is a Clerk organization, and the isolation
guarantee is RLS on `app.current_tenant` set by `withTenant()`. There is no
place for data that belongs to a person rather than a business.

Two further facts shape it. Workout, body and diet data is health data, and
the founder does not want the platform's own staff able to open it. And the
superadmin support view (back-office slice 4) exists precisely to let staff
see inside a client's workspace.

## Decision

**A personal space is a tenant of kind `personal`: a Clerk organization of
exactly one member, provisioned by us, one per person.** Its tools are
ordinary tenant-scoped modules of a `personal` category, switched on when it
is created, and never enabled on a business tenant. **Support view refuses a
personal tenant** at the action, on the admin page and inside
`resolveSupport`, which ends any session it finds on one.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| Data keyed to the person (`clerk_user_id`) with its own RLS context, following them across workspaces | A second tenancy model. Every invariant written as "every tenant-scoped query goes through `withTenant`" would need a sibling, every isolation test a second axis, and `withSystem` code a second way to be wrong. The benefit, data that follows the person between businesses, is exactly what a separate tenant already gives |
| Rows inside the person's business tenant, visible only to them | The diet would live in the employer's workspace, be deleted with a membership, be readable by `withSystem` code written for the business, and be open to the business's support view. A person with no business would have nowhere to put it |
| Clerk's own personal account (no organization) | No `orgId`, so `requireTenant()`, `withTenant()` and every policy have nothing to key on. It is the first alternative again, reached through Clerk |
| A personal space that support view can open with the person's consent | The founder chose never. Consent screens get clicked through, and a tool that is never opened by staff is a simpler promise to keep and to state |

## Consequences

- Nothing about RLS changes. A personal space inherits the whole
  certification suite by being a tenant, and a personal tool is built with the
  same seven steps as any module.
- `tenants` gains `kind` and the owner column, and three places learn to read
  `kind`: the rail, the module gate and support view.
- The webhook and our provisioning both create the row, so the race between
  them has to land one row of the right kind. The upsert must never write
  `kind` on update.
- The cost: a support request about a personal space cannot be looked at. The
  answer is screenshots from the person, or nothing.
- The cost: one Clerk organization per consumer. Clerk's limits and pricing
  on organizations become a cost of the consumer product.
- "Never" covers the product. `withSystem` code and the database owner can
  still read the rows, and the privacy wording has to say so honestly.

## Notes

What would make us revisit: a personal space shared by two people (a
household's meal plan), which a one-member cap forbids by design and which
needs its own decision rather than a raised cap. Or a support burden from
personal spaces heavy enough that a consented, time-boxed view earns its way
back.
