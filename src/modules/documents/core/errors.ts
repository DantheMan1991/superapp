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
  | "DOCUMENT_ATTACHED"
  | "ATTACHMENT_EXISTS"
  | "ATTACHMENT_NOT_FOUND"
  | "ATTACHMENT_NOT_AN_IMAGE"
  | "ATTACHMENT_TARGET_INVALID"
  | "DOCUMENT_UPLOAD_INVALID"
  | "DOCUMENT_NOT_VERSIONABLE"
  | "VERSION_NOT_FOUND"
  | "VERSION_ALREADY_CURRENT"
  | "TAG_NOT_FOUND"
  | "TAG_NAME_TAKEN"
  | "TAG_NAME_INVALID"
  | "TAG_LIMIT"
  | "TEMPLATE_NOT_FOUND"
  | "TEMPLATE_NAME_TAKEN"
  | "TEMPLATE_NAME_INVALID"
  | "TEMPLATE_PUBLISHED"
  | "TEMPLATE_NO_DRAFT"
  | "TEMPLATE_BODY_EMPTY"
  | "TEMPLATE_ARCHIVED"
  | "TEMPLATE_NOT_PUBLISHED"
  | "GENERATION_MISSING_FIELDS"
  | "VIEW_NOT_FOUND"
  | "VIEW_NAME_TAKEN"
  | "VIEW_NAME_INVALID"
  | "VIEW_QUERY_EMPTY"
  | "VIEW_LIMIT"
  | "PREVIEW_UNSUPPORTED"
  | "PREVIEW_LEGACY_EXCEL"
  | "PREVIEW_TOO_LARGE"
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
  DOCUMENT_ATTACHED:
    "Remove this photo from the record it is on before trashing it.",
  ATTACHMENT_EXISTS: "That file is already attached here.",
  ATTACHMENT_NOT_FOUND: "That file isn't attached here.",
  // Said as a fact about the file rather than as a rule the person broke: a
  // PDF manual is a perfectly good attachment, it is just not a portrait.
  ATTACHMENT_NOT_AN_IMAGE:
    "Only a photo can be the picture — JPEG, PNG, WebP or GIF.",
  ATTACHMENT_TARGET_INVALID: "That isn't something a file can be attached to.",
  DOCUMENT_UPLOAD_INVALID:
    "That file type or size isn't supported — see the list of accepted types.",
  DOCUMENT_NOT_VERSIONABLE:
    "This file belongs to Receipts, so its versions are managed there — transactions point at these exact bytes.",
  VERSION_NOT_FOUND: "That version no longer exists.",
  VERSION_ALREADY_CURRENT: "That's already the current version.",
  TAG_NOT_FOUND: "That tag no longer exists.",
  TAG_NAME_TAKEN: "A tag with that name already exists.",
  TAG_NAME_INVALID:
    "That tag name can't be used — it needs at least one letter or number.",
  TAG_LIMIT: "That's the maximum number of tags.",
  TEMPLATE_NOT_FOUND: "That template no longer exists.",
  TEMPLATE_NAME_TAKEN: "A template with that name already exists.",
  TEMPLATE_NAME_INVALID: "Give the template a name.",
  TEMPLATE_PUBLISHED:
    "That version is published, so it can't be changed — your edits start a new draft.",
  TEMPLATE_NO_DRAFT: "There are no unpublished changes to publish.",
  TEMPLATE_BODY_EMPTY: "Write the template before publishing it.",
  TEMPLATE_ARCHIVED:
    "That template is archived — restore it before making documents from it.",
  TEMPLATE_NOT_PUBLISHED:
    "Publish this template before using it. Documents are only ever made from a published version.",
  GENERATION_MISSING_FIELDS: "Fill in the required fields first.",
  VIEW_NOT_FOUND: "That saved view no longer exists.",
  VIEW_NAME_TAKEN: "You already have a saved view with that name.",
  VIEW_NAME_INVALID: "Give the view a name.",
  VIEW_QUERY_EMPTY:
    "There's nothing to save yet — search for something or pick a tag first.",
  VIEW_LIMIT: "That's the maximum number of saved views.",
  PREVIEW_UNSUPPORTED: "There's no preview for this kind of file — download it to open it.",
  PREVIEW_LEGACY_EXCEL:
    "This is an older .xls file, which can't be previewed. Download it, then save it as .xlsx if you want a preview next time.",
  PREVIEW_TOO_LARGE:
    "This spreadsheet is too large to preview — download it to open it.",
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

/**
 * The roles `requireTenant()` resolves. Inlined to keep this file import-free —
 * `@/lib/auth` is `server-only` and this module is imported by client
 * renderers. Same reasoning as `src/lib/packs/authorize.ts`.
 */
export type DocsRole = "owner" | "staff" | "expert";

/**
 * **May this ROLE write to Documents at all?**
 *
 * `expert` — the platform's own bookkeeper working inside a client workspace —
 * is read-only here, as it is in CRM, Scheduling and Work. This module has no
 * read-only-safe write, so there is nothing to opt into. `gate()` has said so
 * since the module shipped; no SCREEN asked until 2026-09-04, which is why an
 * accountant got Upload, New folder, every row menu and the whole drag-and-drop
 * surface, and a refusal from each.
 *
 * **A PACK'S PHOTO IS STILL A DOCUMENT, AND THIS IS STILL THE RULE.**
 * `assets` and `livestock` attach photos through `attachments.ts`, and their own
 * `allowsWrite(role, "member")` clears the accountant deliberately
 * (`src/lib/packs/authorize.ts`). That is the PACK's rule about a pack chore;
 * this is the DMS's rule about a row in `documents`, and both have to pass. On
 * 2026-09-04 the pack gate alone was used and the accountant was offered an
 * upload control that `registerAttachedPhoto` then refused — see the build log
 * in `docs/modules/documents.md`.
 *
 * Exported so a screen can ask the same question the gate asks, rather than
 * restating it as a role comparison and drifting from it.
 */
export function roleMayWrite(role: DocsRole): boolean {
  return role !== "expert";
}

