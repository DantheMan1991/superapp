import "dotenv/config";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { neonConfig, Pool } from "@neondatabase/serverless";
import ws from "ws";

/**
 * Creates (or re-keys) the `app_user` database role the application connects
 * as. Neon's default owner role has BYPASSRLS — it ignores row-level
 * security — so the app must NOT run as it. This script:
 *
 *   1. connects with the owner URL (DATABASE_URL_OWNER, or DATABASE_URL on
 *      first run),
 *   2. creates role `app_user` with a fresh random password and no RLS
 *      bypass, granting it CRUD on all current and future tables,
 *   3. rewrites .env so DATABASE_URL is the app_user connection (runtime)
 *      and DATABASE_URL_OWNER keeps the owner connection (migrations).
 *
 * Idempotent: re-running rotates the app_user password and refreshes grants.
 */
async function main() {
  const envPath = ".env";
  let envText: string;
  try {
    envText = readFileSync(envPath, "utf8");
  } catch {
    console.error("No .env file found. Copy .env.example to .env first.");
    process.exit(1);
  }

  const get = (name: string) =>
    envText
      .split(/\r?\n/)
      .find((l) => l.startsWith(name + "="))
      ?.slice(name.length + 1)
      .trim() ?? "";

  const ownerUrl = get("DATABASE_URL_OWNER") || get("DATABASE_URL");
  if (!ownerUrl) {
    console.error("DATABASE_URL is not set in .env.");
    process.exit(1);
  }

  let parsed: URL;
  try {
    parsed = new URL(ownerUrl);
  } catch {
    console.error("DATABASE_URL doesn't look like a valid connection string.");
    process.exit(1);
  }
  if (decodeURIComponent(parsed.username) === "app_user") {
    console.error(
      "The owner URL already uses app_user — set DATABASE_URL_OWNER to the " +
        "original owner (neondb_owner) connection string and re-run.",
    );
    process.exit(1);
  }

  if (!globalThis.WebSocket) neonConfig.webSocketConstructor = ws;
  const pool = new Pool({ connectionString: ownerUrl });

  const password = randomBytes(24).toString("base64url");
  // Identifier is fixed and the password is generated here — nothing
  // user-controlled is interpolated.
  const roleExists =
    (
      await pool.query(
        "select 1 from pg_roles where rolname = 'app_user'",
      )
    ).rowCount! > 0;

  if (roleExists) {
    await pool.query(`ALTER ROLE app_user WITH LOGIN PASSWORD '${password}'`);
    console.log("app_user role exists — password rotated.");
  } else {
    await pool.query(
      `CREATE ROLE app_user WITH LOGIN PASSWORD '${password}' NOCREATEDB NOCREATEROLE`,
    );
    console.log("app_user role created.");
  }

  await pool.query(`GRANT USAGE ON SCHEMA public TO app_user`);
  await pool.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user`,
  );
  await pool.query(
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user`,
  );
  await pool.query(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user`,
  );
  await pool.query(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_user`,
  );

  const check = await pool.query(
    `select rolbypassrls from pg_roles where rolname = 'app_user'`,
  );
  if (check.rows[0]?.rolbypassrls) {
    console.error("Unexpected: app_user has BYPASSRLS. Aborting.");
    process.exit(1);
  }
  await pool.end();

  const appUrl = new URL(ownerUrl);
  appUrl.username = "app_user";
  appUrl.password = password;

  const setLine = (text: string, name: string, value: string) => {
    const line = `${name}=${value}`;
    const re = new RegExp(`^${name}=.*$`, "m");
    if (re.test(text)) return text.replace(re, line);
    return text.trimEnd() + "\r\n" + line + "\r\n";
  };

  envText = setLine(envText, "DATABASE_URL", appUrl.toString());
  envText = setLine(envText, "DATABASE_URL_OWNER", ownerUrl);
  writeFileSync(envPath, envText);

  console.log(
    "\n.env updated:\n" +
      "  DATABASE_URL        → app_user (runtime; RLS enforced)\n" +
      "  DATABASE_URL_OWNER  → owner (migrations/seeds only)\n" +
      "\nRestart the dev server to pick up the change.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
