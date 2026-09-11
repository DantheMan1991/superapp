/**
 * Brand kit — **Layer 0 identity data, owned by the business and its
 * companies, edited by the Marketing module and consumed by everything that
 * puts the business's name in front of a customer.**
 *
 * The logo, the colours and the tagline are not marketing's data any more than
 * the timezone is scheduling's. An invoice PDF carries them today; a mail
 * signature, a generated document, a share page and the website will. That is
 * why the table lives in its own Layer 0 domain file and why the reader is
 * `src/lib/brand/`, which any module or pack may import — a module may not
 * import another module, and Accounting must not learn that Marketing exists to
 * print a logo.
 *
 * **ONE KIT FOR THE BUSINESS, AND OPTIONALLY ONE PER COMPANY OR PER WEBSITE.**
 * The business-wide kit — the one everything inherits — has NEITHER `entity_id`
 * nor `site_id`; a company's own look sets the first, a website's own look sets
 * the second (ADR 0045), and `brand_kits_one_owner` forbids both. A site's kit
 * is what lets one business run two brands: the farm and its farm store, or a
 * platform and the industry it sells to, each with its own logo, domain and
 * social links. ADR 0015 hung the connected account off the company
 * because the money lands in the company's bank; a brand hangs off the company
 * for the same kind of reason (Oak Row LLC and Maple Street LLC may trade
 * under different names), but unlike a bank account most companies do NOT want
 * their own, so the business-wide kit is the common case and the per-company
 * row is the exception. Resolution is field by field: a company kit that sets
 * only a trading name keeps the shared logo. See `src/lib/brand/core.ts`.
 *
 * The one-company client — every client today — sees one kit and never learns
 * the word company, which is ADR 0010's promise kept.
 *
 * **THE LOGO IS A PRIVATE BLOB, LIKE EVERY OTHER BLOB IN THE PRODUCT.** It is
 * read by the PDF renderer server-side and streamed to signed-in members by a
 * route that first reads this row through RLS. A logo is public by nature, and
 * the day the website needs it on a public URL, a public route serving it is
 * the move — not a public blob store, which would be the first one and would
 * need its own rules.
 */
import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./platform";
import { entities } from "./ledger";
import { sites } from "./sites";

export const brandKits = pgTable(
  "brand_kits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /**
     * Null = the business-wide kit. Set = this company's own look, resolved
     * over the business-wide one field by field.
     *
     * A CLAIM when it arrives from a client; proved against `entities` inside
     * the caller's own `withTenant` scope, and made unrepresentable across
     * tenants by the composite FK below.
     */
    entityId: uuid("entity_id"),
    /**
     * Set = this WEBSITE's own look, resolved over the business-wide one field
     * by field, exactly as a company's is (ADR 0045).
     *
     * A separate key from `entity_id` on purpose, and the `brand_kits_one_owner`
     * CHECK keeps them apart. A brand a business sells under is NOT a company:
     * "Yosher Homestead" has no books, issues no invoices and has no tax id, so
     * making it an `entities` row to borrow this column would put a fabricated
     * company in the entity picker, in the reports and on the invoice's company
     * selector. A site is the thing that has a logo, a domain and social
     * accounts, so a site is what the kit hangs off.
     */
    siteId: uuid("site_id"),
    /**
     * The name customers know the business by. Empty = fall back (a company
     * kit falls back to the business kit, which falls back to the tenant's
     * name). Never the legal name: that stays on `entities.legal_name`.
     */
    displayName: text("display_name").notNull().default(""),
    tagline: text("tagline").notNull().default(""),
    /**
     * `#rrggbb`, lowercase, or empty for "no brand colour yet". Empty rather
     * than null so a consumer can `|| fallback` without a null branch, and a
     * CHECK so nothing downstream ever has to validate a colour again.
     */
    primaryColor: text("primary_color").notNull().default(""),
    accentColor: text("accent_color").notNull().default(""),
    /**
     * The logo as uploaded, under `brand/<tenant>/logos/` (`src/lib/blob.ts`).
     * PNG or JPEG only in this slice: those are what `@react-pdf/renderer`
     * draws, and refusing SVG at the door is the same stored-XSS rule the
     * Documents allowlist follows. The dimensions are sniffed from the bytes
     * at registration — never trusted from the client — so a consumer can lay
     * the logo out without opening the file.
     */
    logoPathname: text("logo_pathname"),
    logoMimeType: text("logo_mime_type").notNull().default(""),
    logoWidth: integer("logo_width").notNull().default(0),
    logoHeight: integer("logo_height").notNull().default(0),
    logoBytes: integer("logo_bytes").notNull().default(0),
    /**
     * Where the logo came from: `upload` (a file the owner brought, including
     * an SVG rasterised on the way in) or `generated` (drawn by the kit from
     * `logo_spec`). The blob is a PNG either way; the difference is whether
     * the VECTOR can be re-drawn — a generated logo can, from its spec, which
     * is what the website will want. Slice 0b.
     */
    logoSource: text("logo_source").notNull().default("upload"),
    /**
     * The wordmark spec a generated logo was drawn from (`LogoSpec` in
     * `src/lib/brand/logo-spec.ts`), `{}` otherwise. The spec is the source
     * of truth for the vector; the stored PNG is what documents use and it
     * stays stable even if the renderer changes.
     */
    logoSpec: jsonb("logo_spec").notNull().default({}),
    /**
     * The look of the business's website (and, one day, its documents): a
     * look, a font pairing and a button shape, each one of the short lists
     * in `src/lib/brand/looks.ts`, or `''` — "as the business kit says" on a
     * company kit, the platform default on the business kit. Presets, never
     * font files or CSS: the CHECKs below are the whole vocabulary. Slice 6d.
     */
    look: text("look").notNull().default(""),
    fontPairing: text("font_pairing").notNull().default(""),
    buttonShape: text("button_shape").notNull().default(""),
    /** Attribution only — grants nothing. */
    updatedByClerkUserId: text("updated_by_clerk_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("brand_kits_tenant_id_id_idx").on(t.tenantId, t.id),
    index("brand_kits_tenant_idx").on(t.tenantId),
    // One business-wide kit per tenant — the one with NEITHER owner set …
    uniqueIndex("brand_kits_tenant_business_idx")
      .on(t.tenantId)
      .where(sql`${t.entityId} is null and ${t.siteId} is null`),
    // … at most one per company …
    uniqueIndex("brand_kits_tenant_entity_idx")
      .on(t.tenantId, t.entityId)
      .where(sql`${t.entityId} is not null`),
    // … and at most one per website (ADR 0045).
    uniqueIndex("brand_kits_tenant_site_idx")
      .on(t.tenantId, t.siteId)
      .where(sql`${t.siteId} is not null`),
    /**
     * A company's own look dies with the company; the business-wide kit
     * (entity_id null) is untouched by the constraint, which MATCH SIMPLE
     * skips when any referencing column is null. CASCADE, not SET NULL — the
     * bare form can never run on a `(tenant_id, x)` key (docs/conventions.md
     * §4), and a kit that silently became the business-wide one would be worse
     * than a missing one.
     */
    foreignKey({
      name: "brand_kits_entity_fk",
      columns: [t.tenantId, t.entityId],
      foreignColumns: [entities.tenantId, entities.id],
    }).onDelete("cascade"),
    /**
     * A website's own look dies with the website, for the same reasons the
     * company's does: CASCADE because the bare SET NULL can never run on a
     * `(tenant_id, x)` key, and a kit that silently became the business-wide
     * one would be worse than a missing one.
     */
    foreignKey({
      name: "brand_kits_site_fk",
      columns: [t.tenantId, t.siteId],
      foreignColumns: [sites.tenantId, sites.id],
    }).onDelete("cascade"),
    /**
     * A KIT HAS AT MOST ONE OWNER. Business-wide (neither set), a company's
     * (`entity_id`), or a website's (`site_id`) — never a company's AND a
     * website's, which would make `resolveBrandFor` a question about
     * precedence rather than a merge.
     */
    check(
      "brand_kits_one_owner",
      sql`${t.entityId} is null or ${t.siteId} is null`,
    ),
    check(
      "brand_kits_primary_color_shape",
      sql`${t.primaryColor} = '' or ${t.primaryColor} ~ '^#[0-9a-f]{6}$'`,
    ),
    check(
      "brand_kits_accent_color_shape",
      sql`${t.accentColor} = '' or ${t.accentColor} ~ '^#[0-9a-f]{6}$'`,
    ),
    /**
     * Either there is a logo and everything about it is known, or there is
     * none and nothing is. A row with a pathname and no dimensions is one a
     * renderer would have to open the file to lay out.
     */
    check(
      "brand_kits_logo_whole",
      sql`(${t.logoPathname} is null and ${t.logoMimeType} = '' and ${t.logoWidth} = 0 and ${t.logoHeight} = 0 and ${t.logoBytes} = 0)
        or (${t.logoPathname} is not null and ${t.logoMimeType} <> '' and ${t.logoWidth} > 0 and ${t.logoHeight} > 0 and ${t.logoBytes} > 0)`,
    ),
    check(
      "brand_kits_logo_source_values",
      sql`${t.logoSource} in ('upload', 'generated')`,
    ),
    check("brand_kits_display_name_length", sql`length(${t.displayName}) <= 80`),
    check("brand_kits_tagline_length", sql`length(${t.tagline}) <= 140`),
    check("brand_kits_look_values", sql`${t.look} in ('', 'modern', 'warm', 'classic')`),
    check(
      "brand_kits_font_pairing_values",
      sql`${t.fontPairing} in ('', 'clean', 'warm', 'classic', 'bold', 'friendly', 'elegant')`,
    ),
    check("brand_kits_button_shape_values", sql`${t.buttonShape} in ('', 'pill', 'rounded', 'square')`),
  ],
);

export type BrandKit = typeof brandKits.$inferSelect;
export type NewBrandKit = typeof brandKits.$inferInsert;
