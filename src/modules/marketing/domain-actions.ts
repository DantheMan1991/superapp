"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { schema, withSystem, withTenant } from "@/db";
import { logAuditInTx } from "@/lib/audit";
import {
  dnsInstructions,
  domainReasonMessage,
  domainStatusFrom,
  normalizeDomain,
  type VercelDomainFacts,
} from "@/lib/sites/domains";
import { platformHostsFromEnv, siteDomainFromEnv } from "@/lib/sites/slug";
import {
  VercelError,
  addProjectDomain,
  getDomainConfig,
  getProjectDomain,
  isVercelConfigured,
  removeProjectDomain,
  verifyProjectDomain,
} from "@/lib/vercel/domains";
import { MarketingError } from "./core/errors";
import {
  deleteSiteDomain,
  findSiteDomain,
  insertSiteDomain,
  listSiteDomains,
  updateSiteDomain,
  type DomainFacts,
  SITE_DOMAINS_MAX,
} from "./domain-ops";
import { fail, gate, type ActionResult } from "./gate";
import { findSite } from "./site-ops";

/**
 * Server actions for a connected domain. Owner-only through the module's
 * one gate. Every call to Vercel happens OUTSIDE a transaction — the house
 * rule — and the row is written from what Vercel said, never from what the
 * owner hoped (S7's shape: the provider is the authority on the domain's
 * state, as Stripe is on billing's).
 */
const BASE = "/dashboard/m/marketing/website";

function revalidateDomains(): void {
  revalidatePath(BASE);
  revalidatePath("/domain/[host]/[[...path]]", "page");
  // The canonical link on the free-address pages names the custom domain.
  revalidatePath("/sites/[slug]/[[...path]]", "page");
  revalidatePath("/hosted/[slug]/[[...path]]", "page");
}

function providerMessage(err: VercelError): string {
  switch (err.code) {
    case "not_configured":
      return "Connecting your own domain isn't switched on for this deployment yet.";
    case "in_use":
      return "Vercel says that domain is already in use elsewhere. Remove it there, or ask us.";
    case "payment":
      return "The hosting account needs a payment method before another domain can be added. Ask us.";
    case "forbidden":
      return "The hosting account refused the request. Ask us.";
    case "invalid":
      return err.message || "Vercel could not accept that domain.";
    default:
      return "Vercel didn't answer properly. Try again in a moment.";
  }
}

/** Vercel's two answers about a domain, folded into what the row stores. */
function factsFrom(
  domain: string,
  project: { verified: boolean; verification: Array<{ type: string; domain: string; value: string }> },
  config: {
    misconfigured: boolean;
    configuredBy: string | null;
    recommendedCNAME: Array<{ rank: number; value: string }>;
    recommendedIPv4: Array<{ rank: number; value: string[] }>;
  },
  lastError = "",
): DomainFacts {
  const facts: VercelDomainFacts = {
    verified: project.verified,
    verification: project.verification,
    misconfigured: config.misconfigured,
    recommendedCNAME: config.recommendedCNAME,
    recommendedIPv4: config.recommendedIPv4,
  };
  return {
    status: domainStatusFrom(facts),
    records: dnsInstructions(domain, facts),
    vercelVerified: project.verified,
    vercelConfiguredBy: config.configuredBy ?? "",
    lastError,
  };
}

const connectInput = z.object({ domain: z.string().max(260) });

export async function connectDomainAction(
  input: unknown,
): Promise<ActionResult<{ id: string; status: string }>> {
  try {
    const ctx = await gate();
    const parsed = connectInput.safeParse(input);
    if (!parsed.success) return { error: "Type the domain you own, like www.example.com." };
    const check = normalizeDomain(parsed.data.domain, {
      platformHosts: platformHostsFromEnv(process.env),
      siteDomain: siteDomainFromEnv(process.env),
    });
    if (!check.ok) throw new MarketingError("DOMAIN_INVALID", domainReasonMessage(check.reason));
    if (!isVercelConfigured()) throw new MarketingError("DOMAINS_UNAVAILABLE", "no token");
    const siteId = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const site = await findSite(tx, ctx.tenantId);
        if (!site) throw new MarketingError("SITE_MISSING", "no site");
        if ((await listSiteDomains(tx, ctx.tenantId, site.id)).length >= SITE_DOMAINS_MAX) {
          throw new MarketingError("DOMAIN_LIMIT", "limit");
        }
        return site.id;
      },
      { role: ctx.role },
    );
    // A hostname points at one site across the whole platform, and a tenant
    // transaction cannot see another tenant's rows to know. One trusted read
    // of one boolean, before Vercel is asked: the unique index would refuse
    // the insert anyway, but by then the domain would be on the project.
    const taken = await withSystem((tx) =>
      tx.query.siteDomains.findFirst({
        where: eq(schema.siteDomains.domain, check.domain),
        columns: { id: true },
      }),
    );
    if (taken) throw new MarketingError("DOMAIN_TAKEN", check.domain);

    let facts: DomainFacts;
    try {
      const project = await addProjectDomain(check.domain);
      const config = await getDomainConfig(check.domain);
      facts = factsFrom(check.domain, project, config);
    } catch (err) {
      if (err instanceof VercelError) throw new MarketingError("DOMAIN_PROVIDER", providerMessage(err));
      throw err;
    }
    const row = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const created = await insertSiteDomain(tx, ctx, siteId, {
          domain: check.domain,
          apex: check.apex,
          ...facts,
        });
        await logAuditInTx(tx, {
          action: "marketing.site.domain_connected",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "site_domain",
          targetId: created.id,
          meta: { domain: check.domain, status: created.status },
        });
        return created;
      },
      { role: ctx.role },
    );
    revalidateDomains();
    return { ok: true, data: { id: row.id, status: row.status } };
  } catch (err) {
    return fail(err);
  }
}

const idInput = z.object({ id: z.string().uuid() });

/** Ask Vercel again, and store its answer. The button reads "Check again". */
export async function checkDomainAction(
  input: unknown,
): Promise<ActionResult<{ status: string }>> {
  try {
    const ctx = await gate();
    const parsed = idInput.safeParse(input);
    if (!parsed.success) return { error: "Pick a domain and try again." };
    if (!isVercelConfigured()) throw new MarketingError("DOMAINS_UNAVAILABLE", "no token");
    const row = await withTenant(
      ctx.tenantId,
      (tx) => findSiteDomain(tx, ctx.tenantId, parsed.data.id),
      { role: ctx.role },
    );
    if (!row) throw new MarketingError("DOMAIN_MISSING", "no such domain");

    let facts: DomainFacts;
    try {
      let project = await getProjectDomain(row.domain);
      if (!project) {
        facts = {
          status: "error",
          records: [],
          vercelVerified: false,
          vercelConfiguredBy: "",
          lastError: "Vercel no longer has this domain. Remove it here and connect it again.",
        };
      } else {
        let note = "";
        if (!project.verified) {
          const attempt = await verifyProjectDomain(row.domain);
          if (attempt.verified) project = (await getProjectDomain(row.domain)) ?? project;
          else note = attempt.message;
        }
        const config = await getDomainConfig(row.domain);
        facts = factsFrom(row.domain, project, config, project.verified ? "" : note);
      }
    } catch (err) {
      if (err instanceof VercelError) throw new MarketingError("DOMAIN_PROVIDER", providerMessage(err));
      throw err;
    }
    const updated = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const next = await updateSiteDomain(tx, ctx, row, facts);
        if (next.status !== row.status) {
          await logAuditInTx(tx, {
            action: "marketing.site.domain_status",
            tenantId: ctx.tenantId,
            actorClerkUserId: ctx.userId,
            targetType: "site_domain",
            targetId: next.id,
            meta: { domain: next.domain, from: row.status, to: next.status },
          });
        }
        return next;
      },
      { role: ctx.role },
    );
    revalidateDomains();
    return { ok: true, data: { status: updated.status } };
  } catch (err) {
    return fail(err);
  }
}

/** Vercel first, then the row — as Square's disconnect does it. */
export async function removeDomainAction(input: unknown): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = idInput.safeParse(input);
    if (!parsed.success) return { error: "Pick a domain and try again." };
    const row = await withTenant(
      ctx.tenantId,
      (tx) => findSiteDomain(tx, ctx.tenantId, parsed.data.id),
      { role: ctx.role },
    );
    if (!row) throw new MarketingError("DOMAIN_MISSING", "no such domain");
    if (isVercelConfigured()) {
      try {
        await removeProjectDomain(row.domain);
      } catch (err) {
        if (err instanceof VercelError) throw new MarketingError("DOMAIN_PROVIDER", providerMessage(err));
        throw err;
      }
    }
    await withTenant(
      ctx.tenantId,
      async (tx) => {
        await deleteSiteDomain(tx, ctx, row.id);
        await logAuditInTx(tx, {
          action: "marketing.site.domain_removed",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "site_domain",
          targetId: row.id,
          meta: { domain: row.domain },
        });
      },
      { role: ctx.role },
    );
    revalidateDomains();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
