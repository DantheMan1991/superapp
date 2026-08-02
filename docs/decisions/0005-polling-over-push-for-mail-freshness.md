# 0005 — Polling over push for mail freshness

- **Date:** 2026-08-02
- **Status:** Accepted
- **Affects:** Email module; `/api/cron/mail-sync`; anything that later wants
  real-time updates on Vercel

## Context

The mail server advertises `urn:ietf:params:jmap:websocket` with
`supportsPush: true`, and has done since the first probe (`jmap:probe`, Slice 0).
"Websocket push" has sat on the mail roadmap ever since, on the reasonable
assumption that an advertised capability is a feature waiting to be used.

It is not, on this platform, and the reason is structural rather than a Vercel
quirk.

**A socket needs a process that outlives a request.** A WebSocket is a TCP
connection held open for minutes or hours; something has to be alive the whole
time to hold it. A serverless function is spawned per request, runs, and is
killed — there is no process in between to own a connection, and the billing is
wall-clock, so one open socket per signed-in user is the wrong economics even
where the platform permits it.

**There are two connections, and they are usually conflated.** Browser ↔ our app,
where we would be the *server*; and our app ↔ Stalwart, where we would be the
*client* (RFC 8887). Both need something always-on, because listening is the
whole point. Neither is available in a request-scoped runtime.

**And push was never the bottleneck.** `MailPoller` runs at 45s focused, 120s
blurred, backs off to 90s when a mailbox is quiet, and — the part that matters —
**checks immediately when the tab regains focus**. Somebody reading their mail
already sees new messages within seconds of looking at the screen. Push would
improve the case where nobody is waiting.

What IS stale is everything that must happen with no tab open: the unread badge
on non-mail pages (`mail_accounts.inbox_unread`), snooze wake-ups, and scheduled
sends. All three ride `/api/cron/mail-sync`. **That is a cron cadence problem,
and no socket fixes it** — which is the observation that reordered the work.

## Decision

**Keep polling. Do not build a WebSocket or an EventSource listener.** Treat mail
freshness as a function of the cron schedule plus the existing poller, and buy
the cron cadence rather than engineering around it.

`vercel.json` asks for `*/10 * * * *`; Vercel's Hobby plan runs cron once a day.
The founder is moving to Pro (2026-08-02), which restores minute-level cron and
resolves the staleness this ADR is really about.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| **JMAP over WebSocket** (`urn:ietf:params:jmap:websocket`) | Needs an always-on process at both ends. No serverless runtime provides one, and holding a socket per user is billed by wall-clock time. |
| **JMAP EventSource / SSE** (`eventSourceUrl`, RFC 8620 §7.3) | Same problem wearing HTTP clothes. Our route would have to hold the connection to the browser *and* poll Stalwart behind it, so the duration limit still applies. Having the BROWSER connect straight to Stalwart's EventSource would mean handing it the mailbox token, which breaks the property that nothing above `oauth/accounts.ts` ever sees a credential. |
| **Web push via VAPID** (`webpush-vapid`, advertised) | **Not rejected — deferred.** It is the one shape that genuinely fits serverless, because Stalwart pushes to the browser's own push service and nobody holds a socket, us included. Deferred because it is a *notification* channel rather than a sync channel (it would tell the poller to wake, not replace it), and it costs a service worker, VAPID keys, a permission prompt, and does not work on iOS unless the app is installed to the home screen. Revisit when the notification itself is the feature. |
| **A daemon on the Hetzner box** | Would work — the box already exists and already runs the mail server — but it reintroduces a stateful component to deploy, monitor and restart, which is precisely what the current architecture avoids. Not justified by a 45-second improvement. |
| **Shorter poll intervals** | Trades server load and battery for a latency nobody is waiting on. The immediate-on-focus check already covers the case where somebody is looking. |

## Consequences

**What this buys.** No always-on component anywhere in the product. Nothing to
babysit, nothing to restart, no per-user connection cost, and the deployment
model stays uniformly serverless. The freshness problem becomes a line item on a
hosting plan rather than a subsystem.

**What it costs, honestly.**

- New mail can be up to ~45 seconds stale in an open, focused tab. That is
  invisible in practice and would not be worth engineering away.
- **Everything that must happen with no tab open is only as punctual as the
  cron.** Scheduled send is the sharpest case: a message queued for 09:00 goes
  out on whichever tick follows. On Pro that is minutes; it was a day on Hobby.
  This is the cost to keep an eye on, because it is the one a client would
  notice.
- The advertised capability stays unused, and somebody will find it again and
  ask. That is what this ADR is for.

## Notes

**The lesson worth keeping: an advertised capability is not a feature that fits
your architecture.** Every other capability this module found in a probe —
`vacationresponse`, `sieve`, `contacts`, multi-mailbox membership — turned out to
be cheaper than expected, and that built a habit of treating the capability list
as a menu. This one is the counterexample: the protocol supports it perfectly
well and the *runtime* cannot.

`eventSourceUrl` is already parsed and host-rebased in
`src/lib/email/jmap/client.ts`, so the groundwork for a server-side listener
exists if this is ever revisited. Leaving it in place is deliberate.

**What would make us revisit:** the notification becoming the product (somebody
wanting a phone alert for a new enquiry, not a fresher inbox), which points at
web push rather than sockets. Or a move off serverless for other reasons, which
would make a listener nearly free. Neither is on the horizon.
