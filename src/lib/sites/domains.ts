/**
 * A domain the business owns, connected to its site — the pure half.
 *
 * What a domain may look like, whether it is an apex or a subdomain (which
 * decides an A record or a CNAME), the records the owner has to publish
 * given what Vercel said, and what Vercel's answers mean for the row's
 * status. The Vercel calls themselves are in `src/lib/vercel/domains.ts`.
 */

/** Hostname per RFC 1123, at least two labels, an alphabetic TLD. */
export const DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export type DomainCheck =
  | { ok: true; domain: string; apex: boolean }
  | { ok: false; reason: "empty" | "shape" | "ip" | "platform" | "wildcard" };

/**
 * "https://WWW.OakRowFarm.com/" → `www.oakrowfarm.com`. Strips what people
 * paste (a scheme, a path, a port, a trailing dot) and refuses what cannot be
 * connected: an IP, a wildcard, a bare word, or one of the platform's own
 * hosts (the app, the site domain, Vercel's) and anything under them.
 */
export function normalizeDomain(
  input: string,
  env: { platformHosts: string[]; siteDomain: string | null },
): DomainCheck {
  let value = input.trim().toLowerCase();
  value = value.replace(/^[a-z]+:\/\//, "");
  value = value.split("/")[0] ?? "";
  value = value.split(":")[0] ?? "";
  value = value.replace(/\.+$/, "");
  if (value === "") return { ok: false, reason: "empty" };
  if (value.startsWith("*")) return { ok: false, reason: "wildcard" };
  if (/^[0-9.]+$/.test(value)) return { ok: false, reason: "ip" };
  if (!DOMAIN_RE.test(value)) return { ok: false, reason: "shape" };
  const own = [...env.platformHosts, "vercel.app", ...(env.siteDomain ? [env.siteDomain] : [])]
    .map((h) => h.toLowerCase().split(":")[0] ?? "")
    .filter(Boolean);
  for (const host of own) {
    if (value === host || value.endsWith(`.${host}`)) return { ok: false, reason: "platform" };
  }
  return { ok: true, domain: value, apex: isApexDomain(value) };
}

export function domainReasonMessage(reason: Exclude<DomainCheck, { ok: true }>["reason"]): string {
  switch (reason) {
    case "empty":
      return "Type the domain you own, like www.example.com.";
    case "shape":
      return "That doesn't look like a domain. Try www.example.com.";
    case "ip":
      return "Connect a domain name, not an address of numbers.";
    case "platform":
      return "That address belongs to Yosher. Connect a domain you own.";
    case "wildcard":
      return "Connect one name, like www.example.com, not a wildcard.";
  }
}

/**
 * `example.com` is an apex; `www.example.com` is not. Two labels means
 * apex. A registry with two-part endings (`example.co.uk`) reads as a
 * subdomain here and is offered a CNAME, which its registrar will refuse at
 * the apex — the owner can connect `www.example.co.uk` instead, which is
 * Vercel's own recommendation for any apex.
 */
export function isApexDomain(domain: string): boolean {
  return domain.split(".").length === 2;
}

export interface DnsRecordToPublish {
  type: "A" | "CNAME" | "TXT";
  /** The host the record is set on, in full: `www.example.com`, `_vercel.example.com`. */
  name: string;
  value: string;
  /** Why, in the owner's words: shown beside the row. */
  purpose: string;
}

export interface VercelDomainFacts {
  verified: boolean;
  verification: Array<{ type: string; domain: string; value: string }>;
  misconfigured: boolean;
  recommendedCNAME: Array<{ rank: number; value: string }>;
  recommendedIPv4: Array<{ rank: number; value: string[] }>;
}

/** Vercel's documented fallbacks, used only when it recommends nothing. */
export const FALLBACK_CNAME = "cname.vercel-dns.com";
export const FALLBACK_IPV4 = "76.76.21.21";

/**
 * The records to publish at the registrar, in the order to do them. Ownership
 * proof first when Vercel asks for it (the domain is in use by another
 * Vercel account), then the record that points the name at the site.
 */
export function dnsInstructions(domain: string, facts: VercelDomainFacts): DnsRecordToPublish[] {
  const records: DnsRecordToPublish[] = [];
  if (!facts.verified) {
    for (const challenge of facts.verification) {
      if (challenge.type.toUpperCase() !== "TXT") continue;
      records.push({
        type: "TXT",
        name: challenge.domain,
        value: challenge.value,
        purpose: "Proves to Vercel that you own the domain.",
      });
    }
  }
  const byRank = <T extends { rank: number }>(list: T[]) =>
    [...list].sort((a, b) => a.rank - b.rank)[0];
  if (isApexDomain(domain)) {
    const ip = byRank(facts.recommendedIPv4)?.value[0] ?? FALLBACK_IPV4;
    records.push({
      type: "A",
      name: domain,
      value: ip,
      purpose: "Points the domain at your site.",
    });
  } else {
    const cname = byRank(facts.recommendedCNAME)?.value ?? FALLBACK_CNAME;
    records.push({
      type: "CNAME",
      name: domain,
      value: cname,
      purpose: "Points the name at your site.",
    });
  }
  return records;
}

export type SiteDomainStatus = "pending" | "active" | "error";

/** The stored `records` blob, or nothing: a malformed row must not break the screen. */
export function readDomainRecords(raw: unknown): DnsRecordToPublish[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (r): r is DnsRecordToPublish =>
      typeof r === "object" &&
      r !== null &&
      ["A", "CNAME", "TXT"].includes((r as DnsRecordToPublish).type) &&
      typeof (r as DnsRecordToPublish).name === "string" &&
      typeof (r as DnsRecordToPublish).value === "string",
  );
}

/** Active only when Vercel has both proved the domain and seen it resolve. */
export function domainStatusFrom(facts: Pick<VercelDomainFacts, "verified" | "misconfigured">): SiteDomainStatus {
  return facts.verified && !facts.misconfigured ? "active" : "pending";
}

/** A line for the screen, from the last check. */
export function domainStatusLine(row: {
  status: SiteDomainStatus;
  vercelVerified: boolean;
  vercelConfiguredBy: string;
  lastError: string;
}): string {
  if (row.status === "active") return "Live. Visitors to this domain see your site.";
  if (row.status === "error") return row.lastError || "The last check failed. Try again.";
  if (!row.vercelVerified) return "Waiting for the TXT record that proves you own the domain.";
  return "Waiting for the record that points the domain at your site. DNS changes can take up to an hour.";
}
