/**
 * The CRM module's error type. Same shape as `DocsError` and `LedgerError`, so
 * a reader who knows one knows all three.
 *
 * `PartyError` from `@/lib/parties` is translated into one of these at the
 * module boundary rather than escaping to the client: the shared subsystem does
 * not know what a CRM record is called, and the client should never see the
 * word "party" — it is our word for a seam, not the user's word for a customer.
 */
export type CrmErrorCode =
  | "RECORD_NOT_FOUND"
  | "NAME_REQUIRED"
  | "STALE_VERSION"
  | "AFFILIATION_NOT_FOUND"
  | "AFFILIATION_INVALID"
  | "AFFILIATION_DUPLICATE"
  | "FORBIDDEN"
  | "FORBIDDEN_EXPERT";

export class CrmError extends Error {
  constructor(
    readonly code: CrmErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CrmError";
  }
}

/**
 * Client-safe wording. Never an id, never a tenant, never a database detail.
 *
 * The unknown case matters: `fail()` routes anything unrecognised through here,
 * so this is the last thing standing between a raw Postgres error and a user.
 */
export function friendlyMessage(err: unknown): string {
  if (!(err instanceof CrmError)) {
    return "Something went wrong. Please try again.";
  }
  switch (err.code) {
    case "RECORD_NOT_FOUND":
      return "That record could not be found.";
    case "NAME_REQUIRED":
      return "A name is required.";
    case "STALE_VERSION":
      return "This record changed while you were editing it. Reload and try again.";
    case "AFFILIATION_NOT_FOUND":
      return "That connection could not be found.";
    case "AFFILIATION_INVALID":
      return "A person can only be connected to an organization.";
    case "AFFILIATION_DUPLICATE":
      return "That connection already exists.";
    case "FORBIDDEN":
      return "You do not have permission to do that.";
    case "FORBIDDEN_EXPERT":
      return "Accountant access to this module is read-only.";
  }
}
