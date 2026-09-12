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
 * production — is the one being avoided.
 */
import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./platform";
import { sites } from "./sites";

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
