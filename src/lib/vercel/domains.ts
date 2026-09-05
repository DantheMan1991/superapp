import "server-only";
import { z } from "zod";

/**
 * Vercel's Domains API, the slice of it a connected domain needs: add a
 * domain to this project, read what Vercel thinks of it, ask it to verify,
 * remove it. Every response is parsed with Zod before anything reads it —
 * the provider is an untrusted input like any other (docs/security.md S5).
 *
 * Configuration: `VERCEL_API_TOKEN` (a token with access to the project),
 * `VERCEL_PROJECT_ID`, and `VERCEL_TEAM_ID` when the project lives in a
 * team. Lazy, like every provider client here: the build needs none of it,
 * and without a token the feature says so rather than failing mid-click.
 *
 * Shapes verified against the REST reference on 2026-09-04:
 * `POST /v10/projects/{id}/domains`, `GET /v9/projects/{id}/domains/{domain}`,
 * `POST /v9/projects/{id}/domains/{domain}/verify`,
 * `GET /v6/domains/{domain}/config`, `DELETE /v9/projects/{id}/domains/{domain}`.
 */
export type VercelErrorCode =
  | "not_configured"
  | "invalid"
  | "in_use"
  | "forbidden"
  | "payment"
  | "unexpected";

export class VercelError extends Error {
  constructor(
    public readonly code: VercelErrorCode,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "VercelError";
  }
}

export function isVercelConfigured(): boolean {
  return Boolean(process.env.VERCEL_API_TOKEN && process.env.VERCEL_PROJECT_ID);
}

const Verification = z.array(
  z.object({
    type: z.string(),
    domain: z.string(),
    value: z.string(),
    reason: z.string().default(""),
  }),
);

export const ProjectDomainSchema = z.object({
  name: z.string(),
  apexName: z.string(),
  verified: z.boolean(),
  verification: Verification.default([]),
});
export type ProjectDomain = z.infer<typeof ProjectDomainSchema>;

export const DomainConfigSchema = z.object({
  configuredBy: z.enum(["A", "CNAME", "dns-01", "http"]).nullable(),
  misconfigured: z.boolean(),
  acceptedChallenges: z.array(z.string()).default([]),
  recommendedCNAME: z.array(z.object({ rank: z.number(), value: z.string() })).default([]),
  recommendedIPv4: z
    .array(z.object({ rank: z.number(), value: z.array(z.string()) }))
    .default([]),
});
export type DomainConfig = z.infer<typeof DomainConfigSchema>;

const ErrorBody = z.object({
  error: z.object({ code: z.string().optional(), message: z.string().optional() }).optional(),
});

function config(): { token: string; projectId: string; teamId: string | null } {
  const token = process.env.VERCEL_API_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;
  if (!token || !projectId) {
    throw new VercelError("not_configured", "VERCEL_API_TOKEN and VERCEL_PROJECT_ID are not set");
  }
  return { token, projectId, teamId: process.env.VERCEL_TEAM_ID?.trim() || null };
}

async function call(
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: unknown,
): Promise<{ status: number; json: unknown }> {
  const { token, teamId } = config();
  const url = new URL(`https://api.vercel.com${path}`);
  if (teamId) url.searchParams.set("teamId", teamId);
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

/** Vercel's message when it gave one; a plain sentence otherwise. */
function messageOf(json: unknown, fallback: string): string {
  const parsed = ErrorBody.safeParse(json);
  return parsed.success ? (parsed.data.error?.message ?? fallback) : fallback;
}

function throwFor(status: number, json: unknown): never {
  switch (status) {
    case 400:
      throw new VercelError("invalid", messageOf(json, "Vercel could not accept that domain."), status);
    case 401:
    case 403:
      throw new VercelError("forbidden", messageOf(json, "Vercel refused the request."), status);
    case 402:
      throw new VercelError("payment", messageOf(json, "The hosting account needs a payment method."), status);
    case 409:
      throw new VercelError("in_use", messageOf(json, "That domain is already in use on Vercel."), status);
    default:
      throw new VercelError("unexpected", messageOf(json, `Vercel answered ${status}.`), status);
  }
}

export async function addProjectDomain(domain: string): Promise<ProjectDomain> {
  const { projectId } = config();
  const { status, json } = await call("POST", `/v10/projects/${projectId}/domains`, { name: domain });
  if (status !== 200) throwFor(status, json);
  return ProjectDomainSchema.parse(json);
}

/** Null when the domain is not on the project (any more). */
export async function getProjectDomain(domain: string): Promise<ProjectDomain | null> {
  const { projectId } = config();
  const { status, json } = await call(
    "GET",
    `/v9/projects/${projectId}/domains/${encodeURIComponent(domain)}`,
  );
  if (status === 404) return null;
  if (status !== 200) throwFor(status, json);
  return ProjectDomainSchema.parse(json);
}

/**
 * Ask Vercel to check the ownership challenge. A 400 here is Vercel saying
 * "not yet" in one of four documented ways (no TXT, wrong TXT, TXT for
 * another project, not on the project) — reported as a message, not thrown,
 * because the owner's next step is the same: publish the record and try
 * again.
 */
export async function verifyProjectDomain(
  domain: string,
): Promise<{ verified: boolean; message: string }> {
  const { projectId } = config();
  const { status, json } = await call(
    "POST",
    `/v9/projects/${projectId}/domains/${encodeURIComponent(domain)}/verify`,
  );
  if (status === 400) return { verified: false, message: messageOf(json, "Not verified yet.") };
  if (status !== 200) throwFor(status, json);
  return { verified: ProjectDomainSchema.parse(json).verified, message: "" };
}

export async function getDomainConfig(domain: string): Promise<DomainConfig> {
  const { projectId } = config();
  const { status, json } = await call(
    "GET",
    `/v6/domains/${encodeURIComponent(domain)}/config?projectIdOrName=${encodeURIComponent(projectId)}`,
  );
  if (status !== 200) throwFor(status, json);
  return DomainConfigSchema.parse(json);
}

/** Gone, or already gone: both are the state the caller wanted. */
export async function removeProjectDomain(domain: string): Promise<void> {
  const { projectId } = config();
  const { status, json } = await call(
    "DELETE",
    `/v9/projects/${projectId}/domains/${encodeURIComponent(domain)}`,
  );
  if (status === 200 || status === 204 || status === 404) return;
  throwFor(status, json);
}
