import "dotenv/config";
import { neonConfig, Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { migrate } from "drizzle-orm/neon-serverless/migrator";
import ws from "ws";

async function main() {
  // Migrations run as the database owner; the app itself runs as app_user
  // (no RLS bypass) — see scripts/create-app-role.ts.
  const url = process.env.DATABASE_URL_OWNER || process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. Copy .env.example to .env and fill it in.");
    process.exit(1);
  }
  if (!globalThis.WebSocket) {
    neonConfig.webSocketConstructor = ws;
  }
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool);
  console.log("Running migrations…");
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Migrations complete.");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
