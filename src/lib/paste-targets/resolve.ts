import "server-only";
import { withTenant } from "@/db";
import { logAuditInTx } from "@/lib/audit";
import { isModuleEnabled } from "@/lib/modules";
import { callProposeModel, claimCooldown, type PasteImage, type ProposeModel } from "./model";
import { pasteTargets } from "./registry";
import {
  checkRow,
  PASTE_MAX_ROWS,
  resolveRows,
  rowLabel,
  validateProposal,
  type ReviewRow,
} from "./shape";
import {
  PasteRefusal,
  type PasteCtx,
  type PasteField,
  type PasteRow,
  type PasteSaved,
  type PasteSavedRow,
  type PasteTarget,
} from "./types";

/**
 * Running a target: finding it, proposing rows for it, saving what a person
 * kept. The posture is `crm/note-actions.ts`'s — two halves, and the split is
 * the safety property. `proposeForTarget` writes NOTHING. `saveForTarget`
 * writes what the person confirmed, and it never sees the model's output: its
 * input is the reviewed list, checked against the target's fields on its own
 * terms and then handed to the module's own verb.
 *
 * Nothing here re-checks what a target may see. Each half is one tenant
 * transaction under the caller's role, and RLS has already decided.
 */

export type PasteErrorCode =
  | "TARGET_UNKNOWN"
  | "TARGET_OFF"
  | "READ_ONLY"
  | "BLOCKED"
  | "NOTHING_TO_READ"
  | "TOO_LONG"
  | "FILE_TYPE"
  | "FILE_SIZE"
  | "COOLDOWN"
  | "NO_RESULT"
  | "TOO_MANY"
  | "NOTHING_KEPT"
  | "ROW";

export class PasteError extends Error {
  constructor(
    public readonly code: PasteErrorCode,
    message: string,
    public readonly detail: { index?: number; label?: string | null } = {},
  ) {
    super(message);
    this.name = "PasteError";
  }
}

/** The words the dialog shows. Static, except a refusal, which names the row. */
export function friendlyPasteError(err: unknown): string {
  if (err instanceof PasteError) {
    switch (err.code) {
      case "TARGET_UNKNOWN":
      case "TARGET_OFF":
        return "That list cannot be pasted here.";
      case "READ_ONLY":
        return "Accountant access is read-only — reviews, sign-offs and exports only.";
      case "BLOCKED":
        return err.message;
      case "NOTHING_TO_READ":
        return "Paste something, or add a photo.";
      case "TOO_LONG":
        return "That is too much at once — paste it in pieces.";
      case "FILE_TYPE":
        return "A photo (JPEG, PNG, WebP or GIF) or a PDF.";
      case "FILE_SIZE":
        return "That file is too large. 4 MB at most.";
      case "COOLDOWN":
        return "Give it a few seconds, then try again.";
      case "NO_RESULT":
        return "It could not read that. Try a cleaner copy, or fewer rows at a time.";
      case "TOO_MANY":
        return `At most ${PASTE_MAX_ROWS} rows at a time.`;
      case "NOTHING_KEPT":
        return "Nothing is ticked.";
      case "ROW": {
        // A refusal from `afterSave` names its own row; nothing to prefix.
        if (err.detail.index === undefined) return err.message;
        const where = `Row ${err.detail.index + 1}${
          err.detail.label ? ` (${err.detail.label})` : ""
        }`;
        return `${where}: ${err.message}`;
      }
    }
  }
  console.error("paste failed", err);
  return "Something went wrong. Nothing was saved.";
}

/* -- Finding a target ----------------------------------------------------- */

export function pasteTargetBySlug(slug: string): PasteTarget | null {
  return pasteTargets.find((t) => t.slug === slug) ?? null;
}

/** The target, if it exists and its module is on for this tenant. */
export async function enabledPasteTarget(tenantId: string, slug: string): Promise<PasteTarget> {
  const target = pasteTargetBySlug(slug);
  if (!target) throw new PasteError("TARGET_UNKNOWN", slug);
  if (!(await isModuleEnabled(tenantId, target.moduleSlug))) {
    throw new PasteError("TARGET_OFF", `${target.moduleSlug} is off`);
  }
  return target;
}

/* -- Propose -------------------------------------------------------------- */

export interface PasteProposal {
  fields: PasteField[];
  rows: ReviewRow[];
}

/**
 * Describe under the tenant's RLS, call the model outside any transaction,
 * judge every cell, then ask the target what each row looks like it already
 * is. Nothing is written.
 */
export async function proposeForTarget(
  ctx: PasteCtx,
  target: PasteTarget,
  input: { text: string; image: PasteImage | null },
  model: ProposeModel = callProposeModel,
): Promise<PasteProposal> {
  const shape = await withTenant(ctx.tenantId, (tx) => target.describe(tx, ctx), {
    role: ctx.role,
    userId: ctx.userId,
  });
  if (shape.blocked) throw new PasteError("BLOCKED", shape.blocked);

  if (!claimCooldown(ctx.tenantId)) throw new PasteError("COOLDOWN", "within the window");

  const raw = await model({
    about: target.about,
    fields: shape.fields,
    text: input.text,
    image: input.image,
  });
  const rawRows = validateProposal(raw);
  if (!rawRows) throw new PasteError("NO_RESULT", "schema mismatch");

  const rows = resolveRows(rawRows, shape.fields);
  if (rows.length > 0) {
    const dups = await withTenant(
      ctx.tenantId,
      (tx) =>
        target.duplicates(
          tx,
          ctx,
          rows.map((r) => r.values),
        ),
      { role: ctx.role, userId: ctx.userId },
    );
    rows.forEach((r, i) => {
      r.duplicateOf = dups[i] ?? null;
    });
  }
  return { fields: shape.fields, rows };
}

/* -- Save what was reviewed ----------------------------------------------- */

/**
 * Validated on its own terms, NOT trusted because it came from the proposal.
 * The person has edited it, and this function has no way to know which parts
 * are theirs and which are the model's — so all of it is ordinary input,
 * checked against the fields as they stand NOW (the choices are read again),
 * and then given to the module's verb, which refuses what it refuses.
 *
 * Every row is checked before any row is written, and a refusal from the verb
 * rolls the whole transaction back: all rows or none, with the row named.
 */
export async function saveForTarget(
  ctx: PasteCtx,
  target: PasteTarget,
  rows: PasteRow[],
): Promise<PasteSaved[]> {
  if (rows.length === 0) throw new PasteError("NOTHING_KEPT", "no rows");
  if (rows.length > PASTE_MAX_ROWS) throw new PasteError("TOO_MANY", `${rows.length} rows`);

  return withTenant(
    ctx.tenantId,
    async (tx) => {
      const shape = await target.describe(tx, ctx);
      if (shape.blocked) throw new PasteError("BLOCKED", shape.blocked);

      // Only the declared keys reach the verb; anything else in a row is
      // dropped here rather than passed along to be ignored, or not.
      const clean: PasteRow[] = rows.map((row) => {
        const out: PasteRow = {};
        for (const f of shape.fields) out[f.key] = row[f.key] ?? null;
        return out;
      });
      clean.forEach((row, index) => {
        const problem = checkRow(row, shape.fields);
        if (problem) {
          throw new PasteError("ROW", problem, { index, label: rowLabel(row, shape.fields) });
        }
      });

      const saved: PasteSavedRow[] = [];
      for (const [index, row] of clean.entries()) {
        try {
          saved.push({ index, row, saved: await target.save(tx, ctx, row) });
        } catch (err) {
          throw refusalOrRethrow(err, index, rowLabel(row, shape.fields));
        }
      }
      if (target.afterSave) {
        try {
          await target.afterSave(tx, ctx, saved);
        } catch (err) {
          throw refusalOrRethrow(err, null, null);
        }
      }

      // Audited AI-ASSISTED, with counts only. Somebody asking "where did these
      // twelve vendors come from?" gets a truthful answer, and the row carries
      // none of the list (S9).
      await logAuditInTx(tx, {
        action: "paste.rows_saved",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "paste_target",
        targetId: null,
        meta: { target: target.slug, rows: saved.length },
      });
      return saved.map((s) => s.saved);
    },
    { role: ctx.role, userId: ctx.userId },
  );
}

/**
 * A refusal the target raised becomes a named-row error; anything else is a
 * failure and propagates as one. A target's `afterSave` names its own row in
 * the message, because it is the only party that knows which one.
 */
function refusalOrRethrow(err: unknown, index: number | null, label: string | null): unknown {
  if (err instanceof PasteRefusal) {
    return index === null
      ? new PasteError("ROW", err.message, { index: undefined, label: null })
      : new PasteError("ROW", err.message, { index, label });
  }
  return err;
}
