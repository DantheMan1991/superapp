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
  | "FIELD_NOT_FOUND"
  | "FIELD_KEY_TAKEN"
  | "FIELD_OPTIONS_REQUIRED"
  | "CUSTOM_VALUES_INVALID"
  | "PIPELINE_NOT_FOUND"
  | "PIPELINE_HAS_NO_OPEN_STAGE"
  | "STAGE_NOT_FOUND"
  | "STAGE_NOT_EMPTY"
  | "STAGE_WRONG_PIPELINE"
  | "DEAL_NOT_FOUND"
  | "DEAL_TITLE_REQUIRED"
  | "ACTIVITY_EMPTY"
  | "ACTIVITY_NOT_FOUND"
  | "TASK_NOT_FOUND"
  | "TASK_TITLE_REQUIRED"
  | "MERGE_SAME_RECORD"
  | "COLLABORATOR_INVALID"
  | "COLLABORATOR_NOT_FOUND"
  | "VIEW_NAME_REQUIRED"
  | "VIEW_NAME_TAKEN"
  | "VIEW_NOT_YOURS"
  | "FORBIDDEN"
  | "FORBIDDEN_EXPERT";

export class CrmError extends Error {
  constructor(
    readonly code: CrmErrorCode,
    message: string,
    /**
     * Per-field messages for `CUSTOM_VALUES_INVALID`, so the form can put each
     * one where it belongs instead of showing one toast for six problems.
     * Already client-safe: a label the tenant typed and a message this module
     * wrote, never a database detail.
     */
    readonly issues?: { fieldId: string; label: string; message: string }[],
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
    case "FIELD_NOT_FOUND":
      return "That field could not be found.";
    case "FIELD_KEY_TAKEN":
      return "A field with that name already exists.";
    case "FIELD_OPTIONS_REQUIRED":
      return "A choice field needs at least one option.";
    case "PIPELINE_NOT_FOUND":
      return "That pipeline could not be found.";
    case "PIPELINE_HAS_NO_OPEN_STAGE":
      return "This pipeline has no open stage to start a deal in. Add one first.";
    case "STAGE_NOT_FOUND":
      return "That stage could not be found.";
    case "STAGE_NOT_EMPTY":
      // Says what to do, not just what went wrong: the deals would otherwise
      // survive in a column nothing draws.
      return "Move the deals out of this stage before archiving it.";
    case "STAGE_WRONG_PIPELINE":
      return "That stage belongs to a different pipeline.";
    case "DEAL_NOT_FOUND":
      return "That deal could not be found.";
    case "DEAL_TITLE_REQUIRED":
      return "Give the deal a name.";
    case "ACTIVITY_EMPTY":
      return "Write something before saving.";
    case "ACTIVITY_NOT_FOUND":
      return "That entry could not be found.";
    case "TASK_NOT_FOUND":
      return "That follow-up could not be found.";
    case "TASK_TITLE_REQUIRED":
      return "Give the follow-up a name.";
    case "MERGE_SAME_RECORD":
      return "Choose two different records to merge.";
    case "COLLABORATOR_INVALID":
      return "Choose somebody to give access to.";
    case "COLLABORATOR_NOT_FOUND":
      // Says what is true rather than "not found": the row is gone, which is
      // what they wanted, and the screen was simply stale.
      return "That person no longer has access to this record.";
    case "VIEW_NAME_REQUIRED":
      return "Give the view a name.";
    case "VIEW_NAME_TAKEN":
      return "You already have a view with that name.";
    case "VIEW_NOT_YOURS":
      // Not "not found": they are looking at it in the picker, so saying it
      // does not exist would be the one answer they know to be false.
      return "Only the person who made a view can change it.";
    case "CUSTOM_VALUES_INVALID":
      // The per-field messages carry the detail; this is the summary line.
      return err.issues?.length
        ? `${err.issues.length} field${err.issues.length === 1 ? "" : "s"} need attention.`
        : "Some fields need attention.";
    case "FORBIDDEN":
      return "You do not have permission to do that.";
    case "FORBIDDEN_EXPERT":
      return "Accountant access to this module is read-only.";
  }
}
