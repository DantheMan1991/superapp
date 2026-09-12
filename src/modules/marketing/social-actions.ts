"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@/db";
import type { SocialChannel } from "@/db/schema";
import { logAuditInTx } from "@/lib/audit";
import {
  AUDIENCE_MAX,
  CHANNEL_LABEL_MAX,
  CHANNEL_URL_MAX,
  HANDLE_MAX,
  VOICE_MAX,
  footerHasLink,
  footerLinkFor,
  handleFromUrl,
  normalizeHandle,
} from "@/lib/social/channels";
import { isWebUrl, SOCIAL_NETWORKS } from "@/lib/sites/links";
import { readSiteSettings, SiteSettingsSchema, SOCIAL_LINKS_MAX } from "@/lib/sites/schema";
import { MarketingError } from "./core/errors";
import { fail, gate, type ActionResult } from "./gate";
import { findSiteById, updateSiteSettings } from "./site-ops";
import {
  deleteChannel,
  findChannelById,
  insertChannel,
  setChannelStatus,
  updateChannel,
} from "./social-ops";

/**
 * The accounts a brand posts to: adding one, editing it, pausing it, removing
 * it, and the one-tap offer to show it in the site's footer as well
 * ([ADR 0047](../../../docs/decisions/0047-a-social-channel-belongs-to-a-website-and-a-footer-link-is-not-one.md)).
 *
 * Owner-only through the module's one gate — where the business speaks to its
 * customers is the same kind of decision as how it looks, and `gate()` is the
 * one place Marketing answers that question.
 *
 * **Nothing here talks to a network.** No token is stored, nothing is fetched,
 * nothing is posted. An owner is writing down where their accounts are, and a
 * handle typed here is not checked against the network — a wrong one is a
 * wrong link in a footer, which the owner sees, and never a failed publish,
 * because nothing publishes yet.
 */
const BASE = "/dashboard/m/marketing/social/accounts";

function revalidateSocial(): void {
  revalidatePath(BASE);
  // A channel's name is on every post row, and pausing one changes what the
  // posts screen offers to write against.
  revalidatePath("/dashboard/m/marketing/social");
  // The footer mark, if the owner took the offer, is on every public page.
  revalidatePath("/dashboard/m/marketing/website");
  revalidatePath("/sites/[slug]/[[...path]]", "page");
  revalidatePath("/hosted/[slug]/[[...path]]", "page");
  revalidatePath("/domain/[host]/[[...path]]", "page");
}

/** One channel as a screen needs it. Dates as strings; nothing else crosses. */
export interface ChannelView {
  id: string;
  siteId: string | null;
  network: string;
  handle: string;
  label: string;
  profileUrl: string;
  audience: string;
  voice: string;
  status: string;
  createdAt: string;
}

/**
 * ASYNC BECAUSE THIS FILE IS `"use server"`, which may export nothing else —
 * the same reason `toPhotoView` is async in `image-actions.ts`. The mapping
 * itself waits for nothing.
 */
export async function toChannelView(row: SocialChannel): Promise<ChannelView> {
  return {
    id: row.id,
    siteId: row.siteId,
    network: row.network,
    handle: row.handle,
    label: row.label,
    profileUrl: row.profileUrl,
    audience: row.audience,
    voice: row.voice,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * The fields, checked once for both the add and the edit.
 *
 * **THE ADDRESS IS THE INPUT AND THE NAME IS DERIVED**, not the other way
 * round. Deriving `facebook.com/<name>` from a typed name produced an address
 * that looked right and pointed at nobody, because a page without a username
 * is `profile.php?id=…`. The owner pastes what their browser shows; the name
 * is read out of it and stays editable.
 */
const channelFields = z.object({
  network: z.enum(SOCIAL_NETWORKS),
  handle: z.string().max(HANDLE_MAX),
  label: z.string().max(CHANNEL_LABEL_MAX).default(""),
  profileUrl: z.string().max(CHANNEL_URL_MAX).default(""),
  audience: z.string().max(AUDIENCE_MAX).default(""),
  voice: z.string().max(VOICE_MAX).default(""),
});

type CheckedFields = {
  network: (typeof SOCIAL_NETWORKS)[number];
  handle: string;
  label: string;
  profileUrl: string;
  audience: string;
  voice: string;
};

function checkFields(
  input: z.infer<typeof channelFields>,
): { ok: true; fields: CheckedFields } | { ok: false; message: string } {
  const label = input.label.trim();
  const profileUrl = input.profileUrl.trim();
  if (profileUrl === "") {
    return {
      ok: false,
      message: "Paste the account's address, the way it looks in your browser.",
    };
  }
  if (!isWebUrl(profileUrl)) {
    return { ok: false, message: "The address should be a full one starting with https://." };
  }
  // Read out of the address when the owner has not typed one of their own.
  const handle = normalizeHandle(input.handle) || handleFromUrl(profileUrl);
  if (handle === "") {
    return {
      ok: false,
      message: "Yosher couldn't read a name out of that address. Type one for it.",
    };
  }
  if (input.network === "other" && label === "") {
    return { ok: false, message: "Give this one a name, so the list can say what it is." };
  }
  return {
    ok: true,
    fields: {
      network: input.network,
      handle,
      label,
      profileUrl,
      audience: input.audience.trim(),
      voice: input.voice.trim(),
    },
  };
}

const addInput = channelFields.extend({
  /**
   * Which brand's account this is: a website's id, or the empty string for the
   * business's own. Empty rather than absent, because a form field that was
   * never filled in and a deliberate "the business itself" must not be the
   * same value — `tsc` cannot see the difference at an `unknown` boundary
   * (the ADR 0045 consequence that cost seven client forms).
   */
  siteId: z.string().uuid().or(z.literal("")),
});

export async function addChannelAction(input: unknown): Promise<ActionResult<ChannelView>> {
  try {
    const ctx = await gate();
    const parsed = addInput.safeParse(input);
    if (!parsed.success) return { error: "Check the fields and try again." };
    const checked = checkFields(parsed.data);
    if (!checked.ok) return { error: checked.message };
    const siteId = parsed.data.siteId === "" ? null : parsed.data.siteId;
    const row = await withTenant(
      ctx.tenantId,
      async (tx) => {
        // A named site must be this tenant's and must still exist. RLS has
        // already decided that; this turns "absent" into the module's words.
        if (siteId !== null && !(await findSiteById(tx, ctx.tenantId, siteId))) {
          throw new MarketingError("SITE_MISSING", "no site");
        }
        const created = await insertChannel(tx, ctx, { ...checked.fields, siteId });
        await logAuditInTx(tx, {
          action: "marketing.social.channel_added",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "social_channel",
          targetId: created.id,
          // Identifiers only: the network, the brand it is under, and the
          // handle, which is a public name and not a secret.
          meta: { network: created.network, siteId: created.siteId, handle: created.handle },
        });
        return created;
      },
      { role: ctx.role },
    );
    revalidateSocial();
    return { ok: true, data: await toChannelView(row) };
  } catch (err) {
    return fail(err);
  }
}

const editInput = channelFields.extend({ id: z.string().uuid() });

export async function editChannelAction(input: unknown): Promise<ActionResult<ChannelView>> {
  try {
    const ctx = await gate();
    const parsed = editInput.safeParse(input);
    if (!parsed.success) return { error: "Check the fields and try again." };
    const checked = checkFields(parsed.data);
    if (!checked.ok) return { error: checked.message };
    const row = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const updated = await updateChannel(tx, ctx, parsed.data.id, checked.fields);
        await logAuditInTx(tx, {
          action: "marketing.social.channel_changed",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "social_channel",
          targetId: updated.id,
          meta: { network: updated.network, siteId: updated.siteId, handle: updated.handle },
        });
        return updated;
      },
      { role: ctx.role },
    );
    revalidateSocial();
    return { ok: true, data: await toChannelView(row) };
  } catch (err) {
    return fail(err);
  }
}

const statusInput = z.object({
  id: z.string().uuid(),
  status: z.enum(["active", "paused"]),
});

export async function setChannelStatusAction(input: unknown): Promise<ActionResult<ChannelView>> {
  try {
    const ctx = await gate();
    const parsed = statusInput.safeParse(input);
    if (!parsed.success) return { error: "Try that again." };
    const row = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const updated = await setChannelStatus(tx, ctx, parsed.data.id, parsed.data.status);
        await logAuditInTx(tx, {
          action:
            parsed.data.status === "paused"
              ? "marketing.social.channel_paused"
              : "marketing.social.channel_resumed",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "social_channel",
          targetId: updated.id,
          meta: { network: updated.network, siteId: updated.siteId },
        });
        return updated;
      },
      { role: ctx.role },
    );
    revalidateSocial();
    return { ok: true, data: await toChannelView(row) };
  } catch (err) {
    return fail(err);
  }
}

const idInput = z.object({ id: z.string().uuid() });

/**
 * Removing a channel leaves the footer mark where it is. They are two rows
 * with two lifetimes (ADR 0047) and a public page is not something to change
 * behind an owner's back — "stop posting here" and "stop telling visitors we
 * are here" are different sentences. The screen says so beside the button.
 */
export async function removeChannelAction(input: unknown): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = idInput.safeParse(input);
    if (!parsed.success) return { error: "Pick an account and try again." };
    await withTenant(
      ctx.tenantId,
      async (tx) => {
        const deleted = await deleteChannel(tx, ctx, parsed.data.id);
        await logAuditInTx(tx, {
          action: "marketing.social.channel_removed",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "social_channel",
          targetId: deleted.id,
          meta: { network: deleted.network, siteId: deleted.siteId },
        });
      },
      { role: ctx.role },
    );
    revalidateSocial();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/**
 * The one-tap offer: put this account's mark in its website's footer too.
 *
 * The one place the two ideas touch, and it touches them ONCE — it copies a
 * value across and walks away. Nothing after this keeps them in step, which is
 * the decision, not an omission.
 */
export async function showChannelInFooterAction(input: unknown): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = idInput.safeParse(input);
    if (!parsed.success) return { error: "Pick an account and try again." };
    await withTenant(
      ctx.tenantId,
      async (tx) => {
        const channel = await findChannelById(tx, ctx.tenantId, parsed.data.id);
        if (!channel) throw new MarketingError("CHANNEL_MISSING", "no such channel");
        if (!channel.siteId) {
          // A business-wide account has no footer to go in. The screen does
          // not offer the button in that case; this is the second door.
          throw new MarketingError("CHANNEL_NOT_ON_A_SITE", "no site");
        }
        const site = await findSiteById(tx, ctx.tenantId, channel.siteId);
        if (!site) throw new MarketingError("SITE_MISSING", "no site");
        const mark = footerLinkFor({
          network: channel.network as (typeof SOCIAL_NETWORKS)[number],
          handle: channel.handle,
          label: channel.label,
          profileUrl: channel.profileUrl,
        });
        if (!mark) throw new MarketingError("INVALID_INPUT", "no address to link to");
        const current = readSiteSettings(site.settings);
        if (footerHasLink(current.social, mark)) return;
        if (current.social.length >= SOCIAL_LINKS_MAX) {
          throw new MarketingError("FOOTER_FULL", "footer full");
        }
        const settings = SiteSettingsSchema.safeParse({
          ...current,
          social: [...current.social, mark],
        });
        if (!settings.success) throw new MarketingError("INVALID_INPUT", "settings rejected");
        await updateSiteSettings(tx, ctx, site.id, { settings: settings.data });
        await logAuditInTx(tx, {
          action: "marketing.social.channel_shown_in_footer",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "social_channel",
          targetId: channel.id,
          meta: { network: channel.network, siteId: site.id },
        });
      },
      { role: ctx.role },
    );
    revalidateSocial();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
