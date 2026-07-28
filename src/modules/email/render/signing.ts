import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed URLs for message bodies, attachments and inline images.
 *
 * WHAT THE SIGNATURE IS FOR, since it is easy to mistake for a bearer token: it
 * proves *we* minted this URL for this person, so the route can reject a
 * fabricated one before touching the database or the mail server. It is NOT the
 * access control — the session is. Both are checked, and a leaked URL is
 * useless to anyone else because the route also compares the signed tenant and
 * user against the live session.
 *
 * That ordering is deliberate: verifying a signature is pure CPU, so an
 * unauthenticated flood costs no Neon query and no JMAP round trip.
 *
 * Keyed by labelled derivation from `APP_ENCRYPTION_KEY`, the same shape
 * public-token.ts uses for share links ("one root secret with LABELLED
 * derivation… three separate env vars would be three things to set, three to
 * rotate and three to forget"). Mail already hard-depends on that key for token
 * storage, so this adds no new deployment requirement.
 *
 * Consequence worth knowing: rotating APP_ENCRYPTION_KEY invalidates
 * outstanding attachment URLs as well as Plaid and mailbox tokens. Bounded by
 * the TTL below, so it self-heals within a day.
 */

const TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Field separator for signed payloads. NUL, because it cannot occur in a
 * uuid, a Clerk id, a mime type or a filename — joining with a character that
 * CAN appear lets two different claims serialize identically, which is a real
 * class of signature forgery. Built with fromCharCode so no control character
 * is embedded in the source.
 */
const SEP = String.fromCharCode(0);

function rootKey(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("APP_ENCRYPTION_KEY is not set. See SETUP.md.");
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("APP_ENCRYPTION_KEY must be 32 bytes of base64.");
  }
  return key;
}

/** Separate keys per purpose, so a blob signature can never open an image URL. */
function purposeKey(purpose: "mail_blob" | "mail_image"): Buffer {
  return createHmac("sha256", rootKey())
    .update(`yosher:v1:${purpose}`)
    .digest();
}

export interface BlobClaim {
  tenantId: string;
  clerkUserId: string;
  mailAccountId: string;
  blobId: string;
  /** The policy's decision, signed so a caller cannot ask for a nicer one. */
  servedType: string;
  fileName: string;
  disposition: "inline" | "attachment";
  expiresAt: number;
}

/**
 * Every field is in the signed payload, separated by a character that cannot
 * appear in any of them. Joining with a separator that CAN appear lets
 * `a|bc` and `ab|c` produce the same string — a real class of signature bug.
 */
function blobPayload(claim: BlobClaim): string {
  return [
    claim.tenantId,
    claim.clerkUserId,
    claim.mailAccountId,
    claim.blobId,
    claim.servedType,
    claim.fileName,
    claim.disposition,
    String(claim.expiresAt),
  ].join(SEP);
}

export function signBlobClaim(claim: BlobClaim): string {
  return createHmac("sha256", purposeKey("mail_blob"))
    .update(blobPayload(claim))
    .digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  // timingSafeEqual throws on a length mismatch, which would itself be a
  // (crude) oracle — compare lengths first and return the same false.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function verifyBlobClaim(
  claim: BlobClaim,
  signature: string,
  now = Date.now(),
): boolean {
  if (claim.expiresAt <= now) return false;
  return safeEqual(signBlobClaim(claim), signature);
}

export function blobExpiry(now = Date.now()): number {
  return now + TTL_MS;
}

/**
 * Remote image URLs are signed separately, and the signed payload includes the
 * SOURCE URL — so the proxy fetches only addresses the sanitizer already
 * approved for this reader, never one supplied by whoever holds the link.
 */
export interface ImageClaim {
  tenantId: string;
  clerkUserId: string;
  url: string;
  expiresAt: number;
}

function imagePayload(claim: ImageClaim): string {
  return [claim.tenantId, claim.clerkUserId, claim.url, String(claim.expiresAt)].join(SEP);
}

export function signImageClaim(claim: ImageClaim): string {
  return createHmac("sha256", purposeKey("mail_image"))
    .update(imagePayload(claim))
    .digest("base64url");
}

export function verifyImageClaim(
  claim: ImageClaim,
  signature: string,
  now = Date.now(),
): boolean {
  if (claim.expiresAt <= now) return false;
  return safeEqual(signImageClaim(claim), signature);
}
