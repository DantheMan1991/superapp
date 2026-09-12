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
 * **MANY SITES PER TENANT** since ADR 0045: a business with two brands wants
 * a site each, with its own address, look, logo and domain. Everything that
 * hangs off a site keys on `site_id` and always did; what changed is that
 * "the tenant's site" is no longer a question with an answer.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
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
    /**
     * Addresses this site used to have (slice 11b): an old free address
     * sends people on to the current one for as long as it is here. Newest
     * first, at most `PREVIOUS_SLUGS_MAX`; a current slug elsewhere wins over
     * a previous one here.
     */
    previousSlugs: text("previous_slugs").array().notNull().default(sql`'{}'::text[]`),
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
    /**
     * MANY SITES PER TENANT since 2026-09-10 (ADR 0045). This was a UNIQUE
     * index and is now a plain one: a business with two brands — a farm and
     * its farm store, a platform and the industry it sells to — wants a site
     * each, with its own logo, its own domain and its own social links, and
     * every table that hangs off a site already keys on `site_id`.
     *
     * The address stays platform-wide unique below, so nothing about how a
     * site is FOUND changed. What changed is that finding "the" site of a
     * tenant is no longer a question with an answer.
     */
    index("sites_tenant_idx").on(t.tenantId),
    // The address is platform-wide; two tenants cannot share a hostname.
    uniqueIndex("sites_slug_idx").on(t.slug),
    // An old address is looked up by containment, across every tenant, under `withSystem`.
    index("sites_previous_slugs_idx").using("gin", t.previousSlugs),
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

/**
 * A LINK THAT SHOWS AN UNPUBLISHED SITE TO SOMEBODY WHO CANNOT SIGN IN.
 *
 * The whole point of the website tool is handing a business its site; until
 * this existed the only way to show one was to publish it and hope, because
 * `/sites/<slug>/draft` demands a member of that tenant. An agency building a
 * site for a client had no way to say "here it is, what do you think?".
 *
 * **The trust model is the document share's, verbatim** (ADR 0046,
 * `src/modules/documents/shares/resolve.ts`): `withSystem` does the token →
 * tenant hop and NOTHING else, and every read after it runs under
 * `withTenant` as `staff`. Widening that one lookup is the dangerous
 * refactor.
 *
 * DELIBERATELY THINNER THAN A DOCUMENT SHARE, because what is behind it is
 * different: marketing copy the owner intends to publish, not files.
 *
 *   - **No passcode.** A client who has to be given a password as well as a
 *     link is a client who replies asking for the password. The token IS the
 *     secret, it expires, and it can be revoked.
 *   - **No use cap.** Somebody reviewing a site refreshes it, sends it to
 *     their spouse, opens it again on a phone. A cap would read as the link
 *     being broken.
 *   - **`expires_at` is NOT NULL anyway**, which is the one rule kept whole
 *     from the document share: there are no never-expiring anonymous links in
 *     this product.
 *
 * `last_viewed_at` and `view_count` are here because the question an owner
 * actually asks is "have they looked at it yet?", and without this the answer
 * is a phone call.
 */
export const sitePreviews = pgTable(
  "site_previews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    siteId: uuid("site_id").notNull(),
    /** SHA-256 of the token. The raw token is never stored. */
    tokenHash: text("token_hash").notNull(),
    /** The token under `APP_ENCRYPTION_KEY`, so the link can be shown again. */
    tokenCiphertext: text("token_ciphertext").notNull(),
    /** Whose review this is for — "Hilltop Farm", "Dan". Shown to nobody but the owner. */
    label: text("label").notNull().default(""),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedByClerkUserId: text("revoked_by_clerk_user_id"),
    createdByClerkUserId: text("created_by_clerk_user_id").notNull(),
    lastViewedAt: timestamp("last_viewed_at", { withTimezone: true }),
    viewCount: integer("view_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("site_previews_tenant_id_id_idx").on(t.tenantId, t.id),
    index("site_previews_tenant_idx").on(t.tenantId),
    index("site_previews_site_idx").on(t.siteId),
    /** The token is looked up across every tenant under `withSystem`; it must be unique platform-wide. */
    uniqueIndex("site_previews_token_idx").on(t.tokenHash),
    /**
     * A preview dies with its site, and cannot name another tenant's site
     * even under `withSystem` — the composite key carries the tenant.
     */
    foreignKey({
      name: "site_previews_site_fk",
      columns: [t.tenantId, t.siteId],
      foreignColumns: [sites.tenantId, sites.id],
    }).onDelete("cascade"),
    check("site_previews_label_length", sql`length(${t.label}) <= 80`),
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
    /**
     * WHAT TO PHOTOGRAPH, per spot on this page — written by the assistant
     * when somebody asks for it, and editable afterwards (slice 19).
     *
     * `{ "<spotKey>": { note, for } }`. The spots THEMSELVES are still read
     * from the page and never stored (ADR 0031); what is stored is the
     * advice, which the page cannot derive because it depends on what the
     * business sells — a farm wants a photograph of its pasture, and a
     * business selling software TO farms wants a screenshot beside it.
     *
     * `for` is the words the note was written from. A spot key is a section
     * INDEX, so inserting or reordering a section would otherwise slide a
     * note onto a neighbour; comparing the words catches that and an edit
     * both, and the note quietly falls back to the generic one. The same
     * trick `settings.map` uses for its pin, for the same reason: kept only
     * for the thing it was made from.
     */
    shotNotes: jsonb("shot_notes").notNull().default({}),
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

/**
 * A domain the business already owns, connected to its site. Slice 3;
 * ADR 0020.
 *
 * **RECORDS ONLY, NEVER NAMESERVERS.** The owner publishes one or two records
 * at their registrar (a CNAME or an A record, plus a TXT when Vercel asks for
 * proof) and Vercel serves the site and its certificate. Nothing here can
 * move a domain's nameservers, because that moves every record the business
 * has — its mail included — and is the failure that breaks businesses.
 *
 * `status` is decided by Vercel, never locally: `active` once the project
 * reports the domain verified and correctly configured, `pending` until then,
 * `error` when the last check failed for a reason worth showing. The public
 * renderer routes a hostname only through an `active` row.
 *
 * `domain` is unique across the platform: a hostname can point at one site.
 */
export const siteDomains = pgTable(
  "site_domains",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    siteId: uuid("site_id").notNull(),
    /** Lowercase, no scheme, no port, no trailing dot: `www.oakrowfarm.com`. */
    domain: text("domain").notNull(),
    /** `oakrowfarm.com` rather than `www.oakrowfarm.com` — decides A vs CNAME. */
    apex: boolean("apex").notNull().default(false),
    status: text("status").notNull().default("pending"),
    /** `DnsRecordToPublish[]` — what the owner was last told to publish. */
    records: jsonb("records").notNull().default([]),
    /** What Vercel last said, for the screen: verified, and how it resolves. */
    vercelVerified: boolean("vercel_verified").notNull().default(false),
    vercelConfiguredBy: text("vercel_configured_by").notNull().default(""),
    lastError: text("last_error").notNull().default(""),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("site_domains_tenant_id_id_idx").on(t.tenantId, t.id),
    index("site_domains_tenant_idx").on(t.tenantId),
    index("site_domains_site_idx").on(t.siteId),
    uniqueIndex("site_domains_domain_idx").on(t.domain),
    foreignKey({
      name: "site_domains_site_fk",
      columns: [t.tenantId, t.siteId],
      foreignColumns: [sites.tenantId, sites.id],
    }).onDelete("cascade"),
    check(
      "site_domains_domain_shape",
      sql`${t.domain} ~ '^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,63}$'`,
    ),
    check(
      "site_domains_status_values",
      sql`${t.status} in ('pending', 'active', 'error')`,
    ),
  ],
);

/**
 * A message sent through a site's enquiry form — Marketing slice 4, ADR 0021.
 *
 * The row is the record of WHAT WAS SENT, kept whatever becomes of the rest:
 * the sender also becomes (or matches) a party, a follow-up is raised in Work
 * and the business is emailed, but those are pointers here, not the message.
 * `party_id` and `work_item_id` are SOFT — no FK — because a merged party or
 * a deleted item must not take the message with it; the screen resolves them
 * and says when one is gone.
 *
 * THE INSERT COMES FROM THE PUBLIC PATH. A stranger's request resolves the
 * site (one trusted lookup, like the renderer's) and then writes as `staff`
 * inside that tenant's context, so the member INSERT policy is the one the
 * form uses. Nothing updates a row — an enquiry is never edited — and only
 * an owner deletes one.
 */
export const siteEnquiries = pgTable(
  "site_enquiries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    siteId: uuid("site_id").notNull(),
    /** The page the form was on. */
    pagePath: text("page_path").notNull().default("/"),
    name: text("name").notNull(),
    email: text("email").notNull(),
    phone: text("phone").notNull().default(""),
    message: text("message").notNull(),
    /** The party the sender became or matched by email. Soft pointer. */
    partyId: uuid("party_id"),
    /** The follow-up raised in Work. Soft pointer. */
    workItemId: uuid("work_item_id"),
    /** Who the business's copy went to: `site_email`, `owners` or `none` (no address to send to). */
    notifyVia: text("notify_via").notNull().default("none"),
    /**
     * `EnquiryAnswer[]` — the business's own questions, answered. Label
     * snapshots, not field ids: a renamed or removed question must not make
     * an old answer unreadable.
     */
    answers: jsonb("answers").notNull().default([]),
    /** Salted hash of the sender's IP, for the abuse story; never the IP. */
    ipHash: text("ip_hash").notNull().default(""),
    /**
     * A booking is an enquiry with a time (ADR 0025): the slot the visitor
     * chose, what was booked, and a SOFT pointer to the calendar item it
     * became on the Bookings calendar. All empty on a plain message.
     */
    bookingStartsAt: timestamp("booking_starts_at", { withTimezone: true }),
    bookingEndsAt: timestamp("booking_ends_at", { withTimezone: true }),
    bookingTitle: text("booking_title").notNull().default(""),
    scheduleItemId: uuid("schedule_item_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("site_enquiries_tenant_id_id_idx").on(t.tenantId, t.id),
    index("site_enquiries_tenant_idx").on(t.tenantId),
    index("site_enquiries_site_idx").on(t.siteId, t.createdAt),
    foreignKey({
      name: "site_enquiries_site_fk",
      columns: [t.tenantId, t.siteId],
      foreignColumns: [sites.tenantId, sites.id],
    }).onDelete("cascade"),
    check("site_enquiries_name_len", sql`char_length(${t.name}) between 1 and 120`),
    check("site_enquiries_message_len", sql`char_length(${t.message}) between 1 and 4000`),
    check(
      "site_enquiries_notify_values",
      sql`${t.notifyVia} in ('none', 'site_email', 'owners')`,
    ),
    check(
      "site_enquiries_booking_whole",
      sql`(${t.bookingStartsAt} is null) = (${t.bookingEndsAt} is null)`,
    ),
  ],
);

/**
 * How many people looked at a page — Marketing slice 4b, ADR 0022.
 *
 * ONE ROW PER PAGE PER DAY, counters only. `views` is every load a browser
 * reported; `visitors` is browsers that reported their FIRST load of the
 * day on this page, so a day's visitors is the sum over its pages. Nothing
 * identifies a person: no cookie, no IP, no user agent — the browser keeps
 * its own "seen today" note (ADR 0022) and the server trusts it, because a
 * counter that can be inflated is still only a counter.
 *
 * Written by the public beacon as `staff` inside the site's tenant, the
 * same shape as `site_enquiries`; read on the Website screen. Rows are
 * never deleted by the app (pages × days is small) and go with the site.
 */
export const sitePageViews = pgTable(
  "site_page_views",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    siteId: uuid("site_id").notNull(),
    /** `yyyy-mm-dd` in the tenant's timezone. */
    day: date("day").notNull(),
    path: text("path").notNull().default("/"),
    views: integer("views").notNull().default(0),
    visitors: integer("visitors").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("site_page_views_site_day_path_idx").on(t.siteId, t.day, t.path),
    index("site_page_views_tenant_idx").on(t.tenantId),
    foreignKey({
      name: "site_page_views_site_fk",
      columns: [t.tenantId, t.siteId],
      foreignColumns: [sites.tenantId, sites.id],
    }).onDelete("cascade"),
    check("site_page_views_counts", sql`${t.views} >= 0 and ${t.visitors} >= 0`),
  ],
);

/**
 * A photo in the site's library — Marketing slice 5, ADR 0023.
 *
 * The bytes live in the private blob store under `sites/<tenant>/photos/`
 * as ONE derivative the platform made (long edge ≤ 1600px, JPEG, or PNG
 * when the upload had transparency; every metadata tag stripped, so a
 * phone's GPS position never reaches the internet). The upload itself is
 * never kept. Sections point at a row by id and carry their own alt text;
 * deleting the row takes the photo off every page that showed it, which
 * the screen warns about. Served publicly by `/sites/<slug>/images/<id>`
 * for a published site only, and to members by the marketing API.
 */
export const siteImages = pgTable(
  "site_images",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    siteId: uuid("site_id").notNull(),
    /** The derivative's blob path, under `sitePhotoPathPrefix(tenant)`. */
    pathname: text("pathname").notNull(),
    mimeType: text("mime_type").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    bytes: integer("bytes").notNull(),
    createdByClerkUserId: text("created_by_clerk_user_id").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("site_images_tenant_id_id_idx").on(t.tenantId, t.id),
    index("site_images_site_idx").on(t.siteId, t.createdAt),
    uniqueIndex("site_images_pathname_idx").on(t.pathname),
    foreignKey({
      name: "site_images_site_fk",
      columns: [t.tenantId, t.siteId],
      foreignColumns: [sites.tenantId, sites.id],
    }).onDelete("cascade"),
    check("site_images_mime_values", sql`${t.mimeType} in ('image/jpeg', 'image/png')`),
    check("site_images_dimensions", sql`${t.width} > 0 and ${t.height} > 0 and ${t.bytes} > 0`),
  ],
);

export type Site = typeof sites.$inferSelect;
export type NewSite = typeof sites.$inferInsert;
export type SitePage = typeof sitePages.$inferSelect;
export type NewSitePage = typeof sitePages.$inferInsert;
export type SitePageVersion = typeof sitePageVersions.$inferSelect;
export type SiteDomain = typeof siteDomains.$inferSelect;
export type SiteEnquiry = typeof siteEnquiries.$inferSelect;
export type SitePageView = typeof sitePageViews.$inferSelect;
export type SiteImage = typeof siteImages.$inferSelect;
