/**
 * Work's error type lives in `src/lib/work/errors.ts` since slice 5a — the
 * shared write path throws it and `src/lib/` may not depend on a module.
 * Re-exported here so the module's call sites are unchanged.
 *
 * What stays in this file is `friendlyMessage`: turning a code into a sentence
 * is presentation, and a second surface (CRM, from slice 5b) may reasonably
 * want different words for the same code.
 */
export { WorkError, type WorkErrorCode } from "@/lib/work/errors";
import type { WorkError as WorkErrorType } from "@/lib/work/errors";

/**
 * What a person is told. Never a Postgres or provider message — those leak
 * schema and internals (conventions §1).
 */
export function friendlyMessage(error: WorkErrorType): string {
  switch (error.code) {
    case "NOT_FOUND":
      return "That work no longer exists, or you cannot see it.";
    case "FORBIDDEN":
      return "You do not have access to do that.";
    case "DEFAULT_IS_PERMANENT":
      return "The default list cannot be archived.";
    case "NOT_ASSIGNABLE":
      return "That person cannot be given work in this workspace.";
    case "WOULD_CYCLE":
      return "Work cannot be filed under itself.";
    case "SELF_LINK":
      return "Work cannot be about itself.";
    case "STALE":
      return "Somebody else changed this while you had it open. Reopen it and try again.";
    case "INVALID":
      return error.message;
  }
}
