/**
 * Errors from the enterprise subsystem. NO IMPORTS — the action layer maps
 * these to sentences and a client component may need the codes.
 */
export class EnterpriseError extends Error {
  constructor(
    readonly code:
      | "NOT_FOUND"
      | "NAME_TAKEN"
      | "INVALID_NAME"
      | "INVALID_KIND",
    message: string,
  ) {
    super(message);
    this.name = "EnterpriseError";
  }
}
