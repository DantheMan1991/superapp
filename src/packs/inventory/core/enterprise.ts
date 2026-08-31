/**
 * Which line of business a movement's cost belongs to. PURE — no database.
 *
 * **THE WHOLE OF SLICE 3 IS THIS ONE RULE PLUS PLUMBING**, so it is worth
 * having somewhere it can be read and tested without a transaction.
 *
 * ── THE RULE, AND THE ORDER IS THE POINT ────────────────────────────────────
 *
 * **1. WHAT CONSUMED IT WINS.** The enterprises dossier states this as the rule
 * slice 3 rests on: *"Grower crumble" belongs to no one part of a business
 * while the pen it was fed to belongs to exactly one.* Feed is the case that
 * makes it obvious — a bag of crumble is not a Broilers cost while it sits in
 * the bin and is one the moment it goes down a pen's throat — but it holds for
 * everything issued to a lot. `issued_to_lot_id` is the column that closes the
 * livestock costing loop, and this is the same join answering a money question.
 *
 * **2. THEN THE BATCH.** A lot inherits its item's tag when it is created, so
 * by the time a movement happens the batch already knows, and a batch that
 * genuinely belongs elsewhere has overridden it. `createLot` is where that
 * decision is made and this is where it is spent.
 *
 * **3. THEN THE ITEM, BUT ONLY WITH NO BATCH AT ALL.** Cartons and baling twine
 * are stocked without lineage and the item tag is the only thing there is.
 *
 * **A BATCH DOES NOT FALL BACK TO ITS ITEM, AND THAT IS DELIBERATE.** It is the
 * one place here somebody could reasonably choose the other way, so: a stored
 * `null` on a lot cannot be told apart from "the item was untagged when this
 * batch was made", and falling back would therefore override somebody who
 * explicitly said none. That is a wrong number posted quietly, which this pack
 * refuses everywhere else it comes up — `resolveServicesAccruedAccount` puts it
 * as *"an entry landing in the wrong account is worse than no entry, because it
 * is wrong quietly."* An untagged batch posting to Unassigned is INCOMPLETE,
 * which is visible on the P&L, askable with the filter bar's "Not set" pill and
 * fixable by tagging the batch. Being incomplete beats being confidently wrong.
 *
 * **NOTHING HERE READS A DIMENSION MEMBER.** It returns an ENTERPRISE id; the
 * translation to the member id a journal line is tagged with is
 * `enterpriseMemberIds` in `src/lib/enterprises/`, and it is over there so a
 * pack never reaches into core's tables.
 */

/** The three tags in play when stock moves. `null` means nothing said. */
export interface MovementEnterprises {
  /** The item's own tag. Used only when there is no batch. */
  itemEnterpriseId: string | null;
  /** The batch the stock came from, or null for lot-less stock. */
  lotEnterpriseId: string | null;
  /** The batch it was issued TO — a pen eating a delivery of feed. */
  consumerEnterpriseId: string | null;
  /** Whether the movement named a batch at all. See the note on the fallback. */
  hasLot: boolean;
}

/**
 * **THE TWO SIDES OF A MOVEMENT DO NOT ALWAYS BELONG TO THE SAME LINE OF
 * BUSINESS, and assuming they did produced a number that was not true.**
 *
 * The first version of this tagged both journal lines with the cost bearer, on
 * the precedent of `assets` doing exactly that for depreciation. It is wrong
 * here, and the difference is that depreciation has no second party: an
 * asset's expense and its accumulated depreciation are the same asset's, always.
 * A stock issue can cross enterprises, and the case is the ordinary one —
 * untagged feed going down a Broilers pen's throat posts:
 *
 * ```
 * Dr 5000  40.00   [Broilers]     the cost landed on Broilers
 * Cr 1300  40.00   [Broilers]     ...and Broilers' stock went down $40?
 * ```
 *
 * Broilers never held that feed. `1300` grouped by enterprise came out at
 * **minus $40 for Broilers** and plus $100 for Unassigned, which is not a
 * misleading presentation of a true fact — it is a false one, and it would have
 * been read as "Broilers is carrying negative stock."
 */
export interface MovementEnterpriseTags {
  /** Where the COST landed. What consumed it, falling back to the batch. */
  cost: string | null;
  /** Whose STOCK moved. Always the batch's own, never the consumer's. */
  stock: string | null;
}

/**
 * Which line of business each side of a movement belongs to.
 *
 * **They are the same on everything except a cross-enterprise issue**, which is
 * why one value looked like enough. A sale of Broilers meat relieves Broilers'
 * stock to put cost on Broilers; only feeding one enterprise's stock to another
 * pulls them apart, and that is precisely the movement the whole dimension
 * exists to get right.
 */
export function enterpriseForMovement(
  input: MovementEnterprises,
): MovementEnterpriseTags {
  const stock = input.hasLot ? input.lotEnterpriseId : input.itemEnterpriseId;
  return { cost: input.consumerEnterpriseId ?? stock, stock };
}

/**
 * The enterprise a whole run belongs to, from the batches that went into it.
 *
 * **THE RUN'S OWN COLUMN IS AN OVERRIDE AND NOT THE SOURCE**, which
 * `RunInput.enterpriseId` says in as many words: *"Set it when a run mixes
 * inputs from more than one, which is the case nothing else can work out;
 * otherwise the input lots already know and this stays null."* So the ordinary
 * path derives, and the column settles the case a derivation cannot.
 *
 * **A MIXED RUN RETURNS NULL, AND IT IS THE SAME REFUSAL THE MIXED MARKET
 * STALL GETS.** Two enterprises' animals through one kill day cannot have the
 * plant's fee attributed to one of them, and splitting it pro rata is an
 * allocation — which the enterprises dossier lists as wanting its own decision
 * rather than being invented in a helper. Unassigned is the honest answer and
 * the P&L renders a column for it. Somebody who disagrees sets the override.
 *
 * Untagged inputs are SKIPPED rather than counted as a disagreement: a run that
 * consumed tagged broilers and an untagged pallet of ice is still a Broilers
 * run, and treating the ice as a second opinion would silently un-tag it.
 */
export function enterpriseForRun(input: {
  /** The run's own column. Wins outright when set. */
  override: string | null;
  /** One per input row, in any order. Nulls are ignored. */
  inputEnterpriseIds: Array<string | null>;
}): string | null {
  if (input.override) return input.override;
  const named = new Set(input.inputEnterpriseIds.filter((id): id is string => !!id));
  return named.size === 1 ? [...named][0] : null;
}
