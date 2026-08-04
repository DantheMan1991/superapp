/**
 * The party subsystem's error type.
 *
 * Its own rather than borrowed: `LedgerError` belongs to accounting and CRM
 * cannot import it, which is exactly the coupling `src/lib/parties/` exists to
 * avoid. Callers translate this into their own module's error for the client —
 * the shape matches `DocsError` / `LedgerError` so that translation is
 * mechanical.
 */
export type PartyErrorCode =
  | "PARTY_NOT_FOUND"
  | "PARTY_NAME_REQUIRED"
  | "CONTACT_POINT_NOT_FOUND"
  | "CONTACT_VALUE_INVALID"
  | "STALE_VERSION";

export class PartyError extends Error {
  constructor(
    readonly code: PartyErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PartyError";
  }
}

/** Client-safe wording. Never leaks an id, a tenant or a database detail. */
export function friendlyPartyMessage(err: PartyError): string {
  switch (err.code) {
    case "PARTY_NOT_FOUND":
      return "That record could not be found.";
    case "PARTY_NAME_REQUIRED":
      return "A name is required.";
    case "CONTACT_POINT_NOT_FOUND":
      return "That contact detail could not be found.";
    case "CONTACT_VALUE_INVALID":
      return "That does not look like a usable email, phone or website.";
    case "STALE_VERSION":
      return "This record changed while you were editing it. Reload and try again.";
  }
}
