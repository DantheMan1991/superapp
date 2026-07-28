/**
 * Is this address safe for our server to connect to?
 *
 * The problem being solved: a mail message can reference any URL, and the image
 * proxy fetches it FROM OUR SERVER. Without this, an anonymous sender gets to
 * aim our infrastructure at anything our network can reach — cloud metadata at
 * 169.254.169.254, the Neon endpoint, the Stalwart admin API on localhost, an
 * internal service that trusts its own network.
 *
 * Pure and free of `server-only`, so every range boundary is testable without a
 * network — which matters more here than almost anywhere, because the failure
 * mode is silent and the ranges are easy to get subtly wrong.
 *
 * THE ONES PEOPLE MISS, and why each is here: IPv4-mapped IPv6
 * (`::ffff:127.0.0.1`), NAT64 (`64:ff9b::7f00:1`) and 6to4 (`2002:7f00:1::`)
 * all smuggle an IPv4 address inside an IPv6 one, so a checker that handles the
 * two families separately waves them through. And `http://2130706433/`,
 * `http://0x7f000001/` and `http://127.1/` are all spellings of 127.0.0.1 that
 * a naive string check does not recognise.
 */

/** Only these. A denylist of dangerous schemes is a list you will not finish. */
const ALLOWED_SCHEMES = new Set(["http:", "https:"]);
/** Only these. Everything else is a service, not a web server. */
const ALLOWED_PORTS = new Set([80, 443]);

function ipv4ToInt(a: number, b: number, c: number, d: number): number {
  return ((a << 24) >>> 0) + (b << 16) + (c << 8) + d;
}

/** CIDR blocks that must never be connected to. */
const BLOCKED_V4: ReadonlyArray<[string, number]> = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local — includes 169.254.169.254 cloud metadata
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.88.99.0", 24], // 6to4 relay anycast
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, includes 255.255.255.255
];

function parseStrictIpv4(value: string): number | null {
  // Exactly four dot-separated DECIMAL octets, no leading zeros beyond "0".
  // This is what rejects 2130706433, 0x7f000001, 017700000001 and 127.1 — all
  // of which the OS resolver would happily accept as 127.0.0.1.
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const nums: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    if (part.length > 1 && part.startsWith("0")) return null;
    const n = Number(part);
    if (n > 255) return null;
    nums.push(n);
  }
  return ipv4ToInt(nums[0], nums[1], nums[2], nums[3]);
}

function inV4Block(addr: number, base: string, bits: number): boolean {
  const baseInt = parseStrictIpv4(base);
  if (baseInt === null) return false;
  if (bits === 0) return true;
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return (addr & mask) >>> 0 === (baseInt & mask) >>> 0;
}

/** Expand an IPv6 literal to eight 16-bit groups. Null when unparseable. */
function parseIpv6(value: string): number[] | null {
  let text = value.trim();
  if (text.startsWith("[") && text.endsWith("]")) text = text.slice(1, -1);
  // Drop a zone id (fe80::1%eth0) — it changes nothing about the address.
  const percent = text.indexOf("%");
  if (percent >= 0) text = text.slice(0, percent);
  if (!text.includes(":")) return null;

  // A trailing dotted-quad (::ffff:127.0.0.1) becomes two groups.
  let tail: number[] = [];
  const lastColon = text.lastIndexOf(":");
  const suffix = text.slice(lastColon + 1);
  if (suffix.includes(".")) {
    const v4 = parseStrictIpv4(suffix);
    if (v4 === null) return null;
    tail = [(v4 >>> 16) & 0xffff, v4 & 0xffff];
    text = text.slice(0, lastColon + 1);
    // Keep a "::" intact — it is the compression marker the split below needs.
    // Only a lone trailing ":" is separator punctuation to discard. Getting
    // this backwards turned "64:ff9b::" into "64:ff9b:", which parses as
    // nothing and quietly made every NAT64 address look unsafe.
    if (!text.endsWith("::")) text = text.slice(0, -1);
  }

  const halves = text.split("::");
  if (halves.length > 2) return null;
  const toGroups = (part: string): number[] | null => {
    if (part === "") return [];
    const out: number[] = [];
    for (const piece of part.split(":")) {
      if (!/^[0-9a-f]{1,4}$/i.test(piece)) return null;
      out.push(parseInt(piece, 16));
    }
    return out;
  };

  const head = toGroups(halves[0]);
  if (head === null) return null;
  if (halves.length === 1) {
    const all = [...head, ...tail];
    return all.length === 8 ? all : null;
  }
  const rest = toGroups(halves[1]);
  if (rest === null) return null;
  const known = head.length + rest.length + tail.length;
  if (known > 8) return null;
  return [...head, ...Array(8 - known).fill(0), ...rest, ...tail];
}

/**
 * Pull the IPv4 address out of an IPv6 one that carries it.
 *
 * IPv4-mapped `::ffff:a.b.c.d`, NAT64 `64:ff9b::a.b.c.d` and 6to4
 * `2002:aabb:ccdd::` all reach an IPv4 destination while looking like IPv6.
 * Each is decoded and re-checked as IPv4 rather than trusted.
 */
function embeddedIpv4(groups: number[]): number | null {
  const isZero = (from: number, to: number) =>
    groups.slice(from, to).every((g) => g === 0);

  if (isZero(0, 5) && groups[5] === 0xffff) {
    return ((groups[6] << 16) >>> 0) + groups[7];
  }
  if (groups[0] === 0x0064 && groups[1] === 0xff9b && isZero(2, 6)) {
    return ((groups[6] << 16) >>> 0) + groups[7];
  }
  if (groups[0] === 0x2002) {
    return ((groups[1] << 16) >>> 0) + groups[2];
  }
  return null;
}

/** True when this address is a public destination we may connect to. */
export function isPublicAddress(ip: string): boolean {
  const v4 = parseStrictIpv4(ip);
  if (v4 !== null) {
    return !BLOCKED_V4.some(([base, bits]) => inV4Block(v4, base, bits));
  }

  const groups = parseIpv6(ip);
  if (groups === null) return false;

  const embedded = embeddedIpv4(groups);
  if (embedded !== null) {
    return !BLOCKED_V4.some(([base, bits]) => inV4Block(embedded, base, bits));
  }

  const [g0] = groups;
  if (groups.every((g) => g === 0)) return false; // ::
  if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return false; // ::1
  if ((g0 & 0xfe00) === 0xfc00) return false; // fc00::/7 unique-local
  if ((g0 & 0xffc0) === 0xfe80) return false; // fe80::/10 link-local
  if ((g0 & 0xff00) === 0xff00) return false; // ff00::/8 multicast
  if (g0 === 0x2001 && groups[1] === 0x0db8) return false; // documentation
  return true;
}

export type UrlRejection =
  | "scheme"
  | "credentials"
  | "port"
  | "host"
  | "private"
  | "length";

export interface UrlCheck {
  ok: boolean;
  reason?: UrlRejection;
  url?: URL;
}

/** Pathological tracker URLs otherwise blow out the request line. */
const MAX_URL_LENGTH = 2048;

/**
 * Validate a URL before it is fetched — and again for every redirect hop,
 * because a public first response can point anywhere.
 *
 * This does NOT resolve DNS. A hostname that passes here still has to survive
 * the resolve-then-connect check in fetch-image.ts, which is what closes the
 * rebinding window.
 */
export function validateHopUrl(raw: string): UrlCheck {
  if (raw.length > MAX_URL_LENGTH) return { ok: false, reason: "length" };

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "host" };
  }

  if (!ALLOWED_SCHEMES.has(url.protocol)) return { ok: false, reason: "scheme" };
  // http://user:pass@internal/ — credentials in a URL are for reaching things
  // that expect them, which is never a public image.
  if (url.username || url.password) return { ok: false, reason: "credentials" };

  const port = url.port
    ? Number(url.port)
    : url.protocol === "https:"
      ? 443
      : 80;
  if (!ALLOWED_PORTS.has(port)) return { ok: false, reason: "port" };

  const host = url.hostname;
  if (host.length === 0) return { ok: false, reason: "host" };

  // An IP literal is checked immediately; there is no name to resolve.
  const literal = host.startsWith("[") ? host.slice(1, -1) : host;
  const looksNumeric = /^[\d.]+$/.test(literal) || literal.includes(":");
  if (looksNumeric) {
    if (!isPublicAddress(literal)) return { ok: false, reason: "private" };
    return { ok: true, url };
  }

  // A hostname must at least look like one. This rejects `2130706433` and
  // `0x7f000001`, which are integer spellings of an IP that the resolver would
  // accept but `parseStrictIpv4` deliberately does not.
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.?$/i.test(host)) {
    return { ok: false, reason: "host" };
  }
  if (/^\d+$/.test(host.replace(/\./g, ""))) return { ok: false, reason: "host" };

  return { ok: true, url };
}
