import "server-only";
import { and, eq } from "drizzle-orm";
import { schema, withSystem } from "@/db";
import type {
  EmailDnsRecord,
  Mailbox,
  MailboxDomain,
  PreviousMxRecord,
} from "@/db/schema";
import { normalizeSendingDomain } from "@/lib/email/identity";
import { defaultMailboxProvider, getMailboxHost } from "./index";
import { guardCutover } from "./guard";
import { describeMxProvider, mxPointsAt, resolveCurrentMx } from "./mx";

/**
 * Standing a tenant's mail up on a domain we host.
 *
 * The shape of this file is dictated by one asymmetry: every other integration
 * in this codebase is additive, and this one is a takeover. When a sending
 * domain fails, notifications stop. When an MX cutover fails, a construction
 * company stops receiving orders, RFIs, and payment remittances, and nobody
 * notices for hours because a quiet inbox looks like a quiet day.
 *
 * So the flow is four separate, individually reversible steps rather than a
 * "Set up email" button:
 *
 *   1. create   — register with the host, snapshot the CURRENT MX. Nothing
 *                 about the tenant's live mail has changed.
 *   2. publish  — the owner adds records at their registrar. This is the step
 *                 that actually redirects mail, and it is the one we cannot do
 *                 for them, which is a feature: it needs a human who knows
 *                 what the domain is for.
 *   3. check    — diagnostics until the host agrees. Read-only, repeatable.
 *   4. activate — the host starts accepting the domain's mail for real.
 *
 * All writes run under withSystem because both tables are member-read-only;
 * requireTenantOwner() authorizes the caller before any of this is reached.
 */

export type ProvisionResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string };

export async function loadHostedDomain(
  tenantId: string,
): Promise<MailboxDomain | null> {
  const row = await withSystem((tx) =>
    tx.query.mailboxDomains.findFirst({
      where: eq(schema.mailboxDomains.tenantId, tenantId),
    }),
  );
  return row ?? null;
}

export async function listTenantMailboxes(
  tenantId: string,
): Promise<Mailbox[]> {
  return withSystem((tx) =>
    tx
      .select()
      .from(schema.mailboxes)
      .where(eq(schema.mailboxes.tenantId, tenantId))
      .orderBy(schema.mailboxes.localPart),
  );
}

/**
 * Step 1. Register the domain and snapshot what its mail does today.
 *
 * The snapshot is the whole reason this is a separate step from activation.
 * Once the owner edits their registrar the old MX answer is unrecoverable from
 * DNS, so it has to be taken now, while the domain still points wherever it
 * has always pointed.
 */
export async function createHostedDomain(
  tenantId: string,
  rawDomain: string,
): Promise<
  ProvisionResult<{
    row: MailboxDomain;
    currentMail: string;
    alreadyHasMail: boolean;
    adopted: boolean;
    /**
     * True when the domain's MX already pointed at the host before we started,
     * which makes the rollback record meaningless — there is no earlier state
     * to go back to. Surfaced so the UI can say so rather than offering a
     * restore that would change nothing.
     */
    rollbackUnavailable: boolean;
  }>
> {
  const domain = normalizeSendingDomain(rawDomain);
  if (!domain) {
    return { ok: false, message: "That doesn't look like a domain name." };
  }

  // A domain cannot be both this tenant's sending subdomain and their hosted
  // mailbox domain: the sending setup wants DKIM/SPF pointed at Resend, this
  // wants MX pointed at the mail host, and the two setups would fight over the
  // same name.
  const sending = await withSystem((tx) =>
    tx.query.emailDomains.findFirst({
      where: and(
        eq(schema.emailDomains.tenantId, tenantId),
        eq(schema.emailDomains.domain, domain),
      ),
    }),
  );
  if (sending) {
    return {
      ok: false,
      message: `${domain} is already set up as your sending domain. Host your mailboxes on your main domain instead, and keep ${domain} for outgoing notifications.`,
    };
  }

  const taken = await withSystem((tx) =>
    tx.query.mailboxDomains.findFirst({
      where: eq(schema.mailboxDomains.domain, domain),
    }),
  );
  if (taken && taken.tenantId !== tenantId) {
    return {
      ok: false,
      message: "That domain is already hosted on this platform.",
    };
  }

  // BEFORE anything changes anywhere.
  const previousMx = await resolveCurrentMx(domain);

  const host = getMailboxHost(defaultMailboxProvider());
  const created = await host.createDomain(domain);
  if (!created.ok) return { ok: false, message: created.message };

  const records = await host.getDomainRecords(domain);
  const dnsRecords: EmailDnsRecord[] = records.ok ? records.data : [];

  const row = await withSystem(async (tx) => {
    const [inserted] = await tx
      .insert(schema.mailboxDomains)
      .values({
        tenantId,
        domain,
        provider: host.provider,
        status: "pending",
        dnsRecords,
        previousMx,
      })
      .onConflictDoUpdate({
        target: schema.mailboxDomains.tenantId,
        set: {
          domain,
          provider: host.provider,
          status: "pending",
          dnsRecords,
          // Deliberately NOT overwritten on conflict — the first snapshot is
          // the pristine one. Re-running setup after the owner has already
          // published new records would otherwise capture our own MX as the
          // thing to roll back to.
          updatedAt: new Date(),
        },
      })
      .returning();
    return inserted;
  });

  return {
    ok: true,
    data: {
      row,
      currentMail: describeMxProvider(previousMx),
      alreadyHasMail: previousMx.length > 0,
      adopted: created.data.adopted === true,
      rollbackUnavailable: mxPointsAt(previousMx, host.provider),
    },
  };
}

/**
 * Step 3. Ask the host what it can see. Read-only against the tenant's world —
 * it never changes DNS and never activates.
 *
 * Promotes pending → dns_ready when the host is satisfied, and demotes back
 * when it is not, so a domain that was ready yesterday and had its records
 * clobbered today stops offering the cutover button.
 */
export async function refreshHostedDomain(
  tenantId: string,
): Promise<ProvisionResult<{ row: MailboxDomain; findings: string[] }>> {
  const existing = await loadHostedDomain(tenantId);
  if (!existing) {
    return { ok: false, message: "No hosted domain to check yet." };
  }

  const host = getMailboxHost(existing.provider);
  const [diagnostics, records] = await Promise.all([
    host.checkDomain(existing.domain),
    host.getDomainRecords(existing.domain),
  ]);

  if (!diagnostics.ok) {
    return { ok: false, message: diagnostics.message };
  }

  // Once active, this call only refreshes findings. Nothing here may take a
  // live domain back out of service — that is what disconnect is for, and it
  // should be a decision rather than a side effect of a health check.
  const nextStatus: MailboxDomain["status"] =
    existing.status === "active"
      ? "active"
      : diagnostics.data.ok
        ? "dns_ready"
        : "pending";

  const row = await withSystem(async (tx) => {
    const [updated] = await tx
      .update(schema.mailboxDomains)
      .set({
        status: nextStatus,
        ...(records.ok ? { dnsRecords: records.data } : {}),
        lastDiagnostics: diagnostics.data.details ?? {},
        lastCheckedAt: new Date(),
        version: existing.version + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.mailboxDomains.tenantId, tenantId),
          eq(schema.mailboxDomains.id, existing.id),
        ),
      )
      .returning();
    return updated;
  });

  return { ok: true, data: { row, findings: diagnostics.data.findings } };
}

/**
 * Step 4. The cutover.
 *
 * Two gates, both of which have to be satisfied by the HOST rather than by our
 * own stored state, because our stored state is exactly what a stale row would
 * lie about:
 *
 *   - the domain must be in dns_ready
 *   - a fresh diagnostics call must confirm the MX actually resolves to the
 *     host right now
 *
 * The second gate is the one that matters. Activating a domain whose MX still
 * points at Google does not break anything immediately — it quietly creates a
 * split where the host believes it is authoritative and no mail ever arrives,
 * which is the hardest kind of email fault to diagnose.
 */
export async function cutoverHostedDomain(
  tenantId: string,
): Promise<ProvisionResult<{ row: MailboxDomain }>> {
  // Cheapest refusal first: a preview deployment has no business redirecting
  // anyone's mail, and there is no argument that gets it past this.
  const blocked = guardCutover();
  if (blocked) return { ok: false, message: blocked };

  const existing = await loadHostedDomain(tenantId);
  if (!existing) {
    return { ok: false, message: "No hosted domain to activate." };
  }
  if (existing.status === "active") {
    return { ok: true, data: { row: existing } };
  }
  if (existing.status !== "dns_ready") {
    return {
      ok: false,
      message:
        "The DNS records aren't confirmed yet. Publish them and run the check first.",
    };
  }

  const host = getMailboxHost(existing.provider);

  const diagnostics = await host.checkDomain(existing.domain);
  if (!diagnostics.ok) return { ok: false, message: diagnostics.message };
  if (!diagnostics.data.mxOk) {
    return {
      ok: false,
      message:
        "Your MX record still points somewhere else, so mail wouldn't reach these mailboxes. Update MX at your DNS provider, wait for it to spread, then check again.",
    };
  }

  // Confirm against public DNS too, not just the host's own view. Two
  // independent sources have to agree before a business's mail is redirected.
  const live = await resolveCurrentMx(existing.domain);
  if (live.length > 0 && !mxPointsAt(live, existing.provider)) {
    return {
      ok: false,
      message: `Public DNS still shows mail for ${existing.domain} going to ${describeMxProvider(live)}. Give the change time to spread, then check again.`,
    };
  }

  const activated = await host.activateDomain(existing.domain);
  if (!activated.ok) return { ok: false, message: activated.message };

  const row = await withSystem(async (tx) => {
    const [updated] = await tx
      .update(schema.mailboxDomains)
      .set({
        status: "active",
        mxCutoverAt: existing.mxCutoverAt ?? new Date(),
        activatedAt: new Date(),
        lastError: "",
        version: existing.version + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.mailboxDomains.tenantId, tenantId),
          eq(schema.mailboxDomains.id, existing.id),
        ),
      )
      .returning();
    return updated;
  });

  return { ok: true, data: { row } };
}

/**
 * What to put back to undo the cutover.
 *
 * Not an action — deliberately. Restoring MX means editing the tenant's
 * registrar, which we have no access to and should not want. What we can do is
 * hand back the exact records the domain had before, so the person fixing it
 * is reading a stored fact instead of trying to remember what Google's MX
 * hostnames were while their mail is down.
 */
export async function rollbackPlan(tenantId: string): Promise<{
  records: PreviousMxRecord[];
  previousProvider: string;
  capturedAt: Date | null;
} | null> {
  const existing = await loadHostedDomain(tenantId);
  if (!existing) return null;
  const records = (existing.previousMx as PreviousMxRecord[]) ?? [];
  return {
    records,
    previousProvider: describeMxProvider(records),
    capturedAt: existing.createdAt,
  };
}

/**
 * Local disconnect. The provider-side domain is left in place — Migadu does not
 * expose domain deletion through the API at all, on purpose, and the same
 * reasoning applies that kept the sending-domain teardown local: destroying a
 * domain at the host would destroy the mailboxes and the mail inside them.
 *
 * Mailboxes are cascade-deleted locally, which stops the app listing addresses
 * it no longer manages, and leaves the actual mailboxes untouched at the host
 * where they can still be reached while the owner sorts out where their mail
 * should live.
 */
export async function disconnectHostedDomain(tenantId: string): Promise<void> {
  await withSystem((tx) =>
    tx
      .delete(schema.mailboxDomains)
      .where(eq(schema.mailboxDomains.tenantId, tenantId)),
  );
}
