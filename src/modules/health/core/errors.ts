/**
 * Every way a Health action can be refused, and what the person is told
 * (docs/help/health/). One sentence each, saying what to do.
 */
export type HealthErrorCode =
  | "INVALID"
  | "SAME_TIME"
  | "NEW_DAY"
  | "NOT_FOUND"
  | "TOO_MANY_HABITS"
  | "HABIT_NAME_TAKEN"
  | "DAY"
  | "TOO_MANY_MEASURES"
  | "MEASURE_NAME_TAKEN";

export const HEALTH_MESSAGES: Record<HealthErrorCode, string> = {
  INVALID: "Something in that was not right. Check it and try again.",
  SAME_TIME: "Bed and wake times are the same. Change one of them.",
  NEW_DAY: "It is a new day. Reload the page, then try again.",
  NOT_FOUND: "That is not here any more. Reload the page.",
  TOO_MANY_HABITS: "That is the most habits Health keeps. Delete one first.",
  HABIT_NAME_TAKEN: "You already have a habit with that name.",
  DAY: "You can fill in today and the two weeks before it.",
  TOO_MANY_MEASURES: "That is the most tape measures Health keeps. Delete one first.",
  MEASURE_NAME_TAKEN: "You already have a tape measure with that name.",
};

export class HealthError extends Error {
  constructor(public readonly code: HealthErrorCode) {
    super(HEALTH_MESSAGES[code]);
    this.name = "HealthError";
  }
}
