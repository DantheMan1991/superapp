/**
 * The Time module's error type. Same shape as `CrmError`, `DocsError` and
 * `LedgerError`, so a reader who knows one knows all four.
 *
 * `PartyError` from `@/lib/parties` is translated into one of these at the
 * module boundary rather than escaping to the client: the shared subsystem does
 * not know what a worker is called, and the client should never see the word
 * "party" — it is our word for a seam, not the user's word for a person.
 */
export type TimeErrorCode =
  | "WORKER_NOT_FOUND"
  | "WORKER_NAME_REQUIRED"
  | "WORKER_EXISTS_FOR_PARTY"
  | "WORKER_EXISTS_FOR_USER"
  | "WORKER_INACTIVE"
  | "ENTRY_NOT_FOUND"
  | "DURATION_UNREADABLE"
  | "DURATION_TOO_LONG"
  | "PAY_TYPE_INVALID"
  | "WORK_DATE_INVALID"
  | "WORK_DATE_IN_FUTURE"
  | "WEEK_START_INVALID"
  | "ROUNDING_INVALID"
  | "PAY_FREQUENCY_INVALID"
  | "PERIOD_ANCHOR_REQUIRED"
  | "RULESET_INVALID"
  | "PERIOD_LOCKED"
  | "PERIOD_NOT_LOCKED"
  | "SHEET_NOT_FOUND"
  | "SHEET_EXISTS"
  | "SHEET_ALREADY_APPROVED"
  | "AMEND_NOT_LOCKED"
  | "DIMENSION_INVALID"
  | "SPLIT_TOO_LARGE"
  | "PUNCH_NOT_FOUND"
  | "ALREADY_CLOCKED_IN"
  | "PUNCH_ALREADY_ENDED"
  | "PUNCH_ENDS_BEFORE_START"
  | "PUNCH_STARTS_IN_FUTURE"
  | "PUNCH_TOO_LONG"
  | "STALE_VERSION"
  | "FORBIDDEN"
  | "FORBIDDEN_EXPERT";

export class TimeError extends Error {
  constructor(
    readonly code: TimeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TimeError";
  }
}

/**
 * Client-safe wording. Never an id, never a tenant, never a database detail.
 *
 * The unknown case matters: `fail()` routes anything unrecognised through here,
 * so this is the last thing standing between a raw Postgres error and a user.
 */
export function friendlyMessage(err: unknown): string {
  if (!(err instanceof TimeError)) {
    return "Something went wrong. Please try again.";
  }
  switch (err.code) {
    case "WORKER_NOT_FOUND":
      return "That person could not be found.";
    case "WORKER_NAME_REQUIRED":
      return "Give the person a name.";
    case "WORKER_EXISTS_FOR_PARTY":
      return "That person can already have time logged for them.";
    case "WORKER_EXISTS_FOR_USER":
      return "Somebody else is already linked to that sign-in.";
    case "WORKER_INACTIVE":
      return "That person has left. Bring them back before logging time for them.";
    case "ENTRY_NOT_FOUND":
      return "That entry could not be found.";
    case "DURATION_UNREADABLE":
      return "How long? Try 1:30, 1.5 or 90m.";
    case "DURATION_TOO_LONG":
      return "One entry cannot be longer than a day. Split it across the days it covers.";
    case "PAY_TYPE_INVALID":
      return "Pick what kind of hours these are.";
    case "WORK_DATE_INVALID":
      return "Pick the day the work happened.";
    case "WORK_DATE_IN_FUTURE":
      return "That day has not happened yet.";
    case "WEEK_START_INVALID":
      return "Pick the day your week starts on.";
    case "ROUNDING_INVALID":
      return "Pick one of the rounding options.";
    case "PAY_FREQUENCY_INVALID":
      return "Pick how often people are paid.";
    case "PERIOD_ANCHOR_REQUIRED":
      return "Say which day a pay period starts on.";
    case "RULESET_INVALID":
      return "Pick which overtime rules you follow.";
    case "PERIOD_LOCKED":
      return "That pay period is locked. Add a correction in the open period instead.";
    case "PERIOD_NOT_LOCKED":
      return "That pay period is not locked.";
    case "SHEET_NOT_FOUND":
      return "That timesheet could not be found.";
    case "SHEET_EXISTS":
      return "This period has already been sent for approval.";
    case "SHEET_ALREADY_APPROVED":
      return "That timesheet has already been approved.";
    case "AMEND_NOT_LOCKED":
      return "That entry can still be edited — change it rather than correcting it.";
    case "DIMENSION_INVALID":
      return "Pick one thing per kind, and nothing that has been retired.";
    case "SPLIT_TOO_LARGE":
      return "A split has to leave some time on the original entry.";
    case "PUNCH_NOT_FOUND":
      return "That clock could not be found.";
    case "ALREADY_CLOCKED_IN":
      return "They are already clocked in.";
    case "PUNCH_ALREADY_ENDED":
      return "That clock has already stopped. Reload and try again.";
    case "PUNCH_ENDS_BEFORE_START":
      return "A clock cannot stop before it started.";
    case "PUNCH_STARTS_IN_FUTURE":
      return "A clock cannot start later than now.";
    case "PUNCH_TOO_LONG":
      return "That clock has run for more than a day. Correct when it started, then stop it.";
    case "STALE_VERSION":
      return "This entry changed while you were editing it. Reload and try again.";
    case "FORBIDDEN":
      return "You do not have permission to do that.";
    case "FORBIDDEN_EXPERT":
      return "Accountant access to this module is read-only.";
  }
}

/**
 * The roles `requireTenant()` resolves. Inlined to keep this file import-free —
 * `@/lib/auth` is `server-only` and this module is imported by client
 * renderers. Same reasoning as `src/modules/crm/core/errors.ts`.
 */
export type TimeRole = "owner" | "staff" | "expert";

/**
 * **May this ROLE write time at all?**
 *
 * `expert` — the platform's own bookkeeper working inside a client workspace —
 * is read-only here, as in CRM, Documents, Scheduling and Work. They can see
 * every hour, which is most of why they are in the workspace; entering somebody
 * else's time is the business's own act.
 *
 * ONE PURE PREDICATE, CALLED BY BOTH SIDES. The permission sweep of 2026-09-04
 * fixed six screens that drew every control enabled and then refused the press,
 * every one of them because the rule lived only in the gate. The screens here
 * ask this same function.
 */
export function roleMayWrite(role: TimeRole): boolean {
  return role !== "expert";
}

/**
 * **May this role manage WHO the workers are?**
 *
 * Adding a person to the payroll-shaped list, linking them to a sign-in and
 * marking that they have left are owner decisions: the list of people whose
 * hours the business records is a different kind of fact from an afternoon's
 * work, and slice 5 hangs pay rates off exactly these rows.
 *
 * Logging an hour stays a `staff` chore — the person who did the work is
 * usually the person writing it down, and they are rarely the owner. That split
 * is the one `ps_time_entries` already lives by.
 */
export function roleMayManageWorkers(role: TimeRole): boolean {
  return role === "owner";
}

/**
 * **May this role APPROVE a timesheet, or lock a period?**
 *
 * Owners. Submitting is a `staff` chore — the person who did the work says it
 * is ready — but agreeing it, and deciding the hours stop moving, is the
 * decision somebody is paid on. Separating the two is the whole point of having
 * a submit step: a person who can both submit and approve their own hours has
 * an approval that certifies nothing.
 */
export function roleMayApprove(role: TimeRole): boolean {
  return role === "owner";
}
