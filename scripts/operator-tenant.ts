import "dotenv/config";
import { eq } from "drizzle-orm";

/**
 * Name the operator tenant — the business that runs the platform, running on
 * it (ADR 0041, docs/modules/back-office.md).
 *
 *   npm run db:operator-tenant -- <slug>            production
 *   npm run db:operator-tenant -- <slug> --dev      the Neon dev branch
 *   npm run db:operator-tenant -- <slug> --unset    take the flag off
 *
 * A script rather than a console button because moving the flag is not a
 * routine act. The partial unique index on `tenants.is_operator` allows one
 * per database; `--unset` exists so a mistake on dev can be undone. The
 * tenant must already be a workspace — a Clerk organization behind it — since
 * the operator is a real tenant and never a prospect row.
 *
 * Connects as the app role through src/db: `withSystem` sets the context the
 * `tenants_superadmin_all` policy honours, and the audit row is written in
 * the same transaction as the flag, identifiers only. (Not `logAudit`: that
 * module is `server-only`, which a script cannot import.)
 */

const argv = process.argv.slice(2);
const wantsDev = argv.includes("--dev");
const wantsUnset = argv.includes("--unset");
const slugArg = argv.find((a) => !a.startsWith("--"));

function resolveUrl(): { url: string; label: string } {
  if (wantsDev) {
    const url = process.env.TEST_DATABASE_URL;
    if (!url) {
      console.error("--dev needs TEST_DATABASE_URL set (the Neon dev branch).");
      process.exit(1);
    }
    if (url === process.env.DATABASE_URL) {
      console.error(
        "REFUSING: TEST_DATABASE_URL points at the same database as DATABASE_URL.",
      );
      process.exit(1);
    }
    return { url, label: "dev branch" };
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. Copy .env.example to .env and fill it in.");
    process.exit(1);
  }
  return { url, label: "production" };
}

async function main() {
  if (!slugArg) {
    console.error(
      "Usage: npm run db:operator-tenant -- <slug> [--dev] [--unset]",
    );
    process.exit(1);
  }
  const slug: string = slugArg;
  const { url, label } = resolveUrl();

  // src/db opens its pool from DATABASE_URL on first use, so the variable is
  // pointed at the chosen database BEFORE the module loads. A script that
  // imports dotenv and then src/db statically is reading production.
  process.env.DATABASE_URL = url;
  const { withSystem, schema } = await import("../src/db");

  const outcome = await withSystem(async (tx) => {
    const tenant = await tx.query.tenants.findFirst({
      where: eq(schema.tenants.slug, slug),
      columns: {
        id: true,
        name: true,
        slug: true,
        clerkOrgId: true,
        isOperator: true,
        status: true,
      },
    });
    if (!tenant) return `No tenant with slug "${slug}" on the ${label}.`;

    if (wantsUnset) {
      if (!tenant.isOperator) {
        return `${tenant.name} is not the operator tenant; nothing to do.`;
      }
      await tx
        .update(schema.tenants)
        .set({ isOperator: false, updatedAt: new Date() })
        .where(eq(schema.tenants.id, tenant.id));
      await tx.insert(schema.auditLog).values({
        action: "tenant.operator_cleared",
        tenantId: tenant.id,
        actorLabel: "operator-tenant-script",
        meta: { slug: tenant.slug },
      });
      return `${tenant.name} is no longer the operator tenant (${label}).`;
    }

    if (!tenant.clerkOrgId) {
      return `${tenant.name} has no workspace behind it (no Clerk organization). The operator must be a real tenant.`;
    }
    if (tenant.isOperator) {
      return `${tenant.name} is already the operator tenant (${label}).`;
    }
    const current = await tx.query.tenants.findFirst({
      where: eq(schema.tenants.isOperator, true),
      columns: { name: true, slug: true },
    });
    if (current) {
      return `${current.name} (${current.slug}) is the operator tenant already. Run --unset on it first.`;
    }

    await tx
      .update(schema.tenants)
      .set({ isOperator: true, status: "active", updatedAt: new Date() })
      .where(eq(schema.tenants.id, tenant.id));
    await tx.insert(schema.auditLog).values({
      action: "tenant.operator_set",
      tenantId: tenant.id,
      actorLabel: "operator-tenant-script",
      meta: { slug: tenant.slug, previousStatus: tenant.status },
    });
    return `${tenant.name} is now the operator tenant (${label}).`;
  });

  console.log(outcome);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
