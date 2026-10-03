/**
 * Why something in Food could not be done, as a code the server throws and a
 * sentence the person can act on (docs/help/food/*.md lists every one). An
 * exception's own text never reaches the screen.
 */

export type FoodErrorCode =
  | "RECIPE_MISSING"
  | "IMPORT_MISSING"
  | "IMPORT_BUSY"
  | "IMPORT_READING"
  | "BAD_LINK"
  | "UNREACHABLE"
  | "BLOCKED"
  | "NOT_A_PAGE"
  | "TOO_LARGE"
  | "NO_RECIPE"
  | "PASTE_EMPTY"
  | "PASTE_TOO_LONG"
  | "PICTURES"
  | "READ_FAILED"
  | "PHOTO"
  | "STORAGE"
  | "FOOD_MISSING"
  | "PORTION"
  | "EATEN_MISSING"
  | "DAY"
  | "PLATE_EMPTY"
  | "PLATE_FAILED"
  | "INVALID";

const MESSAGES: Record<FoodErrorCode, string> = {
  RECIPE_MISSING: "That recipe is not here any more.",
  IMPORT_MISSING: "That draft is not here any more.",
  IMPORT_BUSY: "A recipe is already being read. Wait for it to finish, then try again.",
  IMPORT_READING: "That draft is still being read. Wait for it to finish.",
  BAD_LINK: "That doesn't look like a web address. Copy the page's address and paste it here.",
  UNREACHABLE: "That page could not be reached. Check the link, or copy the recipe and use Paste the text.",
  BLOCKED: "That site would not let the app read it. Copy the recipe from the page and use Paste the text.",
  NOT_A_PAGE: "That link is not a web page. Copy the recipe and use Paste the text.",
  TOO_LARGE: "That page is too large to read. Copy the recipe and use Paste the text.",
  NO_RECIPE: "No recipe was found there. Copy it and use Paste the text, or type it in.",
  PASTE_EMPTY: "Paste a recipe first.",
  PASTE_TOO_LONG: "That is too long to read at once. Paste just the recipe.",
  PICTURES: "Choose one to four photos of the recipe.",
  READ_FAILED: "The recipe could not be read this time. Try again, or type it in.",
  PHOTO: "That photo could not be used. Try another one, a JPEG or PNG.",
  STORAGE: "Photos cannot be kept right now. Save the recipe without one, and add it later.",
  FOOD_MISSING: "That food is not on the list any more. Search for it again.",
  PORTION: "That amount is not one this food can be logged in. Choose another.",
  EATEN_MISSING: "That is not in your log any more. Reload the page.",
  DAY: "You can log today and the two weeks before it.",
  PLATE_EMPTY: "No food was found in that photo. Try another one, or search for the foods.",
  PLATE_FAILED: "The photo could not be read this time. Try again, or search for the foods.",
  INVALID: "Something in that was not right. Check it and try again.",
};

export class FoodError extends Error {
  constructor(
    readonly code: FoodErrorCode,
    detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "FoodError";
  }
}

export function foodMessage(error: FoodError): string {
  return MESSAGES[error.code];
}

/** Every sentence, for the guide test that proves each is written down. */
export const FOOD_MESSAGES: Readonly<Record<FoodErrorCode, string>> = MESSAGES;
