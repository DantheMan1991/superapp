import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { BrandKit } from "@/db/schema";
import type { TenantRole } from "@/lib/auth";
import type { LogoSpec } from "@/lib/brand/logo-spec";
import { BUSINESS_KIT, ownerFields, type KitOwner } from "@/lib/brand/owner";
import { MarketingError } from "./core/errors";

/** Re-exported so a server caller needs one import, not two. */
export { BUSINESS_KIT, type KitOwner };

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
  /** One of the lists in `src/lib/brand/looks.ts`, or empty — checked by the action's Zod. */
  look: string;
  fontPairing: string;
  buttonShape: string;
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

/**
 * WHOSE LOOK THIS IS (ADR 0045) — a discriminated union rather than the
 * `entityId: string | null` this used to be, because that shape had exactly
 * two states and there are now three. The third would otherwise have been a
 * second nullable parameter, and every function here would have had to decide
 * what `(entityId, siteId)` both set means — a question `brand_kits_one_owner`
 * already refuses to represent.
 *
 * The type itself lives in `src/lib/brand/owner.ts`, not here: this module is
 * `server-only` and the screens that edit a kit are client components.
 */

/**
 * The business-wide kit is the row with BOTH owner columns null. A company's
 * and a website's kit each carry a null in the other's column, so a predicate
 * naming only one would find the wrong row — which is how a site's logo could
 * have reached the invoices before ADR 0045 closed it.
 */
function kitWhere(tenantId: string, owner: KitOwner) {
  const mine = eq(schema.brandKits.tenantId, tenantId);
  switch (owner.kind) {
    case "business":
      return and(mine, isNull(schema.brandKits.entityId), isNull(schema.brandKits.siteId));
    case "company":
      return and(mine, eq(schema.brandKits.entityId, owner.entityId));
    case "site":
      return and(mine, eq(schema.brandKits.siteId, owner.siteId));
  }
}

export async function findKit(
  tx: Tx,
  tenantId: string,
  owner: KitOwner,
): Promise<BrandKit | null> {
  const row = await tx.query.brandKits.findFirst({
    where: kitWhere(tenantId, owner),
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

/** A site id from a client is a claim until this proves it, exactly as a company's is. */
export async function assertSite(
  tx: Tx,
  tenantId: string,
  siteId: string,
): Promise<void> {
  const row = await tx.query.sites.findFirst({
    where: and(eq(schema.sites.tenantId, tenantId), eq(schema.sites.id, siteId)),
    columns: { id: true },
  });
  if (!row) throw new MarketingError("SITE_MISSING", "no such site");
}

/** Whichever of the two an owner names; the business names neither. */
async function assertOwner(tx: Tx, tenantId: string, owner: KitOwner): Promise<void> {
  if (owner.kind === "company") await assertCompany(tx, tenantId, owner.entityId);
  if (owner.kind === "site") await assertSite(tx, tenantId, owner.siteId);
}

/**
 * The row for (tenant, company), created empty if it is not there yet. An
 * empty row is meaningful for a company: it is the owner's decision that this
 * company has a look of its own, even before a field is filled in.
 */
export async function ensureKit(
  tx: Tx,
  ctx: MarketingCtx,
  owner: KitOwner,
): Promise<BrandKit> {
  await assertOwner(tx, ctx.tenantId, owner);
  const existing = await findKit(tx, ctx.tenantId, owner);
  if (existing) return existing;
  const [created] = await tx
    .insert(schema.brandKits)
    .values({
      tenantId: ctx.tenantId,
      ...ownerFields(owner),
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
  owner: KitOwner,
  patch: KitFieldsPatch,
): Promise<BrandKit> {
  const kit = await ensureKit(tx, ctx, owner);
  return updateKit(tx, ctx, kit.id, patch);
}

/**
 * The look alone (slice 15): what a site template suggests for a kit whose
 * owner has chosen none of it. The other fields are not touched, so a
 * resolved default never lands on the row as if somebody chose it.
 */
export async function saveKitLook(
  tx: Tx,
  ctx: MarketingCtx,
  owner: KitOwner,
  look: Pick<KitFieldsPatch, "look" | "fontPairing" | "buttonShape">,
): Promise<BrandKit> {
  const kit = await ensureKit(tx, ctx, owner);
  return updateKit(tx, ctx, kit.id, look);
}

/** Returns the pathname the new logo replaced, for the caller to discard AFTER commit. */
export async function setKitLogo(
  tx: Tx,
  ctx: MarketingCtx,
  owner: KitOwner,
  logo: KitLogo,
): Promise<{ kit: BrandKit; previous: string | null }> {
  const kit = await ensureKit(tx, ctx, owner);
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
  owner: KitOwner,
): Promise<{ kit: BrandKit; previous: string | null }> {
  const kit = await ensureKit(tx, ctx, owner);
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
 * A company or a website goes back to the business look: its row goes, and
 * with it its own logo (returned so the caller discards the blob after
 * commit). The business-wide kit cannot be deleted at all — the TYPE says so,
 * not a runtime check — because there is always a business look, even if every
 * field of it is empty.
 */
export async function deleteKit(
  tx: Tx,
  ctx: MarketingCtx,
  owner: Exclude<KitOwner, { kind: "business" }>,
): Promise<{ previous: string | null }> {
  await assertOwner(tx, ctx.tenantId, owner);
  const [deleted] = await tx
    .delete(schema.brandKits)
    .where(kitWhere(ctx.tenantId, owner))
    .returning({ logoPathname: schema.brandKits.logoPathname });
  return { previous: deleted?.logoPathname ?? null };
}
