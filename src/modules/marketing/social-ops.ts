import "server-only";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { SocialChannel } from "@/db/schema";
import { normalizeHandle, SOCIAL_CHANNELS_MAX } from "@/lib/social/channels";
import { MarketingError } from "./core/errors";
import type { MarketingCtx } from "./kit-ops";

/**
 * The accounts a brand posts to (slice S0, ADR 0047). Takes the caller's
 * `tx`; the action layer owns the transaction, the gate and the audit row.
 *
 * **Every function here names an owner**, and `siteId: string | null` is that
 * owner: one of the business's websites, or the business itself. There is no
 * "the tenant's channels" — the same discipline ADR 0045 imposed on sites
 * when `findSite(tx, tenantId)` was deleted, applied from the first line here
 * rather than retrofitted after thirteen call sites existed.
 */

/** A whole workspace's channels, for a screen that shows them grouped by brand. */
export async function listChannels(tx: Tx, tenantId: string): Promise<SocialChannel[]> {
  return tx
    .select()
    .from(schema.socialChannels)
    .where(eq(schema.socialChannels.tenantId, tenantId))
    .orderBy(asc(schema.socialChannels.network), asc(schema.socialChannels.handle));
}

/** One owner's channels: a website's, or — with `null` — the business's own. */
export async function listChannelsFor(
  tx: Tx,
  tenantId: string,
  siteId: string | null,
): Promise<SocialChannel[]> {
  return tx
    .select()
    .from(schema.socialChannels)
    .where(
      and(
        eq(schema.socialChannels.tenantId, tenantId),
        // `= NULL` is never true; the business's own channels need `IS NULL`.
        siteId === null
          ? isNull(schema.socialChannels.siteId)
          : eq(schema.socialChannels.siteId, siteId),
      ),
    )
    .orderBy(asc(schema.socialChannels.network), asc(schema.socialChannels.handle));
}

export async function findChannelById(
  tx: Tx,
  tenantId: string,
  id: string,
): Promise<SocialChannel | null> {
  const [row] = await tx
    .select()
    .from(schema.socialChannels)
    .where(and(eq(schema.socialChannels.tenantId, tenantId), eq(schema.socialChannels.id, id)));
  return row ?? null;
}

export interface ChannelFields {
  siteId: string | null;
  network: string;
  handle: string;
  label: string;
  profileUrl: string;
  audience: string;
  voice: string;
}

async function countFor(tx: Tx, tenantId: string, siteId: string | null): Promise<number> {
  const [{ n }] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.socialChannels)
    .where(
      and(
        eq(schema.socialChannels.tenantId, tenantId),
        siteId === null
          ? isNull(schema.socialChannels.siteId)
          : eq(schema.socialChannels.siteId, siteId),
      ),
    );
  return n;
}

/**
 * The unique index is `(tenant_id, network, handle)` — one account, one row
 * across the workspace, whichever brand claims it. Postgres would refuse the
 * duplicate on its own, but a constraint violation inside a transaction
 * poisons everything after it, so it is looked up first and refused in words
 * the screen can show. That is the rule the leads slot learned the hard way
 * (ADR 0042) and it is cheap to keep everywhere.
 */
async function accountTaken(
  tx: Tx,
  tenantId: string,
  network: string,
  handle: string,
  exceptId?: string,
): Promise<boolean> {
  const rows = await tx
    .select({ id: schema.socialChannels.id })
    .from(schema.socialChannels)
    .where(
      and(
        eq(schema.socialChannels.tenantId, tenantId),
        eq(schema.socialChannels.network, network),
        eq(schema.socialChannels.handle, handle),
      ),
    );
  return rows.some((r) => r.id !== exceptId);
}

export async function insertChannel(
  tx: Tx,
  ctx: MarketingCtx,
  fields: ChannelFields,
): Promise<SocialChannel> {
  const handle = normalizeHandle(fields.handle);
  if (await countFor(tx, ctx.tenantId, fields.siteId) >= SOCIAL_CHANNELS_MAX) {
    throw new MarketingError("CHANNEL_LIMIT", "limit");
  }
  if (await accountTaken(tx, ctx.tenantId, fields.network, handle)) {
    throw new MarketingError("CHANNEL_DUPLICATE", "already added");
  }
  const [created] = await tx
    .insert(schema.socialChannels)
    .values({
      tenantId: ctx.tenantId,
      siteId: fields.siteId,
      network: fields.network,
      handle,
      label: fields.label,
      profileUrl: fields.profileUrl,
      audience: fields.audience,
      voice: fields.voice,
      createdByClerkUserId: ctx.userId,
    })
    .returning();
  // Zero rows is how RLS says no to an INSERT; treat it as the refusal it is.
  if (!created) throw new MarketingError("FORBIDDEN", "channel not created");
  return created;
}

/**
 * Everything about a channel except who owns it. Moving an account from one
 * brand to another is not offered: the handle is the account, so the honest
 * move is to remove it here and add it there, and a silent re-parenting would
 * carry a future post history with it.
 */
export async function updateChannel(
  tx: Tx,
  ctx: MarketingCtx,
  id: string,
  fields: Omit<ChannelFields, "siteId">,
): Promise<SocialChannel> {
  const handle = normalizeHandle(fields.handle);
  if (await accountTaken(tx, ctx.tenantId, fields.network, handle, id)) {
    throw new MarketingError("CHANNEL_DUPLICATE", "already added");
  }
  const [updated] = await tx
    .update(schema.socialChannels)
    .set({
      network: fields.network,
      handle,
      label: fields.label,
      profileUrl: fields.profileUrl,
      audience: fields.audience,
      voice: fields.voice,
      updatedAt: new Date(),
    })
    .where(and(eq(schema.socialChannels.tenantId, ctx.tenantId), eq(schema.socialChannels.id, id)))
    .returning();
  if (!updated) throw new MarketingError("CHANNEL_MISSING", "no such channel");
  return updated;
}

export async function setChannelStatus(
  tx: Tx,
  ctx: MarketingCtx,
  id: string,
  status: "active" | "paused",
): Promise<SocialChannel> {
  const [updated] = await tx
    .update(schema.socialChannels)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(schema.socialChannels.tenantId, ctx.tenantId), eq(schema.socialChannels.id, id)))
    .returning();
  if (!updated) throw new MarketingError("CHANNEL_MISSING", "no such channel");
  return updated;
}

export async function deleteChannel(
  tx: Tx,
  ctx: MarketingCtx,
  id: string,
): Promise<SocialChannel> {
  const [deleted] = await tx
    .delete(schema.socialChannels)
    .where(and(eq(schema.socialChannels.tenantId, ctx.tenantId), eq(schema.socialChannels.id, id)))
    .returning();
  // Zero rows is how RLS says no to a DELETE; treat it as the refusal it is.
  if (!deleted) throw new MarketingError("CHANNEL_MISSING", "no such channel");
  return deleted;
}
