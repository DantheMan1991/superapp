import { deletePostureCheckAction, savePostureCheckAction } from "../actions";
import { toCheckDoc } from "../core/check-doc";
import { deleteCheck, listChecks, markCheck } from "./checks";

/**
 * THE ONE DOOR A CHECK'S NUMBERS TAKE TO THE ACCOUNT (docs/modules/posture.md,
 * slice 3; ADRs 0118 and 0120). Nothing else in the posture code talks to the
 * server, and what goes through here is `toCheckDoc`'s output: the captures'
 * numbers and the check's notes, checked again by the action's strict schema.
 * A photo is never read here.
 *
 * The same rules as a workout session (ADR 0113): the check is on the phone
 * first, sent when it ends and again until the account says it has it, a
 * missing network stops a run (the rest would fail the same way) and a
 * refusal is kept on the check for the screen to say.
 */

export type SendResult = "sent" | "offline" | "refused";

/** Was that a missing network, or an answer? The tell box's rule. */
function looksLikeNoSignal(err: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  if (err instanceof TypeError) return true;
  const message = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return ["fetch", "network", "load failed", "connection"].some((word) => message.includes(word));
}

let inFlight: Promise<SendResult> | null = null;

/** Send every finished check the account does not have yet, oldest first. One run at a time. */
export function sendPendingChecks(owner: string): Promise<SendResult> {
  if (inFlight) return inFlight;
  inFlight = (async (): Promise<SendResult> => {
    let result: SendResult = "sent";
    const pending = (await listChecks(owner)).filter((c) => !c.sentAt).sort((a, b) => a.at.localeCompare(b.at));
    for (const check of pending) {
      try {
        const outcome = await savePostureCheckAction(toCheckDoc(check));
        if ("error" in outcome) {
          await markCheck(check.id, { sentAt: null, refused: outcome.error });
          result = "refused";
        } else {
          await markCheck(check.id, { sentAt: new Date().toISOString(), refused: null });
        }
      } catch (err) {
        if (looksLikeNoSignal(err)) return "offline";
        await markCheck(check.id, { sentAt: null, refused: "The check could not be sent. It is kept on this phone." });
        result = "refused";
      }
    }
    return result;
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/**
 * A check this phone could not keep (a private window, storage that will not
 * open): straight to the account, or not at all. The same document and the
 * same door as every other send.
 */
export async function sendCheckNow(check: Parameters<typeof toCheckDoc>[0]): Promise<{ ok: true } | { error: string }> {
  try {
    const outcome = await savePostureCheckAction(toCheckDoc(check));
    return "error" in outcome ? outcome : { ok: true };
  } catch (err) {
    return { error: looksLikeNoSignal(err) ? "This phone is offline." : "The check could not be sent." };
  }
}

/**
 * Send, but give up waiting after `ms`: the check's end does not hold the
 * report back for a slow connection. The send carries on either way.
 */
export function sendPendingChecksWithin(owner: string, ms: number): Promise<SendResult | "slow"> {
  return Promise.race([
    sendPendingChecks(owner).catch((): SendResult => "offline"),
    new Promise<"slow">((resolve) => setTimeout(() => resolve("slow"), ms)),
  ]);
}

/**
 * Delete a check everywhere it is: the account, then this phone (its numbers
 * and any photo). If the account cannot be reached, nothing is deleted, so a
 * check never lingers in the account after it vanished from the phone.
 */
export async function deleteEverywhere(owner: string, id: string): Promise<{ error: string } | { ok: true }> {
  try {
    const outcome = await deletePostureCheckAction({ id });
    if ("error" in outcome) return outcome;
  } catch (err) {
    return {
      error: looksLikeNoSignal(err)
        ? "This phone is offline. Delete the check when it is back online."
        : "The check could not be deleted just now. Try again.",
    };
  }
  await deleteCheck(owner, id);
  return { ok: true };
}

/**
 * Only a check the account has had this long is taken for deleted when its
 * list lacks it. Both times are this phone's own clock, so a phone that runs
 * slow cannot mistake a check it sent a moment ago (after the list was made)
 * for one deleted elsewhere, and lose its photos.
 */
const SENT_LONG_ENOUGH_MS = 10 * 60 * 1000;

/**
 * A check deleted on another device: the account no longer lists it, but this
 * phone still has it, sent a while ago. Its numbers and photos go here too.
 */
export async function forgetDeletedElsewhere(owner: string, accountIds: readonly string[], now = Date.now()): Promise<number> {
  const inAccount = new Set(accountIds);
  let forgotten = 0;
  for (const check of await listChecks(owner)) {
    if (!check.sentAt || inAccount.has(check.id)) continue;
    if (Date.parse(check.sentAt) < now - SENT_LONG_ENOUGH_MS) {
      await deleteCheck(owner, check.id);
      forgotten++;
    }
  }
  return forgotten;
}
