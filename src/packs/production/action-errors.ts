import "server-only";
import { ProductionError } from "./ops";

/**
 * Turn a thrown error into the `{ error }` a form can render.
 *
 * **IN ITS OWN FILE BECAUSE `actions.ts` IS `"use server"`.** A `"use server"`
 * module may export nothing but async functions — a sync export there compiles,
 * types, and passes the suite, then throws the first time a request evaluates
 * the action graph. That failure has already reached production in this repo
 * once, which is why `tests/use-server-exports.test.ts` exists. So the moment a
 * second actions file needed this function, the choice was a shared module or a
 * second copy, and a second copy of the mapping from error codes to sentences is
 * how two screens start describing the same refusal differently.
 */
export function toResult(err: unknown): { error: string } {
  if (err instanceof ProductionError) {
    switch (err.code) {
      case "FORBIDDEN":
        return { error: "Only an owner can change this." };
      case "NOT_FOUND":
        return { error: "That no longer exists." };
      case "INVALID_KIND":
        return { error: "Use lowercase letters, numbers and underscores." };
      // Every one of these is written for a person at the point it is thrown,
      // and the withdrawal refusal in particular is repeated word for word from
      // the pack that owns the clock. Rewording it here would be this pack
      // paraphrasing a legal statement it does not own.
      case "RUN_CLOSED":
      case "RUN_INVALID":
      case "ITEM_INVALID":
      case "LOT_REQUIRED":
      case "INPUT_BLOCKED":
      case "NOTHING_TO_LAND":
      case "CARCASS_INVALID":
      case "PROCESSOR_INVALID":
      case "BOOKING_INVALID":
      case "ORDER_INVALID":
      case "PAPERWORK_INVALID":
      case "BILL_INVALID":
      case "BILL_POSTED":
        return { error: err.message };
    }
    /**
     * **A CODE NOBODY LISTED IS NOW A TYPE ERROR, NOT A SHRUG.** Slice 2d added
     * two codes and did not add them here, so "nothing came out of this one that
     * is on a shelf, so there is no batch to move a cost onto" — a sentence
     * written for the person reading it — reached the screen as *Something went
     * wrong saving that*. Found by pressing the button.
     *
     * The switch is exhaustive by construction now: an unhandled code makes this
     * assignment fail to compile, which is the same trick `MEASURED_BY` uses in
     * `core/fee.ts` to stop a new price unit quietly shrinking a fee.
     */
    const unhandled: never = err.code;
    return { error: String(unhandled) };
  }
  if (err instanceof Error && err.name === "InventoryError") {
    return { error: err.message };
  }
  if (err instanceof Error && err.name === "LivestockError") {
    return { error: err.message };
  }
  // A party rename can refuse on its own terms — an empty name, or a version
  // that moved under a concurrent edit. Its message is already a sentence.
  if (err instanceof Error && err.name === "PartyError") {
    return { error: err.message };
  }
  console.error("production action failed", err);
  return { error: "Something went wrong saving that." };
}
