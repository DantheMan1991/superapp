import "server-only";
import { accountingAttentionSource } from "@/modules/accounting/attention/source";
import { crmAttentionSource } from "@/modules/crm/attention/source";
import { schedulingAttentionSource } from "@/modules/scheduling/attention/source";
import type { AttentionSource } from "./types";

/**
 * THE COMPOSITION ROOT. The only file in `src/lib/attention-sources/` that may
 * import from `src/modules/**`.
 *
 * Exactly the job `src/lib/mail-extensions/registry.ts` does for mail and
 * `src/modules/index.ts` does for renderers, and for the same reason: somebody
 * has to name the concrete implementations, and confining that to one file is
 * what keeps every other arrow in the dependency graph pointing one way. The
 * digest imports this; it never imports a module. A module imports `types.ts`;
 * it never imports this, and never another module.
 *
 * eslint.config.mjs carves this file out by name. If you find yourself wanting
 * to add a module import somewhere else to avoid a plumbing chore, that is the
 * rule doing its job — add the hook to `types.ts` instead.
 *
 * Registration order is section order in the digest and on the page.
 *
 * SCHEDULING LEADS from 2026-08-09. What is on today is the thing somebody
 * checks a morning email to find out, and it is the only section with a time
 * attached — a 7am digest that opens with an overdue invoice buries the 8am
 * site visit under it. Follow-ups keep second place for the reason they used to
 * hold first: they are the items with a real assignee. Accounting is last
 * because it reaches owners only and has no per-record assignee at all.
 */
export const attentionSources: readonly AttentionSource[] = [
  schedulingAttentionSource,
  crmAttentionSource,
  accountingAttentionSource,
];

/** By slug, for turning a stored or logged source name back into code. */
export function getAttentionSource(slug: string): AttentionSource | null {
  return attentionSources.find((s) => s.slug === slug) ?? null;
}
