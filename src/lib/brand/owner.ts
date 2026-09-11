/**
 * WHOSE LOOK A BRAND KIT IS (ADR 0045) — the business's, one company's, or one
 * website's.
 *
 * Here rather than in `src/modules/marketing/kit-ops.ts` because the SCREENS
 * need it: that module is `server-only`, and the panel that edits a kit, the
 * logo controls beneath it and the form beneath that are all client
 * components. This file is pure, imports nothing, and is the shape both sides
 * agree on.
 *
 * The three cases are exactly what `brand_kits_one_owner` allows: a row may
 * name a company, or a website, or neither — never both.
 */
export type KitOwner =
  | { kind: "business" }
  | { kind: "company"; entityId: string }
  | { kind: "site"; siteId: string };

/** The look everything falls back to. There is always one, even if it is empty. */
export const BUSINESS_KIT: KitOwner = { kind: "business" };

/**
 * The owner as the server actions take it on the wire — and as the columns are
 * written. Exactly one is ever set, which is why the pair can be spread into a
 * form's payload without the caller deciding anything.
 */
export function ownerFields(owner: KitOwner): {
  entityId: string | null;
  siteId: string | null;
} {
  return {
    entityId: owner.kind === "company" ? owner.entityId : null,
    siteId: owner.kind === "site" ? owner.siteId : null,
  };
}

/**
 * The reverse, for an action reading its own input. Both set is the caller's
 * mistake and is the caller's to refuse — this is the pure half and simply
 * prefers the company, so no screen can be shown a look that belongs to
 * something else while the action decides.
 */
export function ownerFrom(input: {
  entityId?: string | null;
  siteId?: string | null;
}): KitOwner {
  if (input.entityId) return { kind: "company", entityId: input.entityId };
  if (input.siteId) return { kind: "site", siteId: input.siteId };
  return BUSINESS_KIT;
}

/** Whether this owner inherits from the business-wide kit, which only the business does not. */
export function inheritsFromBusiness(owner: KitOwner): boolean {
  return owner.kind !== "business";
}

/**
 * Whether a kit row is the business-wide one — BOTH owner columns null.
 *
 * A predicate rather than an inline check because the one-column version has
 * now been wrong in three places: `resolveBrandFor` (which would have printed
 * a site's logo on the invoices), `kitWhere` (which would have let a save to
 * the business kit overwrite a site's), and the Marketing screen's own
 * `kits.find(k => k.entityId === null)`, which would have shown a website's
 * brand as the business's. Anything that filters a list of kits should call
 * this rather than write the test again.
 */
export function isBusinessKit(kit: {
  entityId: string | null;
  siteId: string | null;
}): boolean {
  return kit.entityId === null && kit.siteId === null;
}
