import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { BrandKit } from "@/db/schema";
import type { TenantRole } from "@/lib/auth";
import type { LogoSpec } from "@/lib/brand/logo-spec";
import { MarketingError } from "./core/errors";

/**
 * Writing the brand kit. Takes the caller's `tx`; the action layer owns the
 * transaction, the gate and the audit row (docs/conventions.md §1).
 *
 * `entityId` null is the business-wide kit; set, it is one company's own look
 * and is proved to be this tenant's company before anything is written. The
 * composite FK on the table makes another tenant's company unrepresentable
 * even under `withSystem`; this check is what turns that into a friendly
 * message instead of a constraint error.
 */
export interface MarketingCtx {
  tenantId: string;
  userId: string;
  role: TenantRole;
}

export interface KitFieldsPatch {
  displayName: string;
  tagline: string;
  /** `#rrggbb` or empty — already normalised by the action. */
  primaryColor: string;
  accentColor: string;
}

export interface KitLogo {
  pathname: string;
  mimeType: string;
  width: number;
  height: number;
  bytes: number;
  /** `upload` for a file the owner brought (an SVG included), `generated` for one the kit drew. */
  source: "upload" | "generated";
  /** The `LogoSpec` a generated logo was drawn from; `{}` for an upload. */
  spec: LogoSpec | Record<string, never>;
}

function kitWhere(tenantId: string, entityId: string | null) {
  return entityId === null
    ? and(
        eq(schema.brandKits.tenantId, tenantId),
        isNull(schema.brandKits.entityId),
      )
    : and(
        eq(schema.brandKits.tenantId, tenantId),
        eq(schema.brandKits.entityId, entityId),
      );
}

export async function findKit(
  tx: Tx,
  tenantId: string,
  entityId: string | null,
): Promise<BrandKit | null> {
  const row = await tx.query.brandKits.findFirst({
    where: kitWhere(tenantId, entityId),
  });
  return row ?? null;
}

/** A company id from a client is a claim until this proves it. */
export async function assertCompany(
  tx: Tx,
  tenantId: string,
  entityId: string,
): Promise<void> {
  const row = await tx.query.entities.findFirst({
    where: and(
      eq(schema.entities.tenantId, tenantId),
      eq(schema.entities.id, entityId),
    ),
    columns: { id: true },
  });
  // 404-shaped, never 403-shaped: another tenant's company must look exactly
  // like a company that does not exist (docs/security.md §4).
  if (!row) throw new MarketingError("COMPANY_NOT_FOUND", "no such company");
}

/**
 * The row for (tenant, company), created empty if it is not there yet. An
 * empty row is meaningful for a company: it is the owner's decision that this
 * company has a look of its own, even before a field is filled in.
 */
export async function ensureKit(
  tx: Tx,
  ctx: MarketingCtx,
  entityId: string | null,
): Promise<BrandKit> {
  if (entityId) await assertCompany(tx, ctx.tenantId, entityId);
  const existing = await findKit(tx, ctx.tenantId, entityId);
  if (existing) return existing;
  const [created] = await tx
    .insert(schema.brandKits)
    .values({
      tenantId: ctx.tenantId,
      entityId,
      updatedByClerkUserId: ctx.userId,
    })
    .returning();
  // RLS refuses the insert outright for a non-owner, so this is only reached
  // with a row in hand — the check is for the type, not for a hole.
  if (!created) throw new MarketingError("FORBIDDEN", "kit not created");
  return created;
}

async function updateKit(
  tx: Tx,
  ctx: MarketingCtx,
  kitId: string,
  patch: Partial<typeof schema.brandKits.$inferInsert>,
): Promise<BrandKit> {
  const [updated] = await tx
    .update(schema.brandKits)
    .set({ ...patch, updatedByClerkUserId: ctx.userId, updatedAt: new Date() })
    .where(
      and(
        eq(schema.brandKits.tenantId, ctx.tenantId),
        eq(schema.brandKits.id, kitId),
      ),
    )
    .returning();
  // Zero rows is how RLS says no to an UPDATE (no USING clause satisfied), so
  // it is treated as the refusal it is rather than as success.
  if (!updated) throw new MarketingError("FORBIDDEN", "kit not updated");
  return updated;
}

export async function saveKitFields(
  tx: Tx,
  ctx: MarketingCtx,
  entityId: string | null,
  patch: KitFieldsPatch,
): Promise<BrandKit> {
  const kit = await ensureKit(tx, ctx, entityId);
  return updateKit(tx, ctx, kit.id, patch);
}

/** Returns the pathname the new logo replaced, for the caller to discard AFTER commit. */
export async function setKitLogo(
  tx: Tx,
  ctx: MarketingCtx,
  entityId: string | null,
  logo: KitLogo,
): Promise<{ kit: BrandKit; previous: string | null }> {
  const kit = await ensureKit(tx, ctx, entityId);
  const updated = await updateKit(tx, ctx, kit.id, {
    logoPathname: logo.pathname,
    logoMimeType: logo.mimeType,
    logoWidth: logo.width,
    logoHeight: logo.height,
    logoBytes: logo.bytes,
    logoSource: logo.source,
    logoSpec: logo.spec,
  });
  return { kit: updated, previous: kit.logoPathname };
}

export async function clearKitLogo(
  tx: Tx,
  ctx: MarketingCtx,
  entityId: string | null,
): Promise<{ kit: BrandKit; previous: string | null }> {
  const kit = await ensureKit(tx, ctx, entityId);
  const updated = await updateKit(tx, ctx, kit.id, {
    logoPathname: null,
    logoMimeType: "",
    logoWidth: 0,
    logoHeight: 0,
    logoBytes: 0,
    logoSource: "upload",
    logoSpec: {},
  });
  return { kit: updated, previous: kit.logoPathname };
}

/**
 * A company goes back to the business look: its row goes, and with it its own
 * logo (returned so the caller discards the blob after commit). The
 * business-wide kit cannot be deleted this way — there is always a business
 * look, even if every field of it is empty.
 */
export async function deleteCompanyKit(
  tx: Tx,
  ctx: MarketingCtx,
  entityId: string,
): Promise<{ previous: string | null }> {
  await assertCompany(tx, ctx.tenantId, entityId);
  const [deleted] = await tx
    .delete(schema.brandKits)
    .where(kitWhere(ctx.tenantId, entityId))
    .returning({ logoPathname: schema.brandKits.logoPathname });
  return { previous: deleted?.logoPathname ?? null };
}
