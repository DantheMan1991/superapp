# Feedback — what a client says is wrong, and the conversation that answers it

> A button beside the "?" on every screen in the product. A client presses it,
> says what is broken or what is missing, and the report arrives carrying the
> screen, the module, the viewport and the shell it was filed from — none of
> which anybody had to type. The superadmin answers it from `/admin/feedback`,
> asks questions, moves it through a status the client can read, and closes it
> by saying so. The decision under it is
> [ADR 0053](../decisions/0053-a-report-is-filed-from-the-screen-it-is-about-and-its-thread-is-the-reporters-own.md).
> Status: `available` · Scope: `platform` <!-- keep Status on ONE line — /admin/docs parses it -->

## Build log

Newest first. One entry per session/PR that touched this area. Every PR that
changes it MUST add an entry here (rule in AGENTS.md).

### 2026-09-13 — Slice 1: it reaches you (`claude/feedback-1-it-reaches-you`)

**No migration.** Three emails, through `src/lib/email/send.ts` like everything
else, so the dev guard, the caps, the idempotency claim and the send log all
apply unchanged.

- **A new report and a client's reply reach US**; **our reply reaches THEM.**
  A status change on its own emails nobody — if it is worth telling them, it is
  worth typing, which is what the status picker beside the reply box is for.
- **An internal note emails nobody**, and the check is made twice: `notifyFeedback`
  returns before it reads anything, and `feedbackEmails` returns `[]` for one.
  Driven both ways in the running app — `internal: true` produced no send
  attempt at all in the server log, `internal: false` produced exactly one.
- **`sendEmail` gained `senderIdentity`** (`"tenant"` by default, so no existing
  caller changed). Feedback forces `"platform"`: answering a bug report for a
  farm whose own domain is verified would otherwise arrive from
  `notifications@thefarm.com` signed by us. The one-line decision is
  `senderChoice`, pure and tested in `tests/email.test.ts`.
- **Who at Yosher hears it**: the operator tenant's owners first (data, the
  route `notifyPlan` set for a health-check lead), `SUPER_ADMIN_EMAILS` as a
  fallback — because a database with no operator flagged would otherwise tell
  nobody that the product is broken, and that is the worst channel to let fail
  quietly.
- **Nothing may throw.** The record is committed before any of this runs; a
  provider that is down must not turn "your report was filed" into a red toast
  about a report that is filed. Proven locally, where `EMAIL_FROM_DOMAIN` is
  unset: every action returned 200 with `feedback email not sent
  (not_configured)` in the log, reason only, no address and no subject (S9).
- **Also fixed, found by driving**: the reply box's Send button sat under the
  floating microphone. Both guides corrected — they said there was no email.

### 2026-09-13 — Slice 0: the loop exists end to end (`claude/feedback-the-report-button`)

**The whole conversation, plain.** Two tables, a button on every screen, the
client's own list and thread, and the console that answers them. No
attachments, no outbound email, no work item yet — those are slices 1–3 below,
and none of them is worth building against a loop that does not close.

- **`feedback_reports` + `feedback_messages`** (migrations `0321`, RLS in
  `0322`), applied and `verify-rls` green on dev and prod before the PR. The
  generated migration was **hand-reordered**: drizzle-kit emitted the composite
  FK `(tenant_id, report_id)` ahead of the unique index on
  `feedback_reports (tenant_id, id)` that it references, which cannot apply on
  a fresh database. Same trap production's `0295` hit.
- **The posture is `push_devices`', not an ordinary tenant table's** —
  `app_current_tenant()` AND `app_current_user()`, so an OWNER cannot read
  their staff's report. ADR 0053 argues it: the box says "tell us what is
  wrong", and people answer that honestly only when their employer is not
  reading it. It also makes read state one timestamp per side rather than a
  table, because there is exactly one client reader.
- **The button is beside the "?" in `PageHeader`**, which is on 107 of the 116
  dashboard pages (the nine without it are redirects or delegate to a module
  renderer that has one). Not a second floating button: ADR 0051 put the
  microphone bottom right because that is where a thumb is, and two round
  buttons in one corner makes the important one a target to miss.
- **Everything the user did not type is captured**: route, query, module slug,
  viewport from the browser; shell and app version from the USER AGENT, server
  side, because a value the client supplies is a value the client can get
  wrong.
- **Twenty-two isolation cases**, including the one that matters most: an
  operator's internal note lives in the same table as the conversation, and the
  test writes one and asserts the reporter cannot see it — directly, or by
  asking for its id.
- Two guides.
- **DRIVEN, end to end, on Hilltop Farm (dev branch)** — file from the
  Accounting overview, answer from the console, note, status, and back to the
  client's copy. It found four things, all fixed in this slice and all listed
  under Decisions & gotchas: **a raw `sql` fragment handing back a STRING where
  the code compared Dates** (the one that mattered), the sheet stuck at three
  quarters width on a phone, `screenLabel` saying "accounting" to the client,
  and "somebody · them@example.com" on the console header.

## The slice order

| # | Slice | State |
| --- | --- | --- |
| 0 | The loop exists end to end — tables, button, client thread, console | **Built** |
| 1 | It reaches you — email both ways on a report and on a real reply | **Built** |
| 2 | Attachments — a screenshot from the phone's camera roll, own blob prefix and RLS | Planned |
| 3 | Raise as work — a console button that opens a work item in the operator tenant, linked back | Planned |

Slice 1 came first because slice 0 shipped a loop that only closed when
somebody opened the product: the client learned of a reply from a dot, and the
operator from a count on a nav row. Both now also arrive by email.

## Data model

| Table | Purpose | Notes (RLS, invariants, FKs) |
| --- | --- | --- |
| `feedback_reports` | One report: title, kind, status, where it was filed from, read state per side | Own rows in own tenant (`tenant_id` AND `clerk_user_id`). SELECT/INSERT/UPDATE only — **no DELETE policy**, because withdrawing a report is `declined`, said out loud. `closed_at` moves with `status` and never alone, so "closed" is one indexable predicate. FK to `tenants` ON DELETE CASCADE. |
| `feedback_messages` | One turn, including the FIRST — the opening description is a message, so the thread is homogeneous | Composite FK `(tenant_id, report_id)`, so a message cannot attach to a report in another tenant. Client SELECT requires `internal = false` AND an EXISTS on a report that is theirs; client INSERT additionally pins `side = 'client'`. **No UPDATE and no DELETE policy at all** — a conversation is not a thing either side may rewrite (`audit_log`'s posture). |

`kind`, `status`, `side` and `surface` are **text + CHECK, never `pgEnum`**: a
new enum value needs its own migration file, alone (documents.md paid for that
twice), and `status` is the column most likely to grow a seventh value. The
allowed values live in `src/lib/feedback/vocabulary.ts` — no imports, no
directive — and `tests/isolation/feedback.test.ts` reads every CHECK back out
of `pg_constraint` and compares, because the two cannot be generated from one
another.

## Key files & seams

- `src/lib/feedback/vocabulary.ts` — the words the columns may hold. Imports
  nothing, so the schema, the browser and the migration's CHECK can all agree.
- `src/lib/feedback/core.ts` — pure. Route → module, screen labels, the two
  vocabularies (client and operator), `needsOperator` / `hasUnreadReply`,
  `isSameOriginPath`, `formatWhen`.
- `src/lib/feedback/read.ts` — both sides. The client's reads run in the
  reporter's own transaction; **every console function says `withSystem` on its
  own comment** rather than relying on the reader knowing which half of the file
  they are in.
- `src/lib/feedback/actions.ts` — the CLIENT's writes. File, reply, mark read.
- `src/app/admin/feedback/actions.ts` — the OPERATOR's writes. Reply, note,
  triage, mark seen. **Separate file on purpose**: one file that could write
  both sides is one bug away from letting a client mark their own report `done`.
- `src/components/app/report-button.tsx` — the button, the sheet, and the
  `FeedbackProvider` the dashboard layout wraps its children in.
- `src/components/app/feedback-chips.tsx` — the two chips, shared by both
  surfaces so the words can only differ by audience.
- `/dashboard/feedback`, `/dashboard/feedback/[id]` — the client's copy.
- `/admin/feedback`, `/admin/feedback/[id]` — the console.

## Decisions & gotchas

- **The thread lives in the CLIENT's workspace, not the operator's.** ADR 0041
  put a client in the operator tenant's CRM and the obvious reading is that a
  support conversation belongs there too. It does not: the person who filed it
  has to be able to read the answer, and they have no account over there.
- **`internal` is the one dangerous column in the schema.** An operator's
  private note sits in a table the client reads, separated by one policy clause.
  Guarded three ways — the policy, a CHECK that refuses an internal message on
  the client's side, and the isolation case. The schema comment says in as many
  words that deleting that test makes the column a leak.
- **`status` is NOT protected by RLS, and cannot be.** A row-level policy
  cannot see which column changed, and the client needs an UPDATE to mark a
  thread read. So a client's transaction *can* write `status` — the refusal
  lives in the server action, which never takes one from the client, and the
  isolation suite asserts the update succeeds so nobody mistakes the database
  for the guard. Same arrangement as `tenants.labels`.
- **A status change writes nothing into the conversation.** The first version
  appended "status changed to planned" and it was wrong: between two people
  talking, that is noise wearing the clothes of an answer. The client sees the
  status as a chip on their own copy. If it is worth telling them, it is worth
  typing — which is what the status picker beside the reply box is for.
- **A closed report still takes a reply.** "It is still happening" is the most
  valuable sentence this box ever receives, and `needsOperator` puts that reply
  back at the top of the queue whatever the status says. A human decides what
  to do about the status; the code does not guess.
- **The console's list is relative time, the thread is absolute — in the
  CLIENT's timezone.** Every row in the list is a different business in a
  different zone, and a column of absolute times in mixed zones is unscannable.
  On the thread, "I did this at 8am" only lines up if both people read the clock
  of the person who was standing there.
- **The route is untrusted.** It is a string a browser handed us through a
  form. Rendered as a link only after `isSameOriginPath` agrees — a
  protocol-relative `//somewhere` would otherwise navigate off-site from a
  field the user filled in themselves.
- **A support view files nothing.** `requireTenant()` refuses a non-GET while a
  support session is live, and a server action is a POST, so nothing here
  checks for it — but the dashboard layout still passes `enabled={!ctx.support}`
  so a superadmin never sees a button that cannot work.
- **The dot costs one indexed count in the dashboard layout**, held to the bar
  `getMailBadge` set: one SELECT over rows the person already owns, on every
  page in the product.

### Slice 1's own decisions

- **`senderIdentity: "platform"` on every feedback email.** `sendEmail` picks
  the tenant's own verified domain when there is one, which is right for an
  invoice and wrong for us. Answering a bug report for a farm whose domain is
  verified would have arrived from `notifications@thefarm.com`, reading as the
  farm emailing itself about a bug in somebody else's software. The flag
  changes only the SENDER; caps, log and dev guard stay keyed on `tenantId`,
  because who pays for a send and who signs it are different questions.
- **A status change emails nobody.** Same reasoning as the thread: a machine
  line is not an answer. The status *is* quoted in the mail we send when a
  person actually writes, so "now marked Needs your answer" arrives attached to
  the question that caused it.
- **The client's copy is written for a person outside the building**: plain
  short sentences, no dashes standing in for a pause. `tests/feedback-notify.test.ts`
  asserts it — no em dash, and no line over 21 words — because this is the only
  mail in the module a client reads and it goes out under the founder's name.
- **The recipient is never taken from a form.** Ours come from `profiles` or
  from `SUPER_ADMIN_EMAILS`; theirs from `feedback_reports.reporter_email`,
  which was itself copied from `profiles` at filing time. Nothing typed into
  the box can redirect an email.
- **The mic covered the Send button.** ADR 0051 fixes the tell control
  bottom-right at z-40; the reply box is the last thing on the client's thread
  page and its Send is right-aligned, so scrolling to the bottom parked the
  button underneath it and every tap opened the tell sheet. `pb-24` on that
  page ends the content above the mic. **Any future screen whose primary action
  is both bottom-right and last needs the same** — there is no app-wide
  clearance, and this is the first page to need one.

### Found by driving it, 2026-09-13

- **A raw `sql` fragment carries no column type, and `sql<Date>` is a lie
  `tsc` believes.** `lastOperatorMessageAt` and `lastClientMessageAt` are
  correlated subqueries, so drizzle handed back the driver's raw
  `2026-09-13 10:27:00+00` STRING. `hasUnreadReply` compares `said >
  clientReadAt`; a string against a Date sends both through ToNumber, both are
  NaN, and the predicate returned **false for ever** — no throw, no warning.
  The client's row said "no new reply" while the dot on the button, counted in
  SQL, said there was one; only that disagreement gave it away, on screen.
  `needsOperator` had the identical hole, invisible because a `new` report
  short-circuits before reaching the date. Fixed with `.mapWith(column)`, which
  runs the value through the same decoder a plain `select` uses.
  `tests/feedback-db.test.ts` now asserts the TYPE of every derived value,
  because asserting a comparison between two NaNs proves nothing. **Any future
  raw aggregate in this file needs the same treatment.**
- **`data-[side=right]:w-3/4` on `SheetContent` outranks a plain `w-full`**, so
  the sheet rendered at three quarters on a phone and the override was silently
  dead. The data-variant form is required; `help-button.tsx` already used it.
  The report sheet goes FULL width on a phone and the help panel does not —
  that panel stays narrow so the reader can see the control the guide names,
  and nothing in this sheet refers to the page behind it.
- **`screenLabel` said "accounting" to the client.** The module's real display
  name lives in the feature registry, which `core.ts` may not import without
  dragging `src/modules/**` into a browser bundle, so the slug is prettied to
  sentence case instead — the rail's own convention ("Taking payments").
- **Two facts that read as a disagreement.** The console showed `Screen:
  Accounting` above `Module: accounting`. The `Module` row is gone; the slug is
  in `Path` in full.

## Open items

- **No real delivery has been observed.** `EMAIL_FROM_DOMAIN` lives in Vercel,
  not in the local env, so driving slice 1 proved the path runs and fails
  gracefully (`not_configured`) — not that a message arrives. The first report
  filed on production after the merge is the check, and the send log at
  `outbound_emails` (kind `feedback`) is where to look.
- **A reply still does not reach *What needs you*.** Deliberately out of slice 0
  on the founder's call, and the email covers the same ground more cheaply.
  Worth revisiting only if people start missing answers.
- **An owner cannot see what their staff reported.** ADR 0053 records why and
  what the fix looks like if it is ever wanted: a workspace-visible flag chosen
  by the person filing, not a loosened policy for everybody.
- **`operator_read_at` is shared between superadmins.** Intended today — what
  the console needs to know is whether ANYBODY has looked. It becomes a race
  the day there are two of them.
- **No de-duplication.** Five people reporting the same bug is five threads.
  The console can say so in a note; nothing links them.
- **The mobile app has not been tried.** The web was driven in a browser at
  desktop and at 375px, but no report has been filed from the Capacitor shell,
  so `surface = 'app'` and `app_version` are proven only by the user-agent
  parser's own tests.
