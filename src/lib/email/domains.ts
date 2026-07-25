import "server-only";
import { and, eq } from "drizzle-orm";
import { schema, withSystem } from "@/db";
import type { EmailDnsRecord, EmailDomain } from "@/db/schema";
import { getResend } from "@/lib/resend";

/**
 * Sending-domain provisioning.
 *
 * The tenant proves they own a domain by publishing DNS records the provider
 * hands us. Until those verify, `status` stays "pending" and every send falls
 * back to the platform identity — a domain is never trusted on a tenant's say-so.
 *
 * All writes run under withSystem: `email_domains` is member_read-only,
 * because a member who could set status = 'verified' could make the app try to
 * send as a domain they never proved they own. Authorization happens in the
 * action (requireTenantOwner) before any of this is reached.
 */

/** Flatten the provider's union of record shapes into one storable row. */
function normalizeRecords(records: unknown): EmailDnsRecord[] {
  if (!Array.isArray(records)) return [];
  return records.flatMap((raw): EmailDnsRecord[] => {
    if (typeof raw !== "object" || raw === null) return [];
    const r = raw as Record<string, unknown>;
    if (typeof r.name !== "string" || typeof r.value !== "string") return [];
    return [
      {
        record: String(r.record ?? ""),
        type: String(r.type ?? ""),
        name: r.name,
        value: r.value,
        ttl: String(r.ttl ?? "Auto"),
        ...(typeof r.priority === "number" ? { priority: r.priority } : {}),
        ...(typeof r.status === "string" ? { status: r.status } : {}),
      },
    ];
  });
}

/** The provider reports several partial states; only one of them can send. */
function mapStatus(providerStatus: unknown): "pending" | "verified" | "failed" {
  const value = String(providerStatus ?? "");
  if (value === "verified") return "verified";
  if (value === "failed") return "failed";
  return "pending";
}

export async function createSendingDomain(
  tenantId: string,
  domain: string,
  fromLocalPart: string,
): Promise<{ ok: true; row: EmailDomain } | { ok: false; message: string }> {
  if (!process.env.RESEND_API_KEY) {
    return {
      ok: false,
      message: "Email isn't configured yet — add RESEND_API_KEY. See SETUP.md.",
    };
  }

  const created = await getResend().domains.create({ name: domain });
  if (created.error || !created.data) {
    return {
      ok: false,
      message:
        created.error?.message ??
        "The email provider wouldn't accept that domain.",
    };
  }

  const records = normalizeRecords(created.data.records);
  const row = await withSystem(async (tx) => {
    const [inserted] = await tx
      .insert(schema.emailDomains)
      .values({
        tenantId,
        domain,
        providerDomainId: created.data!.id,
        status: mapStatus(created.data!.status),
        dnsRecords: records,
        fromLocalPart,
      })
      .onConflictDoUpdate({
        target: schema.emailDomains.tenantId,
        set: {
          domain,
          providerDomainId: created.data!.id,
          status: mapStatus(created.data!.status),
          dnsRecords: records,
          fromLocalPart,
          verifiedAt: null,
          updatedAt: new Date(),
        },
      })
      .returning();
    return inserted;
  });

  return { ok: true, row };
}

/**
 * Ask the provider to re-check DNS, then store what it says. The provider is
 * the authority here; nothing about verification is decided locally.
 */
export async function refreshSendingDomain(
  tenantId: string,
): Promise<{ ok: true; row: EmailDomain } | { ok: false; message: string }> {
  const existing = await withSystem((tx) =>
    tx.query.emailDomains.findFirst({
      where: eq(schema.emailDomains.tenantId, tenantId),
    }),
  );
  if (!existing?.providerDomainId) {
    return { ok: false, message: "No sending domain to check yet." };
  }

  const resend = getResend();
  // verify() asks for a re-check; get() reads the result back.
  await resend.domains.verify(existing.providerDomainId).catch(() => undefined);
  const fetched = await resend.domains.get(existing.providerDomainId);
  if (fetched.error || !fetched.data) {
    return {
      ok: false,
      message: fetched.error?.message ?? "Couldn't reach the email provider.",
    };
  }

  const status = mapStatus(fetched.data.status);
  const row = await withSystem(async (tx) => {
    const [updated] = await tx
      .update(schema.emailDomains)
      .set({
        status,
        dnsRecords: normalizeRecords(fetched.data!.records),
        lastCheckedAt: new Date(),
        verifiedAt:
          status === "verified" ? (existing.verifiedAt ?? new Date()) : null,
        version: existing.version + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.emailDomains.tenantId, tenantId),
          eq(schema.emailDomains.id, existing.id),
        ),
      )
      .returning();
    return updated;
  });

  return { ok: true, row };
}

export async function loadSendingDomain(
  tenantId: string,
): Promise<EmailDomain | null> {
  const row = await withSystem((tx) =>
    tx.query.emailDomains.findFirst({
      where: eq(schema.emailDomains.tenantId, tenantId),
    }),
  );
  return row ?? null;
}

/**
 * Disconnect. The provider-side domain is left in place on purpose: deleting it
 * would silently invalidate anything already sent from it, and re-adding later
 * would hand out different DKIM keys. Locally forgetting it is enough to make
 * sending fall back to the platform identity.
 */
export async function disconnectSendingDomain(tenantId: string): Promise<void> {
  await withSystem((tx) =>
    tx
      .delete(schema.emailDomains)
      .where(eq(schema.emailDomains.tenantId, tenantId)),
  );
}
