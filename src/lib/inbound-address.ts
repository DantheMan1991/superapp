/**
 * Routing an inbound email to the thing it was addressed to.
 *
 * Two features now use forwarding addresses on the same domain — receipts
 * (`receipts-<token>@`) and Documents folders (`docs-<token>@`) — so the
 * matching lives here rather than being copied. Pure and dependency-free; the
 * webhook verifies the signature and hands the addresses in.
 *
 * Two hard-won details are load-bearing and must not be "tidied":
 *
 *  1. Matching is case-INSENSITIVE and the token is returned lowercased.
 *     Email local-parts are not case-preserved in the wild — Outlook
 *     lowercases forwarded addresses, which was learned in production. Tokens
 *     are therefore generated and stored lowercase.
 *
 *  2. The scan includes the ENVELOPE recipient, not just To/Cc, because that
 *     is the only place a BCC or a forward shows up.
 */

/** Prefixes are fixed strings, never user input, so they need no escaping. */
export type InboundPrefix = "receipts" | "docs";

const TOKEN_BODY = "([A-Za-z0-9_-]{10,})";

export function parseTokenForPrefix(
  addresses: readonly string[],
  domain: string,
  prefix: InboundPrefix,
): string | null {
  const wantDomain = domain.trim().toLowerCase();
  if (!wantDomain) return null;
  const pattern = new RegExp(`^${prefix}-${TOKEN_BODY}$`, "i");

  for (const raw of addresses) {
    // Tolerate "Display Name <addr@host>" forms.
    const angled = /<([^<>]+)>/.exec(raw);
    const addr = (angled ? angled[1] : raw).trim();
    const at = addr.lastIndexOf("@");
    if (at < 0) continue;
    if (addr.slice(at + 1).toLowerCase() !== wantDomain) continue;
    const match = pattern.exec(addr.slice(0, at));
    if (match) return match[1].toLowerCase();
  }
  return null;
}

/**
 * Which feature an email is addressed to, if any. Checked in order, and a
 * message is only ever routed one way — an address cannot match both prefixes
 * because the prefix is part of the local part.
 */
export function routeInboundEmail(
  addresses: readonly string[],
  domain: string,
): { kind: InboundPrefix; token: string } | null {
  const docs = parseTokenForPrefix(addresses, domain, "docs");
  if (docs) return { kind: "docs", token: docs };
  const receipts = parseTokenForPrefix(addresses, domain, "receipts");
  if (receipts) return { kind: "receipts", token: receipts };
  return null;
}

/** Tokens are lowercase by construction — see the note above about Outlook. */
export function buildInboundAddress(
  prefix: InboundPrefix,
  token: string,
  domain: string,
): string {
  return `${prefix}-${token.toLowerCase()}@${domain}`;
}
