"use server";

import { z } from "zod";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { JobsError, type JobsCtx } from "./ops";
import { PACK } from "./vocabulary";
import { MAX_SCHEDULE_CHARS } from "./bim-schedule";
import {
  previewTakeoff,
  takeoffItems,
  type TakeoffPreview,
  type TakeoffResult,
} from "./bim-takeoff-ops";

export type { TakeoffPreview, TakeoffResult } from "./bim-takeoff-ops";

/**
 * THE TAKEOFF OFF THE MODEL, AS THE ESTIMATE EDITOR ASKS FOR IT (X15).
 *
 * Two doors: read the file and say what it holds, then make the items the
 * person confirmed. Neither writes an estimate line — the editor holds the
 * estimate and saves itself (ADR 0082) — so the second returns items the
 * way `dropAssemblyAction` does and the editor appends them.
 */

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

const textSchema = z.object({
  projectId: z.string().uuid(),
  text: z.string().min(1).max(MAX_SCHEDULE_CHARS),
  fileName: z.string().trim().max(200).default(""),
  /** The column that names things, and the one that splits a name; -1 for none (X16). */
  keyBy: z.number().int().min(0).max(500).optional(),
  alsoBy: z.number().int().min(-1).max(500).optional(),
});

export async function previewTakeoffAction(
  input: unknown,
): Promise<{ ok: true; preview: TakeoffPreview } | { error: string }> {
  const parsed = textSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the file and try again." };
  try {
    const ctx = await gate();
    const preview = await withTenant(
      ctx.tenantId,
      (tx) =>
        previewTakeoff(tx, ctx.tenantId, parsed.data.text, parsed.data.fileName, {
          keyBy: parsed.data.keyBy,
          alsoBy: parsed.data.alsoBy,
        }),
      { role: ctx.role },
    );
    return { ok: true as const, preview };
  } catch (err) {
    return toResult(err);
  }
}

const itemsSchema = textSchema.extend({
  choices: z
    .array(
      z.object({
        key: z.string().trim().min(1).max(300),
        assemblyId: z.string().uuid().optional(),
        lineFrom: z.string().trim().max(120).optional(),
        remember: z.boolean().optional(),
      }),
    )
    .max(500),
});

export async function takeoffFromModelAction(
  input: unknown,
): Promise<{ ok: true; result: TakeoffResult } | { error: string }> {
  const parsed = itemsSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the file and try again." };
  try {
    const ctx = await gate();
    const result = await withTenant(
      ctx.tenantId,
      (tx) =>
        takeoffItems(tx, ctx, {
          projectId: parsed.data.projectId,
          text: parsed.data.text,
          fileName: parsed.data.fileName,
          choices: parsed.data.choices,
          named: { keyBy: parsed.data.keyBy, alsoBy: parsed.data.alsoBy },
        }),
      { role: ctx.role },
    );
    return { ok: true as const, result };
  } catch (err) {
    return toResult(err);
  }
}
