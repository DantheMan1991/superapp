/**
 * The rules of a PERSONAL SPACE: a workspace of one, beside the business
 * (ADR 0111, docs/modules/personal-space.md).
 *
 * To RLS a personal space is an ordinary tenant, and nothing here changes a
 * policy. What makes it different is `tenants.kind`, and the handful of places
 * that read it all ask this file: the auth split (`requireTenant` refuses one,
 * `requirePersonalSpace` refuses anything else), the module gate, the console's
 * buttons and the webhook that mirrors the organization.
 *
 * PURE AND IMPORT-FREE, for the reason `operator-guard.ts` is: a control drawn
 * but refused, or refused but drawn, is the bug the permission-gate sweep of
 * 2026-09-04 was fixing, and one predicate called from both sides is the cure.
 */

export type TenantKind = "business" | "personal";

/** The `modules.category` a personal tool carries. Text, like the others. */
export const PERSONAL_CATEGORY = "personal";

/** Where a personal space lives. The business product is `/dashboard`. */
export const PERSONAL_HOME = "/personal";

/**
 * The door into it from a business workspace: a page OUTSIDE the space's own
 * layout, because until it has switched the active organization the caller is
 * still in their business, and the space's layout would send them back there.
 */
export const PERSONAL_OPEN = "/personal/open";

/**
 * The Clerk organization's name. The same for everybody, because the switcher
 * lists it beside the person's businesses and "Personal" is the whole of what
 * it needs to say. Clerk does not require names to be unique; slugs, it does.
 */
export const PERSONAL_ORG_NAME = "Personal";

/**
 * What the console, and the webhook, refuse on a personal space, each with the
 * sentence it shows. A personal space is not a client: it has no relationship
 * in the operator's CRM, no retainer, no plan billed as a business, no industry
 * and no business vocabulary — and support view never opens it (ADR 0111).
 */
export const PERSONAL_REFUSALS = {
  support:
    "This is somebody's personal space. Support view never opens one — ask them for a screenshot instead.",
  profile:
    "This is a personal space. It has no industry, so no profile is installed on it.",
  labels: "This is a personal space. It has no business vocabulary to rename.",
  retainer:
    "This is a personal space. A retainer is a service to a business, and it has none.",
  billing: "This is a personal space. It is not billed as a business.",
  party:
    "This is a personal space. Its owner is not a client, and it has no party in the operator's CRM.",
} as const;

export type PersonalAct = keyof typeof PERSONAL_REFUSALS;

/** The sentence to show, or null when the act is allowed — as it always is on a business. */
export function personalRefusal(
  tenant: { kind: TenantKind },
  act: PersonalAct,
): string | null {
  return tenant.kind === "personal" ? PERSONAL_REFUSALS[act] : null;
}

/**
 * WHICH TOOLS BELONG IN WHICH KIND OF WORKSPACE. A personal space runs personal
 * tools and nothing else; a business never runs one.
 *
 * Called by the module gate (`isModuleEnabled`, and so all of
 * `requireModuleEnabled`'s callers), by the rail through `getActiveModules`,
 * and by the console before it switches anything on. A row that somehow
 * enables a mismatched tool is therefore off everywhere at once, rather than
 * shown in one place and refused in another.
 */
export function moduleFitsTenant(category: string, kind: TenantKind): boolean {
  return kind === "personal"
    ? category === PERSONAL_CATEGORY
    : category !== PERSONAL_CATEGORY;
}

/** The console's sentence for a tool switched on in the wrong kind of workspace. */
export function moduleRefusal(category: string, kind: TenantKind): string | null {
  if (moduleFitsTenant(category, kind)) return null;
  return kind === "personal"
    ? "This is a personal space. Only personal tools can be switched on in it."
    : "This is a business workspace. A personal tool can only be switched on in somebody's personal space.";
}

/**
 * THE MARK A PERSONAL ORGANIZATION CARRIES IN CLERK: public metadata, set by
 * our own backend when it creates the organization and never writable from a
 * browser. It is how the webhook, which can land before our own insert does,
 * knows what it is looking at — without it, `organization.created` would
 * mirror a personal space as a business.
 */
export interface PersonalOrgMetadata {
  yosherKind: "personal";
  personalOwner: string;
}

export function personalOrgMetadata(clerkUserId: string): PersonalOrgMetadata {
  return { yosherKind: "personal", personalOwner: clerkUserId };
}

/**
 * Read the kind back off an organization's public metadata. Anything that is
 * not exactly our own mark — missing, malformed, an owner that is not a Clerk
 * user id — is a business, the default every organization had before this
 * existed.
 */
export function kindFromOrgMetadata(
  metadata: unknown,
): { kind: "business"; owner: null } | { kind: "personal"; owner: string } {
  if (metadata && typeof metadata === "object") {
    const m = metadata as Record<string, unknown>;
    if (
      m.yosherKind === "personal" &&
      typeof m.personalOwner === "string" &&
      /^user_[A-Za-z0-9]+$/.test(m.personalOwner)
    ) {
      return { kind: "personal", owner: m.personalOwner };
    }
  }
  return { kind: "business", owner: null };
}

/**
 * A personal space's slug. Random rather than the person's name: Clerk wants
 * organization slugs unique across the whole instance, a consumer product will
 * have a great many people called Dan, and a slug is no place for a name.
 */
export function personalSlug(randomHex: string): string {
  return `personal-${randomHex.toLowerCase()}`;
}

/**
 * WHO MAY OPEN ONE, for now. A personal space with nothing in it is a
 * container, and every Yosher user being offered one before its first tool
 * ships would be a menu item that leads to an empty room. So: superadmins
 * always (they build it), everybody else from the day a personal tool is
 * `available` in the catalogue — which the seed decides, with no flag to
 * remember to flip.
 */
export function personalSpacesOpen(input: {
  isSuperAdmin: boolean;
  personalToolsAvailable: boolean;
}): boolean {
  return input.isSuperAdmin || input.personalToolsAvailable;
}
