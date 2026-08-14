/**
 * Dependency and vocabulary resolution for Layer 2. PURE — no `server-only`,
 * no database, no registry import.
 *
 * It takes a dependency graph rather than reading `packRegistry` so the rules
 * can be tested against fixtures instead of against whatever packs happen to
 * exist this week. The real graph is adapted in `src/lib/features.ts`.
 */

/** slug → the slugs it requires. Core modules appear with an empty array. */
export type DependencyGraph = Record<string, string[]>;

export class DependencyCycleError extends Error {
  constructor(readonly cycle: string[]) {
    super(`Dependency cycle: ${cycle.join(" → ")}`);
    this.name = "DependencyCycleError";
  }
}

function requirementsOf(graph: DependencyGraph, slug: string): string[] {
  return graph[slug] ?? [];
}

/**
 * What must be switched on before `slug` can be, given what already is.
 *
 * Direct requirements only. Transitive ones are covered because a dependency
 * cannot itself have been enabled with ITS requirements missing — the check
 * runs on every enable, so the invariant holds inductively rather than needing
 * a full walk here.
 */
export function missingRequirements(
  slug: string,
  enabled: Iterable<string>,
  graph: DependencyGraph,
): string[] {
  const on = new Set(enabled);
  return requirementsOf(graph, slug).filter((dep) => !on.has(dep));
}

/**
 * Enabled features that would be left with a missing requirement if `slug`
 * were switched off. Non-empty means the disable must be refused.
 */
export function blockingDependents(
  slug: string,
  enabled: Iterable<string>,
  graph: DependencyGraph,
): string[] {
  return [...enabled]
    .filter((other) => other !== slug)
    .filter((other) => requirementsOf(graph, other).includes(slug))
    .sort();
}

/**
 * Order `slugs` so every dependency precedes its dependents.
 *
 * Only orders the given set. Requirements outside it are ignored rather than
 * pulled in — a profile listing a pack whose dependency it does not also list
 * is a configuration error, and `unlistedRequirements` reports it separately.
 * Silently installing a pack the profile never asked for would be the worse
 * failure: the tenant ends up with something nobody chose.
 *
 * Deterministic: ties break alphabetically, so the same profile always
 * installs in the same order and an audit trail is comparable across tenants.
 *
 * @throws {DependencyCycleError} if the graph cannot be ordered.
 */
export function installOrder(
  slugs: string[],
  graph: DependencyGraph,
): string[] {
  const wanted = new Set(slugs);
  const ordered: string[] = [];
  const done = new Set<string>();
  const visiting: string[] = [];

  function visit(slug: string) {
    if (done.has(slug)) return;
    const cycleStart = visiting.indexOf(slug);
    if (cycleStart !== -1) {
      throw new DependencyCycleError([...visiting.slice(cycleStart), slug]);
    }
    visiting.push(slug);
    for (const dep of [...requirementsOf(graph, slug)].sort()) {
      if (wanted.has(dep)) visit(dep);
    }
    visiting.pop();
    done.add(slug);
    ordered.push(slug);
  }

  for (const slug of [...wanted].sort()) visit(slug);
  return ordered;
}

/**
 * Requirements of the given packs that the list itself does not include.
 *
 * A profile should say what it means, so this is reported to the caller as a
 * refusal rather than repaired. Returns sorted unique slugs; empty is valid.
 */
export function unlistedRequirements(
  slugs: string[],
  graph: DependencyGraph,
): string[] {
  const listed = new Set(slugs);
  const missing = new Set<string>();
  for (const slug of slugs) {
    for (const dep of requirementsOf(graph, slug)) {
      if (!listed.has(dep)) missing.add(dep);
    }
  }
  return [...missing].sort();
}

/**
 * Vocabulary for a tenant: the profile's labels, overridden per tenant.
 *
 * TOTAL BY CONSTRUCTION, and that is load-bearing. `tenant_modules.config` is
 * jsonb with no shape constraint, and `tenants.industry` defaults to `general`
 * — a slug with no manifest — so the degraded path is the COMMON one and runs
 * for every tenant that has never installed a profile. Anything that is not a
 * plain string is dropped individually; nothing here throws. Same discipline as
 * `parseWorkView` in the Work module, and for the same reason: a corrupted row
 * must at worst mean default labels, never a crashed page.
 */
export function resolveLabels(
  base: Record<string, string> | null | undefined,
  overrides?: unknown,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(base ?? {})) {
    if (typeof value === "string" && value !== "") out[key] = value;
  }
  if (overrides && typeof overrides === "object" && !Array.isArray(overrides)) {
    for (const [key, value] of Object.entries(
      overrides as Record<string, unknown>,
    )) {
      if (typeof value === "string" && value !== "") out[key] = value;
    }
  }
  return out;
}

/** A label, or the core word when no profile supplies one. */
export function labelFor(
  labels: Record<string, string>,
  key: string,
  fallback: string,
): string {
  return labels[key] ?? fallback;
}
