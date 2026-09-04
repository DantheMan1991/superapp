/**
 * The Marketing module's errors, and the one place their English lives.
 * Same shape as every module: a code the code can branch on, a message that
 * is safe to show, and never a raw provider or Postgres error at the client.
 */
export type MarketingErrorCode =
  | "FORBIDDEN"
  | "FORBIDDEN_EXPERT"
  | "INVALID_INPUT"
  | "COMPANY_NOT_FOUND"
  | "LOGO_NOT_AN_IMAGE"
  | "LOGO_TOO_LARGE"
  | "LOGO_MISSING"
  | "STORAGE_UNAVAILABLE";

export class MarketingError extends Error {
  constructor(
    public readonly code: MarketingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "MarketingError";
  }
}

export function friendlyMessage(err: unknown): string {
  if (err instanceof MarketingError) {
    switch (err.code) {
      case "FORBIDDEN":
        return "Only an owner can change how the business looks.";
      case "FORBIDDEN_EXPERT":
        return "Accountant access is read-only.";
      case "INVALID_INPUT":
        return "Check the fields and try again.";
      case "COMPANY_NOT_FOUND":
        return "That company no longer exists.";
      case "LOGO_NOT_AN_IMAGE":
        return "That file isn't a PNG or JPEG image. Export the logo as one and try again.";
      case "LOGO_TOO_LARGE":
        return "That logo is over 2MB. Export it smaller and try again.";
      case "LOGO_MISSING":
        return "The upload didn't finish. Try again.";
      case "STORAGE_UNAVAILABLE":
        return "File storage isn't set up on this deployment yet.";
    }
  }
  return "Something went wrong. Please try again.";
}
