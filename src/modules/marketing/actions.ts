"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { logAuditInTx } from "@/lib/audit";
import {
  BRAND_DISPLAY_NAME_MAX,
  BRAND_TAGLINE_MAX,
  normalizeHexColor,
} from "@/lib/brand/core";
import { MarketingError, friendlyMessage } from "./core/errors";
import {
  clearKitLogo,
  deleteCompanyKit,
  ensureKit,
  saveKitFields,
  setKitLogo,
  type MarketingCtx,
} from "./kit-ops";
import { discardLogoBlob, inspectUploadedLogo } from "./logo-ingest";

/**
 * Server actions for the Marketing module. Canonical shape:
 * gate → Zod → withTenant(core + audit) → revalidate.
 *
 * **EVERY WRITE HERE IS OWNER-ONLY, and not as a matter of taste.** How the
 * business looks to its customers is a decision, not a chore
 * (`src/lib/packs/authorize.ts` draws that line for the packs, and this is the
 * same line): the logo on every invoice is chosen by whoever owns the business.
 * Staff see the kit and cannot change it; the accountant is read-only here as
 * in every core module.
 */
const BASE = "/dashboard/m/marketing";

type ActionResult<T = undefined> = { ok: true; data?: T } | { error: string };

async function gate(): Promise<MarketingCtx> {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "marketing");
  if (ctx.role === "expert") {
    throw new MarketingError("FORBIDDEN_EXPERT", "accountant access is read-only");
  }
  if (ctx.role !== "owner") {
    throw new MarketingError("FORBIDDEN", "owner role required");
  }
  return { tenantId: ctx.tenant.id, userId: ctx.userId, role: ctx.role };
}

function fail(err: unknown): { error: string } {
  if (!(err instanceof MarketingError)) {
    console.error("marketing action failed", err);
  }
  return { error: friendlyMessage(err) };
}

function revalidate(): void {
  revalidatePath(BASE);
}

const entityIdSchema = z.string().uuid().nullable();

const fieldsSchema = z.object({
  entityId: entityIdSchema,
  displayName: z.string().trim().max(BRAND_DISPLAY_NAME_MAX),
  tagline: z.string().trim().max(BRAND_TAGLINE_MAX),
  primaryColor: z.string().trim().max(16),
  accentColor: z.string().trim().max(16),
});

const COLOR_MESSAGE =
  "A color needs to be a hex value like #1f6f5f, or left blank.";

/** Empty stays empty; anything else must normalise, or the action refuses. */
function colorOrNull(raw: string): string | null {
  if (raw === "") return "";
  return normalizeHexColor(raw);
}

export async function saveBrandKitAction(
  input: unknown,
): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = fieldsSchema.safeParse(input);
    if (!parsed.success) return { error: "Check the fields and try again." };
    const primaryColor = colorOrNull(parsed.data.primaryColor);
    const accentColor = colorOrNull(parsed.data.accentColor);
    if (primaryColor === null || accentColor === null) {
      return { error: COLOR_MESSAGE };
    }
    await withTenant(
      ctx.tenantId,
      async (tx) => {
        const kit = await saveKitFields(tx, ctx, parsed.data.entityId, {
          displayName: parsed.data.displayName,
          tagline: parsed.data.tagline,
          primaryColor,
          accentColor,
        });
        await logAuditInTx(tx, {
          action: "marketing.brand_kit.saved",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "brand_kit",
          targetId: kit.id,
          meta: { entityId: parsed.data.entityId },
        });
      },
      { role: ctx.role },
    );
    revalidate();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

const logoSchema = z.object({
  entityId: entityIdSchema,
  pathname: z.string().min(1).max(500),
});

export async function setBrandLogoAction(
  input: unknown,
): Promise<ActionResult> {
  let pathname: string | null = null;
  try {
    const ctx = await gate();
    const parsed = logoSchema.safeParse(input);
    if (!parsed.success) return { error: "The upload didn't finish. Try again." };
    pathname = parsed.data.pathname;
    // Blob work first and outside the transaction; the row only ever points at
    // a logo that has been read and understood.
    const logo = await inspectUploadedLogo(ctx.tenantId, pathname);
    const { kit, previous } = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const result = await setKitLogo(tx, ctx, parsed.data.entityId, logo);
        await logAuditInTx(tx, {
          action: "marketing.brand_kit.logo_set",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "brand_kit",
          targetId: result.kit.id,
          meta: { entityId: parsed.data.entityId, mimeType: logo.mimeType },
        });
        return result;
      },
      { role: ctx.role },
    );
    // Only now, with the new row committed, is the old file unreferenced.
    if (previous && previous !== kit.logoPathname) await discardLogoBlob(previous);
    revalidate();
    return { ok: true };
  } catch (err) {
    // A rejected upload must not linger in the store: nothing references it
    // and nothing ever will. Guarded by the same namespace check registration
    // applies, so a forged pathname cannot make this delete somebody's file.
    if (
      pathname &&
      err instanceof MarketingError &&
      (err.code === "LOGO_NOT_AN_IMAGE" || err.code === "LOGO_TOO_LARGE")
    ) {
      await discardLogoBlob(pathname);
    }
    return fail(err);
  }
}

const entityOnlySchema = z.object({ entityId: entityIdSchema });

export async function removeBrandLogoAction(
  input: unknown,
): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = entityOnlySchema.safeParse(input);
    if (!parsed.success) return { error: "Check the fields and try again." };
    const { kit, previous } = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const result = await clearKitLogo(tx, ctx, parsed.data.entityId);
        await logAuditInTx(tx, {
          action: "marketing.brand_kit.logo_removed",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "brand_kit",
          targetId: result.kit.id,
          meta: { entityId: parsed.data.entityId },
        });
        return result;
      },
      { role: ctx.role },
    );
    void kit;
    await discardLogoBlob(previous);
    revalidate();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

const companySchema = z.object({ entityId: z.string().uuid() });

/** A company gets a look of its own — an empty kit to fill in. */
export async function startCompanyLookAction(
  input: unknown,
): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = companySchema.safeParse(input);
    if (!parsed.success) return { error: "Pick a company and try again." };
    await withTenant(
      ctx.tenantId,
      async (tx) => {
        const kit = await ensureKit(tx, ctx, parsed.data.entityId);
        await logAuditInTx(tx, {
          action: "marketing.brand_kit.company_look_started",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "brand_kit",
          targetId: kit.id,
          meta: { entityId: parsed.data.entityId },
        });
      },
      { role: ctx.role },
    );
    revalidate();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/** Back to the business look: the company's kit and its own logo go. */
export async function removeCompanyLookAction(
  input: unknown,
): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = companySchema.safeParse(input);
    if (!parsed.success) return { error: "Pick a company and try again." };
    const { previous } = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const result = await deleteCompanyKit(tx, ctx, parsed.data.entityId);
        await logAuditInTx(tx, {
          action: "marketing.brand_kit.company_look_removed",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "entity",
          targetId: parsed.data.entityId,
        });
        return result;
      },
      { role: ctx.role },
    );
    await discardLogoBlob(previous);
    revalidate();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
