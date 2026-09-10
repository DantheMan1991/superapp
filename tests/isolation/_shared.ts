/**
 * Shared fixtures for the tenant-isolation suite.
 *
 * THE tests that certify the shell: two tenants, and neither can read, write,
 * or enumerate the other's rows — enforced by Postgres RLS, not app code. They
 * run against the real database (DATABASE_URL required, pointed at a test
 * branch by tests/setup/database-guard.ts) and must pass on every deploy.
 *
 * They also prove default-deny: with no tenant context at all, nothing is
 * visible even to the connection's own role (FORCE ROW LEVEL SECURITY).
 *
 * One file per area under tests/isolation/. Every d(...) block owns the tenants
 * it creates, so the files are independent — a new module adds a file here
 * instead of growing a single 6,000-line one.
 */
import { describe } from "vitest";
import { eq } from "drizzle-orm";
import { schema, type Tx } from "../../src/db";

export const RUN = !!process.env.DATABASE_URL;

/** `describe`, or `describe.skip` when there is no database to certify against. */
export const d = RUN ? describe : describe.skip;

if (!RUN) {
  console.warn(
    "⚠ tenant-isolation: DATABASE_URL not set — SKIPPING the most important test in the repo. " +
      "Set it (test/staging DB, never prod) and re-run.",
  );
}

/**
 * Mint the party behind a `customers` or `vendors` fixture.
 *
 * Since CRM slice 0 those two tables are ROLES on a shared identity, so a
 * fixture that wants a customer needs a party first. Deliberately a raw insert
 * rather than a call into `src/lib/parties/`: this suite certifies what the
 * DATABASE enforces, and routing fixtures through application code would let a
 * bug in that code make the isolation tests agree with it.
 */
/**
 * Mint the legal entity behind any journal-entry fixture (ADR 0010).
 *
 * `journal_entries.entity_id` is NOT NULL and its composite FK is
 * `(tenant_id, entity_id) -> entities (tenant_id, id)`, so every fixture that
 * posts needs one — and the FK is itself one of the things this suite
 * certifies. Raw insert for the reason `seedParty` is: this file proves what
 * the DATABASE enforces.
 */
export async function seedEntity(
  tx: Tx,
  tenantId: string,
  tag: string,
): Promise<string> {
  const [row] = await tx
    .insert(schema.entities)
    .values({ tenantId, name: `Company ${tag}`, isDefault: true })
    .returning();
  return row.id;
}

export async function seedParty(
  tx: Tx,
  tenantId: string,
  displayName: string,
): Promise<string> {
  const [row] = await tx
    .insert(schema.parties)
    .values({ tenantId, kind: "organization", displayName })
    .returning();
  return row.id;
}

/**
 * The operator tenant (ADR 0041) for a test that needs one: the NAMED one
 * when the database has it — a dev branch where the founder has run
 * scripts/operator-tenant.ts — and a minted one otherwise, which is what CI's
 * from-zero database gets. A database holds at most one, by index, so a test
 * that always minted its own would fail the moment a real one existed; that
 * refusal is a fact the suite proves, not a fixture problem.
 *
 * A test may create rows INSIDE a real operator and must delete exactly
 * those; it must never delete the operator itself unless it minted it, which
 * is why `minted` comes back beside the id. Raw select and insert, like every
 * fixture here: this suite certifies what the DATABASE enforces.
 */
export async function obtainOperator(
  tx: Tx,
  stamp: string,
): Promise<{ id: string; minted: boolean }> {
  const existing = await tx.query.tenants.findFirst({
    where: eq(schema.tenants.isOperator, true),
    columns: { id: true },
  });
  if (existing) return { id: existing.id, minted: false };
  const [row] = await tx
    .insert(schema.tenants)
    .values({
      clerkOrgId: `${stamp}-op`,
      name: "Isolation Operator",
      slug: `${stamp}-op`,
      isOperator: true,
    })
    .returning({ id: schema.tenants.id });
  return { id: row.id, minted: true };
}
