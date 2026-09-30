"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@/db";
import { requirePersonalSpace } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { FitnessError, fitnessMessage } from "../core/errors";
import { deletePostureCheck, savePostureCheck } from "./check-ops";
import { postureCheckDocSchema } from "./core/check-doc";

/**
 * THE POSTURE CHECK'S SERVER ACTIONS (docs/modules/posture.md, slice 3). The
 * personal space's own door, the module gate, then zod on the input. The only
 * things a phone sends are a check's numbers (`postureCheckDocSchema`, which
 * has no place for a picture: ADR 0118) and a check's id to delete.
 */

const POSTURE = "/personal/m/fitness/posture";

type Outcome<T extends object = object> = ({ ok: true } & T) | { error: string };

async function gate() {
  const ctx = await requirePersonalSpace();
  await requireModuleEnabled(ctx.tenant.id, "fitness");
  return ctx;
}

/**
 * Keep a finished check in the account. The phone sends it when the check
 * ends, and again until it hears back, so this is safe to repeat. A failure
 * is said quietly: the check is still on the phone and will be sent again.
 */
export async function savePostureCheckAction(input: unknown): Promise<Outcome<{ created: boolean }>> {
  const ctx = await gate();
  const parsed = postureCheckDocSchema.safeParse(input);
  if (!parsed.success) return { error: "This check could not be read. It is still on this phone." };
  try {
    const saved = await withTenant(ctx.tenant.id, (tx) => savePostureCheck(tx, ctx.tenant.id, parsed.data), {
      role: ctx.role,
    });
    revalidatePath(POSTURE);
    return { ok: true, created: saved.created };
  } catch (err) {
    if (err instanceof FitnessError) return { error: fitnessMessage(err) };
    console.error("posture check save failed", err);
    return { error: "This check could not be kept just now. It is still on this phone and will be sent again." };
  }
}

const idSchema = z.strictObject({ id: z.string().uuid() });

/** Delete a check from the account. Its photos, if any, are the phone's to delete. */
export async function deletePostureCheckAction(input: unknown): Promise<Outcome> {
  const ctx = await gate();
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { error: "That check could not be found." };
  try {
    await withTenant(ctx.tenant.id, (tx) => deletePostureCheck(tx, ctx.tenant.id, parsed.data.id), { role: ctx.role });
    revalidatePath(POSTURE);
    return { ok: true };
  } catch (err) {
    console.error("posture check delete failed", err);
    return { error: "The check could not be deleted just now. Try again." };
  }
}
