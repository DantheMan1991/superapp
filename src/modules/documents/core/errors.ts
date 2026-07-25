/**
 * The Documents module's own failure type.
 *
 * Deliberately NOT a re-export of the accounting LedgerError: the DMS must
 * work for a tenant that has never enabled accounting, so nothing under
 * src/modules/documents/ may import from src/modules/accounting/. Codes and
 * copy that overlap (STALE_VERSION, DOCUMENT_TRASHED, FORBIDDEN_EXPERT) are
 * kept word-for-word identical so the two modules read as one product.
 */
export type DocsErrorCode =
  | "FORBIDDEN"
  | "FORBIDDEN_EXPERT"
  | "STALE_VERSION"
  | "SETTINGS_MISSING"
  | "FOLDER_NOT_FOUND"
  | "FOLDER_NAME_INVALID"
  | "FOLDER_NAME_TAKEN"
  | "FOLDER_DEPTH"
  | "FOLDER_CYCLE"
  | "FOLDER_NOT_EMPTY"
  | "DOCUMENT_NOT_FOUND"
  | "DOCUMENT_TRASHED"
  | "DOCUMENT_HAS_LINKS"
  | "DOCUMENT_UPLOAD_INVALID"
  | "DOCUMENT_NOT_VERSIONABLE"
  | "VERSION_NOT_FOUND"
  | "VERSION_ALREADY_CURRENT"
  | "TAG_NOT_FOUND"
  | "TAG_NAME_TAKEN"
  | "TAG_LIMIT"
  | "VIEW_NOT_FOUND"
  | "VIEW_NAME_TAKEN"
  | "SEARCH_QUERY_INVALID"
  | "SHARE_NOT_FOUND"
  | "SHARE_LIMIT"
  | "SHARE_TTL_TOO_LONG"
  | "SHARE_ROOT_RESTRICTED"
  | "SHARE_HAS_PASSCODE"
  | "SHARING_DISABLED";

export class DocsError extends Error {
  constructor(
    readonly code: DocsErrorCode,
    message: string,
    readonly meta?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "DocsError";
  }
}

/**
 * Note what is NOT in here: there is no FOLDER_RESTRICTED or
 * DOCUMENT_RESTRICTED. When RLS hides a row because the caller is staff and
 * the folder is owners-only, the application genuinely cannot tell "restricted"
 * from "does not exist" — and the non-leaking answer is the only one available.
 * Restricted things return NOT_FOUND, on purpose.
 */
const FRIENDLY: Record<DocsErrorCode, string> = {
  FORBIDDEN: "Only the business owner can do that.",
  FORBIDDEN_EXPERT:
    "Accountant access is read-only — reviews, sign-offs and exports only.",
  STALE_VERSION: "This changed since you opened it — reload and try again.",
  SETTINGS_MISSING:
    "Documents is not fully set up for this business. Toggle the module off and on again.",
  FOLDER_NOT_FOUND: "That folder no longer exists.",
  FOLDER_NAME_INVALID:
    "That folder name can't be used — no slashes, and 120 characters at most.",
  FOLDER_NAME_TAKEN: "A folder with that name is already here.",
  FOLDER_DEPTH: "Folders can be nested ten levels deep.",
  FOLDER_CYCLE: "A folder can't be moved inside itself.",
  FOLDER_NOT_EMPTY:
    "That folder still has things in it — move or trash them first.",
  DOCUMENT_NOT_FOUND: "That file no longer exists.",
  DOCUMENT_TRASHED: "That file is in the trash — restore it first.",
  DOCUMENT_HAS_LINKS:
    "Detach this file from its transactions before trashing it.",
  DOCUMENT_UPLOAD_INVALID:
    "That file type or size isn't supported — see the list of accepted types.",
  DOCUMENT_NOT_VERSIONABLE:
    "This file belongs to Receipts, so its versions are managed there — transactions point at these exact bytes.",
  VERSION_NOT_FOUND: "That version no longer exists.",
  VERSION_ALREADY_CURRENT: "That's already the current version.",
  TAG_NOT_FOUND: "That tag no longer exists.",
  TAG_NAME_TAKEN: "A tag with that name already exists.",
  TAG_LIMIT: "That's the maximum number of tags.",
  VIEW_NOT_FOUND: "That saved view no longer exists.",
  VIEW_NAME_TAKEN: "You already have a saved view with that name.",
  SEARCH_QUERY_INVALID: "That search couldn't be read — try simpler terms.",
  SHARE_NOT_FOUND: "That link no longer exists.",
  SHARE_LIMIT: "That's the maximum number of active links.",
  SHARE_TTL_TOO_LONG: "That's longer than this business allows a link to live.",
  SHARE_ROOT_RESTRICTED:
    "Owners-only files and folders can't be shared outside the business. Move it somewhere shared first, or turn off owners-only.",
  SHARE_HAS_PASSCODE:
    "This link has a passcode, so it can't be emailed — send the passcode separately, by phone or text.",
  SHARING_DISABLED: "Sharing is switched off for this business.",
};

export function friendlyMessage(err: unknown): string {
  if (err instanceof DocsError) return FRIENDLY[err.code];
  return "Something went wrong. Please try again.";
}
