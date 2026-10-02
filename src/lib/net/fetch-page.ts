import "server-only";
import http from "node:http";
import https from "node:https";
import zlib from "node:zlib";
import { guardedLookup } from "./guarded-lookup";
import { validateHopUrl } from "./ssrf";

/**
 * FETCH A WEB PAGE ON A PERSON'S SAY-SO, SAFELY (Food D1, ADR 0123): the
 * recipe reader's twin of `fetch-image.ts`, built the same way and for the
 * same reason. `node:http` with the guarded resolver, so the address that was
 * checked is the address connected to; every redirect hop checked again; and
 * nothing on our own network reachable by pasting its address into a box.
 *
 * It says who it is (`YosherRecipeReader`), sends no cookies, and stops at a
 * size, a time and a number of redirects. A page that answers with a bot
 * check comes back as what it is, its status and its body, so the caller can
 * tell the person. Nothing here tries to pass for a browser to get past one.
 */

export const PAGE_MAX_BYTES = 3 * 1024 * 1024;
export const PAGE_TIMEOUT_MS = 10_000;
export const PAGE_MAX_REDIRECTS = 5;
/** All the hops together. */
const PAGE_DEADLINE_MS = 20_000;
const USER_AGENT = "Mozilla/5.0 (compatible; YosherRecipeReader/1.0; +https://yosherapp.com)";

export type PageFetchFailure = "invalid" | "unreachable" | "too large" | "not a page" | "status" | "too many redirects";

export type PageFetchResult =
  | { ok: true; url: string; html: string }
  | { ok: false; reason: PageFetchFailure; status?: number; html?: string };

class TooLarge extends Error {}

interface RawPage {
  status: number;
  location: string | null;
  contentType: string | null;
  body: Buffer;
}

function requestOnce(target: URL): Promise<RawPage> {
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
        // Never follow a redirect automatically: each hop is re-validated.
        headers: {
          Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
          "Accept-Encoding": "gzip, br",
          "Accept-Language": "en-US,en;q=0.8",
          "User-Agent": USER_AGENT,
        },
        timeout: PAGE_TIMEOUT_MS,
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const location = response.headers.location ?? null;
        const contentType = response.headers["content-type"] ?? null;
        if (status >= 300 && status < 400) {
          response.resume();
          resolve({ status, location, contentType, body: Buffer.alloc(0) });
          return;
        }
        const encoding = String(response.headers["content-encoding"] ?? "").trim().toLowerCase();
        const stream =
          encoding === "gzip" || encoding === "x-gzip"
            ? response.pipe(zlib.createGunzip())
            : encoding === "br"
              ? response.pipe(zlib.createBrotliDecompress())
              : encoding === "deflate"
                ? response.pipe(zlib.createInflate())
                : response;
        const chunks: Buffer[] = [];
        let total = 0;
        let settled = false;
        const fail = (err: Error) => {
          if (settled) return;
          settled = true;
          response.destroy();
          reject(err);
        };
        // Counted AFTER decompression: a small compressed page can unpack to
        // anything, and this is what stops it.
        stream.on("data", (chunk: Buffer) => {
          total += chunk.length;
          if (total > PAGE_MAX_BYTES) {
            fail(new TooLarge("too large"));
            return;
          }
          chunks.push(chunk);
        });
        stream.on("end", () => {
          if (settled) return;
          settled = true;
          resolve({ status, location, contentType, body: Buffer.concat(chunks) });
        });
        stream.on("error", fail);
        response.on("error", fail);
      },
    );
    request.on("timeout", () => request.destroy(new Error("timeout")));
    request.on("error", reject);
    request.end();
  });
}

/** The body as text, in the charset the header or the page's own meta tag names; UTF-8 otherwise. */
function decode(body: Buffer, contentType: string | null): string {
  let label = /charset\s*=\s*["']?([\w-]+)/i.exec(contentType ?? "")?.[1];
  if (!label) label = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(body.subarray(0, 4096).toString("latin1"))?.[1];
  try {
    return new TextDecoder(label ?? "utf-8").decode(body);
  } catch {
    return new TextDecoder("utf-8").decode(body);
  }
}

function isPage(contentType: string | null, html: string): boolean {
  if (contentType) return /html|xml|text\/plain/i.test(contentType);
  return /^\s*</.test(html);
}

export async function fetchPage(raw: string): Promise<PageFetchResult> {
  let current = raw;
  const deadline = Date.now() + PAGE_DEADLINE_MS;
  for (let hop = 0; hop <= PAGE_MAX_REDIRECTS; hop += 1) {
    const check = validateHopUrl(current);
    if (!check.ok || !check.url) return { ok: false, reason: "invalid" };
    if (Date.now() > deadline) return { ok: false, reason: "unreachable" };

    let response: RawPage;
    try {
      response = await requestOnce(check.url);
    } catch (err) {
      return { ok: false, reason: err instanceof TooLarge ? "too large" : "unreachable" };
    }

    if (response.status >= 300 && response.status < 400 && response.location) {
      // Resolved against the CURRENT url so a relative Location works, then
      // put through the full check again on the next iteration.
      current = new URL(response.location, check.url).toString();
      continue;
    }
    const html = decode(response.body, response.contentType);
    if (response.status !== 200) return { ok: false, reason: "status", status: response.status, html };
    if (!isPage(response.contentType, html)) return { ok: false, reason: "not a page" };
    return { ok: true, url: check.url.toString(), html };
  }
  return { ok: false, reason: "too many redirects" };
}
