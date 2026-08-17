import "dotenv/config";
import { neonConfig, Pool } from "@neondatabase/serverless";
import ws from "ws";

async function main() {
  neonConfig.webSocketConstructor = ws as never;
  const dev = process.argv.includes("--dev");
  const pool = new Pool({ connectionString: dev ? process.env.TEST_DATABASE_URL_OWNER : process.env.DATABASE_URL_OWNER });
  const q = async (sql: string) => (await pool.query(sql)).rows;
  console.log(dev ? "DEV" : "APP", "nullable:", await q(`select table_name, is_nullable from information_schema.columns where column_name='entity_id' and table_name in ('invoices','bills','bank_accounts','journal_entries') order by 1`));
  console.log("nulls:", await q(`select
    (select count(*)::int from invoices where entity_id is null) as invoices,
    (select count(*)::int from bills where entity_id is null) as bills,
    (select count(*)::int from bank_accounts where entity_id is null) as bank_accounts`));
  console.log("tenants without a company:", await q(`select count(*)::int as n from tenants t where not exists (select 1 from entities e where e.tenant_id=t.id)`));
  await pool.end();
}
main();
