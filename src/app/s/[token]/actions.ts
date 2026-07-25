"use server";

import { cookies, headers } from "next/headers";
import { z } from "zod";
import {
  decoyPasscodeWork,
  hashIp,
  signSession,
  verifyPasscode,
} from "@/lib/public-token";
import {
  countFailedUnlock,
  GENERIC_GONE,
  resolveShare,
} from "@/modules/documents/shares/resolve";
import { recordShareEvent } from "@/modules/documents/shares/events";
import { recordAttempt } from "@/modules/documents/shares/limits";

/**
 * The one PUBLIC mutation in this feature. No requireX by design, exactly like
 * the health-check actions: the defences are the 256-bit token, the abuse
 * caps, Zod, and responses that give nothing away.
 *
 * A wrong passcode and a token that never existed return the same string, and
 * both do the same amount of scrypt work, so neither the message nor the
 * timing distinguishes them.
 */

const WRONG = "That passcode didn't work.";

const unlockSchema = z.object({
  token: z.string().min(1).max(100),
  passcode: z.string().min(1).max(64),
});

async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
}

export async function unlockShareAction(input: {
  token: string;
  passcode: string;
}): Promise<{ ok: true } | { error: string }> {
  const parsed = unlockSchema.safeParse(input);
  if (!parsed.success) return { error: WRONG };

  const ipHash = hashIp(await clientIp());

  const capped = await recordAttempt("share_unlock_fail", ipHash);
  if (capped.overCap) {
    decoyPasscodeWork();
    return { error: WRONG };
  }

  const resolved = await resolveShare(parsed.data.token, ipHash);
  if (!resolved.ok) {
    decoyPasscodeWork();
    return { error: GENERIC_GONE };
  }
  const { share } = resolved;

  if (!share.passcodeHash) {
    // Nothing to unlock; the page renders the contents directly.
    return { ok: true };
  }

  if (!verifyPasscode(parsed.data.passcode, share.passcodeHash)) {
    await countFailedUnlock(share.tenantId, share.id);
    await recordShareEvent({
      tenantId: share.tenantId,
      shareId: share.id,
      kind: "denied_passcode",
      ipHash,
    });
    return { error: WRONG };
  }

  // Scoped to this link's own path so it is never sent anywhere else, and it
  // carries the share id rather than the token — a cookie that held the
  // credential would just be a second copy of it to leak.
  const ttlMs = Math.min(
    60 * 60 * 1000,
    share.expiresAt.getTime() - Date.now(),
  );
  const jar = await cookies();
  jar.set(`share_${share.id}`, signSession({
    shareId: share.id,
    exp: Date.now() + ttlMs,
  }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: `/s/${parsed.data.token}`,
    maxAge: Math.floor(ttlMs / 1000),
  });

  await recordShareEvent({
    tenantId: share.tenantId,
    shareId: share.id,
    kind: "unlocked",
    ipHash,
  });
  return { ok: true };
}
