"use server";

import { z } from "zod";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { logAudit } from "@/lib/audit";
import { CLAUDE_MODEL } from "@/lib/claude";
import { packContext } from "@/lib/packs/tenant-context";
import { toResult } from "./action-errors";
import { requireWrite } from "./ops";
import { readKillSheet } from "./ai/kill-sheet";
import { readPriceList } from "./ai/price-list";
import {
  PAPERWORK_MAX_UPLOAD_BYTES,
  isPaperworkMime,
} from "./ai/paperwork";
import { processorHandlesFrom } from "./vocabulary";

/**
 * Reading somebody else's paperwork.
 *
 * **NEITHER ACTION WRITES A SINGLE ROW.** They return a proposal for a person to
 * correct and confirm; the confirm calls `addRunCarcassAction`,
 * `setHandleAction` or `setPriceItemAction` — the ordinary write paths, one row
 * at a time, with the ordinary validation and the ordinary audit entries. See
 * `ai/paperwork.ts` for why that is not negotiable on these tables in
 * particular.
 *
 * **THE AUDIT ENTRY RECORDS THAT A MODEL WAS ASKED, and nothing it said.** How
 * many rows came back is a fact about the request; the fees and the
 * condemnations are proposals nobody has agreed to yet, and logging them would
 * put unconfirmed numbers about a named business into the permanent record. The
 * confirmed values are audited by the write actions, where they belong.
 *
 * **OWNER, both of them.** Reading a price list is the first half of changing
 * what a plant charges, and reading a kill sheet spends money on a model call.
 * The kill sheet's own write path is MEMBER — transcribing is a chore — and the
 * asymmetry is deliberate: pressing a button that costs money is not the same
 * act as typing what is in front of you.
 */

const PACK = "production";

/**
 * The file, as a data URL from the browser.
 *
 * A server action cannot take a `File` across the boundary in a way that is
 * worth the plumbing here, and the sizes involved are a photograph rather than a
 * video. The cap is checked twice — once on the encoded string, cheaply, and
 * once on the decoded bytes in `preparePaperwork`, which is the number that
 * actually matters.
 */
const upload = z.object({
  mimeType: z.string().min(1).max(120),
  // base64 is ~4/3 of the bytes; this is a cheap early refusal, not the rule.
  base64: z
    .string()
    .min(1)
    .max(Math.ceil((PAPERWORK_MAX_UPLOAD_BYTES * 4) / 3) + 1024),
});

function decode(base64: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64, "base64"));
}

export async function readKillSheetAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z.object({ runId: z.string().uuid(), ...upload.shape }).safeParse(input);
  if (!parsed.success) return { error: "Check the file and try again." };
  if (!isPaperworkMime(parsed.data.mimeType)) {
    return { error: "That is not a kind of file this can read — a photograph or a PDF." };
  }

  try {
    // Not a database write, but the role rule is the same one the ops layer
    // applies, so it comes from the same function rather than a second copy.
    requireWrite(
      { tenantId: ctx.tenant.id, userId: ctx.userId, role: ctx.role },
      "owner",
    );
    const proposal = await readKillSheet({
      mimeType: parsed.data.mimeType,
      bytes: decode(parsed.data.base64),
    });
    await logAudit({
      action: "production.paperwork.read",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "production_run",
      targetId: parsed.data.runId,
      // What was asked and how much came back. Never what it said.
      meta: {
        kind: "kill_sheet",
        model: CLAUDE_MODEL,
        mimeType: parsed.data.mimeType,
        lines: proposal.lines.length,
      },
    });
    return { ok: true, proposal };
  } catch (err) {
    return toResult(err);
  }
}

export async function readPriceListAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({ processorId: z.string().uuid(), ...upload.shape })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the file and try again." };
  if (!isPaperworkMime(parsed.data.mimeType)) {
    return { error: "That is not a kind of file this can read — a photograph or a PDF." };
  }

  try {
    requireWrite(
      { tenantId: ctx.tenant.id, userId: ctx.userId, role: ctx.role },
      "owner",
    );
    // The profile's vocabulary, so the model maps onto this farm's words rather
    // than inventing its own. Read inside a tenant transaction like any config.
    const pack = await withTenant(
      ctx.tenant.id,
      (tx) => packContext(tx, ctx.tenant.id, ctx.tenant.industry, PACK),
      { role: ctx.role },
    );
    const proposal = await readPriceList(
      {
        mimeType: parsed.data.mimeType,
        bytes: decode(parsed.data.base64),
      },
      processorHandlesFrom(pack.config),
    );
    await logAudit({
      action: "production.paperwork.read",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "production_processor",
      targetId: parsed.data.processorId,
      meta: {
        kind: "price_list",
        model: CLAUDE_MODEL,
        mimeType: parsed.data.mimeType,
        items: proposal.items.length,
        animals: proposal.animals.length,
      },
    });
    return { ok: true, proposal };
  } catch (err) {
    return toResult(err);
  }
}
