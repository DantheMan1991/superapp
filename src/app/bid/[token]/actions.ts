"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseMoneyToCents } from "@/lib/money";
import { recordAttempt } from "@/lib/public-limits";
import { hashIp } from "@/lib/public-token";
import { recordBidReply } from "@/packs/jobs/bids-ops";
import { GENERIC_GONE, resolveBidInvitation } from "@/packs/jobs/bid-share";

/**
 * THE ONE WRITE A SUBCONTRACTOR MAY MAKE (X3, ADR 0098).
 *
 * No `requireTenant`, by design and exactly like the proposal's acceptance
 * and the document share's unlock: the defences are the 256-bit token, the
 * abuse cap, Zod at the boundary, and answers that give nothing away. **The
 * tenant is never taken from the request** — it comes from the token through
 * the single `withSystem` lookup in `resolveBidInvitation`, and the write
 * itself runs under `withTenant` at role staff where RLS governs it.
 *
 * **IT BUYS NOTHING.** Recording that a subcontractor said a number is a
 * fact about what they said, the shape a lien waiver (ADR 0066) and an
 * acceptance (ADR 0085) already have. Awarding it is the business's act, on
 * their own screen; buying the work is a commitment after that.
 *
 * **AND IT HAPPENS ONCE.** `recordBidReply` writes only where nothing has
 * been said yet, so a second post — a double submit, a back button, somebody
 * changing their mind — cannot quietly replace a number the builder has
 * already seen and may already have awarded. They ring up instead, which is
 * what they would do anyway.
 */

const replySchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    /** As they type it: "12,500", "$12500.00". */
    amount: z.string().trim().max(40).optional(),
    note: z.string().trim().max(2000).optional(),
    declined: z.union([z.literal("on"), z.literal("")]).optional(),
  })
  .refine((v) => v.declined === "on" || (v.amount ?? "").trim() !== "", {
    message: "Give a number, or say you are not bidding.",
    path: ["amount"],
  });

export async function replyToBidAction(
  token: string,
  _prev: { error?: string; done?: boolean } | null,
  form: FormData,
): Promise<{ error?: string; done?: boolean }> {
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  const ipHash = hashIp(ip);

  const parsed = replySchema.safeParse({
    name: form.get("name"),
    amount: form.get("amount") ?? undefined,
    note: form.get("note") ?? undefined,
    declined: form.get("declined") ?? undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  }

  /** Counted whether it lands or not, so a wrong token costs the same. */
  await recordAttempt("bid_reply", ipHash);

  const resolved = await resolveBidInvitation(token, ipHash);
  if (!resolved.ok || !resolved.invitation || !resolved.tenantId) {
    return { error: GENERIC_GONE };
  }
  if (!resolved.acceptsReply) {
    return { error: "This one has already been answered." };
  }

  const declined = parsed.data.declined === "on";
  let amountCents: number | null = null;
  if (!declined) {
    const cents = parseMoneyToCents(parsed.data.amount ?? "");
    if (cents === null || cents < 0) {
      return { error: "That does not read as an amount. Try 12500 or 12,500.00." };
    }
    amountCents = cents;
  }

  const wrote = await recordBidReply(resolved.tenantId, resolved.invitation.id, {
    name: parsed.data.name,
    amountCents,
    declined,
    note: parsed.data.note ?? "",
    ipHash,
  });
  if (!wrote) return { error: "This one has already been answered." };

  revalidatePath(`/bid/${token}`);
  return { done: true };
}
