"use server";

import { z } from "zod";
import type {
  AttentionActionArgs,
  AttentionActionResult,
} from "@/lib/attention-sources/types";
import { approveSheetAction, submitSheetAction } from "../actions";

/**
 * The one-tap verbs on What needs you.
 *
 * **THIS FILE EXISTS BECAUSE OF ONE RULE, AND SLICE 3 BROKE IT.** The page
 * hands a handler straight to a client button, so the handler must BE a server
 * action — a function exported from a `"use server"` file. Slice 3 satisfied
 * that in spirit by calling the module's own exported action, but wrapped it in
 * an arrow defined in `source.ts`: the arrow is what gets passed, the arrow is
 * not a server action, and React refuses it at render with "Functions cannot be
 * passed directly to Client Components".
 *
 * That threw the WHOLE page — not the item, not the section — for any owner
 * with a timesheet waiting, and nothing caught it: `tsc` is happy, the source's
 * own tests never render, and the page only fails when an item with an action
 * is actually drawn. It surfaced while driving slice 8. `AttentionActionHandler`
 * says all of this in its own doc comment; the fix is to obey it.
 *
 * Nothing here is new authority. Each is the pay period screen's own button,
 * reached from the feed: same gate, same Zod, same audit row, same refusals.
 */

const approveArgs = z.object({
  sheetId: z.string().uuid(),
  expectedVersion: z.coerce.number().int().min(1),
});

export async function approveSheetFromAttentionAction(
  args: AttentionActionArgs,
): Promise<AttentionActionResult> {
  const parsed = approveArgs.safeParse(args);
  if (!parsed.success) return { error: "Invalid input" };
  const result = await approveSheetAction(parsed.data);
  return "error" in result ? { error: result.error } : { ok: true };
}

const submitArgs = z.object({
  workerId: z.string().uuid(),
  on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function submitSheetFromAttentionAction(
  args: AttentionActionArgs,
): Promise<AttentionActionResult> {
  const parsed = submitArgs.safeParse(args);
  if (!parsed.success) return { error: "Invalid input" };
  const result = await submitSheetAction(parsed.data);
  return "error" in result ? { error: result.error } : { ok: true };
}
