import "server-only";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { SocialChannel, SocialPost } from "@/db/schema";
import { MarketingError } from "./core/errors";
import type { MarketingCtx } from "./kit-ops";

/**
 * Writing and reading posts (slice S1). Takes the caller's `tx`; the action
 * layer owns the transaction, the gate and the audit row.
 *
 * **A POST IS ALWAYS READ WITH ITS CHANNEL.** Its brand, its network and the
 * voice it was written for all live on the channel, and there is no `site_id`
 * copied onto the post — a channel cannot move between brands (ADR 0047), so
 * the join is stable and one denormalised column would be one more thing to
 * keep true. Every read here returns the pair.
 */
export interface PostWithChannel {
  post: SocialPost;
  channel: SocialChannel;
}

/**
 * The post-with-channel select, WITHOUT a `where` — each caller adds exactly
 * one, because drizzle's builder drops `.where` from the type after the first
 * and a second call would silently replace rather than narrow the first.
 */
function joined(tx: Tx) {
  return tx
    .select({ post: schema.socialPosts, channel: schema.socialChannels })
    .from(schema.socialPosts)
    .innerJoin(
      schema.socialChannels,
      and(
        eq(schema.socialChannels.tenantId, schema.socialPosts.tenantId),
        eq(schema.socialChannels.id, schema.socialPosts.channelId),
      ),
    );
}

/**
 * One brand's posts: a website's, or — with `null` — the business's own.
 *
 * Newest date first among the scheduled and posted, with the dateless drafts
 * carried along; `groupByDay` puts them at the top, because a post with no
 * date is the one waiting on a decision.
 */
export async function listPostsFor(
  tx: Tx,
  tenantId: string,
  siteId: string | null,
): Promise<PostWithChannel[]> {
  return joined(tx)
    .where(
      and(
        eq(schema.socialPosts.tenantId, tenantId),
        // `= NULL` is never true; the business's own channels need `IS NULL`.
        siteId === null
          ? isNull(schema.socialChannels.siteId)
          : eq(schema.socialChannels.siteId, siteId),
      ),
    )
    .orderBy(asc(schema.socialPosts.scheduledAt), desc(schema.socialPosts.createdAt));
}

export async function findPostById(
  tx: Tx,
  tenantId: string,
  id: string,
): Promise<PostWithChannel | null> {
  const [row] = await joined(tx).where(
    and(eq(schema.socialPosts.tenantId, tenantId), eq(schema.socialPosts.id, id)),
  );
  return row ?? null;
}

export async function createPost(
  tx: Tx,
  ctx: MarketingCtx,
  input: { channelId: string; body?: string; origin?: "hand" | "assistant" | "pack" },
): Promise<SocialPost> {
  // The channel must be this tenant's and must still be there. RLS decided
  // that already; this turns "absent" into the module's own words, and the
  // NOT NULL composite FK would otherwise raise a constraint error inside the
  // transaction, which poisons everything after it.
  const [channel] = await tx
    .select()
    .from(schema.socialChannels)
    .where(
      and(
        eq(schema.socialChannels.tenantId, ctx.tenantId),
        eq(schema.socialChannels.id, input.channelId),
      ),
    );
  if (!channel) throw new MarketingError("CHANNEL_MISSING", "no such channel");
  const [created] = await tx
    .insert(schema.socialPosts)
    .values({
      tenantId: ctx.tenantId,
      channelId: channel.id,
      body: input.body ?? "",
      origin: input.origin ?? "hand",
      createdByClerkUserId: ctx.userId,
    })
    .returning();
  // Zero rows is how RLS says no to an INSERT; treat it as the refusal it is.
  if (!created) throw new MarketingError("FORBIDDEN", "post not created");
  return created;
}

export interface PostFields {
  body: string;
  link: string;
  imageId: string | null;
  shape: string;
  focusX: number;
  focusY: number;
}

/**
 * The words and the picture. NOT the status or the time — those are the three
 * verbs below, because "save what I typed" and "commit this to Tuesday" are
 * different decisions and a form that did both would do the second by
 * accident.
 */
export async function updatePost(
  tx: Tx,
  ctx: MarketingCtx,
  id: string,
  fields: PostFields,
): Promise<SocialPost> {
  if (fields.imageId !== null) {
    // Same reasoning as the channel above: a photo from another tenant is
    // simply absent under RLS, and letting the FK refuse it would poison the
    // transaction instead of telling the owner what happened.
    const [image] = await tx
      .select({ id: schema.siteImages.id })
      .from(schema.siteImages)
      .where(
        and(eq(schema.siteImages.tenantId, ctx.tenantId), eq(schema.siteImages.id, fields.imageId)),
      );
    if (!image) throw new MarketingError("PHOTO_MISSING", "no such photo");
  }
  const [updated] = await tx
    .update(schema.socialPosts)
    .set({
      body: fields.body,
      link: fields.link,
      imageId: fields.imageId,
      shape: fields.shape,
      focusX: fields.focusX,
      focusY: fields.focusY,
      updatedAt: new Date(),
    })
    .where(and(eq(schema.socialPosts.tenantId, ctx.tenantId), eq(schema.socialPosts.id, id)))
    .returning();
  if (!updated) throw new MarketingError("POST_MISSING", "no such post");
  return updated;
}

/**
 * Put it on the calendar.
 *
 * **Scheduling CLEARS the reminder**, so a post moved to next week is reminded
 * about next week rather than never again. That one line is the whole reason
 * `reminded_at` is a column on the post and not a boolean somebody has to
 * remember to reset.
 */
export async function schedulePost(
  tx: Tx,
  ctx: MarketingCtx,
  id: string,
  at: Date,
): Promise<SocialPost> {
  const [updated] = await tx
    .update(schema.socialPosts)
    .set({
      status: "scheduled",
      scheduledAt: at,
      postedAt: null,
      remindedAt: null,
      workItemId: null,
      updatedAt: new Date(),
    })
    .where(and(eq(schema.socialPosts.tenantId, ctx.tenantId), eq(schema.socialPosts.id, id)))
    .returning();
  if (!updated) throw new MarketingError("POST_MISSING", "no such post");
  return updated;
}

/** Back to a draft: off the calendar, and the reminder forgotten with it. */
export async function unschedulePost(
  tx: Tx,
  ctx: MarketingCtx,
  id: string,
): Promise<SocialPost> {
  const [updated] = await tx
    .update(schema.socialPosts)
    .set({
      status: "draft",
      scheduledAt: null,
      postedAt: null,
      remindedAt: null,
      workItemId: null,
      updatedAt: new Date(),
    })
    .where(and(eq(schema.socialPosts.tenantId, ctx.tenantId), eq(schema.socialPosts.id, id)))
    .returning();
  if (!updated) throw new MarketingError("POST_MISSING", "no such post");
  return updated;
}

/**
 * Somebody says they posted it.
 *
 * A claim, not an observation — nothing here can see the network. It keeps
 * `scheduled_at` so the calendar still shows when it was meant to go out
 * beside when it did, which is the only way an owner ever notices they are
 * always three hours late.
 */
export async function markPosted(
  tx: Tx,
  ctx: MarketingCtx,
  id: string,
  at: Date,
): Promise<SocialPost> {
  const [updated] = await tx
    .update(schema.socialPosts)
    .set({ status: "posted", postedAt: at, updatedAt: new Date() })
    .where(and(eq(schema.socialPosts.tenantId, ctx.tenantId), eq(schema.socialPosts.id, id)))
    .returning();
  if (!updated) throw new MarketingError("POST_MISSING", "no such post");
  return updated;
}

export async function deletePost(
  tx: Tx,
  ctx: MarketingCtx,
  id: string,
): Promise<SocialPost> {
  const [deleted] = await tx
    .delete(schema.socialPosts)
    .where(and(eq(schema.socialPosts.tenantId, ctx.tenantId), eq(schema.socialPosts.id, id)))
    .returning();
  // Zero rows is how RLS says no to a DELETE; treat it as the refusal it is.
  if (!deleted) throw new MarketingError("POST_MISSING", "no such post");
  return deleted;
}

/** How many posts each brand has waiting, for the picker's counts. */
export async function countPostsByChannel(
  tx: Tx,
  tenantId: string,
): Promise<Map<string, number>> {
  const rows = await tx
    .select({ channelId: schema.socialPosts.channelId, n: sql<number>`count(*)::int` })
    .from(schema.socialPosts)
    .where(eq(schema.socialPosts.tenantId, tenantId))
    .groupBy(schema.socialPosts.channelId);
  return new Map(rows.map((r) => [r.channelId, r.n]));
}
