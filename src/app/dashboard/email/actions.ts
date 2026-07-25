"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenantOwner } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import {
  createSendingDomain,
  disconnectSendingDomain,
  refreshSendingDomain,
} from "@/lib/email/domains";
import { sendEmail } from "@/lib/email/send";
import {
  isSubdomain,
  looksLikeEmail,
  normalizeLocalPart,
  normalizeSendingDomain,
} from "@/lib/email/identity";

/**
 * Sending-domain setup. Owner-only throughout: this decides what address the
 * business's outbound mail claims to come from, which is not a staff decision.
 */

const BASE = "/dashboard/email";

type ActionResult<T = undefined> = { ok: true; data?: T } | { error: string };

const connectSchema = z.object({
  domain: z.string().min(4).max(253),
  fromLocalPart: z.string().min(1).max(63).default("notifications"),
});

export async function connectDomainAction(
  input: z.infer<typeof connectSchema>,
): Promise<ActionResult<{ status: string; warning?: string }>> {
  const ctx = await requireTenantOwner();
  const parsed = connectSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };

  const domain = normalizeSendingDomain(parsed.data.domain);
  if (!domain) {
    return { error: "That doesn't look like a domain name." };
  }
  const localPart = normalizeLocalPart(parsed.data.fromLocalPart);
  if (!localPart) {
    return {
      error: "The part before the @ can only use letters, numbers, dots and dashes.",
    };
  }

  const result = await createSendingDomain(ctx.tenant.id, domain, localPart);
  if (!result.ok) return { error: result.message };

  await logAudit({
    action: "email.domain_connected",
    tenantId: ctx.tenant.id,
    actorClerkUserId: ctx.userId,
    targetType: "email_domain",
    targetId: result.row.id,
    meta: { domain, status: result.row.status },
  });

  revalidatePath(BASE);
  return {
    ok: true,
    data: {
      status: result.row.status,
      // Not an error — sending from the root domain works, it just means this
      // traffic shares a reputation with the owner's personal mail.
      ...(isSubdomain(domain)
        ? {}
        : {
            warning:
              "Using your main domain works, but a subdomain like mail." +
              domain +
              " keeps this mail's reputation separate from your everyday email.",
          }),
    },
  };
}

export async function checkDomainAction(): Promise<
  ActionResult<{ status: string }>
> {
  const ctx = await requireTenantOwner();
  const result = await refreshSendingDomain(ctx.tenant.id);
  if (!result.ok) return { error: result.message };

  if (result.row.status === "verified" && !result.row.verifiedAt) {
    await logAudit({
      action: "email.domain_verified",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "email_domain",
      targetId: result.row.id,
      meta: { domain: result.row.domain },
    });
  }

  revalidatePath(BASE);
  return { ok: true, data: { status: result.row.status } };
}

export async function disconnectDomainAction(): Promise<ActionResult> {
  const ctx = await requireTenantOwner();
  await disconnectSendingDomain(ctx.tenant.id);
  await logAudit({
    action: "email.domain_disconnected",
    tenantId: ctx.tenant.id,
    actorClerkUserId: ctx.userId,
    targetType: "email_domain",
    targetId: ctx.tenant.id,
    meta: {},
  });
  revalidatePath(BASE);
  return { ok: true };
}

const testSchema = z.object({ to: z.string().min(6).max(254) });

/**
 * Send one real message so an owner can see what recipients see. Deliberately
 * uses the same spine as everything else — a test that took a different path
 * would prove nothing.
 */
export async function sendTestEmailAction(
  input: z.infer<typeof testSchema>,
): Promise<ActionResult<{ sentFrom: string; duplicate: boolean }>> {
  const ctx = await requireTenantOwner();
  const parsed = testSchema.safeParse(input);
  if (!parsed.success || !looksLikeEmail(parsed.data.to)) {
    return { error: "That doesn't look like an email address." };
  }

  const result = await sendEmail({
    tenantId: ctx.tenant.id,
    kind: "test",
    to: parsed.data.to,
    subject: `Test email from ${ctx.tenant.name}`,
    text: [
      `This is a test message from ${ctx.tenant.name}, sent through Yosher.`,
      "",
      "If the sender address above looks right, your email setup is working.",
    ].join("\n"),
    // Minute-bucketed: re-clicking "send test" inside the same minute is a
    // no-op, but the owner can retry after correcting DNS.
    idempotencyKey: `test:${parsed.data.to}:${new Date().toISOString().slice(0, 16)}`,
  });

  if (!result.ok) return { error: result.message };

  revalidatePath(BASE);
  return {
    ok: true,
    data: { sentFrom: result.sentAs.fromAddress, duplicate: result.duplicate },
  };
}
