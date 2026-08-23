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
 * ONE WORD A FEATURE LETS YOU RENAME.
 *
 * Vocabulary is the cheapest way to express an industry difference
 * (extension-model.md §3), and until this existed the mechanism had almost
 * nothing flowing through it: three keys were declared in one profile, exactly
 * ONE of them was read by any code, and every other noun in every pack was
 * hardcoded English. Nobody — including whoever wrote the packs — could answer
 * "what words can I change?" without grepping for `labelFor`.
 *
 * A declaration is what makes the answer knowable. It gives the admin screen
 * something to list, gives a test something to check against, and gives the
 * next pack a place to say what its words are.
 */
export interface LabelDefinition {
  /** The key passed to `labelFor`. Unique across the whole product. */
  key: string;
  /** The word used when nobody has overridden it. */
  fallback: string;
  /**
   * What it names, in a sentence — shown beside the field on the admin screen,
   * because "zone" means nothing to somebody deciding whether to rename it.
   */
  describes: string;
  /** The feature that owns the word. Set by `collectLabelDefinitions`. */
  owner?: string;
  /** The feature's display name, for grouping. Set by the collector. */
  ownerName?: string;
}

/**
 * Every renameable word across the features given, sorted and attributed.
 *
 * Takes the definitions rather than reading a registry, for the same reason
 * the dependency helpers above do: the rules stay testable against fixtures
 * instead of against whatever packs happen to exist this week.
 *
 * A key declared by two features is a CONFLICT and is reported rather than
 * merged — two owners for one word means renaming it does something one of
 * them did not expect.
 */
export function collectLabelDefinitions(
  features: { slug: string; name: string; labels?: LabelDefinition[] }[],
): { labels: LabelDefinition[]; conflicts: string[] } {
  const byKey = new Map<string, LabelDefinition>();
  const conflicts: string[] = [];
  for (const feature of features) {
    for (const label of feature.labels ?? []) {
      const existing = byKey.get(label.key);
      if (existing && existing.owner !== feature.slug) {
        conflicts.push(label.key);
        continue;
      }
      byKey.set(label.key, {
        ...label,
        owner: feature.slug,
        ownerName: feature.name,
      });
    }
  }
  return {
    labels: [...byKey.values()].sort(
      (a, b) =>
        (a.ownerName ?? "").localeCompare(b.ownerName ?? "") ||
        a.key.localeCompare(b.key),
    ),
    conflicts: [...new Set(conflicts)].sort(),
  };
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

/** A renameable word with the word it currently RESOLVES to, and from where. */
export interface LabelRow extends LabelDefinition {
  /** What an empty override box means: the profile's word, or the pack's. */
  inherited: string;
  /** The profile supplying `inherited`; null when it is the pack's own word. */
  inheritedFrom: string | null;
}

/**
 * Pair each renameable word with what it actually resolves to for a tenant.
 *
 * THE MIRROR OF `resolveLabels`, and it exists because the admin screen did
 * this arithmetic in its head and got it wrong. Vocabulary has three layers —
 * the pack declares `zone`, a profile renames it to `Paddock`, the tenant may
 * rename it again — and the editor showed only the first, telling a superadmin
 * the client's word was "Zone" while every Land screen said "Paddock". Its own
 * help text then promised that clearing the box would give "Zone".
 *
 * `resolveLabels` answers "what word do I render?". This answers "and where did
 * that come from?", which is the question an editor has to answer and a
 * renderer never does. Keeping them in one file is what stops them disagreeing
 * a second time.
 */
export function labelRows(
  definitions: LabelDefinition[],
  profileLabels: Record<string, string> | null | undefined,
  profileName: string | null,
): LabelRow[] {
  return definitions.map((definition) => {
    const fromProfile = profileLabels?.[definition.key];
    // An empty string in a profile is not a rename. Same rule `resolveLabels`
    // applies, and it has to be the same or the two answers diverge.
    const overridden =
      typeof fromProfile === "string" && fromProfile !== "" ? fromProfile : null;
    return {
      ...definition,
      inherited: overridden ?? definition.fallback,
      inheritedFrom: overridden ? profileName : null,
    };
  });
}
