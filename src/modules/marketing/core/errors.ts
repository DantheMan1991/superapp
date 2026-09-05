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
  | "STORAGE_UNAVAILABLE"
  | "IMAGE_UNAVAILABLE"
  | "SPEC_INVALID"
  | "SLUG_TAKEN"
  | "SLUG_INVALID"
  | "SITE_EXISTS"
  | "SITE_MISSING"
  | "SITE_EMPTY"
  | "PAGE_MISSING"
  | "PAGE_PATH_TAKEN"
  | "PAGE_PATH_INVALID"
  | "PAGE_IS_HOME"
  | "PAGE_INVALID"
  | "VERSION_MISSING"
  | "DOMAINS_UNAVAILABLE"
  | "DOMAIN_INVALID"
  | "DOMAIN_TAKEN"
  | "DOMAIN_MISSING"
  | "DOMAIN_LIMIT"
  | "DOMAIN_PROVIDER";

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
        return "That file isn't a PNG, JPEG or SVG image. Export the logo as one and try again.";
      case "LOGO_TOO_LARGE":
        return "That logo is over 2MB. Export it smaller and try again.";
      case "LOGO_MISSING":
        return "The upload didn't finish. Try again.";
      case "STORAGE_UNAVAILABLE":
        return "File storage isn't set up on this deployment yet.";
      case "IMAGE_UNAVAILABLE":
        return "Drawing isn't available on this deployment right now. Upload a PNG instead.";
      case "SPEC_INVALID":
        return "That candidate can't be drawn. Draw a new set and try again.";
      case "SLUG_TAKEN":
        return "That address is already taken. Choose another.";
      case "SLUG_INVALID":
        return "Use letters, numbers and hyphens for the address.";
      case "SITE_EXISTS":
        return "This business already has a website.";
      case "SITE_MISSING":
        return "There is no website yet. Build one first.";
      case "SITE_EMPTY":
        return "There are no pages to publish yet.";
      case "PAGE_MISSING":
        return "That page no longer exists.";
      case "PAGE_PATH_TAKEN":
        return "Another page already has that address.";
      case "PAGE_PATH_INVALID":
        return err.message;
      case "PAGE_IS_HOME":
        return "The home page stays; every site has one.";
      case "PAGE_INVALID":
        return err.message;
      case "VERSION_MISSING":
        return "That version is gone.";
      case "DOMAINS_UNAVAILABLE":
        return "Connecting your own domain isn't switched on for this deployment yet.";
      case "DOMAIN_INVALID":
        return err.message;
      case "DOMAIN_TAKEN":
        return "That domain is already connected to a site on Yosher.";
      case "DOMAIN_MISSING":
        return "That domain is no longer connected.";
      case "DOMAIN_LIMIT":
        return "A site can have up to five domains. Remove one first.";
      case "DOMAIN_PROVIDER":
        return err.message;
    }
  }
  return "Something went wrong. Please try again.";
}
