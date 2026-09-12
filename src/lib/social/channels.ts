import { SOCIAL_NETWORK_LABELS, type SocialNetwork } from "@/lib/sites/links";

/**
 * A social CHANNEL — an account the business posts to — decided in one pure,
 * dependency-free file so the screen, the action and the database agree
 * ([ADR 0047](../../../docs/decisions/0047-a-social-channel-belongs-to-a-website-and-a-footer-link-is-not-one.md)).
 *
 * **A channel is not a footer link.** `settings.social` holds the marks an
 * owner chose to DISPLAY in the site's footer; this holds the accounts the
 * business POSTS TO. They name the same networks and often the same accounts,
 * and neither becomes the other: adding a channel offers to add the mark, and
 * from then on they are two rows with two lifetimes. The mismatch is the price
 * of not pretending a display choice and a publishing target are one thing.
 *
 * **Who it belongs to** is `site_id`: one of the business's websites, which
 * since ADR 0045 is what a brand IS, or the business itself when null. That is
 * the founder's opening requirement — a Facebook per industry — and it is a
 * column rather than a feature.
 */

/** Per owner: per website, and again for the business's own. */
export const SOCIAL_CHANNELS_MAX = 12;

export const CHANNEL_STATUSES = ["active", "paused"] as const;
export type ChannelStatus = (typeof CHANNEL_STATUSES)[number];

export const CHANNEL_STATUS_LABELS: Record<ChannelStatus, string> = {
  active: "Posting",
  paused: "Paused",
};

export const HANDLE_MAX = 80;
export const CHANNEL_LABEL_MAX = 80;
/**
 * 200, NOT the column's 500.
 *
 * `SocialLinkSchema.url` caps a footer mark at 200, and a channel can be
 * copied into the footer in one tap. A longer address would store fine and
 * then fail that copy with "Check the fields and try again.", which is the
 * worst kind of refusal: correct, late, and about a field the owner is not
 * looking at. The column keeps 500 as headroom; nothing is ever written past
 * this.
 */
export const CHANNEL_URL_MAX = 200;
export const AUDIENCE_MAX = 400;
export const VOICE_MAX = 400;

/**
 * The networks a machine could ever post to, as opposed to the ones a person
 * can plan for. `other` is deliberately a channel — a Nextdoor, a Substack, a
 * forum the trade lives on belongs in the plan, and in a tool whose first
 * version is copy-and-paste there is nothing it cannot do — but no API will
 * ever be written for "another site", so the screen says so when it is chosen
 * rather than letting somebody find out at connection time.
 *
 * Nothing is connected yet in any case; S6 is where that is earned, one app
 * review at a time.
 */
export function canEverConnect(network: SocialNetwork): boolean {
  return network !== "other";
}

/**
 * One account, one row. Trimmed, stripped of a leading `@`, lowercased, and
 * with any internal whitespace gone.
 *
 * LOWERCASE IS SAFE FOR EVERY NETWORK HERE — handles are case-insensitive on
 * all of them — and it is what lets the unique index be a plain
 * `(tenant_id, network, handle)` rather than an expression index drizzle-kit
 * would have to be talked into. `other` loses nothing by it either, because
 * what the screen SHOWS for `other` is `label`, never the handle.
 */
export function normalizeHandle(handle: string): string {
  return handle.trim().replace(/^@+/, "").replace(/\s+/g, "").toLowerCase();
}

/** What the screen calls this channel: the owner's own words for `other`, else `@handle`. */
export function channelDisplay(channel: {
  network: SocialNetwork;
  handle: string;
  label: string;
}): string {
  if (channel.network === "other") return channel.label.trim() || "Another site";
  return `@${channel.handle}`;
}

/** "Facebook · @oakrowfarm", the one line a list row needs. */
export function channelTitle(channel: {
  network: SocialNetwork;
  handle: string;
  label: string;
}): string {
  return `${SOCIAL_NETWORK_LABELS[channel.network]} · ${channelDisplay(channel)}`;
}

const PROFILE_PREFIX: Partial<Record<SocialNetwork, string>> = {
  facebook: "https://www.facebook.com/",
  instagram: "https://www.instagram.com/",
  youtube: "https://www.youtube.com/@",
  tiktok: "https://www.tiktok.com/@",
  linkedin: "https://www.linkedin.com/company/",
  x: "https://x.com/",
  pinterest: "https://www.pinterest.com/",
};

/**
 * The address a handle almost certainly lives at, so the owner types one field
 * instead of two. A GUESS, and the form shows it as a filled-in value the
 * owner can overwrite — LinkedIn in particular is `/company/` for a business
 * and `/in/` for a person, and YouTube still honours several shapes.
 *
 * Empty for `other`, which is the one network whose address cannot be derived
 * from anything; that form asks for the link itself.
 */
export function profileUrlFor(network: SocialNetwork, handle: string): string {
  const prefix = PROFILE_PREFIX[network];
  const clean = normalizeHandle(handle);
  if (!prefix || clean === "") return "";
  return `${prefix}${clean}`;
}

/** The footer mark this channel would become, for the one-tap offer on the screen. */
export function footerLinkFor(channel: {
  network: SocialNetwork;
  handle: string;
  label: string;
  profileUrl: string;
}): { network: SocialNetwork; url: string; label: string } | null {
  const url = channel.profileUrl.trim() || profileUrlFor(channel.network, channel.handle);
  if (url === "") return null;
  return {
    network: channel.network,
    url,
    // The footer's own label cap is shorter than a channel's (30 vs 80), and
    // it only matters for `other`; a longer one is cut rather than refused,
    // because the offer is a convenience and must not fail the save.
    label: channel.network === "other" ? channel.label.trim().slice(0, 30) : "",
  };
}

/** Is this mark already in the footer? Compared on the address, which is the account. */
export function footerHasLink(
  links: readonly { network: SocialNetwork; url: string }[],
  mark: { network: SocialNetwork; url: string },
): boolean {
  const want = mark.url.trim().replace(/\/+$/, "").toLowerCase();
  return links.some(
    (l) => l.network === mark.network && l.url.trim().replace(/\/+$/, "").toLowerCase() === want,
  );
}
