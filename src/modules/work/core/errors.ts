/**
 * Work's error type. No directive: the codes cross the action boundary as
 * strings, and a client component may want to branch on one.
 */
export type WorkErrorCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "INVALID"
  | "DEFAULT_IS_PERMANENT"
  | "NOT_ASSIGNABLE"
  | "WOULD_CYCLE";

export class WorkError extends Error {
  constructor(
    readonly code: WorkErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "WorkError";
  }
}

/**
 * What a person is told. Never a Postgres or provider message — those leak
 * schema and internals (conventions §1).
 */
export function friendlyMessage(error: WorkError): string {
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
    case "INVALID":
      return error.message;
  }
}
