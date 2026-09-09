"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenant } from "@/lib/auth";
import { prepareImage, type PasteImage } from "./model";
import {
  enabledPasteTarget,
  friendlyPasteError,
  PasteError,
  proposeForTarget,
  saveForTarget,
} from "./resolve";
import {
  PASTE_IMAGE_MAX_BYTES,
  PASTE_IMAGE_TYPES,
  PASTE_MAX_CHARS,
  savedRowsSchema,
  type ReviewRow,
} from "./shape";
import type { PasteCtx, PasteField, PasteRow } from "./types";

/**
 * Paste a list, get rows; review them, then save.
 *
 * TWO ACTIONS ON PURPOSE, and the split is the safety property (see
 * `resolve.ts`). `proposePaste` writes NOTHING. `savePaste` writes what the
 * person ticked, through the module's own verb.
 *
 * Platform code in `src/lib/`, like `work/actions.ts`: no module hosts the
 * dialog, so no module hosts its actions.
 */

/**
 * The accountant role is read-only across the product and is refused here
 * before any target is asked. Staff pass through: the accounting targets take
 * a vendor from staff, and the packs' verbs refuse staff with their own words,
 * which is the rule "the module's refusals are the refusals" kept.
 */
async function gate(): Promise<PasteCtx> {
  const ctx = await requireTenant();
  if (ctx.role === "expert") throw new PasteError("READ_ONLY", "accountant access is read-only");
  return {
    tenantId: ctx.tenant.id,
    userId: ctx.userId,
    role: ctx.role,
    industry: ctx.tenant.industry ?? null,
  };
}

const slugSchema = z.string().regex(/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/);

/* -- Propose -------------------------------------------------------------- */

export type ProposePasteResult =
  | { ok: true; fields: PasteField[]; rows: ReviewRow[] }
  | { error: string };

/**
 * FormData rather than JSON because a photo may come with the text. The file
 * is read into memory here — it is capped at 4 MB — normalised for the vision
 * API, and never stored: a paste is not a document.
 */
export async function proposePasteAction(formData: FormData): Promise<ProposePasteResult> {
  try {
    const ctx = await gate();
    const slug = slugSchema.safeParse(formData.get("slug"));
    if (!slug.success) return { error: "Invalid input" };
    const text = String(formData.get("text") ?? "");
    if (text.length > PASTE_MAX_CHARS) throw new PasteError("TOO_LONG", `${text.length} chars`);

    const file = formData.get("file");
    let image: PasteImage | null = null;
    if (file instanceof Blob && file.size > 0) {
      if (!(PASTE_IMAGE_TYPES as readonly string[]).includes(file.type)) {
        throw new PasteError("FILE_TYPE", file.type);
      }
      if (file.size > PASTE_IMAGE_MAX_BYTES) throw new PasteError("FILE_SIZE", `${file.size}`);
      image = await prepareImage(new Uint8Array(await file.arrayBuffer()), file.type);
    }
    if (text.trim() === "" && !image) throw new PasteError("NOTHING_TO_READ", "empty");

    const target = await enabledPasteTarget(ctx.tenantId, slug.data);
    const proposal = await proposeForTarget(ctx, target, { text, image });
    return { ok: true, fields: proposal.fields, rows: proposal.rows };
  } catch (err) {
    return { error: friendlyPasteError(err) };
  }
}

/* -- Save what was reviewed ----------------------------------------------- */

const saveSchema = z.object({
  slug: slugSchema,
  rows: savedRowsSchema,
});

export type SavePasteResult =
  | { ok: true; saved: number; labels: string[] }
  | { error: string };

export async function savePasteAction(input: {
  slug: string;
  rows: PasteRow[];
}): Promise<SavePasteResult> {
  try {
    const ctx = await gate();
    const parsed = saveSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    const target = await enabledPasteTarget(ctx.tenantId, parsed.data.slug);
    const saved = await saveForTarget(ctx, target, parsed.data.rows);
    for (const path of target.revalidate) revalidatePath(path);
    return { ok: true, saved: saved.length, labels: saved.map((s) => s.label) };
  } catch (err) {
    return { error: friendlyPasteError(err) };
  }
}
