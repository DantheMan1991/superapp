/**
 * Work's error type.
 *
 * IN `src/lib/` RATHER THAN THE MODULE, since slice 5a. The shared write path
 * (`items.ts`) throws these, and CRM catches them — and `src/lib/` may not
 * depend on a module, so the class cannot live in one. `friendlyMessage` stays
 * in `src/modules/work/core/errors.ts`, because turning a code into a sentence
 * is presentation and each surface may want its own words.
 *
 * No directive: the codes cross the action boundary as strings and a client
 * component may branch on one.
 */
export type WorkErrorCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "INVALID"
  | "DEFAULT_IS_PERMANENT"
  | "NOT_ASSIGNABLE"
  | "WOULD_CYCLE"
  /**
   * Somebody else changed the row since it was read.
   *
   * Arrives with the shared write path because `crm_tasks` has carried an
   * optimistic `version` since CRM slice 1, and slice 5b moves those rows here.
   * Migrating without it would quietly drop a property follow-ups have today —
   * two people editing one follow-up would go back to last-write-wins.
   */
  | "STALE";

export class WorkError extends Error {
  constructor(
    readonly code: WorkErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "WorkError";
  }
}
