"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@/db";
import { requirePersonalSpace } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { draftRequestSchema } from "./core/draft";
import { FitnessError, fitnessMessage } from "./core/errors";
import { programInputSchema, programProblems } from "./core/program";
import { markVideos } from "./embeds";
import { discardImport, draftProgram, markImportSaved } from "./import-ops";
import { deleteProgram, saveProgram } from "./program-ops";

/**
 * WORKOUTS' SERVER ACTIONS. Each one: the personal space's own door
 * (`requirePersonalSpace` — a business never reaches here), the module gate,
 * then zod on the input. Each returns `{ ok }` or `{ error }` with a sentence;
 * an exception's own text never reaches the screen.
 */

const HOME = "/personal/m/fitness";

type Outcome<T extends object = object> = ({ ok: true } & T) | { error: string };

async function gate() {
  const ctx = await requirePersonalSpace();
  await requireModuleEnabled(ctx.tenant.id, "fitness");
  return ctx;
}

function failure(err: unknown, fallback: string): { error: string } {
  if (err instanceof FitnessError) return { error: fitnessMessage(err) };
  console.error("fitness action failed", err);
  return { error: fallback };
}

/**
 * Draft a program from the pages the browser read. Takes about a minute: the
 * page that calls this sets `maxDuration` for it.
 */
export async function draftProgramAction(
  input: z.infer<typeof draftRequestSchema>,
): Promise<Outcome<{ importId: string }>> {
  const ctx = await gate();
  const parsed = draftRequestSchema.safeParse(input);
  if (!parsed.success) return { error: "That file could not be read. Try choosing it again." };
  try {
    const { importId } = await draftProgram(ctx, parsed.data);
    revalidatePath(HOME);
    return { ok: true, importId };
  } catch (err) {
    return failure(err, "The program could not be drafted. Try again in a minute.");
  }
}

const saveSchema = z.object({
  program: programInputSchema,
  /** Null for a new program; the program's id for an edit. */
  programId: z.string().uuid().nullable(),
  /** The version the editor opened, for an edit. */
  version: z.number().int().min(1).nullable(),
  /** The import this program is being saved from, if it is one. */
  importId: z.string().uuid().nullable(),
});

/** Save the editor: a new program (by hand, or from an import's draft) or an edit. */
export async function saveProgramAction(
  input: z.infer<typeof saveSchema>,
): Promise<Outcome<{ programId: string }>> {
  const ctx = await gate();
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { error: "Something in the program could not be read. Check it and save again." };
  const { programId, version, importId } = parsed.data;
  const problems = programProblems(parsed.data.program);
  if (problems.length > 0) return { error: problems[0] };
  if (programId !== null && version === null) return { error: "Reload the page, then save again." };

  try {
    // Videos added or changed in the editor get YouTube's answer on whether
    // they play here, and an unnamed second video takes its YouTube title;
    // ones already answered keep theirs.
    const program = await markVideos(parsed.data.program);
    const saved = await withTenant(
      ctx.tenant.id,
      async (tx) => {
        const result = await saveProgram(
          tx,
          ctx.tenant.id,
          program,
          programId === null
            ? { programId: null, source: importId === null ? "own" : "imported" }
            : { programId, version: version as number },
        );
        if (importId !== null) await markImportSaved(tx, ctx.tenant.id, importId, result.programId);
        return result;
      },
      { role: ctx.role },
    );
    revalidatePath(HOME);
    revalidatePath(`${HOME}/programs/${saved.programId}`);
    return { ok: true, programId: saved.programId };
  } catch (err) {
    return failure(err, "The program could not be saved. Try again.");
  }
}

const importIdSchema = z.object({ importId: z.string().uuid() });

/** Throw a draft (or a failed import) away. */
export async function discardImportAction(
  input: z.infer<typeof importIdSchema>,
): Promise<Outcome> {
  const ctx = await gate();
  const parsed = importIdSchema.safeParse(input);
  if (!parsed.success) return { error: "That draft could not be found." };
  try {
    await withTenant(ctx.tenant.id, (tx) => discardImport(tx, ctx.tenant.id, parsed.data.importId), {
      role: ctx.role,
    });
    revalidatePath(HOME);
    return { ok: true };
  } catch (err) {
    return failure(err, "The draft could not be discarded. Try again.");
  }
}

const programIdSchema = z.object({ programId: z.string().uuid() });

/** Delete a program and everything in it. The page asks first. */
export async function deleteProgramAction(
  input: z.infer<typeof programIdSchema>,
): Promise<Outcome> {
  const ctx = await gate();
  const parsed = programIdSchema.safeParse(input);
  if (!parsed.success) return { error: "That program could not be found." };
  try {
    await withTenant(ctx.tenant.id, (tx) => deleteProgram(tx, ctx.tenant.id, parsed.data.programId), {
      role: ctx.role,
    });
    revalidatePath(HOME);
    return { ok: true };
  } catch (err) {
    return failure(err, "The program could not be deleted. Try again.");
  }
}
