"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenantOwner } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import {
  createTenantMailbox,
  deleteTenantMailbox,
  reconcileMailboxes,
} from "@/lib/email/mailbox/mailboxes";
import {
  createHostedDomain,
  cutoverHostedDomain,
  disconnectHostedDomain,
  refreshHostedDomain,
} from "@/lib/email/mailbox/provisioning";

/**
 * Hosted-mailbox setup. Owner-only throughout — this decides where a
 * business's incoming mail physically goes, which is the single most
 * consequential setting in the product.
 *
 * Nothing here logs an email address. The audit log is identifiers-only and
 * superadmin-visible (the rule the send log follows too), and an invitation
 * address is someone's personal mailbox.
 */

const BASE = "/dashboard/email";

type ActionResult<T = undefined> = { ok: true; data?: T } | { error: string };

const setupSchema = z.object({ domain: z.string().min(4).max(253) });

export async function setupHostedDomainAction(
  input: z.infer<typeof setupSchema>,
): Promise<
  ActionResult<{
    status: string;
    currentMail: string;
    alreadyHasMail: boolean;
    adopted: boolean;
    rollbackUnavailable: boolean;
  }>
> {
  const ctx = await requireTenantOwner();
  const parsed = setupSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };

  const result = await createHostedDomain(ctx.tenant.id, parsed.data.domain);
  if (!result.ok) return { error: result.message };

  await logAudit({
    action: "mailbox.domain_created",
    tenantId: ctx.tenant.id,
    actorClerkUserId: ctx.userId,
    targetType: "mailbox_domain",
    targetId: result.data.row.id,
    meta: {
      domain: result.data.row.domain,
      // Whether they had mail elsewhere is the fact that decides how risky the
      // cutover is. Worth recording; it names a provider, not a person.
      hadExistingMail: result.data.alreadyHasMail,
      previousProvider: result.data.currentMail,
      // Worth recording: an adopted domain has no meaningful rollback, and
      // that is the sort of thing someone reconstructing an incident needs.
      adopted: result.data.adopted,
      rollbackUnavailable: result.data.rollbackUnavailable,
    },
  });

  revalidatePath(BASE);
  return {
    ok: true,
    data: {
      status: result.data.row.status,
      currentMail: result.data.currentMail,
      alreadyHasMail: result.data.alreadyHasMail,
      adopted: result.data.adopted,
      rollbackUnavailable: result.data.rollbackUnavailable,
    },
  };
}

export async function checkHostedDomainAction(): Promise<
  ActionResult<{ status: string; findings: string[] }>
> {
  const ctx = await requireTenantOwner();
  const result = await refreshHostedDomain(ctx.tenant.id);
  if (!result.ok) return { error: result.message };

  revalidatePath(BASE);
  return {
    ok: true,
    data: { status: result.data.row.status, findings: result.data.findings },
  };
}

/**
 * The cutover. Requires the owner to type the domain name.
 *
 * That friction is proportionate rather than decorative: this is the action
 * that redirects every piece of mail the business receives, and unlike almost
 * everything else in the app it cannot be undone from inside the app — undoing
 * it means editing DNS at their registrar and waiting for it to spread.
 */
const cutoverSchema = z.object({ confirmDomain: z.string().min(1).max(253) });

export async function cutoverHostedDomainAction(
  input: z.infer<typeof cutoverSchema>,
): Promise<ActionResult<{ status: string }>> {
  const ctx = await requireTenantOwner();
  const parsed = cutoverSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };

  const { loadHostedDomain } = await import("@/lib/email/mailbox/provisioning");
  const existing = await loadHostedDomain(ctx.tenant.id);
  if (!existing) return { error: "No hosted domain to activate." };

  if (
    parsed.data.confirmDomain.trim().toLowerCase() !==
    existing.domain.toLowerCase()
  ) {
    return { error: `Type ${existing.domain} exactly to confirm.` };
  }

  const result = await cutoverHostedDomain(ctx.tenant.id);
  if (!result.ok) return { error: result.message };

  await logAudit({
    action: "mailbox.domain_activated",
    tenantId: ctx.tenant.id,
    actorClerkUserId: ctx.userId,
    targetType: "mailbox_domain",
    targetId: result.data.row.id,
    meta: { domain: result.data.row.domain },
  });

  revalidatePath(BASE);
  return { ok: true, data: { status: result.data.row.status } };
}

export async function disconnectHostedDomainAction(): Promise<ActionResult> {
  const ctx = await requireTenantOwner();
  await disconnectHostedDomain(ctx.tenant.id);
  await logAudit({
    action: "mailbox.domain_disconnected",
    tenantId: ctx.tenant.id,
    actorClerkUserId: ctx.userId,
    targetType: "mailbox_domain",
    targetId: ctx.tenant.id,
    meta: {},
  });
  revalidatePath(BASE);
  return { ok: true };
}

const createMailboxSchema = z.object({
  localPart: z.string().min(1).max(63),
  displayName: z.string().max(120).default(""),
  inviteEmail: z.string().min(6).max(254),
});

export async function createMailboxAction(
  input: z.infer<typeof createMailboxSchema>,
): Promise<ActionResult<{ address: string; invitedTo: string }>> {
  const ctx = await requireTenantOwner();
  const parsed = createMailboxSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };

  const result = await createTenantMailbox(ctx.tenant.id, parsed.data);
  if (!result.ok) return { error: result.message };

  await logAudit({
    action: "mailbox.created",
    tenantId: ctx.tenant.id,
    actorClerkUserId: ctx.userId,
    targetType: "mailbox",
    targetId: result.data.mailbox.id,
    // The local part is a business fact ("they made an invoices@ box"); the
    // invitation address is a person's private mailbox and stays out.
    meta: { localPart: result.data.mailbox.localPart },
  });

  revalidatePath(BASE);
  return {
    ok: true,
    data: {
      address: result.data.mailbox.address,
      invitedTo: result.data.invitedTo,
    },
  };
}

/**
 * Deleting a mailbox destroys the mail inside it at the host, so the address
 * has to be typed out. Same reasoning as the cutover confirmation: the cost of
 * an accidental click is unrecoverable correspondence.
 */
const deleteMailboxSchema = z.object({
  mailboxId: z.string().uuid(),
  confirmAddress: z.string().min(1).max(254),
});

export async function deleteMailboxAction(
  input: z.infer<typeof deleteMailboxSchema>,
): Promise<ActionResult<{ address: string }>> {
  const ctx = await requireTenantOwner();
  const parsed = deleteMailboxSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };

  const { listTenantMailboxes } = await import(
    "@/lib/email/mailbox/provisioning"
  );
  const mailboxes = await listTenantMailboxes(ctx.tenant.id);
  const target = mailboxes.find((m) => m.id === parsed.data.mailboxId);
  if (!target) return { error: "That mailbox no longer exists." };

  if (
    parsed.data.confirmAddress.trim().toLowerCase() !==
    target.address.toLowerCase()
  ) {
    return { error: `Type ${target.address} exactly to confirm.` };
  }

  const result = await deleteTenantMailbox(ctx.tenant.id, parsed.data.mailboxId);
  if (!result.ok) return { error: result.message };

  await logAudit({
    action: "mailbox.deleted",
    tenantId: ctx.tenant.id,
    actorClerkUserId: ctx.userId,
    targetType: "mailbox",
    targetId: parsed.data.mailboxId,
    meta: { localPart: target.localPart },
  });

  revalidatePath(BASE);
  return { ok: true, data: { address: result.data.address } };
}

export async function reconcileMailboxesAction(): Promise<
  ActionResult<{ onlyLocal: string[]; onlyRemote: string[]; inSync: number }>
> {
  const ctx = await requireTenantOwner();
  const result = await reconcileMailboxes(ctx.tenant.id);
  if (!result.ok) return { error: result.message };
  revalidatePath(BASE);
  return { ok: true, data: result.data };
}
