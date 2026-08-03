import "server-only";
import type { Tx } from "@/db";
import { getActiveModules } from "@/lib/modules";
import { mailExtensions } from "./registry";
import type {
  LinkableEntity,
  LinkableEntityRef,
  MailEntityType,
  MailExtension,
  MailExtensionCtx,
  MailContactCandidate,
  MailImageCandidate,
} from "./types";

/**
 * Running the extensions: which ones apply, what they can find, and what a
 * stored link actually points at.
 *
 * Everything here is defensive in one direction. An extension is trusted code —
 * there is no runtime sandbox between modules and there never was (security.md
 * §7) — but it is code somebody else wrote, running inside the request that
 * paints a person's inbox. So a slow one, a throwing one, or one whose module
 * was switched off between page loads must cost its own panel and nothing more.
 * The inbox has to render.
 *
 * What is NOT defensive, deliberately: nothing here re-checks what an extension
 * is allowed to see. It cannot see anything, because it is handed the caller's
 * own `tx` and RLS has already decided. Adding an application-level filter on
 * top would be a second place for that rule to be wrong.
 */

/**
 * Long enough that a real query on a cold connection finishes; short enough that
 * a wedged one does not hold the reading pane. Chips are decoration on a message
 * that has already been fetched — the message renders either way.
 */
const EXTENSION_TIMEOUT_MS = 2_500;

/** Per entity type, per search. The picker is for finding, not for browsing. */
export const SEARCH_LIMIT_PER_TYPE = 6;

/**
 * Race a hook against the clock and never let it reject.
 *
 * The loser keeps running — there is no way to cancel a promise — so its
 * eventual rejection is swallowed explicitly. Without that, a slow extension
 * that also fails would surface as an unhandled rejection long after the
 * response went out, in a request nobody can identify.
 */
async function guarded<T>(
  label: string,
  fallback: T,
  work: () => Promise<T>,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const started = work().catch((err) => {
      console.error(`mail extension ${label} failed`, err);
      return fallback;
    });
    const timeout = new Promise<T>((resolve) => {
      timer = setTimeout(() => {
        console.error(`mail extension ${label} timed out`);
        resolve(fallback);
      }, EXTENSION_TIMEOUT_MS);
    });
    return await Promise.race([started, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * The extensions that apply to this tenant right now.
 *
 * An extension whose module is switched off contributes nothing — no picker
 * section, no chips — while its `mail_links` rows sit untouched in the database
 * and light up again the day the module is switched back on. That is the
 * property `entity_type` carrying no whitelist was for: an uninstalled layer's
 * links are ignored, never invalid.
 *
 * `requireModuleEnabled` is an entitlement check and not a security boundary
 * (security.md §7), so this is about what a tenant has bought, not about what
 * they may read. RLS decides the latter, further down.
 */
export async function enabledMailExtensions(
  tenantId: string,
): Promise<MailExtension[]> {
  const active = await getActiveModules(tenantId);
  const enabled = new Set(active.map((m) => m.module.id));
  return mailExtensions.filter((e) => enabled.has(e.moduleSlug));
}

/** entity_type → the extension and type that owns it. */
export function entityTypeIndex(
  extensions: readonly MailExtension[],
): Map<string, { extension: MailExtension; entityType: MailEntityType }> {
  const index = new Map<
    string,
    { extension: MailExtension; entityType: MailEntityType }
  >();
  for (const extension of extensions) {
    for (const entityType of extension.entityTypes) {
      // First registration wins. Two extensions claiming one type is a bug in
      // the registry, not something to resolve at runtime by guessing.
      if (!index.has(entityType.type)) index.set(entityType.type, { extension, entityType });
    }
  }
  return index;
}

/** The one extension that files published copies, if its module is on. */
export function filingTargetFor(
  extensions: readonly MailExtension[],
): MailExtension | null {
  return extensions.find((e) => e.filing) ?? null;
}

/**
 * Every extension the composer can insert a picture from, if its module is on.
 *
 * A LIST rather than the single answer `filingTargetFor` gives, even though only
 * Documents implements it today: filing has to pick one destination and this
 * does not, so a second source (an industry pack's photo library, say) is a
 * registry entry rather than a decision about which one wins.
 */
export function imageSourcesFrom(
  extensions: readonly MailExtension[],
): MailExtension[] {
  return extensions.filter((e) => e.images);
}

/** Images from every source, each behind its own timeout. */
export async function searchInsertableImages(
  tx: Tx,
  ctx: MailExtensionCtx,
  query: string,
  limit: number,
): Promise<{ extensionSlug: string; label: string; images: MailImageCandidate[] }[]> {
  const sources = imageSourcesFrom(await enabledMailExtensions(ctx.tenantId));
  const groups = await Promise.all(
    sources.map(async (extension) => ({
      extensionSlug: extension.slug,
      label: extension.images!.label,
      images: await guarded<MailImageCandidate[]>(
        `${extension.slug}.images.search`,
        [],
        () => extension.images!.search(tx, ctx, query, limit),
      ),
    })),
  );
  return groups.filter((g) => g.images.length > 0);
}

/** Every extension that can offer people, if its module is on. */
export function contactSourcesFrom(
  extensions: readonly MailExtension[],
): MailExtension[] {
  return extensions.filter((e) => e.contacts);
}

/**
 * People from every contributing module, each behind its own timeout.
 *
 * Flattened rather than grouped, unlike the image sources: a recipient
 * autocomplete is one ranked list, and which module supplied a row is a
 * sublabel rather than a heading. `contacts/rank.ts` does the ordering.
 */
export async function searchExtensionContacts(
  tx: Tx,
  ctx: MailExtensionCtx,
  query: string,
  limit: number,
): Promise<MailContactCandidate[]> {
  const sources = contactSourcesFrom(await enabledMailExtensions(ctx.tenantId));
  const groups = await Promise.all(
    sources.map((extension) =>
      guarded<MailContactCandidate[]>(
        `${extension.slug}.contacts.search`,
        [],
        () => extension.contacts!.search(tx, ctx, query, limit),
      ),
    ),
  );
  return groups.flat();
}

export interface SearchGroup {
  extensionSlug: string;
  entityType: string;
  label: string;
  pluralLabel: string;
  icon: string;
  results: LinkableEntity[];
}

/**
 * Everything a thread could be attached to, matching `query`.
 *
 * Every registered type is searched concurrently, each behind its own timeout,
 * so the picker's shape does not depend on which module answers fastest and one
 * slow table cannot stall the rest.
 */
export async function searchLinkTargets(
  tx: Tx,
  ctx: MailExtensionCtx,
  extensions: readonly MailExtension[],
  query: string,
  limit = SEARCH_LIMIT_PER_TYPE,
): Promise<SearchGroup[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];

  const jobs: Promise<SearchGroup>[] = [];
  for (const extension of extensions) {
    for (const entityType of extension.entityTypes) {
      jobs.push(
        guarded(
          `${extension.slug}:${entityType.type}:search`,
          [] as LinkableEntity[],
          () => entityType.search(tx, ctx, trimmed, limit),
        ).then((results) => ({
          extensionSlug: extension.slug,
          entityType: entityType.type,
          label: entityType.label,
          pluralLabel: entityType.pluralLabel,
          icon: entityType.icon,
          // Trusting an extension's own limit would let one type flood the
          // picker; truncating here keeps the shape predictable.
          results: results.slice(0, limit),
        })),
      );
    }
  }

  const settled = await Promise.allSettled(jobs);
  return settled
    .filter(
      (s): s is PromiseFulfilledResult<SearchGroup> => s.status === "fulfilled",
    )
    .map((s) => s.value)
    .filter((g) => g.results.length > 0);
}

/**
 * Turn stored `(entity_type, entity_id)` pairs into things a person recognises.
 *
 * ONE call per entity type, not one per link — the batching that stops a thread
 * with six links becoming six round trips behind the reading pane.
 *
 * Refs whose type belongs to a switched-off module, or whose row RLS will not
 * show this caller, come back absent. The caller decides what to render for
 * them; here they are simply not found, which is also the only non-leaking
 * answer (a "restricted" state would confirm the row exists).
 */
export async function resolveLinkEntities(
  tx: Tx,
  ctx: MailExtensionCtx,
  extensions: readonly MailExtension[],
  refs: readonly LinkableEntityRef[],
): Promise<Map<string, LinkableEntity>> {
  const out = new Map<string, LinkableEntity>();
  if (refs.length === 0) return out;

  const index = entityTypeIndex(extensions);
  const byType = new Map<string, Set<string>>();
  for (const ref of refs) {
    if (!index.has(ref.entityType)) continue;
    const ids = byType.get(ref.entityType) ?? new Set<string>();
    ids.add(ref.entityId);
    byType.set(ref.entityType, ids);
  }

  const jobs = [...byType.entries()].map(([type, ids]) => {
    const entry = index.get(type)!;
    return guarded(
      `${entry.extension.slug}:${type}:resolve`,
      [] as LinkableEntity[],
      () => entry.entityType.resolve(tx, ctx, [...ids]),
    );
  });

  for (const settled of await Promise.allSettled(jobs)) {
    if (settled.status !== "fulfilled") continue;
    for (const entity of settled.value) {
      out.set(entityKey(entity), entity);
    }
  }
  return out;
}

/** The map key both sides of `resolveLinkEntities` agree on. */
export function entityKey(ref: LinkableEntityRef): string {
  return `${ref.entityType}:${ref.entityId}`;
}

/**
 * Every entity type that contributes template placeholders.
 *
 * TWO CALLERS AND THEY WANT DIFFERENT ANSWERS, which is why this takes the
 * extensions rather than reaching for the registry itself:
 *
 *   • the template editor and the save action pass the tenant's ENABLED
 *     extensions, so the list offered is the list that can actually be filled;
 *   • the send guard passes `allTemplateContributors()`, because a body
 *     carrying `{{invoice.number}}` in a tenant that has since switched
 *     Accounting off must still be refused rather than sent as literal braces.
 */
export function templateContributors(
  extensions: readonly MailExtension[],
): MailEntityType[] {
  return extensions.flatMap((e) =>
    e.entityTypes.filter((t) => (t.templateFields?.length ?? 0) > 0),
  );
}

/**
 * The same, over the whole static registry — every namespace that exists in
 * this build, regardless of what any tenant has switched on.
 *
 * Deliberately does NOT consult the database: recognizing a placeholder is a
 * question about the code, and making it a question about configuration is what
 * opened the hole described above.
 */
export function allTemplateContributors(): MailEntityType[] {
  return templateContributors(mailExtensions);
}
