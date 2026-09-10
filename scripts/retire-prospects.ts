import "dotenv/config";

/**
 * Retire the prospect rows (ADR 0041, back-office slice 3): a business with
 * no workspace behind it is a party in the operator's CRM now, never a
 * `tenants` row. This lists what is left and, on `--delete`, removes it.
 *
 *   npm run db:retire-prospects                dry run, production
 *   npm run db:retire-prospects -- --dev       dry run, the Neon dev branch
 *   npm run db:retire-prospects -- --delete    delete, production
 *
 * Dry run by default because this is a judgment the founder makes once: the
 * rows on production were test residue, but the script cannot know that.
 * What is safe to say: no discovery record cascades from these rows any
 * more — slice 2 moved every audit into the operator tenant and kept the
 * origin as a breadcrumb — and their `subscriptions` rows go with them.
 * The audit log records each deletion by slug.
 */

const argv = process.argv.slice(2);
const wantsDev = argv.includes("--dev");
const wantsDelete = argv.includes("--delete");

function resolveUrl(): { url: string; label: string } {
  if (wantsDev) {
    const url = process.env.TEST_DATABASE_URL;
    if (!url) {
      console.error("--dev needs TEST_DATABASE_URL set (the Neon dev branch).");
      process.exit(1);
    }
    if (url === process.env.DATABASE_URL) {
      console.error("REFUSING: TEST_DATABASE_URL points at the same database as DATABASE_URL.");
      process.exit(1);
    }
    return { url, label: "dev branch" };
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }
  return { url, label: "production" };
}

async function main() {
  const { url, label } = resolveUrl();
  process.env.DATABASE_URL = url;
  const { withSystem, schema } = await import("../src/db");
  const { eq, isNull } = await import("drizzle-orm");

  const rows = await withSystem((tx) =>
    tx.query.tenants.findMany({
      where: isNull(schema.tenants.clerkOrgId),
      columns: { id: true, slug: true, name: true, status: true, createdAt: true },
      orderBy: (t, { asc }) => [asc(t.createdAt)],
    }),
  );
  if (rows.length === 0) {
    console.log(`No prospect rows on the ${label}. Nothing to retire.`);
    return;
  }
  console.log(`${rows.length} prospect row${rows.length === 1 ? "" : "s"} on the ${label}:`);
  for (const r of rows) {
    console.log(`  ${r.slug.padEnd(32)} ${r.name.padEnd(28)} ${r.status}  since ${r.createdAt.toISOString().slice(0, 10)}`);
  }
  if (!wantsDelete) {
    console.log("Dry run. Add --delete to remove them.");
    return;
  }

  await withSystem(async (tx) => {
    for (const r of rows) {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, r.id));
      await tx.insert(schema.auditLog).values({
        action: "tenant.prospect_retired",
        tenantId: null,
        actorLabel: "retire-prospects-script",
        targetType: "tenant",
        targetId: r.id,
        meta: { slug: r.slug, name: r.name },
      });
    }
  });
  console.log(`Deleted ${rows.length} on the ${label}.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
