import type { PreviousMxRecord } from "@/db/schema";

/**
 * Reading a domain's live MX records — the "before" picture that makes an MX
 * cutover reversible.
 *
 * Split from provisioning.ts and kept free of `server-only` so the pure parts
 * are unit-testable without a database or a network.
 */

/** Where a domain's mail currently goes, as a sentence an owner will recognize. */
export function describeMxProvider(records: PreviousMxRecord[]): string {
  if (records.length === 0) return "nowhere — this domain receives no mail today";
  const hosts = records.map((r) => r.host.toLowerCase());
  const matches = (needle: string) => hosts.some((h) => h.includes(needle));

  if (matches("google") || matches("googlemail")) return "Google Workspace";
  if (matches("outlook") || matches("microsoft") || matches("protection.outlook"))
    return "Microsoft 365";
  if (matches("migadu")) return "Migadu (already us)";
  if (matches("zoho")) return "Zoho";
  if (matches("protonmail") || matches("proton.me")) return "Proton";
  if (matches("secureserver") || matches("godaddy")) return "GoDaddy";
  if (matches("messagingengine") || matches("fastmail")) return "Fastmail";
  if (matches("mail.yahoodns")) return "Yahoo";
  return hosts[0];
}

/** True once the live MX actually points at the given host's mail servers. */
export function mxPointsAt(
  records: PreviousMxRecord[],
  hostNeedle: string,
): boolean {
  return records.some((r) => r.host.toLowerCase().includes(hostNeedle));
}

export function normalizeMxRecords(raw: unknown): PreviousMxRecord[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry): PreviousMxRecord[] => {
    if (typeof entry !== "object" || entry === null) return [];
    const r = entry as Record<string, unknown>;
    const host = typeof r.exchange === "string" ? r.exchange : r.host;
    if (typeof host !== "string" || host.length === 0) return [];
    const priority = typeof r.priority === "number" ? r.priority : 0;
    return [{ host: host.replace(/\.$/, ""), priority }];
  });
}

/**
 * Look up a domain's current MX.
 *
 * Called BEFORE anything is changed, because the moment the tenant publishes
 * the new records at their registrar the old answer is gone — and that is the
 * answer a rollback needs. Taking this snapshot at cutover time would already
 * be too late.
 *
 * A failed lookup returns an empty list rather than throwing, and callers must
 * treat "empty" as "we could not see it" rather than "there was nothing":
 * a domain with no MX and a domain we failed to resolve look identical here,
 * which is why the UI asks the owner to confirm what they see too.
 */
export async function resolveCurrentMx(
  domain: string,
): Promise<PreviousMxRecord[]> {
  try {
    const dns = await import("node:dns/promises");
    const records = await dns.resolveMx(domain);
    return normalizeMxRecords(records).sort((a, b) => a.priority - b.priority);
  } catch {
    return [];
  }
}
