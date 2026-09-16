import "server-only";
import { and, asc, eq, ilike, inArray, or, type SQL } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { EntityLinkCtx, EntityLinkProvider, LinkableEntity } from "@/lib/entity-links/types";
import { PACK, PROJECT_ENTITY, STATUS_LABELS, WARRANTY_CLAIM_ENTITY } from "./vocabulary";

/**
 * The jobs pack as a place things can be attached to (ADR 0071): a project
 * is a linkable entity, so a calendar item — every phase of a job's
 * schedule, and anything a person puts on their own calendar — an email or
 * a work item can point at "24-109 · Miller barn conversion" and open it.
 *
 * The first layer beneath the core modules to contribute a provider; the
 * registry imports this file the way it imports `work/links.ts`. `search`
 * and `resolve` take the caller's `tx` and never open their own.
 */

const hrefFor = (id: string) => `/dashboard/m/jobs/${id}`;

type ProjectRow = { id: string; number: string; name: string; status: string };

function toEntity(row: ProjectRow): LinkableEntity {
  return {
    entityType: PROJECT_ENTITY,
    entityId: row.id,
    label: `${row.number} · ${row.name}`,
    sublabel: (STATUS_LABELS as Record<string, string>)[row.status] ?? row.status,
    href: hrefFor(row.id),
  };
}

const projectColumns = {
  id: schema.jobProjects.id,
  number: schema.jobProjects.number,
  name: schema.jobProjects.name,
  status: schema.jobProjects.status,
};

async function searchProjects(tx: Tx, ctx: EntityLinkCtx, query: string, limit: number): Promise<LinkableEntity[]> {
  const q = `%${query.trim()}%`;
  const rows = await tx
    .select(projectColumns)
    .from(schema.jobProjects)
    .where(
      and(
        eq(schema.jobProjects.tenantId, ctx.tenantId),
        query.trim() === "" ? undefined : or(ilike(schema.jobProjects.number, q), ilike(schema.jobProjects.name, q)),
      ),
    )
    .orderBy(asc(schema.jobProjects.number))
    .limit(limit);
  return rows.map(toEntity);
}

async function resolveProjects(tx: Tx, ctx: EntityLinkCtx, ids: readonly string[]): Promise<LinkableEntity[]> {
  if (ids.length === 0) return [];
  const rows = await tx
    .select(projectColumns)
    .from(schema.jobProjects)
    .where(and(eq(schema.jobProjects.tenantId, ctx.tenantId), inArray(schema.jobProjects.id, [...ids])));
  return rows.map(toEntity);
}

/**
 * A warranty claim is linkable too (ADR 0076): the Work item a claim raises
 * points at the claim rather than the job, so the Work module names which
 * call it is and the job's punch list stays the punch list. The href lands
 * on the job's Warranty tab at the claim's row.
 */
type ClaimRow = { id: string; number: number; title: string; projectId: string; projectNumber: string };

function toClaimEntity(row: ClaimRow): LinkableEntity {
  return {
    entityType: WARRANTY_CLAIM_ENTITY,
    entityId: row.id,
    label: `Warranty claim ${row.number} · ${row.projectNumber}`,
    sublabel: row.title,
    href: `${hrefFor(row.projectId)}/warranty#claim-${row.id}`,
  };
}

const claimColumns = {
  id: schema.jobWarrantyClaims.id,
  number: schema.jobWarrantyClaims.number,
  title: schema.jobWarrantyClaims.title,
  projectId: schema.jobWarrantyClaims.projectId,
  projectNumber: schema.jobProjects.number,
};

function claimQuery(tx: Tx, ctx: EntityLinkCtx, where?: SQL) {
  return tx
    .select(claimColumns)
    .from(schema.jobWarrantyClaims)
    .innerJoin(
      schema.jobProjects,
      and(eq(schema.jobProjects.tenantId, schema.jobWarrantyClaims.tenantId), eq(schema.jobProjects.id, schema.jobWarrantyClaims.projectId)),
    )
    .where(and(eq(schema.jobWarrantyClaims.tenantId, ctx.tenantId), where));
}

async function searchClaims(tx: Tx, ctx: EntityLinkCtx, query: string, limit: number): Promise<LinkableEntity[]> {
  const q = `%${query.trim()}%`;
  const rows = await claimQuery(tx, ctx, query.trim() === "" ? undefined : or(ilike(schema.jobWarrantyClaims.title, q), ilike(schema.jobProjects.number, q)))
    .orderBy(asc(schema.jobProjects.number), asc(schema.jobWarrantyClaims.number))
    .limit(limit);
  return rows.map(toClaimEntity);
}

async function resolveClaims(tx: Tx, ctx: EntityLinkCtx, ids: readonly string[]): Promise<LinkableEntity[]> {
  if (ids.length === 0) return [];
  const rows = await claimQuery(tx, ctx, inArray(schema.jobWarrantyClaims.id, [...ids]));
  return rows.map(toClaimEntity);
}

export const jobsEntityLinks: EntityLinkProvider = {
  slug: PACK,
  moduleSlug: PACK,
  name: "Jobs",
  entityTypes: [
    {
      type: PROJECT_ENTITY,
      label: "Project",
      pluralLabel: "Projects",
      icon: "hard-hat",
      search: searchProjects,
      resolve: resolveProjects,
    },
    {
      type: WARRANTY_CLAIM_ENTITY,
      label: "Warranty claim",
      pluralLabel: "Warranty claims",
      icon: "shield-check",
      search: searchClaims,
      resolve: resolveClaims,
    },
  ],
};
