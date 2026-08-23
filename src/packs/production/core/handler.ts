/**
 * The slot. TYPES ONLY — no imports that survive compilation, no database, no
 * `server-only`, so a pack filling this slot never drags production's ops into
 * its own bundle.
 *
 * **THIS IS THE FIRST USE OF P5 — A DECLARED EXTENSION POINT** (see
 * docs/extension-model.md §4). It exists because of a rule in
 * `src/packs/index.ts` that is easy to read past:
 *
 * > `production` requires `inventory` because that is where outputs land — and
 * > deliberately NOT `livestock`, because a bakery running production over
 * > purchased flour is a legitimate composition and a pack must not assume its
 * > neighbours.
 *
 * That leaves two things this pack cannot do for itself, both of which the
 * design insists on:
 *
 *   1. **The withdrawal clock has to be enforced here.** `livestock` built its
 *      two-clock guardrail a slice ahead of anything that could refuse an
 *      action, and said so plainly in its own dossier: *"when slice 6 lands it
 *      must consult `blocksProcessing` before booking anything — that is the
 *      enforcement point this slice was built for."* This is that point. A run
 *      against a lot under a withdrawal, or under a period nobody has looked
 *      up, must be refused with the reason and the date in the message.
 *   2. **Head must leave through `livestock`'s own ledger.** Not a second one.
 *      `removeHead` writes the head movement with its kind and its extension
 *      slug, and a run that wrote its own would be the parallel counter the
 *      whole pack model exists to prevent.
 *
 * So `production` names the slot and `livestock` fills it. Neither imports the
 * other's ops; the two are joined in `src/packs/run-handlers.ts`, which is the
 * Layer-2a registry file and is allowed to know both exist for exactly the
 * reason `src/packs/index.ts` is.
 *
 * A handler is CONSULTED, never trusted to be present. A tenant with no
 * livestock has no handler claiming anything, every input is ordinary stock, and
 * nothing about this pack changes.
 */

/** The context shape every pack's ops already take. Structural, deliberately. */
export interface RunHandlerCtx {
  tenantId: string;
  userId: string;
  role: "owner" | "staff" | "expert";
}

/**
 * Why a lot may not be consumed by a run.
 *
 * `reason` is the sentence shown to the person about to load a trailer, written
 * by the pack that knows what it means. Production repeats it verbatim rather
 * than paraphrasing: a withdrawal message is a legal statement and this pack
 * has no standing to reword it.
 */
export interface RunInputBlock {
  /** Which pack refused, so the message can be attributed. */
  slug: string;
  /** Short badge text: "Under withdrawal", "Not looked up". */
  headline: string;
  /** The full sentence, including any clearing date. */
  reason: string;
  /** The day it clears, when there is one. Null when nobody has looked it up. */
  clearsOn: string | null;
}

export interface RunConsumeInput {
  itemId: string;
  /** The inventory lot being consumed. */
  lotId: string;
  /** Positive, in the item's stocking unit. */
  quantity: number;
  occurredOn: string;
  /**
   * What leaves with it, in cents. The run computed it from the lot's
   * accumulated cost net of anything already released; the handler's job is to
   * stamp it on the movement it writes, not to second-guess it.
   */
  costCents: number | null;
  locationAssetId?: string | null;
  notes?: string;
}

/**
 * A pack that owns what is inside some inventory lots.
 *
 * `Tx` is deliberately loose here (`unknown`-shaped generic in the concrete
 * registry) so this file stays free of a `@/db` import and can be read by a
 * client bundle. The registry supplies the real type.
 */
export interface RunInputHandler<Tx> {
  /** The pack this belongs to. Matches its slug in `packRegistry`. */
  slug: string;
  /**
   * Which of these inventory lots this pack owns the contents of.
   *
   * One query, whatever the lot count. A lot nobody claims is ordinary stock
   * and leaves through `inventory.issueStock`.
   */
  claims(tx: Tx, tenantId: string, lotIds: string[]): Promise<Set<string>>;
  /**
   * Anything that should stop a run consuming these lots today, keyed by lot id.
   *
   * Only asked about lots this handler claimed. An empty map means go ahead.
   */
  blocks(
    tx: Tx,
    tenantId: string,
    lotIds: string[],
    today: string,
  ): Promise<Map<string, RunInputBlock>>;
  /**
   * Take it out, the owning pack's way. Returns the id of the movement written.
   *
   * The handler is responsible for the movement KIND and the extension slug, so
   * the row still reads as its pack's event when somebody opens the ledger.
   */
  consume(
    tx: Tx,
    ctx: RunHandlerCtx,
    input: RunConsumeInput,
  ): Promise<string>;
  /**
   * What KIND of thing is in each of these lots, keyed by lot id.
   *
   * **ADDED FOR THE EXEMPTION COUNTER (slice 1d), and it is the same boundary
   * problem the rest of this file solves.** An on-farm processing exemption is
   * counted per species — the pilot's is a thousand birds a year — and
   * `production` cannot ask what a bird is: it does not require `livestock`,
   * and a pack that knew "poultry" would know what industry it was in.
   *
   * So production asks a neutral question and gets a slug back. Which slugs
   * carry a cap, and what the cap is, comes from the installed profile's
   * `packConfig.production.exemptions` — three parties, none of which knows
   * more than it should. A lot nobody claims has no kind, counts toward
   * nothing, and that is the correct answer for a sack of flour.
   *
   * Only asked about lots this handler claimed, the same as `blocks`.
   */
  kinds(
    tx: Tx,
    tenantId: string,
    lotIds: string[],
  ): Promise<Map<string, string>>;
}
