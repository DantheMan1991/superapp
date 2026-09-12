"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@/db";
import { logAuditInTx } from "@/lib/audit";
import {
  bodyLimitFor,
  POST_BODY_MAX,
  POST_LINK_MAX,
  POST_SHAPES,
  readyToSchedule,
  roundToStep,
} from "@/lib/social/posts";
import { isSafeHref, LINK_RULE, SOCIAL_NETWORK_LABELS, type SocialNetwork } from "@/lib/sites/links";
import { MarketingError } from "./core/errors";
import { fail, gate, type ActionResult } from "./gate";
import {
  createPost,
  deletePost,
  findPostById,
  markPosted,
  schedulePost,
  unschedulePost,
  updatePost,
  type PostWithChannel,
} from "./post-ops";

/**
 * A post: writing it, giving it a picture, putting it on the calendar, saying
 * it went out, throwing it away (slice S1).
 *
 * Owner-only through the module's one gate — the same line Marketing draws
 * everywhere, and it matters more here than for a logo: when S6 brings real
 * connections, a scheduled post goes out on its own, so whoever may write one
 * may eventually publish one. Loosening that is a policy change with a reason
 * attached, not a default to drift into.
 *
 * **NOTHING HERE TALKS TO A NETWORK.** `markPostedAction` records a claim a
 * person made. The screen says so.
 */
const BASE = "/dashboard/m/marketing/social";

function revalidatePosts(): void {
  revalidatePath(BASE);
  revalidatePath(`${BASE}/posts/[postId]`, "page");
}

/** One post as a screen needs it. Dates as strings; nothing else crosses. */
export interface PostView {
  id: string;
  channelId: string;
  network: string;
  handle: string;
  label: string;
  status: string;
  origin: string;
  body: string;
  link: string;
  imageId: string | null;
  shape: string;
  focusX: number;
  focusY: number;
  scheduledAt: string | null;
  postedAt: string | null;
  remindedAt: string | null;
  workItemId: string | null;
}

/** ASYNC because this file is `"use server"`, which may export nothing else. */
export async function toPostView(row: PostWithChannel): Promise<PostView> {
  return {
    id: row.post.id,
    channelId: row.channel.id,
    network: row.channel.network,
    handle: row.channel.handle,
    label: row.channel.label,
    status: row.post.status,
    origin: row.post.origin,
    body: row.post.body,
    link: row.post.link,
    imageId: row.post.imageId,
    shape: row.post.shape,
    focusX: row.post.focusX,
    focusY: row.post.focusY,
    scheduledAt: row.post.scheduledAt?.toISOString() ?? null,
    postedAt: row.post.postedAt?.toISOString() ?? null,
    remindedAt: row.post.remindedAt?.toISOString() ?? null,
    workItemId: row.post.workItemId,
  };
}

const addInput = z.object({ channelId: z.string().uuid() });

export async function addPostAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await gate();
    const parsed = addInput.safeParse(input);
    if (!parsed.success) return { error: "Pick an account and try again." };
    const created = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const row = await createPost(tx, ctx, { channelId: parsed.data.channelId });
        await logAuditInTx(tx, {
          action: "marketing.social.post_created",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "social_post",
          targetId: row.id,
          meta: { channelId: row.channelId, origin: row.origin },
        });
        return row;
      },
      { role: ctx.role },
    );
    revalidatePosts();
    return { ok: true, data: { id: created.id } };
  } catch (err) {
    return fail(err);
  }
}

const saveInput = z.object({
  id: z.string().uuid(),
  body: z.string().max(POST_BODY_MAX),
  link: z.string().max(POST_LINK_MAX).default(""),
  imageId: z.string().uuid().nullable().default(null),
  shape: z.enum(POST_SHAPES),
  focusX: z.number().min(0).max(1),
  focusY: z.number().min(0).max(1),
});

export async function savePostAction(input: unknown): Promise<ActionResult<PostView>> {
  try {
    const ctx = await gate();
    const parsed = saveInput.safeParse(input);
    if (!parsed.success) return { error: "Check the fields and try again." };
    const link = parsed.data.link.trim();
    if (link !== "" && !isSafeHref(link)) return { error: LINK_RULE };
    const row = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const before = await findPostById(tx, ctx.tenantId, parsed.data.id);
        if (!before) throw new MarketingError("POST_MISSING", "no such post");
        // THE NETWORK'S LIMIT, NOT OURS. Checked here rather than only in the
        // form, because the form learns the network from a prop and an action
        // takes `unknown`. Read from the post's OWN channel, so a body saved
        // against an X account is held to 280 whatever was posted.
        const limit = bodyLimitFor(before.channel.network as SocialNetwork);
        if (parsed.data.body.length > limit) {
          throw new MarketingError(
            "POST_TOO_LONG",
            `${SOCIAL_NETWORK_LABELS[before.channel.network as SocialNetwork]} takes ${limit.toLocaleString()} characters; this is ${parsed.data.body.length.toLocaleString()}.`,
          );
        }
        const updated = await updatePost(tx, ctx, parsed.data.id, {
          body: parsed.data.body,
          link,
          imageId: parsed.data.imageId,
          shape: parsed.data.shape,
          focusX: parsed.data.focusX,
          focusY: parsed.data.focusY,
        });
        await logAuditInTx(tx, {
          action: "marketing.social.post_saved",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "social_post",
          targetId: updated.id,
          // Identifiers and shapes only — never the words themselves.
          meta: { channelId: updated.channelId, hasImage: updated.imageId !== null },
        });
        return { post: updated, channel: before.channel };
      },
      { role: ctx.role },
    );
    revalidatePosts();
    return { ok: true, data: await toPostView(row) };
  } catch (err) {
    return fail(err);
  }
}

const scheduleInput = z.object({
  id: z.string().uuid(),
  /** An ISO instant the browser built from the owner's own clock. */
  at: z.string().min(1).max(40),
});

export async function schedulePostAction(input: unknown): Promise<ActionResult<PostView>> {
  try {
    const ctx = await gate();
    const parsed = scheduleInput.safeParse(input);
    if (!parsed.success) throw new MarketingError("POST_TIME_INVALID", "bad input");
    const at = new Date(parsed.data.at);
    if (Number.isNaN(at.getTime())) throw new MarketingError("POST_TIME_INVALID", "unparseable");
    // Rounded to the sweep's own ten minutes, so the screen never promises a
    // minute the reminder cannot keep.
    const when = roundToStep(at);
    const row = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const before = await findPostById(tx, ctx.tenantId, parsed.data.id);
        if (!before) throw new MarketingError("POST_MISSING", "no such post");
        // An empty post on the calendar is a reminder to write something,
        // which is not what a calendar entry means here.
        if (!readyToSchedule(before.post)) throw new MarketingError("POST_EMPTY", "no words");
        const updated = await schedulePost(tx, ctx, parsed.data.id, when);
        await logAuditInTx(tx, {
          action: "marketing.social.post_scheduled",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "social_post",
          targetId: updated.id,
          meta: { channelId: updated.channelId, scheduledAt: when.toISOString() },
        });
        return { post: updated, channel: before.channel };
      },
      { role: ctx.role },
    );
    revalidatePosts();
    return { ok: true, data: await toPostView(row) };
  } catch (err) {
    return fail(err);
  }
}

const idInput = z.object({ id: z.string().uuid() });

export async function unschedulePostAction(input: unknown): Promise<ActionResult<PostView>> {
  try {
    const ctx = await gate();
    const parsed = idInput.safeParse(input);
    if (!parsed.success) return { error: "Pick a post and try again." };
    const row = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const before = await findPostById(tx, ctx.tenantId, parsed.data.id);
        if (!before) throw new MarketingError("POST_MISSING", "no such post");
        const updated = await unschedulePost(tx, ctx, parsed.data.id);
        await logAuditInTx(tx, {
          action: "marketing.social.post_unscheduled",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "social_post",
          targetId: updated.id,
          meta: { channelId: updated.channelId },
        });
        return { post: updated, channel: before.channel };
      },
      { role: ctx.role },
    );
    revalidatePosts();
    return { ok: true, data: await toPostView(row) };
  } catch (err) {
    return fail(err);
  }
}

/**
 * "I posted it."
 *
 * A CLAIM A PERSON MADE, and the words in the guide say so. Nothing in this
 * build can see a network, so this is bookkeeping — it takes the post off the
 * list of things still to do and leaves the record of when.
 */
export async function markPostedAction(input: unknown): Promise<ActionResult<PostView>> {
  try {
    const ctx = await gate();
    const parsed = idInput.safeParse(input);
    if (!parsed.success) return { error: "Pick a post and try again." };
    const row = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const before = await findPostById(tx, ctx.tenantId, parsed.data.id);
        if (!before) throw new MarketingError("POST_MISSING", "no such post");
        const updated = await markPosted(tx, ctx, parsed.data.id, new Date());
        await logAuditInTx(tx, {
          action: "marketing.social.post_marked_posted",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "social_post",
          targetId: updated.id,
          meta: { channelId: updated.channelId },
        });
        return { post: updated, channel: before.channel };
      },
      { role: ctx.role },
    );
    revalidatePosts();
    return { ok: true, data: await toPostView(row) };
  } catch (err) {
    return fail(err);
  }
}

export async function deletePostAction(input: unknown): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = idInput.safeParse(input);
    if (!parsed.success) return { error: "Pick a post and try again." };
    await withTenant(
      ctx.tenantId,
      async (tx) => {
        const deleted = await deletePost(tx, ctx, parsed.data.id);
        await logAuditInTx(tx, {
          action: "marketing.social.post_deleted",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "social_post",
          targetId: deleted.id,
          meta: { channelId: deleted.channelId, status: deleted.status },
        });
      },
      { role: ctx.role },
    );
    revalidatePosts();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
