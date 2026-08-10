import "server-only";
import { accountingMailExtension } from "@/modules/accounting/mail/extension";
import { crmMailExtension } from "@/modules/crm/mail/extension";
import { documentsMailExtension } from "@/modules/documents/mail/extension";
import { workEntityLinks } from "@/modules/work/links";
import type { EntityLinkProvider } from "./types";

/**
 * THE COMPOSITION ROOT for linkable records. The only file in
 * `src/lib/entity-links/` that may import from `src/modules/**`.
 *
 * Exactly the job `src/lib/mail-extensions/registry.ts` and
 * `src/modules/index.ts` do, and for the same reason: somebody has to name the
 * concrete implementations, and confining that to one file keeps every other
 * arrow in the dependency graph pointing one way.
 *
 * ONLY A HOST MAY IMPORT THIS. A host is a module that DECLARES an "attach
 * to…" surface and therefore has to run the wiring — mail and scheduling today.
 * Every other module is a CONTRIBUTOR, and a contributor that imported this
 * would pull in every other module through it, defeating the isolation rule by
 * one level of indirection. eslint.config.mjs enforces the split by name.
 *
 * ── A NAMING DEBT, RECORDED RATHER THAN HIDDEN ───────────────────────────────
 *
 * These objects still live at `src/modules/<slug>/mail/extension.ts`, because
 * that is where they were written when mail was the only consumer. The
 * directory now lies slightly: those entity types serve scheduling too, and
 * will serve whatever asks next.
 *
 * Moving them to `<slug>/links.ts` is a mechanical rename of three files and
 * their imports, deliberately NOT done in the same change as extracting the
 * contract — one of those is a type-level change that cannot alter behaviour,
 * and the other is a file move across a live module. Keeping them separate is
 * what makes the first one safe to review.
 */
/**
 * WORK IS BOTH A CONTRIBUTOR AND A HOST, which nothing here was before.
 *
 * It appears below as a provider, and `src/modules/work/link-ops.ts` imports
 * this file to render its own picker. Those are two different files on purpose:
 * `work/links.ts` must never import this registry, or the graph closes into a
 * cycle. eslint.config.mjs pins that with a rule aimed at that single file,
 * because the per-module rule exempts a host's whole directory and would not
 * catch it.
 *
 * It is also the first provider named `links.ts` rather than
 * `mail/extension.ts` — see the naming debt below, which it does not inherit.
 */
export const entityLinkProviders: readonly EntityLinkProvider[] = [
  accountingMailExtension,
  crmMailExtension,
  documentsMailExtension,
  workEntityLinks,
];

/** By slug, for turning a stored `extension_slug` back into code. */
export function getEntityLinkProvider(slug: string): EntityLinkProvider | null {
  return entityLinkProviders.find((p) => p.slug === slug) ?? null;
}

/**
 * Every entity type, flattened, with the provider that owns it.
 *
 * The shape a picker actually wants: it groups by type, not by module, and it
 * needs the slug to write into the link row.
 */
export function allEntityTypes(): Array<{
  provider: EntityLinkProvider;
  type: EntityLinkProvider["entityTypes"][number];
}> {
  return entityLinkProviders.flatMap((provider) =>
    provider.entityTypes.map((type) => ({ provider, type })),
  );
}
