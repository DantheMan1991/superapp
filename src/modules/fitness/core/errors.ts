/**
 * What Workouts refuses, each with the sentence the person sees. Pure, so the
 * actions turn a code into words the same way everywhere.
 */
export type FitnessErrorCode =
  | "NOT_FOUND"
  | "STALE"
  | "INVALID"
  | "BUSY"
  | "NO_TEXT"
  | "TOO_LONG"
  | "DRAFT_FAILED";

export class FitnessError extends Error {
  constructor(
    readonly code: FitnessErrorCode,
    /**
     * For DRAFT_FAILED and INVALID: the specific sentence, already written.
     * For NO_TEXT and TOO_LONG: other words than the import's, where its
     * advice ("build the program by hand") does not fit (a program read again).
     */
    readonly detail?: string,
  ) {
    super(detail ?? code);
    this.name = "FitnessError";
  }
}

export function fitnessMessage(error: FitnessError): string {
  switch (error.code) {
    case "NOT_FOUND":
      return "That program is not here any more. It may have been deleted.";
    case "STALE":
      return "This program changed since you opened it. Reload the page to see the latest, then make your change again.";
    case "INVALID":
      return error.detail ?? "Something in the program needs fixing before it can be saved.";
    case "BUSY":
      return "A program is already being drafted. Give it a minute, then look under Drafts on the Workouts page.";
    case "NO_TEXT":
      return (
        error.detail ??
        "This PDF has no words to read. It may be pictures of pages, which cannot be read yet. Build the program by hand instead."
      );
    case "TOO_LONG":
      return (
        error.detail ??
        "This PDF is too long to draft in one go. It reads like a book rather than a program. Build the program by hand, or import a shorter file."
      );
    case "DRAFT_FAILED":
      return error.detail ?? "The program could not be drafted. Try again in a minute.";
  }
}
