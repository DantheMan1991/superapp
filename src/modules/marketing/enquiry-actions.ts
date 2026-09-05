"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@/db";
import { logAuditInTx } from "@/lib/audit";
import { fail, gate, type ActionResult } from "./gate";
import { deleteEnquiry } from "./enquiry-ops";

/**
 * The one action on an enquiry: an owner removing it. Receiving one is the
 * public path's job (`src/components/site/enquiry-action.ts`), and reading
 * them is the Website screen's.
 */
const BASE = "/dashboard/m/marketing/website";

const idInput = z.object({ id: z.string().uuid() });

export async function deleteEnquiryAction(input: unknown): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = idInput.safeParse(input);
    if (!parsed.success) return { error: "Pick a message and try again." };
    await withTenant(
      ctx.tenantId,
      async (tx) => {
        const row = await deleteEnquiry(tx, ctx, parsed.data.id);
        await logAuditInTx(tx, {
          action: "marketing.site.enquiry_deleted",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "site_enquiry",
          targetId: row.id,
          // Identifiers only: the name, email and message stay out of the log.
          meta: { siteId: row.siteId, partyId: row.partyId, workItemId: row.workItemId },
        });
      },
      { role: ctx.role },
    );
    revalidatePath(BASE);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
