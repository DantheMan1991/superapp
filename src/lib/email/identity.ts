/**
 * Who a message appears to come from.
 *
 * The rule that makes this file necessary: you cannot put a tenant's address in
 * the From header just because you know it. Mail claiming to be from
 * acmebuilders.com but signed by our keys fails SPF/DKIM alignment, DMARC
 * rejects it, and it lands in spam — or is dropped outright. Sending as someone
 * requires their DNS to say you may.
 *
 * So there are exactly two honest identities, and this pure function picks
 * between them:
 *
 *   VERIFIED    invoices@mail.acmebuilders.com    — their domain, their name
 *   FALLBACK    notifications@<platform>          — our domain, their NAME in
 *                                                   the display part, and
 *                                                   Reply-To pointed at them
 *
 * The fallback is deliberately not anonymous. "Acme Builders
 * <notifications@…>" with replies going to the tenant is a long way from
 * "noreply@sometool.com", and it is what every tenant gets on day one before
 * anyone has touched a DNS panel.
 */

export type SenderKind = "tenant_domain" | "platform";

export interface SenderIdentity {
  kind: SenderKind;
  /** RFC 5322 From value, display name included. */
  from: string;
  fromAddress: string;
  replyTo?: string;
}

export interface IdentityInput {
  tenantName: string;
  /** The tenant's verified sending domain, if they have one. */
  verifiedDomain: { domain: string; fromLocalPart: string; fromName: string } | null;
  /** Where replies should go when sending from the platform domain. */
  tenantReplyTo?: string | null;
  /** The platform's own sending domain, e.g. "mail.yosherapp.com". */
  platformDomain: string;
  platformLocalPart?: string;
}

/**
 * Display names are quoted and stripped of the characters that would let a
 * name break out of the header. A tenant called `Acme" <evil@x.com>` must not
 * become a second address.
 */
export function sanitizeDisplayName(raw: string): string {
  let out = "";
  for (const char of raw) {
    const code = char.charCodeAt(0);
    if (code < 32 || code === 127) continue;
    if (char === '"' || char === "\\" || char === "<" || char === ">") continue;
    out += char;
  }
  return out.trim().slice(0, 78);
}

export function resolveSender(input: IdentityInput): SenderIdentity {
  const tenantName = sanitizeDisplayName(input.tenantName) || "Yosher";

  if (input.verifiedDomain) {
    const name =
      sanitizeDisplayName(input.verifiedDomain.fromName) || tenantName;
    const address = `${input.verifiedDomain.fromLocalPart}@${input.verifiedDomain.domain}`;
    return {
      kind: "tenant_domain",
      from: `"${name}" <${address}>`,
      fromAddress: address,
      // No Reply-To needed: the From address is genuinely theirs and replies
      // to it reach them.
      ...(input.tenantReplyTo ? { replyTo: input.tenantReplyTo } : {}),
    };
  }

  const address = `${input.platformLocalPart ?? "notifications"}@${input.platformDomain}`;
  return {
    kind: "platform",
    // Their name, our envelope — honest about the sender while still reading
    // as the client rather than as the tool.
    from: `"${tenantName}" <${address}>`,
    fromAddress: address,
    ...(input.tenantReplyTo ? { replyTo: input.tenantReplyTo } : {}),
  };
}

/**
 * A sending domain must be a real, plausible hostname. A subdomain is strongly
 * preferred — sending from `mail.acme.com` keeps this traffic's reputation
 * separate from the root domain the owner uses for their personal mail, so a
 * bad send never poisons their day-to-day email.
 */
export function normalizeSendingDomain(raw: string): string | null {
  const trimmed = raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/\.$/, "");
  if (trimmed.length < 4 || trimmed.length > 253) return null;
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(trimmed)) {
    return null;
  }
  // Must have a TLD-ish last label.
  const labels = trimmed.split(".");
  if (labels.length < 2) return null;
  if (labels[labels.length - 1].length < 2) return null;
  return trimmed;
}

export function isSubdomain(domain: string): boolean {
  return domain.split(".").length >= 3;
}

export function normalizeLocalPart(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9._-]{0,62}$/.test(trimmed) ? trimmed : null;
}

/** Cheap shape check. Real validation is the provider bouncing it. */
export function looksLikeEmail(raw: string): boolean {
  const value = raw.trim();
  if (value.length < 6 || value.length > 254) return false;
  if (/[\s<>",;]/.test(value)) return false;
  const at = value.indexOf("@");
  if (at <= 0 || at !== value.lastIndexOf("@")) return false;
  const domain = value.slice(at + 1);
  return domain.includes(".") && !domain.startsWith(".") && !domain.endsWith(".");
}

export function emailDomainOf(address: string): string {
  const at = address.lastIndexOf("@");
  return at === -1 ? "" : address.slice(at + 1).toLowerCase();
}
