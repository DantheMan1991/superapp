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
 * What an address on this network USUALLY looks like — a placeholder, never a
 * value.
 *
 * **THE FORM USED TO DERIVE THE ADDRESS FROM A TYPED NAME, AND THAT WAS
 * BACKWARDS.** A Facebook page is `facebook.com/<username>` only when it has a
 * username; plenty are `facebook.com/profile.php?id=61550…` or
 * `facebook.com/p/Some-Name-61550…`. LinkedIn is `/company/` for a business and
 * `/in/` for a person. YouTube honours `@handle`, `/c/` and `/channel/UC…`. So
 * a name typed into a box produced an address that LOOKED right, was silently
 * saved, and pointed at nobody — the founder hit it on his own page the day S1
 * merged.
 *
 * The site's own footer form had it right all along ("paste the address of your
 * page and the network fills in from it"), and this now works the same way:
 * paste the real address, and the network and the name come FROM it. This
 * function survives only to show the shape in a placeholder.
 */
export function profileUrlExample(network: SocialNetwork): string {
  const prefix = PROFILE_PREFIX[network];
  return prefix ? `${prefix}yourname` : "https://example.com/yourpage";
}

/**
 * Path segments that name a KIND of page rather than the account: what comes
 * after them is the account. `/company/oak-row`, `/channel/UCabc`, `/p/Oak-Row-123`.
 */
const PATH_PREFIXES = new Set(["p", "c", "channel", "company", "in", "user", "pages", "profile"]);

/**
 * The account's name, read OUT of its address — the direction that actually
 * works.
 *
 * `handle` is still the workspace-unique key and still editable, but it is no
 * longer the thing an owner has to know: they paste what their browser shows
 * and this reads the identifying part out of it. A page with no username at all
 * yields its numeric id, which is ugly and is also exactly what identifies it.
 */
export function handleFromUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return "";
  }
  // `facebook.com/profile.php?id=615…` — the id IS the account.
  const id = parsed.searchParams.get("id");
  if (id && /^\d+$/.test(id)) return id;
  const segments = parsed.pathname.split("/").filter((seg) => seg !== "");
  const meaningful = segments.filter(
    (seg) => !PATH_PREFIXES.has(seg.toLowerCase().replace(/\.php$/, "")),
  );
  return normalizeHandle(meaningful[0] ?? "");
}

/**
 * The footer mark this channel would become, for the one-tap offer on the screen.
 *
 * No fallback to a guessed address any more: the stored one is the address the
 * owner pasted, and a mark on a public page is the last place to put something
 * derived from a name that may not be the account's at all.
 */
export function footerLinkFor(channel: {
  network: SocialNetwork;
  handle: string;
  label: string;
  profileUrl: string;
}): { network: SocialNetwork; url: string; label: string } | null {
  const url = channel.profileUrl.trim();
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
