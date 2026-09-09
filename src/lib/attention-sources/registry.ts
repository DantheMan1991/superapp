import "server-only";
import { accountingAttentionSource } from "@/modules/accounting/attention/source";
import { schedulingAttentionSource } from "@/modules/scheduling/attention/source";
import { workAttentionSource } from "@/modules/work/attention/source";
import { livestockAttentionSource } from "@/packs/livestock/attention/source";
import { inventoryAttentionSource } from "@/packs/inventory/attention/source";
import { productionAttentionSource } from "@/packs/production/attention/source";
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
 * site visit under it.
 *
 * WORK IS SECOND, from 2026-08-09, and there is no CRM source any more.
 *
 * Follow-ups held second place for the reason Work now holds it: a real
 * assignee and a real agreed date. Work has the stronger claim, because
 * clearing the item IS the point of the record — closing it removes the line,
 * with nothing to mark read — and because it covers the whole business rather
 * than the part that happens to be a customer conversation.
 *
 * `crmAttentionSource` was DELETED in work.md slice 5b, in the same deploy that
 * copied `crm_tasks` into `work_items`. Those two cannot be separated: with the
 * rows copied and both sources registered, every follow-up would be reported
 * twice, once by each.
 *
 * PRODUCTION IS THIRD, from 2026-08-23, and it is **the first source that is a
 * PACK rather than a core module** — the composition root's job is to name
 * concrete implementations, and where they live is not a distinction it needs to
 * care about. `src/packs/**` is outside the module-isolation rules in
 * `eslint.config.mjs` (which are generated from `MODULE_SLUGS`), so no rule
 * changed; the source itself still imports only `types.ts`, exactly like the
 * three around it.
 *
 * It sits below Work because a booked slaughter date is usually weeks out and
 * Work is usually today, and above Accounting because it reaches everybody
 * rather than owners alone. Its overdue item — a date that passed with no
 * processing day recorded against it — is the strongest single line this list
 * carries, since the alternative to being told is a kill day nobody wrote down.
 *
 * LIVESTOCK IS FOURTH, from 2026-09-08 — the second pack source. It reaches
 * everybody, like production's, and sits below it because production's
 * overdue line is a kill date nobody wrote down while livestock's is a
 * missed round or a clock that needs a label read: daily chores, not dated
 * money. Above accounting for the reason production is.
 *
 * INVENTORY IS FIFTH, from 2026-09-09 — the third pack source. Below
 * livestock because a pen nobody looked at is a living thing and a bag of
 * feed below zero is a record; above accounting because four of its five
 * lines reach everybody (stock below zero, a batch past its date, an item at
 * its reorder point, a count walked and never posted) and only the fifth — a
 * delivery two months without an invoice — is the owner's.
 *
 * Accounting is last because it reaches owners only and has no per-record
 * assignee at all.
 */
export const attentionSources: readonly AttentionSource[] = [
  schedulingAttentionSource,
  workAttentionSource,
  productionAttentionSource,
  livestockAttentionSource,
  inventoryAttentionSource,
  accountingAttentionSource,
];

/** By slug, for turning a stored or logged source name back into code. */
export function getAttentionSource(slug: string): AttentionSource | null {
  return attentionSources.find((s) => s.slug === slug) ?? null;
}
