"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { JobsError, type JobsCtx } from "./ops";
import { PACK } from "./vocabulary";
import {
  deleteAssembly,
  getAssembly,
  saveItemAsAssembly,
  updateAssembly,
  type SaveAssemblyInput,
} from "./assembly-ops";
import { quantityStringToThousandths } from "./billing-math";
import { ASSEMBLY_LINE_SHAPES } from "@/db/schema";

/**
 * OWNING YOUR ASSEMBLIES (X10).
 *
 * The founder, asked to pick what to build next: *"let's do the assemblies
 * first. how easy is it to build assemblies?"*
 *
 * Making one was already a click — the package icon on an estimate item. But
 * there was **no screen, and no update**: `saveItemAsAssembly` and
 * `deleteAssembly` were the whole library. You could not see what you had,
 * and fixing a typo in one line meant deleting the assembly and building an
 * item to re-save from. That is why nobody was ever going to own thirty of
 * them, and owning thirty of them is the whole answer to *"how do I get the
 * items I want, with the wording I want, every time."*
 *
 * These are the doors for the library screen. The one that saves an item
 * from an estimate stays in `actions.ts` beside the rest of the editor.
 */

const LIBRARY = "/dashboard/m/jobs/assemblies";

async function gate(): Promise<JobsCtx> {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  return { tenantId: ctx.tenant.id, userId: ctx.userId, role: ctx.role };
}

function sentence(message: string): string {
  const trimmed = message.trim();
  if (trimmed === "") return "That did not work.";
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}${/[.!?]$/.test(trimmed) ? "" : "."}`;
}

function toResult(err: unknown): { error: string } {
  if (err instanceof JobsError) return { error: sentence(err.message) };
  return { error: "That did not work. Try again." };
}

/**
 * A line as the library screen edits it. Money arrives as the integers the
 * pack keeps everywhere — the screen does the reading, because `formatMoney`
 * and its inverse already live there and a second parser is a second answer.
 */
const lineSchema = z.object({
  description: z.string().trim().max(300),
  clientDescription: z.string().trim().max(300).default(""),
  clientVisible: z.boolean().default(true),
  unit: z.string().trim().max(24).default(""),
  quantityThousandths: z.number().int().min(0).max(1_000_000_000_000),
  unitCostCents: z.number().int().min(0).max(1_000_000_000_000),
  /**
   * **UNSET IS NULL, NOT ZERO.** A markup of null takes the estimate's rate
   * and a price of null is priced by markup; a ZERO is an explicit 0% and an
   * explicit $0.00. The library screen coerced both to zero for a day, and
   * every assembly it saved then dropped its lines at a price of nothing —
   * found by the first takeoff off the model (X15), whose item came in with
   * the client paying $0.00. Migration 0420 put those rows back to unset.
   */
  markupPpm: z.number().int().min(0).max(100_000_000).nullable(),
  unitPriceCents: z.number().int().min(0).max(1_000_000_000_000).nullable(),
  costCode: z.string().trim().max(60).default(""),
});

const bodySchema = z.object({
  name: z.string().trim().min(1).max(200),
  /** One line covering its rooms, or a line per room (X11). */
  lineShape: z.enum(ASSEMBLY_LINE_SHAPES).optional(),
  /** Every item this makes is an allowance (X12). */
  isAllowance: z.boolean().optional(),
  clientNote: z.string().trim().max(500).default(""),
  notes: z.string().trim().max(2000).default(""),
  /** As it is typed: "320", "1", "24.5". Read the way every quantity is. */
  drivingQuantity: z.string().trim().max(40),
  drivingUnit: z.string().trim().max(24).default(""),
  /** What the model calls it (X15): the names a schedule uses for this thing. */
  keys: z.array(z.string().trim().min(1).max(200)).max(200).optional(),
  lines: z.array(lineSchema).min(1).max(200),
});

function asInput(body: z.infer<typeof bodySchema>): SaveAssemblyInput {
  return {
    name: body.name,
    lineShape: body.lineShape,
    isAllowance: body.isAllowance,
    clientNote: body.clientNote,
    notes: body.notes,
    drivingQuantityThousandths: quantityStringToThousandths(body.drivingQuantity) ?? 0,
    drivingUnit: body.drivingUnit,
    keys: body.keys,
    /** The order on screen IS the order; the ops re-spaces it by tens. */
    lines: body.lines.map((l, i) => ({ ...l, sortOrder: i })),
  };
}

/** A new one, from nothing — the door the library never had. */
export async function createAssemblyAction(input: unknown) {
  const parsed = bodySchema.safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  try {
    const ctx = await gate();
    const made = await withTenant(
      ctx.tenantId,
      (tx) => saveItemAsAssembly(tx, ctx, asInput(parsed.data)),
      { role: ctx.role },
    );
    revalidatePath(LIBRARY);
    return { ok: true as const, id: made.id, name: made.name };
  } catch (err) {
    return toResult(err);
  }
}

export async function updateAssemblyAction(input: unknown) {
  const parsed = bodySchema.extend({
    id: z.string().uuid(),
    version: z.number().int().min(1),
  }).safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  try {
    const ctx = await gate();
    const saved = await withTenant(
      ctx.tenantId,
      (tx) =>
        updateAssembly(tx, ctx, parsed.data.id, {
          ...asInput(parsed.data),
          version: parsed.data.version,
        }),
      { role: ctx.role },
    );
    revalidatePath(LIBRARY);
    revalidatePath(`${LIBRARY}/${parsed.data.id}`);
    return { ok: true as const, version: saved.version };
  } catch (err) {
    return toResult(err);
  }
}

const idSchema = z.object({ id: z.string().uuid() });

/**
 * **TAKING ONE OUT OF THE LIBRARY TOUCHES NO JOB.** An item on a bid you
 * sent in March copied this assembly into itself; the copy is that bid's.
 * Said here as well as in the ops, because it is the question somebody will
 * have their finger over the button asking.
 */
export async function deleteAssemblyFromLibraryAction(input: unknown) {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  try {
    const ctx = await gate();
    await withTenant(ctx.tenantId, (tx) => deleteAssembly(tx, ctx, parsed.data.id), {
      role: ctx.role,
    });
    revalidatePath(LIBRARY);
    return { ok: true as const };
  } catch (err) {
    return toResult(err);
  }
}

/** One, whole, for the editor to open. */
export async function readAssemblyAction(input: unknown) {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  try {
    const ctx = await gate();
    const found = await withTenant(
      ctx.tenantId,
      (tx) => getAssembly(tx, ctx.tenantId, parsed.data.id),
      { role: ctx.role },
    );
    if (!found) return { error: "That assembly is not there any more." };
    return { ok: true as const, assembly: found.assembly, lines: found.lines };
  } catch (err) {
    return toResult(err);
  }
}
