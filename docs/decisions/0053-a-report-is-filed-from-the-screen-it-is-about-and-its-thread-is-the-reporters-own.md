# 0053 — A report is filed from the screen it is about, and its thread is the reporter's own

- **Date:** 2026-09-13
- **Status:** Accepted
- **Affects:** `src/db/schema/feedback.ts`, `src/lib/feedback/`, `src/components/app/report-button.tsx`, `src/app/dashboard/feedback/`, `src/app/admin/feedback/`, `drizzle/0321`–`0322`

## Context

Every screen in the product was shipped without anybody outside the building
pressing a button on it. The founder's own module review (the per-module pass
started 2026-09-06) is the only mechanism that has ever found a wrong label or
a dead control, and it is one person scrolling at 375px. Several modules —
Scheduling, Work — are live and **nobody has ever clicked them**.

Meanwhile the two channels a client actually has are a phone call to the
founder and nothing. Neither produces a record, neither survives the week, and
neither says which screen they were on.

Three constraints shaped what was built:

1. **The report has to be filed from where the problem is.** "Which screen?"
   asked an hour later gets "the animals one". The button already knows the
   route, the module, the viewport and whether it is the mobile app.
2. **It has to be a conversation, not a suggestion box.** The founder's ask was
   explicit: *"message the user back, ask more questions, work on the issue or
   feature and complete it."* A form that swallows a sentence and answers by
   email is a form people stop filling in.
3. **The reporter has to be able to read the answer**, which is what rules out
   the obvious home for it. [ADR 0041](0041-a-tenant-is-a-workspace-and-a-client-is-a-party-in-the-operator-tenant.md)
   put a CLIENT in the operator tenant's CRM, and a support conversation looks
   like it belongs there too — but the person who filed it has no account in
   the operator's workspace and never will.

## Decision

**A feedback report is an ordinary tenant-scoped row in the CLIENT's own
workspace, visible to the person who filed it and to nobody else in that
workspace; the operator answers it from `/admin/feedback` under `withSystem`,
the posture `/admin/audit` already has.**

The button sits **beside the "?" in `PageHeader`**, which is on every screen in
the product, and files the route, the module, the viewport and the shell
without asking.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| The thread lives in the operator tenant's CRM, as ADR 0041 would suggest | The reporter cannot read it. A conversation only one side can see is a suggestion box with extra tables. |
| Visible to the whole workspace | Cuts duplicate reports, and costs the reports worth having. The box says "tell us what is wrong" and people answer that honestly only when their employer is not reading it. It is also the **loosenable** direction: adding owners later is one clause, taking the workspace back out after somebody has typed a complaint about their boss is an apology. |
| A second floating button beside the microphone | ADR 0051 put the mic bottom right because that is where a thumb is, and that argument does not survive being used twice — two round buttons in one corner makes the important one a target to miss. |
| In the nav rail | The rail is thirteen rows at a tenant with a profile installed, and on a phone it is a drawer. ADR 0051 rejected the rail for the tell control on the same ground. |
| Email to support@ | No record, no status, no route, and no way to tell a client their thing shipped. |
| A third-party widget (Intercom and friends) | A script tag that reads every screen of a multi-tenant book-keeping product, plus a second account system for the client. The data model here is four hundred lines. |
| `status` as a `pgEnum` | documents.md paid for that twice: a new enum value needs its own migration file, alone. `status` is the column most likely to grow a seventh value. text + CHECK, with the values in a no-import vocabulary file. |

## Consequences

**What it buys.** A bug reported on a phone in a barn arrives with the route,
the module, the screen size and the app version attached, in a queue sorted by
whose move it is rather than by date. A client can be told their thing shipped,
by name, in the product. Yosher's own staff use the same button, because Yosher
is a tenant of its own platform — the operator's reports show up in the console
marked `(us)`.

**What it costs, honestly:**

- **An owner cannot see what their staff reported**, and will eventually ask
  to. That is a screen and a policy clause away, and it is deliberately not
  built yet — see the table above.
- **An internal note lives in the same table as the conversation.** One clause
  in one policy (`internal = false`) separates a private "this is the same bug
  as Hilltop's" from the client reading it. It is guarded three ways — the
  policy, a CHECK that refuses an internal message on the client's side, and an
  isolation test that writes one and asserts the reporter cannot see it — and
  the schema comment says in as many words that deleting that test makes the
  column a leak.
- **Nothing pushes.** The client learns of a reply from a dot on the button
  they filed from; the operator learns of a report from a count on the console
  nav. Both require somebody to open the product. The digest source and the
  outbound email are the next slice, not this one.
- **`status` is not protected by RLS.** A row-level policy cannot see which
  column changed, so a client's own UPDATE — which exists so they can mark a
  thread read — could set `status` if anything ever built one. The refusal
  lives in the server action, the isolation test says so out loud, and the
  arrangement is `tenants.labels`'.

## Notes

**The "(us)" case is the point, not a curiosity.** The operator tenant files
reports through the same button into the same table, and the console reads them
beside every client's. That is ADR 0041 working: Yosher is an ordinary tenant to
RLS, and nothing here special-cases it.

**Driving it found the bug the tests could not.** `hasUnreadReply` was
correct about two Dates and was never given two Dates: a correlated subquery
written as a raw `sql` fragment returns the driver's string, the comparison
went to NaN, and the predicate answered false for ever without throwing. The
pure test passed, the isolation suite passed, the build was green, and the
screen showed a dot on the button beside a row that said there was nothing to
read. Neither half was wrong on its own — only together. Worth recording as a
shape rather than a bug: **a derived boolean has to be tested against the rows
the database actually returns, not against the rows the types promise.**

**What would make us revisit this.** A client whose staff all report the same
bug five times, which is the cost of the own-rows-only policy showing up in
practice — the fix is a workspace-visible flag on the report, chosen by the
person filing it, rather than flipping the policy for everybody. Or a second
superadmin, at which point `operator_read_at` being shared between them stops
being the intended behaviour and starts being a race.
