import "server-only";
import type { Tx } from "@/db";
import type { Party } from "@/db/schema";
import { createParty, loadParty, updateParty } from "./index";
import { normalizeName } from "./names";

/**
 * The bridge between a role row that carries its own name and the party that
 * now owns that identity. TEMPORARY BY DESIGN — see the last paragraph.
 *
 * `customers.name` and `vendors.name` predate `parties.display_name`, so for
 * now the same fact is stored twice. Two copies that nobody reconciles diverge
 * the first time somebody corrects a spelling, and the CRM built on top would
 * then show a name the invoice does not. So the role's writer calls through
 * here and the two stay in step.
 *
 * WHY THE DUPLICATION IS NOT SIMPLY REMOVED NOW. Dropping `customers.name`
 * means rewriting every read site — invoices, statements, the aging report, the
 * mail extension's search and its `{{invoice.customer_name}}` placeholder, the
 * CSV and full-books exports. That is a large change with no user-visible
 * benefit, landing in the same PR as a live migration of the AR and AP tables.
 * Expand, deploy, contract: this file is the "both exist" stage, and the
 * contract stage is a slice of its own once every reader has been moved.
 */

/**
 * Mint the party behind a newly created role row.
 *
 * `kind: "organization"` IS AN ASSUMPTION, and it is the same one 0061's
 * compatibility trigger makes, deliberately — two code paths that guessed
 * differently would produce a database where a customer's kind depended on
 * which version of the app created it. A role row supplies a name and nothing
 * that distinguishes a company from a person; organization is the majority case
 * for a B2B office platform, and CRM slice 1 puts the correction one click
 * away.
 */
export async function createPartyForRole(
  tx: Tx,
  tenantId: string,
  name: string,
): Promise<Party> {
  return createParty(tx, tenantId, {
    kind: "organization",
    displayName: name,
  });
}

/**
 * Carry a role rename onto the party.
 *
 * Reads the party's CURRENT version inside the caller's transaction rather than
 * taking the version the user loaded, because the user was editing a customer
 * and never saw the party. Two concurrent renames still cannot both win: the
 * second one's `WHERE version = ...` matches nothing and `updateParty` raises
 * STALE_VERSION, so one caller is told to retry instead of one rename vanishing.
 *
 * A no-op when the name is unchanged, so an edit that only touched a phone
 * number does not burn a version or write a row.
 */
export async function syncPartyName(
  tx: Tx,
  tenantId: string,
  partyId: string,
  name: string,
): Promise<void> {
  const next = normalizeName(name);
  // An empty name is refused by the role's own validation; treating it as
  // "nothing to do" here keeps this helper from being the thing that reports it.
  if (next.length === 0) return;

  const party = await loadParty(tx, tenantId, partyId);
  if (party.displayName === next) return;

  await updateParty(tx, tenantId, {
    partyId,
    expectedVersion: party.version,
    patch: { displayName: next },
  });
}
