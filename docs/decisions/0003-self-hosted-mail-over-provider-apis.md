# 0003 — Self-hosted Stalwart over a hosted mail provider

- **Date:** 2026-07-26
- **Status:** Accepted
- **Affects:** Email module (Layers 0–1)

## Context

Mail must come from the **client's own domain** — a client's customers should
never see a platform address. That ruled out sending as ourselves, and led to
Migadu for hosted mailboxes (shipped, PR #27).

The actual destination was always a mail *client* inside the platform: an inbox
the app can read, thread, search and link to invoices and documents. Reading a
mailbox over IMAP requires that mailbox's password — and provisioning had been
built, deliberately, so that **no such credential exists anywhere in this
system**. Migadu exposes no app passwords, no OAuth and no delegated access, so
the inbox was blocked by a property we had shipped on purpose.

## Decision

Self-host Stalwart as the mail server and talk to it over **JMAP** (RFC 8621).
Stalwart provides app passwords, API keys and a built-in OAuth 2.0 / OIDC
server, so a user authorizes the platform against their own mail server and we
store an encrypted **token** rather than a password.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| Stay on Migadu, read over IMAP | Requires storing the mailbox password — reverses the security property the provisioning design exists to guarantee. |
| Gmail / Microsoft 365 connectors | Client must already use them, and mail would not be under platform control. Fails the "client's own domain, our product" requirement. |
| Migadu for sending, another host for the inbox | Two mail systems, two provisioning paths, split MX authority. |
| Build an IMAP client | Threading, search, delta sync, MIME parsing and charset decoding all land on us. JMAP puts them on the server. |

## Consequences

- The no-stored-password property **survives** rather than being reversed —
  tokens are encrypted with the existing `APP_ENCRYPTION_KEY` (S8).
- We now operate a mail server: deliverability, DNS, MX cutovers, backups,
  patching. Real, ongoing operational cost.
- JMAP's `#ids` back-reference lets `Email/query` + `Email/get` complete in one
  round trip — verified against a live server, and the difference between this
  client and one as slow as the IMAP it replaced.
- Local development works fully in Docker (`docker/stalwart/compose.yml`) with
  no VPS, DNS, domain or spend. Only receiving internet mail needs a real host.
- Migadu work is not wasted — hosted mailboxes shipped and the sending path is
  unchanged.

## Notes

The lesson worth carrying: **evaluate a vendor against the destination, not
against the step in front of you.** Migadu was chosen on pricing, provisioning
API and protocol — never on "can the platform read the mailboxes?", which was
the goal from the first conversation.

A second finding, from probing a live server: Stalwart builds session URLs from
its *configured hostname*, not the request's `Host` header, so a spec-following
client can chase a name that does not resolve. Full detail in
[docs/modules/email.md](../modules/email.md).
