/**
 * Websites — **the business's public site, built from its own data and hosted
 * by the platform.** Marketing slice 1; ADR 0019.
 *
 * A site is a handful of PAGES, and a page is a list of TYPED SECTIONS (a
 * hero, an "about", an offer list, hours, contact …) held as JSON and
 * validated by `src/lib/sites/schema.ts` on every write. Sections are
 * structured data, never markup: nothing an owner types can put a script or
 * an unknown tag on the public page, and a generator can fill a structured
 * block from the brand kit and the business's details where it could never
 * fill a free canvas. That is the whole argument for blocks over a
 * free-form builder, and it is the reason this table holds JSON rather than
 * HTML.
 *
 * **DRAFT AND PUBLISHED ARE TWO COLUMNS ON THE PAGE.** Editing touches
 * `draft`; publishing copies it into `published`; the public renderer reads
 * only `published`. A half-edited site is therefore never on the internet,
 * and "unpublish" is a status flip that leaves the drafts intact.
 *
 * **THE PUBLIC READ PATH IS THE ONE PLACE A STRANGER'S REQUEST REACHES TENANT
 * DATA WITHOUT A SESSION.** `slug` → tenant is resolved under `withSystem`
 * (the same trusted-lookup shape an inbound-mail token uses), and everything
 * after runs in that tenant's context as `staff` through the ordinary member
 * policy. Nothing here has a public policy; "no context → no rows" still
 * holds at the database.
 *
 * One site per tenant in this slice. A per-company site (the brand kit's
 * `entity_id` pattern) is a plausible later ask and would be a column and a
 * unique-index change, not a redesign.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
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

export const sites = pgTable(
  "sites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /**
     * The free address: `<slug>.<SITE_DOMAIN>`, and `/sites/<slug>` on the
     * platform host. Unique across every tenant — it IS the hostname label.
     * Shape and reserved words are decided in `src/lib/sites/slug.ts`; the
     * CHECK repeats the shape so a row cannot be written any other way.
     */
    slug: text("slug").notNull(),
    /** The name in the site's header. Empty = the brand kit's display name. */
    title: text("title").notNull().default(""),
    /**
     * Details the contact and hours sections read LIVE — phone, email,
     * address, hours lines — so a changed phone number changes every page
     * that shows it without touching a section. `SiteSettingsSchema`.
     */
    settings: jsonb("settings").notNull().default({}),
    /** `draft` until the owner publishes; `published` while it is on the internet. */
    status: text("status").notNull().default("draft"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    /**
     * Which writer produced the current drafts: `model` (the assistant, from
     * the brief) or `standard` (the fixed copy that stands in without a key).
     * The screen says which, so an owner knows whether to read closely.
     */
    copySource: text("copy_source").notNull().default("standard"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("sites_tenant_id_id_idx").on(t.tenantId, t.id),
    // One site per tenant in this slice (see the header).
    uniqueIndex("sites_tenant_idx").on(t.tenantId),
    // The address is platform-wide; two tenants cannot share a hostname.
    uniqueIndex("sites_slug_idx").on(t.slug),
    check(
      "sites_slug_shape",
      sql`${t.slug} ~ '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$'`,
    ),
    check("sites_status_values", sql`${t.status} in ('draft', 'published')`),
    check(
      "sites_copy_source_values",
      sql`${t.copySource} in ('model', 'standard')`,
    ),
    check("sites_title_length", sql`length(${t.title}) <= 80`),
  ],
);

export const sitePages = pgTable(
  "site_pages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    siteId: uuid("site_id").notNull(),
    /** `/` for the home page, else `/about`, `/contact`, `/services/hay` … */
    path: text("path").notNull(),
    title: text("title").notNull(),
    navOrder: integer("nav_order").notNull().default(0),
    inNav: boolean("in_nav").notNull().default(true),
    /** `PageContent`: a description and the sections. What the owner edits. */
    draft: jsonb("draft").notNull().default({ description: "", sections: [] }),
    /** The same shape, frozen at publish time. What the internet sees. */
    published: jsonb("published"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("site_pages_tenant_id_id_idx").on(t.tenantId, t.id),
    index("site_pages_tenant_idx").on(t.tenantId),
    uniqueIndex("site_pages_site_path_idx").on(t.siteId, t.path),
    /**
     * A page cannot belong to another tenant's site even under `withSystem`:
     * the composite key carries the tenant. Pages die with their site.
     */
    foreignKey({
      name: "site_pages_site_fk",
      columns: [t.tenantId, t.siteId],
      foreignColumns: [sites.tenantId, sites.id],
    }).onDelete("cascade"),
    check(
      "site_pages_path_shape",
      sql`${t.path} ~ '^/(?:[a-z0-9-]+(?:/[a-z0-9-]+)*)?$'`,
    ),
    check("site_pages_title_length", sql`length(${t.title}) between 1 and 80`),
  ],
);

/**
 * A page's history: the draft as it was at each save, publish and restore.
 * Slice 2 (the editor). Kept to the last `PAGE_VERSIONS_KEEP`
 * (`src/lib/sites/pages.ts`) per page, pruned on write; restoring writes the
 * chosen content back into the draft and records that as a version too, so
 * history never loses a step.
 */
export const sitePageVersions = pgTable(
  "site_page_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    pageId: uuid("page_id").notNull(),
    /** `save` from the editor, `publish` when the site went live, `restore` from history. */
    kind: text("kind").notNull().default("save"),
    /** `PageContent`, as it was. */
    content: jsonb("content").notNull(),
    /** Attribution only — grants nothing. */
    createdByClerkUserId: text("created_by_clerk_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("site_page_versions_tenant_id_id_idx").on(t.tenantId, t.id),
    index("site_page_versions_tenant_idx").on(t.tenantId),
    index("site_page_versions_page_idx").on(t.pageId, t.createdAt),
    foreignKey({
      name: "site_page_versions_page_fk",
      columns: [t.tenantId, t.pageId],
      foreignColumns: [sitePages.tenantId, sitePages.id],
    }).onDelete("cascade"),
    check(
      "site_page_versions_kind_values",
      sql`${t.kind} in ('save', 'publish', 'restore')`,
    ),
  ],
);

export type Site = typeof sites.$inferSelect;
export type NewSite = typeof sites.$inferInsert;
export type SitePage = typeof sitePages.$inferSelect;
export type NewSitePage = typeof sitePages.$inferInsert;
export type SitePageVersion = typeof sitePageVersions.$inferSelect;
