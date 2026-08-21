/**
 * Layer 0 schema — the whole database, one file per domain.
 *
 * Every tenant-scoped table carries tenant_id and is protected by Postgres
 * Row-Level Security (see drizzle/0001_rls.sql). App code must additionally
 * scope every query through withTenant() — defense in depth, neither layer
 * is trusted alone.
 *
 * This barrel exists so that `@/db/schema` keeps resolving for the ~112
 * modules that import it, and so `drizzle({ schema })` still sees every
 * table. Add a new domain file here when you add one.
 */

export * from "./platform";
export * from "./parties";
export * from "./ledger";
export * from "./invoicing";
export * from "./banking";
export * from "./documents";
export * from "./mail";
export * from "./payables";
export * from "./close";
export * from "./retainer";
export * from "./interview";
export * from "./crm";
export * from "./scheduling";
export * from "./work";
// Layer 2a — pack-owned tables. Same rules as any domain above; the separation
// that matters is in `src/packs/`, where the code lives.
export * from "./assets";
export * from "./land";
export * from "./inventory";
export * from "./livestock";
export * from "./production";
export * from "./retail";
