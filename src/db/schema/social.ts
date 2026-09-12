/**
 * Social — **the accounts a brand posts to.** Marketing slice S0;
 * [ADR 0047](../../../docs/decisions/0047-a-social-channel-belongs-to-a-website-and-a-footer-link-is-not-one.md).
 *
 * **A CHANNEL BELONGS TO A WEBSITE, OR TO THE BUSINESS.** `site_id` nullable:
 * since ADR 0045 a tenant holds many websites and a website is what a brand
 * IS — its own look, logo, address, domain and accounts — so the founder's
 * opening requirement, a Facebook per industry, is this column and nothing
 * more exotic. Null is the business's own account, the ordinary client with
 * one Instagram and no website yet.
 *
 * **BEWARE THE NEIGHBOUR.** On `brand_kits` a null `site_id` may still be a
 * COMPANY's kit, which is why that table carries `brand_kits_one_owner` and
 * why a one-column predicate there shipped two live bugs the day the column
 * arrived. There is no second owner column here, so null means exactly one
 * thing — but a reader arriving from `brand_kits` will expect the harder rule.
 *
 * **A CHANNEL IS NOT A FOOTER LINK.** `sites.settings.social` holds up to
 * eight marks an owner chose to DISPLAY. This holds accounts the business
 * POSTS TO. Adding a channel offers to add the mark; nothing keeps the two in
 * step afterwards, on purpose, and the screen shows them side by side so a
 * mismatch is visible where it can be fixed.
 *
 * **NOTHING POSTS YET.** S0 is the shape. Publishing to a real network is
 * gated on app review at Meta and elsewhere (the module dossier's plan has the
 * table), which is why there is no token column here: a connection is S6's
 * table, written when there is an app to connect to. The Square lesson —
 * OAuth code written before the developer app existed, still unproven in
 * production — is the one being avoided. That is still true of `social_posts`
 * below (S1): a post is finished here and posted by a person.
 */
import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./platform";
import { siteImages, sites } from "./sites";

export const socialChannels = pgTable(
  "social_channels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** The website this brand's account belongs to; NULL is the business's own. */
    siteId: uuid("site_id"),
    /** One of `SOCIAL_NETWORKS` — the same list the footer marks use. */
    network: text("network").notNull(),
    /**
     * The account, without its `@` and lowercased (`normalizeHandle`). One
     * account is one row per workspace: the unique index below is what stops
     * the same Facebook page being filed under two brands, which is ADR 0047's
     * rule made mechanical rather than remembered.
     */
    handle: text("handle").notNull(),
    /** What `other` is called — "our Substack". Ignored for a known network. */
    label: text("label").notNull().default(""),
    /** Where the account lives. Guessed from the handle, overwritable. */
    profileUrl: text("profile_url").notNull().default(""),
    /**
     * WHO READS THIS ONE. The writer's first input, and the reason the
     * homestead Facebook and the trades Facebook can sound different without a
     * line of forked code — the per-client-differences-live-in-config rule
     * applied to a brand.
     */
    audience: text("audience").notNull().default(""),
    /** HOW THIS BRAND SOUNDS HERE. The writer's second input. */
    voice: text("voice").notNull().default(""),
    /** `paused` keeps the row and its history, and offers it to nothing. */
    status: text("status").notNull().default("active"),
    createdByClerkUserId: text("created_by_clerk_user_id").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // What a later composite FK from a post will point at.
    uniqueIndex("social_channels_tenant_id_id_idx").on(t.tenantId, t.id),
    index("social_channels_owner_idx").on(t.tenantId, t.siteId),
    /**
     * ONE ACCOUNT, ONE ROW, across the whole workspace — not per site.
     * Yosher Homestead's page and Yosher Trades' page have different handles,
     * so this never stands in the way of the per-industry case; what it
     * refuses is the same account filed under two brands, which ADR 0047 says
     * is a single channel with a null `site_id` instead.
     */
    uniqueIndex("social_channels_account_idx").on(t.tenantId, t.network, t.handle),
    /**
     * The composite every child of a site uses. It is NOT NULL on the others
     * and nullable here, which Postgres handles the way this needs: a
     * MATCH SIMPLE foreign key with any column null is not checked at all, so
     * a business-wide channel points at nothing and is refused by nothing.
     * The cascade still reaches a channel that named a site when that site is
     * removed.
     */
    foreignKey({
      name: "social_channels_site_fk",
      columns: [t.tenantId, t.siteId],
      foreignColumns: [sites.tenantId, sites.id],
    }).onDelete("cascade"),
    check(
      "social_channels_network_values",
      sql`${t.network} in ('facebook', 'instagram', 'youtube', 'tiktok', 'linkedin', 'x', 'pinterest', 'other')`,
    ),
    check("social_channels_status_values", sql`${t.status} in ('active', 'paused')`),
    check(
      "social_channels_handle_length",
      sql`length(${t.handle}) between 1 and 80`,
    ),
    check("social_channels_label_length", sql`length(${t.label}) <= 80`),
    check("social_channels_url_length", sql`length(${t.profileUrl}) <= 500`),
    check("social_channels_audience_length", sql`length(${t.audience}) <= 400`),
    check("social_channels_voice_length", sql`length(${t.voice}) <= 400`),
    /**
     * `other` is the one network with no name of its own, so it must bring a
     * label — otherwise the screen would draw a row that says nothing, which
     * is what `socialLabel`'s "Website" fallback quietly papers over for a
     * footer mark. A channel is picked from a list; it has to be nameable.
     */
    check(
      "social_channels_other_has_label",
      sql`${t.network} <> 'other' or length(btrim(${t.label})) > 0`,
    ),
  ],
);

export type SocialChannel = typeof socialChannels.$inferSelect;

export const socialPosts = pgTable(
  "social_posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /**
     * ONE POST IS ONE CHANNEL, and NOT NULL says so at the database. Sending
     * the same idea to several accounts writes several rows; see
     * `src/lib/social/posts.ts` for why that is the design rather than a
     * limitation. A post dies with the account it was for — words written for
     * an Instagram that is gone are not words for anything.
     */
    channelId: uuid("channel_id").notNull(),
    /** `draft`, `scheduled` or `posted`. There is no `idea`; a dateless draft is one. */
    status: text("status").notNull().default("draft"),
    /** Where it came from: typed by hand, written by the assistant (S2), or a pack's fact (S4). */
    origin: text("origin").notNull().default("hand"),
    /** The words. The form holds the owner to the NETWORK's limit, which is tighter. */
    body: text("body").notNull().default(""),
    /** A page on the site this is about, for the S7 link code to wrap later. */
    link: text("link").notNull().default(""),
    /**
     * The photo, from the site's own library. A soft dependency in spirit but
     * a real composite FK: ON DELETE SET NULL, so removing a photo from the
     * library leaves the post and its words standing with no picture, rather
     * than taking a scheduled post down with it.
     */
    imageId: uuid("image_id"),
    /** One of `POST_SHAPES` — what the picture is cut to. */
    shape: text("shape").notNull().default("square"),
    /**
     * WHERE THE PICTURE MATTERS, in 0–1 of the source. Not a crop box: the box
     * is derived by `cropBox()` from the shape and this point, so a stored
     * value can never describe a rectangle outside the photo or of the wrong
     * ratio. Kept in fractions so it survives the photo being served at
     * another size.
     */
    focusX: real("focus_x").notNull().default(0.5),
    focusY: real("focus_y").notNull().default(0.5),
    /** When it should go out. Required by a CHECK once the status is `scheduled`. */
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    /** When somebody said they had posted it. Required by a CHECK once `posted`. */
    postedAt: timestamp("posted_at", { withTimezone: true }),
    /**
     * THE SWEEP'S OWN BOOKKEEPING, and the reason it is idempotent. The
     * ten-minute cron raises one Work item per post and stamps this; a second
     * pass over the same row does nothing. Written under `withSystem` by
     * trusted background code, never by a screen.
     */
    remindedAt: timestamp("reminded_at", { withTimezone: true }),
    /** The Work item the sweep raised. A SOFT pointer, like `site_enquiries.work_item_id`. */
    workItemId: uuid("work_item_id"),
    createdByClerkUserId: text("created_by_clerk_user_id").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("social_posts_tenant_id_id_idx").on(t.tenantId, t.id),
    index("social_posts_channel_idx").on(t.tenantId, t.channelId, t.scheduledAt),
    /**
     * EXACTLY THE ROWS THE SWEEP WANTS. Partial, because a cron running every
     * ten minutes across every tenant should read an index the size of the
     * work outstanding rather than of the table — and because the day a
     * workspace holds ten thousand posted rows is the day this matters.
     */
    index("social_posts_due_idx")
      .on(t.scheduledAt)
      .where(sql`status = 'scheduled' and reminded_at is null`),
    foreignKey({
      name: "social_posts_channel_fk",
      columns: [t.tenantId, t.channelId],
      foreignColumns: [socialChannels.tenantId, socialChannels.id],
    }).onDelete("cascade"),
    /**
     * SET NULL rather than CASCADE, and it must name the columns: a bare
     * SET NULL can never run on a composite `(tenant_id, x)` key, because it
     * would have to null the tenant too. PG 15's column-list form nulls only
     * the photo, and drizzle-kit keeps it because it diffs snapshots rather
     * than the database.
     */
    foreignKey({
      name: "social_posts_image_fk",
      columns: [t.tenantId, t.imageId],
      foreignColumns: [siteImages.tenantId, siteImages.id],
    }).onDelete("set null"),
    check("social_posts_status_values", sql`${t.status} in ('draft', 'scheduled', 'posted')`),
    check("social_posts_origin_values", sql`${t.origin} in ('hand', 'assistant', 'pack')`),
    check("social_posts_shape_values", sql`${t.shape} in ('square', 'portrait', 'story', 'wide')`),
    check("social_posts_body_length", sql`length(${t.body}) <= 5000`),
    check("social_posts_link_length", sql`length(${t.link}) <= 500`),
    check("social_posts_focus_range", sql`${t.focusX} between 0 and 1 and ${t.focusY} between 0 and 1`),
    /**
     * A STATUS THAT NEEDS A TIME MUST HAVE ONE. Without these two a scheduled
     * post with no `scheduled_at` is invisible to the sweep and sits there
     * forever looking scheduled — the worst kind of bug, because the screen
     * says it is handled.
     */
    check(
      "social_posts_scheduled_has_time",
      sql`${t.status} <> 'scheduled' or ${t.scheduledAt} is not null`,
    ),
    check(
      "social_posts_posted_has_time",
      sql`${t.status} <> 'posted' or ${t.postedAt} is not null`,
    ),
  ],
);

export type SocialPost = typeof socialPosts.$inferSelect;
