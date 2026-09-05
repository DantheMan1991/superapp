# 0020 — A connected domain is records only; a purchased one is held for the client

- **Date:** 2026-09-04
- **Status:** Accepted (connecting built 2026-09-04; purchasing designed, not built)
- **Affects:** Marketing (`site_domains`, the proxy, the public routes), the
  mail module's domain wizards by intent, `docs/security.md` trust boundaries
- **Builds on:** [0003](0003-self-hosted-mail-over-provider-apis.md),
  [0019](0019-a-website-is-pages-of-typed-sections.md)

## Context

A business with a website wants it at its own name. Two kinds of business
arrive: one that already owns a domain, whose registrar holds records the
business depends on (its mail above all), and one that has none and would
rather Yosher took care of it.

The mail module already asks owners to publish DNS records twice (a sending
subdomain, and an MX cutover for hosted mailboxes) and learned the rule
that shaped both: **sending is additive, receiving is a takeover**. Pointing
a name at a website is additive too — unless the way it is done moves the
domain's nameservers, which moves every record the business has.

The platform runs on Vercel, whose Domains API adds a hostname to a project,
reports how it resolves and whether ownership is proved, and issues the
certificate. Vercel also sells domains and hosts their DNS.

## Decision

**Connecting a domain the business owns:**

- **Records only, never nameservers.** The owner publishes one record that
  points the name at the site (a CNAME for a subdomain, an A record for an
  apex) and, when Vercel asks for proof, one TXT. Yosher never suggests a
  nameserver change for a domain that already has records.
- **Vercel is the authority on state.** A row is `active` only when Vercel
  reports the domain verified for the project and correctly configured;
  until then it is `pending` with the records to publish. Nothing is decided
  locally, and checking is a button, not a poller — the mail wizards' shape.
- **One trusted lookup, then tenant context.** `host → tenant` is a
  `withSystem` read of identifiers over `active` rows; the page then runs in
  that tenant's context as `staff`. The proxy stays database-free: every
  hostname that is not the platform's own becomes a path, and the page does
  the lookup or answers 404.
- **The connected domain is canonical.** Once one is live, every address of
  the site points search engines at it.
- **A hostname points at one site across the platform** (a unique index), and
  a site holds at most five.

**Buying a domain for a business (designed, not built):**

- **Yosher buys through Vercel's registrar API into its own account and holds
  the domain on the client's behalf.** That is the only way the platform can
  publish the mail records (MX to Stalwart, SES DKIM, SPF, DMARC) and the site
  records itself, which is the whole promise: a new business gets a domain, a
  mailbox and a website in one onboarding and never sees a DNS record.
- **The client owns the name in every sense that matters:** it is theirs on
  request, transferred out at cost within a documented time when they leave,
  and never resold, repointed or let lapse while they are a client. This is
  written into the terms before the first purchase, and the transfer runbook
  exists before the button does.
- **The site domain (`SITE_DOMAIN`, for free addresses) is a separate
  purchase**, on Vercel's nameservers with a wildcard, and is never
  `yosherapp.com`, whose zone carries the mail records ADR 0003 depends on.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| Nameservers to Vercel for a connected domain | Moves every record the business has, mail first. The failure that breaks businesses; the mail dossier's rule, kept. |
| Yosher hosting DNS for connected domains (import the zone, then take the nameservers) | The right end state for a PURCHASED domain, where the zone starts empty. For an existing one it is a migration existing clients must survive before seeing value, which ADR 0003's memory says never to sell. |
| A `domains` table shared with mail today | The mail wizards hold provider-specific state (Resend/SES record sets, an MX rollback snapshot) that a site domain has no use for. Unifying them before a purchased domain exists would be a refactor with one consumer. It comes with purchasing, when the platform publishes mail and site records for the same name. |
| The database in the proxy | A hostname lookup per request at the edge, on a runtime that promises nothing about module state, for a route the page can resolve itself. |
| Polling Vercel for verification | Every domain, forever, for a state the owner changes once at a registrar. A button beside the records, as the mail wizards have. |

## Consequences

- The proxy's `classifyHost` is the one place that decides whose request a
  hostname is; a Vercel preview host, the app host and the site domain's
  own labels are the platform's, everything else is a customer's.
- `VERCEL_API_TOKEN`, `VERCEL_PROJECT_ID` and (in a team) `VERCEL_TEAM_ID`
  are required for connecting; without them the screen says so and the free
  address carries on. The token's scope is this project's domains.
- Purchasing needs, before it is built: the terms, the transfer runbook, a
  billing decision (pass-through at cost or bundled), and the mail module's
  wizards learning to publish their records through Vercel DNS rather than
  asking the owner. That is the moment for the shared `domains` table.

## Notes

The registry-suffix limitation is known: `example.co.uk` reads as a
subdomain and is offered a CNAME, which a registrar refuses at an apex. The
owner connects `www.example.co.uk` instead, which is Vercel's own advice for
any apex, and the guide says so.
