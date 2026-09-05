/**
 * Links an owner types into the site, and the profiles elsewhere — pure,
 * dependency-free.
 *
 * A link is one of four shapes and nothing else: a page on this site
 * (`/contact`), an `https://` or `http://` address, a `mailto:` or a
 * `tel:`. The rule is checked when the owner saves (the editor says why)
 * and again by the renderer, which turns anything else into plain words,
 * so a stored `javascript:` from any road — an older page, a row edited by
 * hand — is never an `href` on a public page. The public pages sit on the
 * platform's own origin, which is what makes this a security rule rather
 * than a tidiness one.
 */
export const LINK_HINT =
  "A page on this site such as /contact, a full https:// address, or a mailto: or tel: link.";
/** The same rule as a sentence, for a refusal. */
export const LINK_RULE =
  "A link is a page on this site such as /contact, a full https:// address, or a mailto: or tel: link.";

const LINK_SCHEMES = /^(https?:\/\/|mailto:|tel:)/i;

export function isSafeHref(href: string): boolean {
  const value = href.trim();
  if (value === "") return false;
  // `//host` is a protocol-relative address, not a page here.
  if (value.startsWith("/")) return !value.startsWith("//");
  return LINK_SCHEMES.test(value);
}

/** A profile elsewhere is a web address on a real host: `https://www.facebook.com/oakrowfarm`. */
export function isWebUrl(url: string): boolean {
  const value = url.trim();
  if (!/^https?:\/\//i.test(value)) return false;
  try {
    return new URL(value).hostname.includes(".");
  } catch {
    return false;
  }
}

export const WEB_URL_HINT = "A full address that starts with https://.";

/**
 * The networks a business is likely to be on, drawn as icons by the
 * renderer (`src/components/site/social-icons.tsx`); `other` is any site
 * with a label of its own, shown as words.
 */
export const SOCIAL_NETWORKS = [
  "facebook",
  "instagram",
  "youtube",
  "tiktok",
  "linkedin",
  "x",
  "pinterest",
  "other",
] as const;
export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number];

export const SOCIAL_NETWORK_LABELS: Record<SocialNetwork, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  youtube: "YouTube",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
  x: "X",
  pinterest: "Pinterest",
  other: "Another site",
};

/** What a link is called: the network's name, or the owner's own label for `other`. */
export function socialLabel(link: { network: SocialNetwork; label: string }): string {
  if (link.network === "other") return link.label.trim() || "Website";
  return SOCIAL_NETWORK_LABELS[link.network];
}

const HOSTS: Array<[SocialNetwork, string[]]> = [
  ["facebook", ["facebook.com", "fb.com", "fb.me"]],
  ["instagram", ["instagram.com", "instagr.am"]],
  ["youtube", ["youtube.com", "youtu.be"]],
  ["tiktok", ["tiktok.com"]],
  ["linkedin", ["linkedin.com", "lnkd.in"]],
  ["x", ["x.com", "twitter.com"]],
  ["pinterest", ["pinterest.com", "pin.it"]],
];

/** The network a pasted address belongs to, from its host; null when it is nobody's we know. */
export function guessNetwork(url: string): SocialNetwork | null {
  let host: string;
  try {
    host = new URL(url.trim()).hostname.toLowerCase();
  } catch {
    return null;
  }
  for (const [network, hosts] of HOSTS) {
    if (hosts.some((h) => host === h || host.endsWith(`.${h}`))) return network;
  }
  return null;
}
