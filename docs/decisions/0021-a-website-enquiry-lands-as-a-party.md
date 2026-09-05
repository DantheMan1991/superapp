# 0021 — A website enquiry lands as a party, a follow-up and an email, written as staff

- **Date:** 2026-09-04
- **Status:** Accepted (built 2026-09-04, Marketing slice 4)
- **Affects:** Marketing (`site_enquiries`, the `form` section, the public
  routes), the shared party doors (`src/lib/parties`), Work's shared verbs
  (`src/lib/work/entity-work.ts`), CRM's `crm_party_details`, the outbound
  mail door, `docs/security.md` trust boundaries
- **Builds on:** [0019](0019-a-website-is-pages-of-typed-sections.md),
  [0014](0014-migrations-are-applied-before-the-merge.md)

## Context

A website that cannot take a message is a brochure. The point of building
the site inside the platform rather than beside it is that what a visitor
sends should land where the business already works: as a person it can
call, a thing to do today, and an email in the inbox it actually reads.

That makes the form the first place a stranger's request WRITES into a
tenant. Every public surface before it either wrote nothing tenant-scoped
(the platform's contact form mails a fixed address), wrote platform-level
rows (the health check's `interview_sessions`), or carried a token that
named its tenant (inbound mail). The renderer (ADR 0019) reads a tenant's
published pages through one trusted lookup and then the ordinary member
policies; the form needs the same shape for a write.

Three questions had to be settled before the first row: what a message
becomes, who does the writing, and what happens when a feature the message
would touch is switched off.

## Decision

1. **A message becomes a party, a follow-up, a row of its own and an
   email.** The sender is matched by email against the tenant's parties and
   otherwise created as a person, with the email and phone as contact
   points, through the Layer 0 doors every module uses. A Work item titled
   "Reply to <name>", due today in the tenant's timezone, carries the whole
   message in its notes, so it reaches the morning digest. The
   `site_enquiries` row is the record of what was actually sent, kept
   whatever becomes of the rest. The business is emailed with Reply-To set
   to the sender, to the site's contact email if the details name one, else
   to every owner's profile address, never to anything the visitor typed.
2. **The public write runs as `staff` inside the tenant the site's slug
   resolves to.** `lookupSiteBySlug` is the one `withSystem` read, returns
   identifiers only, and only a `published` site takes messages. Everything
   after it is `withTenant(tenantId, …, { role: "staff" })` with no user: the
   database applies the member policies, so what a form may write is exactly
   what a staff member could, and nothing more. The insert policy on
   `site_enquiries` is therefore a MEMBER policy, and there is no update
   policy at all; an owner deletes.
3. **The guard is the owning feature.** CRM's `crm_party_details` row
   (`source = 'website'`) is written only when CRM is switched on for the
   tenant, and the follow-up is linked to the `crm/contact` only then;
   otherwise the follow-up is raised unlinked. Marketing being on is implied
   by the site being published. Work being off does not stop the follow-up
   (work.md's rule); the party is Layer 0 and needs no module at all.
4. **`party_id` and `work_item_id` on the enquiry are soft pointers.** A
   merged party or a deleted item must not take the message with it; the
   screen resolves both and says when one is gone.
5. **Caps are the platform's, plus one per site.** Per IP per hour and
   platform-wide per day in `public_access_attempts` (shared with the contact
   form through `src/lib/public-caps.ts`), and a per-site daily count on
   `site_enquiries` so a bot cannot fill one inbox and one work list. A
   honeypot answers success. A failed email never fails the message.

## Consequences

- The form is fixed: name, email, phone (optional) and a message. A
  business wanting its own fields is a later slice, and it would still land
  the same way; the shape of what a message becomes is settled here.
- CRM's automation (`record_created`) does not fire for a website record,
  because the write bypasses CRM's own `createRecord`. A rule that should
  fire on website leads is an open item in the CRM dossier.
- A site's contact email is read at submission time, so changing it in the
  site's details changes where the next message goes, with no republish.
- The dev-guard on outbound mail applies: outside production every copy
  goes to `EMAIL_DEV_REDIRECT`, so a local test of the form emails the
  developer, not the business.

## Alternatives rejected

- **Only email the business, store nothing.** That is the platform's own
  contact form, and it is right for the platform: there is no tenant to
  land in. For a tenant with a CRM and a work list it throws away the whole
  reason to host the site.
- **Write only when CRM is on.** A business without CRM still has
  customers and still has Work; refusing its messages until it buys CRM is
  the failure the shared-spine design exists to prevent.
- **A dedicated database role for public writes.** Tempting as a belt, but
  it would be a third role the policies had to name everywhere, for one
  write path that a member policy already bounds exactly. If a second
  public write path arrives with different needs, revisit.
