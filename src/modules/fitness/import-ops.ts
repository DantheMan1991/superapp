import "server-only";
import { and, desc, eq, gt, inArray, lte, or } from "drizzle-orm";
import { schema, withTenant, type Tx } from "@/db";
import type { FitnessImport } from "@/db/schema";
import type { TenantContext } from "@/lib/auth";
import { DraftError, draftTextProblem, normalizeDraft, type DraftRequest } from "./core/draft";
import { FitnessError } from "./core/errors";
import { programInputSchema, type ProgramInput } from "./core/program";
import { mergeAdditions, READ_AGAIN_WORDS, type AdditionsFound } from "./core/read-again";
import { callAdditionsModel, callDraftModel, DraftModelError, type AdditionsModel, type DraftModel } from "./draft-model";
import { checkVideo, markVideos, type VideoCheck } from "./embeds";
import { loadProgram, programToInput } from "./program-ops";

/**
 * AN IMPORT: a PDF on its way to being a program (src/db/schema/fitness.ts).
 *
 * `drafting` → `draft` → `saved`, or `failed`, or `discarded`. The row exists
 * from the moment drafting starts, so a person who closes the tab while
 * Claude reads still finds the draft under Drafts on the Workouts page.
 */

/**
 * How long a `drafting` import holds the door shut for the next one — and
 * after which it was INTERRUPTED: whatever was drafting it has hit its time
 * limit (the import page's `maxDuration`, 300 s) or been restarted by a
 * deploy, and nothing is ever going to finish it.
 */
const DRAFTING_WINDOW_MS = 5 * 60 * 1000;

export const INTERRUPTED =
  "The draft was interrupted before it finished. Discard it and import the PDF again.";

/**
 * An import as the person should see it: a `drafting` row older than the
 * window reads as the failure it is, and can be discarded like one. Without
 * this it would say "Drafting, started 3 hours ago" on the Workouts page for
 * ever, with no button, because discarding refused a row still drafting.
 * Busy (`startImport`) and interrupted are the two sides of the same line, so
 * a row is never both.
 */
export function settleImport(row: FitnessImport, now: Date = new Date()): FitnessImport {
  return row.status === "drafting" && now.getTime() - row.createdAt.getTime() >= DRAFTING_WINDOW_MS
    ? { ...row, status: "failed", error: INTERRUPTED }
    : row;
}

interface DraftDeps {
  model: DraftModel;
  videos: VideoCheck;
}

const LIVE_DEPS: DraftDeps = { model: callDraftModel, videos: checkVideo };

/**
 * DRAFT A PROGRAM FROM A PDF'S PAGES. Returns the import's id; the draft is on
 * the import, waiting for review.
 *
 * The model call runs OUTSIDE any transaction, between two short ones: a row
 * held open for a minute of Claude reading would be a lock held for a minute.
 * One import drafts at a time per space — a second press while the first is
 * still reading is `BUSY`, not a second bill for the same book.
 */
export async function draftProgram(
  ctx: TenantContext,
  request: DraftRequest,
  deps: DraftDeps = LIVE_DEPS,
): Promise<{ importId: string }> {
  const problem = draftTextProblem(request);
  if (problem) throw new FitnessError(problem);
  const linkCount = new Set(request.pages.flatMap((page) => page.links)).size;

  const importId = await withTenant(
    ctx.tenant.id,
    (tx) =>
      startImport(tx, ctx.tenant.id, {
        fileName: request.fileName,
        pageCount: request.pageCount,
        linkCount,
        clerkUserId: ctx.userId,
      }),
    { role: ctx.role },
  );

  let draft: ProgramInput;
  try {
    const raw = await deps.model(request);
    draft = await markVideos(normalizeDraft(raw), deps.videos);
  } catch (err) {
    const message = draftFailure(err);
    await withTenant(ctx.tenant.id, (tx) => failImport(tx, ctx.tenant.id, importId, message), {
      role: ctx.role,
    });
    throw new FitnessError("DRAFT_FAILED", message);
  }
  await withTenant(ctx.tenant.id, (tx) => finishImport(tx, ctx.tenant.id, importId, draft), {
    role: ctx.role,
  });
  return { importId };
}

interface ReadAgainDeps {
  model: AdditionsModel;
  videos: VideoCheck;
}

const LIVE_READ_AGAIN: ReadAgainDeps = { model: callAdditionsModel, videos: checkVideo };

/**
 * READ A PROGRAM'S PDF AGAIN (F4b, core/read-again.ts): what the program in
 * the app does not have yet (its side self-assessment, and the exercises done
 * on one side), merged into it for the editor to open, with the version it
 * was read against so the save still refuses a second tab's change.
 *
 * Nothing is written: the editor's Save is the only way any of it lands, the
 * rule the import lives by (ADR 0054). No import row either, because a
 * program read again is still the same program, its workouts and all.
 */
export async function readAgain(
  ctx: TenantContext,
  programId: string,
  request: DraftRequest,
  deps: ReadAgainDeps = LIVE_READ_AGAIN,
): Promise<{ program: ProgramInput; version: number; found: AdditionsFound }> {
  const problem = draftTextProblem(request);
  if (problem) throw new FitnessError(problem, READ_AGAIN_WORDS[problem]);
  const loaded = await withTenant(ctx.tenant.id, (tx) => loadProgram(tx, ctx.tenant.id, programId), {
    role: ctx.role,
  });
  if (!loaded) throw new FitnessError("NOT_FOUND");
  const current = programToInput(loaded);
  let merged: { program: ProgramInput; found: AdditionsFound };
  try {
    merged = mergeAdditions(current, await deps.model(request, current));
  } catch (err) {
    throw new FitnessError("DRAFT_FAILED", readAgainFailure(err));
  }
  return { program: await markVideos(merged.program, deps.videos), version: loaded.version, found: merged.found };
}

/** Why reading again failed: the program is untouched, so never the import's "build it by hand". */
function readAgainFailure(err: unknown): string {
  if (err instanceof DraftModelError) return READ_AGAIN_WORDS[err.code];
  console.error("fitness: reading a program again failed", err);
  return READ_AGAIN_WORDS.FAILED;
}

/** Why a draft failed, in words the person can act on — never an exception's text. */
function draftFailure(err: unknown): string {
  if (err instanceof DraftError) {
    return err.code === "EMPTY"
      ? "No exercises could be found in this PDF. Build the program by hand instead."
      : "The PDF could not be turned into a program. Try again, or build it by hand.";
  }
  if (err instanceof DraftModelError) {
    switch (err.code) {
      case "REFUSED":
        return "Claude would not draft this file. Build the program by hand instead.";
      case "TRUNCATED":
        return "The program was too long to draft in one go. Try a shorter file, or build it by hand.";
      case "NO_TOOL":
        return "Claude did not return a program. Try again in a minute.";
    }
  }
  console.error("fitness: drafting a program failed", err);
  return "The program could not be drafted. Try again in a minute.";
}

export async function startImport(
  tx: Tx,
  tenantId: string,
  input: { fileName: string; pageCount: number; linkCount: number; clerkUserId: string },
): Promise<string> {
  const t = schema;
  const [busy] = await tx
    .select({ id: t.fitnessImports.id })
    .from(t.fitnessImports)
    .where(
      and(
        eq(t.fitnessImports.tenantId, tenantId),
        eq(t.fitnessImports.status, "drafting"),
        gt(t.fitnessImports.createdAt, new Date(Date.now() - DRAFTING_WINDOW_MS)),
      ),
    )
    .limit(1);
  if (busy) throw new FitnessError("BUSY");
  const [row] = await tx
    .insert(t.fitnessImports)
    .values({
      tenantId,
      fileName: input.fileName,
      pageCount: input.pageCount,
      linkCount: input.linkCount,
      createdByClerkUserId: input.clerkUserId,
    })
    .returning({ id: t.fitnessImports.id });
  return row.id;
}

/**
 * Claude answered. Only a row still `drafting` takes the answer: one the
 * person discarded as interrupted stays discarded, however late the answer.
 */
async function finishImport(tx: Tx, tenantId: string, importId: string, draft: ProgramInput) {
  const t = schema;
  await tx
    .update(t.fitnessImports)
    .set({ status: "draft", draft, error: null, updatedAt: new Date() })
    .where(
      and(
        eq(t.fitnessImports.tenantId, tenantId),
        eq(t.fitnessImports.id, importId),
        eq(t.fitnessImports.status, "drafting"),
      ),
    );
}

async function failImport(tx: Tx, tenantId: string, importId: string, message: string) {
  const t = schema;
  await tx
    .update(t.fitnessImports)
    .set({ status: "failed", error: message, updatedAt: new Date() })
    .where(
      and(
        eq(t.fitnessImports.tenantId, tenantId),
        eq(t.fitnessImports.id, importId),
        eq(t.fitnessImports.status, "drafting"),
      ),
    );
}

/**
 * The person threw the draft away. A draft or a failure can be discarded, and
 * so can a draft that was interrupted (`settleImport`); one still drafting
 * inside the window cannot.
 */
export async function discardImport(tx: Tx, tenantId: string, importId: string): Promise<void> {
  const t = schema;
  const changed = await tx
    .update(t.fitnessImports)
    .set({ status: "discarded", draft: null, updatedAt: new Date() })
    .where(
      and(
        eq(t.fitnessImports.tenantId, tenantId),
        eq(t.fitnessImports.id, importId),
        or(
          inArray(t.fitnessImports.status, ["draft", "failed"]),
          and(
            eq(t.fitnessImports.status, "drafting"),
            lte(t.fitnessImports.createdAt, new Date(Date.now() - DRAFTING_WINDOW_MS)),
          ),
        ),
      ),
    )
    .returning({ id: t.fitnessImports.id });
  if (changed.length === 0) throw new FitnessError("NOT_FOUND");
}

/**
 * The draft became a program. The draft itself is dropped: the program is
 * now the record, and a stored copy of the book's gist has no further use.
 */
export async function markImportSaved(
  tx: Tx,
  tenantId: string,
  importId: string,
  programId: string,
): Promise<void> {
  const t = schema;
  const changed = await tx
    .update(t.fitnessImports)
    .set({ status: "saved", programId, draft: null, updatedAt: new Date() })
    .where(
      and(
        eq(t.fitnessImports.tenantId, tenantId),
        eq(t.fitnessImports.id, importId),
        eq(t.fitnessImports.status, "draft"),
      ),
    )
    .returning({ id: t.fitnessImports.id });
  if (changed.length === 0) throw new FitnessError("STALE");
}

export async function getImport(
  tx: Tx,
  tenantId: string,
  importId: string,
): Promise<FitnessImport | null> {
  const t = schema;
  const [row] = await tx
    .select()
    .from(t.fitnessImports)
    .where(and(eq(t.fitnessImports.tenantId, tenantId), eq(t.fitnessImports.id, importId)));
  return row ? settleImport(row) : null;
}

/** A stored draft, read back through the same schema the editor saves with. */
export function importDraft(row: FitnessImport): ProgramInput | null {
  const parsed = programInputSchema.safeParse(row.draft);
  return parsed.success ? parsed.data : null;
}

/**
 * Drafts still waiting for the person: drafting, ready to review, or failed
 * (an interrupted one among them, `settleImport`).
 */
export async function listOpenImports(tx: Tx, tenantId: string): Promise<FitnessImport[]> {
  const t = schema;
  const rows = await tx
    .select()
    .from(t.fitnessImports)
    .where(
      and(
        eq(t.fitnessImports.tenantId, tenantId),
        inArray(t.fitnessImports.status, ["drafting", "draft", "failed"]),
      ),
    )
    .orderBy(desc(t.fitnessImports.createdAt))
    .limit(10);
  const now = new Date();
  return rows.map((row) => settleImport(row, now));
}
