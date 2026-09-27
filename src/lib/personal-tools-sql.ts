import { sql, type SQL } from "drizzle-orm";
import { PERSONAL_CATEGORY } from "./personal-space-core";

/**
 * SWITCHING ON A PERSONAL SPACE'S TOOLS (ADR 0111), as SQL both halves can run.
 *
 * Its own file, with no `server-only` and no database client, because two very
 * different callers need exactly the same statement: `provisionPersonalSpace`
 * inside the app, when a space is made, and `scripts/seed.ts`, which opens its
 * own pool and cannot import the app's server code. One statement, one source:
 * a copy in each would drift, and the drift would be a tool that some spaces
 * have and some do not.
 *
 * Both only ever ADD rows — `on conflict do nothing` — so a tool the person has
 * switched off (a row with `enabled = false`) stays off. And both enable
 * `available` tools only, with ONE exception below.
 *
 * **A superadmin's own space previews `coming_soon` personal tools.** The
 * people building a tool use it before anybody else does — the same rule that
 * opens the "Personal space" door to superadmins first (`personalSpacesOpen`).
 * Fitness shipped this way (F1, 2026-09-27): the founder's space only, until
 * workout mode. The seed never previews; it reaches every space, so it waits
 * for `available`.
 */

/**
 * Every available personal tool — and, with `preview`, every coming-soon one —
 * on, in ONE space. Returns the ids it added.
 */
export function ensurePersonalToolsSql(
  tenantId: string,
  opts: { preview?: boolean } = {},
): SQL {
  const statuses = opts.preview ? ["available", "coming_soon"] : ["available"];
  return sql`
    insert into tenant_modules (tenant_id, module_id, enabled, enabled_at)
    select ${tenantId}::uuid, m.id, true, now()
      from modules m
     where m.category = ${PERSONAL_CATEGORY}
       and m.status::text in (${sql.join(
         statuses.map((s) => sql`${s}`),
         sql`, `,
       )})
    on conflict (tenant_id, module_id) do nothing
    returning module_id
  `;
}

/**
 * The same, in EVERY personal space — the seed's half. A tool that ships after
 * somebody made their space reaches them the next time the seed runs, which is
 * the ritual a new catalogue row already requires (AGENTS.md, Commands).
 * Without this, a new row would reach only the spaces made after it: the
 * "seeded rows do not follow the seed" trap.
 */
export const enablePersonalToolsEverywhereSql: SQL = sql`
  insert into tenant_modules (tenant_id, module_id, enabled, enabled_at)
  select t.id, m.id, true, now()
    from tenants t
    cross join modules m
   where t.kind = 'personal'
     and m.category = ${PERSONAL_CATEGORY}
     and m.status = 'available'
  on conflict (tenant_id, module_id) do nothing
  returning module_id
`;
