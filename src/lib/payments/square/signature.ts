import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Square webhook signatures. **Pure**, so the one thing standing between the
 * internet and a write to `payment_accounts` has a test with a known vector.
 *
 * Square puts `x-square-hmacsha256-signature` on every notification: the
 * base64 HMAC-SHA256, keyed with the subscription's signature key, of the
 * NOTIFICATION URL followed by the RAW BODY. The URL is part of the input on
 * purpose — a notification replayed at a different endpoint fails — which is
 * also why `squareWebhookUrl()` has to match the Developer Console exactly.
 */
export function squareSignature(
  signatureKey: string,
  notificationUrl: string,
  body: string,
): string {
  return createHmac("sha256", signatureKey)
    .update(notificationUrl + body)
    .digest("base64");
}

export function verifySquareSignature(input: {
  body: string;
  signatureHeader: string | null | undefined;
  signatureKey: string;
  notificationUrl: string;
}): boolean {
  if (!input.signatureHeader) return false;
  const expected = Buffer.from(
    squareSignature(input.signatureKey, input.notificationUrl, input.body),
  );
  const given = Buffer.from(input.signatureHeader);
  // timingSafeEqual throws on unequal lengths; unequal lengths are simply wrong.
  if (expected.length !== given.length) return false;
  return timingSafeEqual(expected, given);
}
