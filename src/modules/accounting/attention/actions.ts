"use server";

import { z } from "zod";
import type {
  AttentionActionArgs,
  AttentionActionResult,
} from "@/lib/attention-sources/types";
import { approveBillAction } from "../payables/actions";

const approveArgs = z.object({
  billId: z.string().uuid(),
  version: z.coerce.number().int().min(1),
});

/**
 * The one-tap Approve on What needs you.
 *
 * Nothing here is new authority: it is `approveBillAction`, the bill page's
 * own button, reached from the feed — same gate (owners only, expert refused),
 * same validation, same audit row, same period-lock and uncoded-line refusals.
 * The `version` the item carried is the CAS the page would have sent, so a
 * bill somebody edited since the feed was drawn is refused, not approved on
 * stale lines. This file is `"use server"` because the page hands the handler
 * to a client button; see `AttentionActionHandler`.
 */
export async function approveBillFromAttentionAction(
  args: AttentionActionArgs,
): Promise<AttentionActionResult> {
  const parsed = approveArgs.safeParse(args);
  if (!parsed.success) return { error: "Invalid input" };
  const result = await approveBillAction({
    billId: parsed.data.billId,
    expectedVersion: parsed.data.version,
  });
  return "error" in result ? { error: result.error } : { ok: true };
}
