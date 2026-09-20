"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { schema, withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { logAuditInTx } from "@/lib/audit";
import { packContext } from "@/lib/packs/tenant-context";
import { interviewGateFrom } from "./interview-gate";
import {
  awardInvitation,
  createBidPackage,
  inviteToBid,
  revealInvitationToken,
  revokeInvitation,
  updateBidPackage,
} from "./bids-ops";
import { JobsError, type JobsCtx } from "./ops";
import { PACK } from "./vocabulary";

/**
 * ASKING FOR A NUMBER, from the builder's side (X3, ADR 0098).
 *
 * **BEHIND THE SAME GATE AS THE WALK**, and checked at every door. Bid
 * requests are independently useful and will probably be un-gated once the
 * pilot has earned it, but shipping them ungated would put a new public
 * surface in front of every tenant on the strength of one business's
 * feedback. One constant to change when it is time.
 */

const BASE = "/dashboard/m/jobs";

interface BidCtx extends JobsCtx {
  industry: string;
}

async function gate(): Promise<BidCtx> {
  const tenant = await requireTenant();
  await requireModuleEnabled(tenant.tenant.id, PACK);
  const ctx: BidCtx = {
    tenantId: tenant.tenant.id,
    userId: tenant.userId,
    role: tenant.role,
    industry: tenant.tenant.industry ?? "",
  };
  const available = await withTenant(
    ctx.tenantId,
    async (tx) => {
      const pack = await packContext(tx, ctx.tenantId, ctx.industry, PACK);
      return interviewGateFrom(pack.config).available;
    },
    { role: ctx.role },
  );
  if (!available) throw new JobsError("NOT_FOUND", "bid requests are not switched on");
  return ctx;
}

function sentence(message: string): string {
  const m = message.trim();
  return m.charAt(0).toUpperCase() + m.slice(1) + (m.endsWith(".") ? "" : ".");
}

function toResult(err: unknown): { error: string } {
  if (err instanceof JobsError) {
    switch (err.code) {
      case "FORBIDDEN":
        return { error: "You cannot change this job." };
      case "NOT_FOUND":
        return { error: "That is no longer here. Reload the page." };
      case "ALREADY_ASKED":
        return { error: "They have already been asked for this one." };
      case "INVALID_VALUE":
      case "INVALID_STATUS":
        return { error: sentence(err.message) };
      default:
        return { error: "That did not work. Try again." };
    }
  }
  return { error: "That did not work. Try again." };
}

const createSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  costCode: z.string().trim().max(60).optional(),
  scope: z.string().trim().max(8000).optional(),
  dueOn: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function createBidPackageAction(input: unknown) {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  try {
    const ctx = await gate();
    const pkg = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const made = await createBidPackage(tx, ctx, {
          projectId: parsed.data.projectId,
          title: parsed.data.title,
          costCode: parsed.data.costCode,
          scope: parsed.data.scope,
          dueOn: parsed.data.dueOn ?? null,
        });
        await logAuditInTx(tx, {
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          action: "jobs.bid_package.created",
          targetType: "job_bid_package",
          targetId: made.id,
        });
        return made;
      },
      { role: ctx.role },
    );
    revalidatePath(`${BASE}/${parsed.data.projectId}/bids`);
    return { ok: true as const, packageId: pkg.id };
  } catch (err) {
    return toResult(err);
  }
}

const inviteSchema = z.object({
  projectId: z.string().uuid(),
  packageId: z.string().uuid(),
  partyId: z.string().uuid(),
});

export async function inviteToBidAction(input: unknown) {
  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  try {
    const ctx = await gate();
    const made = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const out = await inviteToBid(tx, ctx, {
          packageId: parsed.data.packageId,
          partyId: parsed.data.partyId,
        });
        await logAuditInTx(tx, {
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          action: "jobs.bid_invitation.created",
          targetType: "job_bid_invitation",
          targetId: out.invitation.id,
          /** Identifiers only. The token is never audited. */
          meta: { packageId: parsed.data.packageId },
        });
        return out;
      },
      { role: ctx.role },
    );
    revalidatePath(`${BASE}/${parsed.data.projectId}/bids`);
    return { ok: true as const, token: made.token };
  } catch (err) {
    return toResult(err);
  }
}

const invitationSchema = z.object({
  projectId: z.string().uuid(),
  invitationId: z.string().uuid(),
});

/** The link again, so the builder can re-send it without minting a second. */
export async function revealBidLinkAction(input: unknown) {
  const parsed = invitationSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  try {
    const ctx = await gate();
    const token = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const rows = await tx
          .select()
          .from(schema.jobBidInvitations)
          .where(eq(schema.jobBidInvitations.id, parsed.data.invitationId))
          .limit(1);
        if (!rows[0]) throw new JobsError("NOT_FOUND", "that invitation is no longer here");
        return revealInvitationToken(rows[0]);
      },
      { role: ctx.role },
    );
    return { ok: true as const, token };
  } catch (err) {
    return toResult(err);
  }
}

export async function revokeBidLinkAction(input: unknown) {
  const parsed = invitationSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  try {
    const ctx = await gate();
    await withTenant(
      ctx.tenantId,
      (tx) => revokeInvitation(tx, ctx, parsed.data.invitationId),
      { role: ctx.role },
    );
    revalidatePath(`${BASE}/${parsed.data.projectId}/bids`);
    return { ok: true as const };
  } catch (err) {
    return toResult(err);
  }
}

export async function awardBidAction(input: unknown) {
  const parsed = invitationSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  try {
    const ctx = await gate();
    await withTenant(
      ctx.tenantId,
      async (tx) => {
        const out = await awardInvitation(tx, ctx, parsed.data.invitationId);
        await logAuditInTx(tx, {
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          action: "jobs.bid_invitation.awarded",
          targetType: "job_bid_invitation",
          targetId: out.id,
          meta: { amountCents: out.amountCents },
        });
      },
      { role: ctx.role },
    );
    revalidatePath(`${BASE}/${parsed.data.projectId}/bids`);
    return { ok: true as const };
  } catch (err) {
    return toResult(err);
  }
}

const closeSchema = z.object({
  projectId: z.string().uuid(),
  packageId: z.string().uuid(),
  status: z.enum(["open", "closed"]),
});

export async function setBidPackageStatusAction(input: unknown) {
  const parsed = closeSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  try {
    const ctx = await gate();
    await withTenant(
      ctx.tenantId,
      (tx) => updateBidPackage(tx, ctx, parsed.data.packageId, { status: parsed.data.status }),
      { role: ctx.role },
    );
    revalidatePath(`${BASE}/${parsed.data.projectId}/bids`);
    return { ok: true as const };
  } catch (err) {
    return toResult(err);
  }
}
