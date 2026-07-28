import "server-only";
import http from "node:http";
import https from "node:https";
import { lookup as dnsLookup } from "node:dns";
import { isPublicAddress, validateHopUrl } from "./ssrf";

/**
 * Fetch a remote image on the server's behalf, safely.
 *
 * `validateHopUrl` checks the shape of a URL. This closes the gap it cannot:
 * **DNS rebinding**. A hostname that resolves to a public address when checked
 * can resolve to 127.0.0.1 a moment later when connected — so validation and
 * connection have to be the same act, not two.
 *
 * That is why this uses `node:http` with a custom `lookup` rather than `fetch`.
 * The validation happens INSIDE the resolver callback and returns the address
 * it approved, so the socket connects to exactly what was checked. `fetch` gives
 * no hook at that point, which makes it unusable for this job however convenient
 * it is everywhere else.
 */

export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const IMAGE_TIMEOUT_MS = 8_000;
export const IMAGE_MAX_REDIRECTS = 3;

/**
 * Sniffed from the bytes, never trusted from the header. A server claiming
 * `image/png` while sending HTML is exactly the case this exists for.
 *
 * SVG is deliberately absent: it is a scriptable document, and the same refusal
 * applies here as in the attachment policy.
 */
const MAGIC: ReadonlyArray<[string, number[]]> = [
  ["image/jpeg", [0xff, 0xd8, 0xff]],
  ["image/png", [0x89, 0x50, 0x4e, 0x47]],
  ["image/gif", [0x47, 0x49, 0x46, 0x38]],
  ["image/bmp", [0x42, 0x4d]],
];

function sniff(head: Buffer): string | null {
  for (const [type, magic] of MAGIC) {
    if (magic.every((byte, i) => head[i] === byte)) return type;
  }
  // RIFF....WEBP
  if (
    head.length >= 12 &&
    head.toString("latin1", 0, 4) === "RIFF" &&
    head.toString("latin1", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

export type ImageFetchResult =
  | { ok: true; body: Buffer; contentType: string }
  | { ok: false; reason: string };

/**
 * A resolver that refuses to hand back a private address.
 *
 * Returning an error here aborts the connection before a packet is sent, and
 * because the agent connects to the address this callback returned, there is no
 * window in which the name could resolve to something else.
 */
function guardedLookup(
  hostname: string,
  options: Parameters<typeof dnsLookup>[1],
  callback: (
    err: NodeJS.ErrnoException | null,
    address: string,
    family: number,
  ) => void,
): void {
  dnsLookup(hostname, options as never, (err, address, family) => {
    if (err) return callback(err, "", 0);
    const addresses = Array.isArray(address)
      ? (address as unknown as Array<{ address: string; family: number }>)
      : [{ address: address as string, family: family as number }];
    for (const entry of addresses) {
      if (!isPublicAddress(entry.address)) {
        return callback(
          Object.assign(new Error("blocked private address"), {
            code: "EBLOCKED",
          }),
          "",
          0,
        );
      }
    }
    const first = addresses[0];
    callback(null, first.address, first.family);
  });
}

function requestOnce(target: URL): Promise<{
  status: number;
  location: string | null;
  contentType: string | null;
  contentLength: number | null;
  body: Buffer;
}> {
  return new Promise((resolve, reject) => {
    const transport = target.protocol === "https:" ? https : http;
    const request = transport.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (target.protocol === "https:" ? 443 : 80),
        path: `${target.pathname}${target.search}`,
        method: "GET",
        lookup: guardedLookup as never,
        // Never follow a redirect automatically — each hop is re-validated.
        headers: {
          Accept: "image/*",
          // Deliberately NOT the reader's user agent, and no cookies, no
          // Referer, no Accept-Language. The sender learns nothing about who
          // opened the message beyond that somebody did.
          "User-Agent": "Mozilla/5.0 (compatible; YosherMailImageProxy/1.0)",
          "Accept-Encoding": "identity",
        },
        timeout: IMAGE_TIMEOUT_MS,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let total = 0;
        response.on("data", (chunk: Buffer) => {
          total += chunk.length;
          if (total > IMAGE_MAX_BYTES) {
            // Stop reading rather than buffering something enormous.
            response.destroy();
            reject(new Error("too large"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            location: response.headers.location ?? null,
            contentType: response.headers["content-type"] ?? null,
            contentLength: response.headers["content-length"]
              ? Number(response.headers["content-length"])
              : null,
            body: Buffer.concat(chunks),
          }),
        );
        response.on("error", reject);
      },
    );
    request.on("timeout", () => {
      request.destroy(new Error("timeout"));
    });
    request.on("error", reject);
    request.end();
  });
}

export async function fetchRemoteImage(raw: string): Promise<ImageFetchResult> {
  let current = raw;

  for (let hop = 0; hop <= IMAGE_MAX_REDIRECTS; hop += 1) {
    const check = validateHopUrl(current);
    if (!check.ok || !check.url) {
      return { ok: false, reason: check.reason ?? "invalid" };
    }

    let response: Awaited<ReturnType<typeof requestOnce>>;
    try {
      response = await requestOnce(check.url);
    } catch (err) {
      return {
        ok: false,
        reason: err instanceof Error ? err.message : "request failed",
      };
    }

    if (response.status >= 300 && response.status < 400 && response.location) {
      // Resolved against the CURRENT url so a relative Location works, then
      // put through the full check again on the next iteration.
      current = new URL(response.location, check.url).toString();
      continue;
    }

    if (response.status !== 200) return { ok: false, reason: `status ${response.status}` };
    if (response.body.length === 0) return { ok: false, reason: "empty" };
    if (response.contentLength !== null && response.contentLength > IMAGE_MAX_BYTES) {
      return { ok: false, reason: "too large" };
    }

    // The SNIFFED type is what gets served. A response claiming image/png while
    // sending HTML is served as nothing at all.
    const sniffed = sniff(response.body);
    if (!sniffed) return { ok: false, reason: "not an image" };

    return { ok: true, body: response.body, contentType: sniffed };
  }

  return { ok: false, reason: "too many redirects" };
}
