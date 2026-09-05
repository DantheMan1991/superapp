import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { SiteDomain } from "@/db/schema";
import type { DnsRecordToPublish, SiteDomainStatus } from "@/lib/sites/domains";
import { MarketingError } from "./core/errors";
import type { MarketingCtx } from "./kit-ops";

/**
 * Writing a connected domain's row. Takes the caller's `tx`; the action
 * layer owns the transaction, the gate, the audit row and every call to
 * Vercel (network, never inside a transaction).
 */
export const SITE_DOMAINS_MAX = 5;

function isUniqueViolation(err: unknown): boolean {
  const code =
    (err as { code?: string })?.code ?? (err as { cause?: { code?: string } })?.cause?.code;
  return code === "23505";
}

export async function listSiteDomains(
  tx: Tx,
  tenantId: string,
  siteId: string,
): Promise<SiteDomain[]> {
  return tx.query.siteDomains.findMany({
    where: and(eq(schema.siteDomains.tenantId, tenantId), eq(schema.siteDomains.siteId, siteId)),
    orderBy: asc(schema.siteDomains.createdAt),
  });
}

export async function findSiteDomain(
  tx: Tx,
  tenantId: string,
  id: string,
): Promise<SiteDomain | null> {
  const row = await tx.query.siteDomains.findFirst({
    where: and(eq(schema.siteDomains.tenantId, tenantId), eq(schema.siteDomains.id, id)),
  });
  return row ?? null;
}

export interface DomainFacts {
  status: SiteDomainStatus;
  records: DnsRecordToPublish[];
  vercelVerified: boolean;
  vercelConfiguredBy: string;
  lastError: string;
}

export async function insertSiteDomain(
  tx: Tx,
  ctx: MarketingCtx,
  siteId: string,
  input: { domain: string; apex: boolean } & DomainFacts,
): Promise<SiteDomain> {
  const existing = await listSiteDomains(tx, ctx.tenantId, siteId);
  if (existing.length >= SITE_DOMAINS_MAX) throw new MarketingError("DOMAIN_LIMIT", "limit");
  try {
    const [created] = await tx
      .insert(schema.siteDomains)
      .values({
        tenantId: ctx.tenantId,
        siteId,
        domain: input.domain,
        apex: input.apex,
        status: input.status,
        records: input.records,
        vercelVerified: input.vercelVerified,
        vercelConfiguredBy: input.vercelConfiguredBy,
        lastError: input.lastError,
        lastCheckedAt: new Date(),
        activatedAt: input.status === "active" ? new Date() : null,
      })
      .returning();
    if (!created) throw new MarketingError("FORBIDDEN", "domain not created");
    return created;
  } catch (err) {
    if (isUniqueViolation(err)) throw new MarketingError("DOMAIN_TAKEN", input.domain);
    throw err;
  }
}

export async function updateSiteDomain(
  tx: Tx,
  ctx: MarketingCtx,
  row: SiteDomain,
  facts: DomainFacts,
): Promise<SiteDomain> {
  const [updated] = await tx
    .update(schema.siteDomains)
    .set({
      status: facts.status,
      records: facts.records,
      vercelVerified: facts.vercelVerified,
      vercelConfiguredBy: facts.vercelConfiguredBy,
      lastError: facts.lastError,
      lastCheckedAt: new Date(),
      activatedAt:
        facts.status === "active" ? (row.activatedAt ?? new Date()) : row.activatedAt,
      updatedAt: new Date(),
    })
    .where(and(eq(schema.siteDomains.tenantId, ctx.tenantId), eq(schema.siteDomains.id, row.id)))
    .returning();
  // Zero rows is how RLS says no to an UPDATE; treat it as the refusal it is.
  if (!updated) throw new MarketingError("FORBIDDEN", "domain not updated");
  return updated;
}

export async function deleteSiteDomain(
  tx: Tx,
  ctx: MarketingCtx,
  id: string,
): Promise<SiteDomain> {
  const [deleted] = await tx
    .delete(schema.siteDomains)
    .where(and(eq(schema.siteDomains.tenantId, ctx.tenantId), eq(schema.siteDomains.id, id)))
    .returning();
  if (!deleted) throw new MarketingError("DOMAIN_MISSING", "no such domain");
  return deleted;
}
