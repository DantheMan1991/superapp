import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  // The barrel — it re-exports every per-domain file under src/db/schema/,
  // so drizzle-kit still sees the whole schema from one entry point.
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: (process.env.DATABASE_URL_OWNER || process.env.DATABASE_URL)!,
  },
  verbose: true,
  strict: true,
});
