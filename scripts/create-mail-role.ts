import "dotenv/config";
import { randomBytes } from "node:crypto";
import { neonConfig, Pool } from "@neondatabase/serverless";
import ws from "ws";

/**
 * Creates (or re-keys) the `stalwart_directory` database role that the MAIL
 * SERVER connects as.
 *
 * Stalwart authenticates its users against an external SQL directory, which is
 * what lets a mailbox be provisioned by writing a row instead of calling
 * somebody's API. The cost is that an internet-facing mail server now holds
 * database credentials, and that is the single largest new attack surface on
 * the platform.
 *
 * This role is therefore built to be almost useless:
 *
 *   - SELECT on `mail_directory_accounts` and nothing else. That table holds
 *     addresses and password hashes; no invoice, no document, no ledger.
 *   - No INSERT, UPDATE or DELETE anywhere. The directory is read-only to the
 *     mail server; Yosher is the only writer.
 *   - Not covered by the ALTER DEFAULT PRIVILEGES that grants app_user every
 *     future table, so tables added later are invisible to it by default rather
 *     than by somebody remembering.
 *   - No RLS bypass, and an RLS policy keyed on current_user as a second
 *     independent bound (drizzle/0042).
 *
 * The script then PROVES the boundary rather than asserting it: it connects as
 * the new role and confirms it can read the directory and cannot read tenants.
 * A grant that was silently wider than intended fails here instead of in
 * production.
 *
 * Idempotent: re-running rotates the password and refreshes grants.
 *
 *   npm run db:create-mail-role
 */

const ROLE = "stalwart_directory";
const DIRECTORY_TABLE = "mail_directory_accounts";

async function main() {
  const ownerUrl = process.env.DATABASE_URL_OWNER || process.env.DATABASE_URL;
  if (!ownerUrl) {
    console.error("DATABASE_URL_OWNER is not set. See SETUP.md.");
    process.exit(1);
  }

  if (!globalThis.WebSocket) neonConfig.webSocketConstructor = ws;
  const pool = new Pool({ connectionString: ownerUrl });

  const password = randomBytes(24).toString("base64url");
  // The identifier is a fixed constant and the password is generated here —
  // nothing user-controlled is interpolated into these statements.
  const exists =
    (await pool.query(`select 1 from pg_roles where rolname = '${ROLE}'`))
      .rowCount! > 0;

  if (exists) {
    await pool.query(`ALTER ROLE ${ROLE} WITH LOGIN PASSWORD '${password}'`);
    console.log(`${ROLE} exists — password rotated.`);
  } else {
    await pool.query(
      `CREATE ROLE ${ROLE} WITH LOGIN PASSWORD '${password}' NOCREATEDB NOCREATEROLE NOSUPERUSER`,
    );
    console.log(`${ROLE} created.`);
  }

  // Start from nothing every run, so a grant added by hand during debugging
  // does not survive into the next rotation.
  await pool.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${ROLE}`);
  await pool.query(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${ROLE}`);
  await pool.query(`REVOKE ALL ON SCHEMA public FROM ${ROLE}`);

  await pool.query(`GRANT USAGE ON SCHEMA public TO ${ROLE}`);
  await pool.query(`GRANT SELECT ON ${DIRECTORY_TABLE} TO ${ROLE}`);

  const bypass = await pool.query(
    `select rolbypassrls from pg_roles where rolname = '${ROLE}'`,
  );
  if (bypass.rows[0]?.rolbypassrls) {
    console.error(`Unexpected: ${ROLE} has BYPASSRLS. Aborting.`);
    process.exit(1);
  }

  const granted = await pool.query(
    `select table_name, privilege_type
       from information_schema.role_table_grants
      where grantee = '${ROLE}'
      order by table_name, privilege_type`,
  );
  await pool.end();

  const unexpected = granted.rows.filter(
    (r: { table_name: string; privilege_type: string }) =>
      r.table_name !== DIRECTORY_TABLE || r.privilege_type !== "SELECT",
  );
  if (unexpected.length > 0) {
    console.error(
      `\n✗ ${ROLE} has grants beyond SELECT on ${DIRECTORY_TABLE}:\n` +
        unexpected
          .map(
            (r: { table_name: string; privilege_type: string }) =>
              `    ${r.privilege_type} on ${r.table_name}`,
          )
          .join("\n"),
    );
    process.exit(1);
  }

  // Prove it, rather than trusting the grant table.
  const roleUrl = new URL(ownerUrl);
  roleUrl.username = ROLE;
  roleUrl.password = password;
  const rolePool = new Pool({ connectionString: roleUrl.toString() });

  try {
    await rolePool.query(`select 1 from ${DIRECTORY_TABLE} limit 1`);
    console.log(`✓ ${ROLE} can read ${DIRECTORY_TABLE}.`);
  } catch (err) {
    console.error(
      `✗ ${ROLE} cannot read ${DIRECTORY_TABLE} — the mail server would be ` +
        `unable to authenticate anyone.\n  ${err instanceof Error ? err.message : err}`,
    );
    await rolePool.end();
    process.exit(1);
  }

  let leaked: string | null = null;
  for (const table of ["tenants", "documents", "invoices", "mail_accounts"]) {
    try {
      await rolePool.query(`select 1 from ${table} limit 1`);
      leaked = table;
      break;
    } catch {
      // Expected: permission denied.
    }
  }
  await rolePool.end();

  if (leaked) {
    console.error(
      `\n✗ ${ROLE} can read "${leaked}". The mail server must never see ` +
        `tenant data. Aborting before this is put into service.`,
    );
    process.exit(1);
  }
  console.log(`✓ ${ROLE} is blind to tenant tables.`);

  console.log(
    "\n" +
      "─".repeat(72) +
      "\nConnection string for the mail server's SQL directory —\n" +
      "shown ONCE, not written to .env, because it belongs in Stalwart's\n" +
      "config and not in this application's environment:\n\n" +
      `  ${roleUrl.toString()}\n\n` +
      "Paste it into Stalwart now, then clear your terminal scrollback.\n" +
      "Re-run this script to rotate if it is ever exposed.\n" +
      "─".repeat(72),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
