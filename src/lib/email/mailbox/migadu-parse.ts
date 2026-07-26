import type { EmailDnsRecord } from "@/db/schema";
import type { HostDiagnostics, HostMailbox } from "./types";

/**
 * Pure parsing of the mail host's responses.
 *
 * Split out of migadu.ts and deliberately free of `server-only` — the same
 * reasoning that keeps mx.ts separate. These functions decide whether a
 * cutover is allowed to proceed and what a DNS wizard displays, which makes
 * them the highest-value things in this directory to test, and they should be
 * testable without a network, a database, or a server runtime.
 *
 * Every shape below was verified against a live Migadu response on 2026-07-26.
 * The fixtures in tests/mailbox.test.ts are copies of that response; if this
 * file and those fixtures ever disagree with reality, `npm run mailbox:probe`
 * prints the current truth.
 */

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function asBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

/**
 * Flatten the host's DNS payload into the one row shape the setup wizard
 * already renders.
 *
 * Migadu does NOT return a list. It returns an object keyed by purpose, where
 * some keys hold a single record and others hold an array:
 *
 *   { dns_verification: {...}, mx_records: [...], dkim: [...],
 *     spf: {...}, dmarc: {...}, domain_name: "..." }
 *
 * Verified against a live response on 2026-07-26; the earlier array-shaped
 * guess produced an empty wizard. Types come back lowercase ("txt", "cname")
 * and DKIM values carry a trailing dot, both normalized here.
 *
 * Emitted in publish order — prove ownership, route the mail, then
 * authenticate it — because that is the order someone should work down a DNS
 * panel in.
 */
const RECORD_GROUPS: { key: string; label: string }[] = [
  { key: "dns_verification", label: "Verification" },
  { key: "mx_records", label: "MX" },
  { key: "dkim", label: "DKIM" },
  { key: "spf", label: "SPF" },
  // Optional in Migadu's own words, and genuinely hazardous to publish blind:
  // a domain may already carry a DMARC record, and a second one at the same
  // name makes DMARC fail to evaluate rather than picking the stricter of the
  // two. Labelled so the wizard can present it as a choice.
  { key: "dmarc", label: "DMARC (optional)" },
];

export function normalizeRecords(payload: unknown): EmailDnsRecord[] {
  const root = asRecord(payload);
  if (!root) return [];

  const out: EmailDnsRecord[] = [];
  for (const { key, label } of RECORD_GROUPS) {
    const value = root[key];
    const entries = Array.isArray(value) ? value : [value];
    for (const raw of entries) {
      const r = asRecord(raw);
      if (!r) continue;
      const name = r.name ?? r.host ?? r.hostname;
      const recordValue = r.value ?? r.data ?? r.content ?? r.target;
      if (typeof name !== "string" || typeof recordValue !== "string") continue;
      const priority = r.priority ?? r.prio;
      out.push({
        record: label,
        type: String(r.type ?? r.record_type ?? "").toUpperCase(),
        name,
        // A trailing dot is valid in a zone file and rejected by most DNS
        // panels, which is a confusing failure to debug from the other side.
        value: recordValue.replace(/\.$/, ""),
        ttl: String(r.ttl ?? "Auto"),
        ...(typeof priority === "number" ? { priority } : {}),
        ...(typeof r.status === "string" ? { status: r.status } : {}),
      });
    }
  }
  return out;
}

/**
 * Read the host's diagnostics.
 *
 * The critical rule here: when the payload cannot be understood, report NOT
 * ok. An unparsed response means we do not know whether the domain is ready,
 * and the cost of the two possible mistakes is wildly asymmetric — a false
 * "not ready" costs someone another click, while a false "ready" invites them
 * to redirect a business's entire mail flow on the strength of a shape we
 * failed to parse.
 */
/**
 * What each diagnostic check is called when we tell a human it failed.
 * Migadu's own keys are terse; these are what an owner staring at a DNS panel
 * needs to read.
 */
const CHECK_LABELS: Record<string, string> = {
  verify: "Domain ownership (verification TXT)",
  nameservers: "Nameservers",
  spf: "SPF record",
  mx: "MX records — where your mail is delivered",
  dkim: "DKIM keys",
};

/**
 * Read the host's diagnostics.
 *
 * Live shape, verified 2026-07-26:
 *
 *   { "status": "ok",
 *     "checks": { "verify": "ok", "nameservers": "ok",
 *                 "spf": "ok", "mx": "ok", "dkim": "ok" } }
 *
 * The earlier guess read `root.mx` rather than `root.checks.mx`, so mxOk was
 * permanently false and the cutover could never unlock — which is exactly the
 * safe direction for a wrong guess to fail in, and why the rule below exists.
 *
 * The critical rule: when the payload cannot be understood, report NOT ok. An
 * unparsed response means we do not know whether the domain is ready, and the
 * cost of the two possible mistakes is wildly asymmetric — a false "not ready"
 * costs someone another click, while a false "ready" invites them to redirect
 * a business's entire mail flow on the strength of a shape we failed to parse.
 */
export function normalizeDiagnostics(payload: unknown): HostDiagnostics {
  const root = asRecord(payload);
  if (!root) {
    return {
      ok: false,
      mxOk: false,
      findings: ["The mail host's reply couldn't be read. Check again shortly."],
      details: payload,
    };
  }

  const isOk = (value: unknown): boolean =>
    value === "ok" || value === true || value === "true";

  const checks = asRecord(root.checks);
  const findings: string[] = [];
  let anyCheckFailed = false;

  if (checks) {
    for (const [key, value] of Object.entries(checks)) {
      if (isOk(value)) continue;
      anyCheckFailed = true;
      const label = CHECK_LABELS[key] ?? key;
      findings.push(
        typeof value === "string" && value.length > 0
          ? `${label}: ${value}`
          : `${label}: not passing yet`,
      );
    }
  }

  // Free-text complaints, if this host ever grows any. Kept because a host
  // that starts returning messages should surface them without a code change.
  for (const key of ["messages", "errors", "warnings", "findings"]) {
    const value = root[key];
    if (typeof value === "string") findings.push(value);
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry === "string") findings.push(entry);
        else {
          const e = asRecord(entry);
          const msg = e?.message ?? e?.error ?? e?.text;
          if (typeof msg === "string") findings.push(msg);
        }
      }
    }
  }

  // MX is the field that gates the cutover, and it is the one we refuse to
  // guess at: only an explicit affirmative from the host counts. A missing
  // `checks` object means no.
  const mxOk = checks !== null && isOk(checks.mx);

  // Ready requires BOTH the host's overall verdict and no individual check
  // failing. Promoting to dns_ready on a green top-line while DKIM is broken
  // would offer a cutover that lands the tenant's mail in spam.
  const ok = isOk(root.status ?? root.ok ?? root.valid) && !anyCheckFailed;

  return { ok, mxOk, findings: findings.slice(0, 20), details: payload };
}

export function normalizeMailbox(raw: unknown, domain: string): HostMailbox | null {
  const r = asRecord(raw);
  if (!r) return null;
  const localPart = r.local_part;
  if (typeof localPart !== "string" || localPart.length === 0) return null;
  return {
    localPart,
    address:
      typeof r.address === "string" ? r.address : `${localPart}@${domain}`,
    displayName: typeof r.name === "string" ? r.name : "",
    maySend: asBool(r.may_send, true),
    mayReceive: asBool(r.may_receive, true),
    mayAccessImap: asBool(r.may_access_imap, true),
  };
}
