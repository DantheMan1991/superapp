/**
 * The farm digest — what the advisor is told about THIS farm before it answers.
 * PURE: no imports, no database, no network.
 *
 * **THE ANCHORING IS THE DIFFERENTIATION, NOT THE MODEL.** The profile's AI
 * thesis, written down after being rediscovered three times: a general model can
 * tell anyone that a finishing pig eats roughly five pounds a day. Only this app
 * can add *"your last lot averaged 5.4 and finished at 250 lb in four
 * months"*, because only this app has both the question and the records. A
 * chatbot with no digest is a worse version of a search engine; the digest is
 * the whole product.
 *
 * So the shape below is chosen for what it lets an answer say, not for what is
 * easy to query:
 *
 *   - head, intake and deaths per lot, because "is this normal" is the most
 *     common orienting question and it needs a rate, not a count;
 *   - age, because every rule of thumb in animal husbandry is indexed on it;
 *   - where they are and how long that ground has rested, because the second
 *     most common question is "where do I put them next";
 *   - when each lot was last looked at, because an advisor that answers
 *     confidently from a fortnight-old record is worse than one that says so.
 *
 * **Everything here is assembled SERVER-SIDE from the tenant's own rows.**
 * Nothing in this file may ever be built from client input — a question is the
 * only thing the browser sends, and the facts come from the database under RLS.
 * That is what makes it safe for the answer to sound certain about the farm.
 */

export interface AdvisorLot {
  code: string;
  species: string;
  /**
   * The RESOLVED breeding, already formatted: "½ Angus · ¼ Hereford · ¼
   * unknown". Falls back to the superseded `breed` string while a lot still
   * carries one and nothing has been entered as fractions.
   *
   * A string rather than a structure on purpose — the digest is prose the model
   * reads, and the unknown share has to survive into that prose. An advisor told
   * "Angus" about a half-Angus calf would answer with more confidence than the
   * records support.
   */
  breed: string;
  sex: string | null;
  /** Null when the birth date is unknown, which is ordinary for bought-in stock. */
  ageDays: number | null;
  head: number;
  /** Everything that ever arrived — the denominator of the loss rate. */
  intake: number;
  died: number;
  /** Zone name, with the pen or barn if there is one. Null means not placed. */
  where: string | null;
  /** The day the current stay began — so "how long on this ground" is answerable. */
  whereSince: string | null;
  /**
   * When head were lost, newest first.
   *
   * **TIMING IMPLIES CAUSE**, which is the design's rule and the reason a total
   * is not enough: losses in the first week point at chick quality or brooding,
   * losses in the last at heat and the leg and heart problems of fast growth.
   * A digest carrying "8 of 70" and no dates gets an answer that has to ask.
   */
  losses: { on: string; ageDays: number | null; head: number }[];
  lastCheckedOn: string | null;
  /**
   * What has been fed into this lot, and HOW THAT IS KNOWN.
   *
   * Null when nothing has been fed on record. The provenance travels with the
   * number because the two are different claims: a bag issued to this pen by name
   * is measured, and a share of a bin serving fifteen pens is an estimate spread
   * by head × days. An advisor told only "$412" would speak about both with the
   * same confidence, and the second one does not deserve it.
   *
   * **THERE IS NO FCR HERE, AND THE PROMPT SAYS WHY.** Feed per pound of gain
   * needs weights and nothing has been weighed; a model handed feed and head
   * would otherwise be one plausible step from inventing the number the whole
   * enterprise is judged on.
   */
  feed: {
    cents: number;
    centsPerHead: number | null;
    provenance: string;
  } | null;
  /**
   * What they weigh, what they are gaining, and what that costs in feed.
   *
   * Null when nothing has been weighed, which is the ordinary case for a farm in
   * its first season and must not read as "they weigh nothing".
   *
   * **`conversion` is null far more often than it is set**, and `blockedBy` says
   * why in the same words the screen uses. That is deliberate: an advisor told
   * only that FCR is absent will reach for a rule of thumb and present it as the
   * farm's own, whereas one told *"one weighing — gain needs two"* gives the
   * instruction that fixes it.
   */
  weight: {
    latestLb: number | null;
    weighedOn: string | null;
    method: string | null;
    /** Pounds per head per day, between the first and last weighing. */
    adgLb: number | null;
    /**
     * **THE WINDOW THE GAIN WAS MEASURED OVER, and it is not optional.**
     *
     * Driven against the real API, the advisor was given "gaining 0.129 lb a
     * day", noticed it was close to the latest weight divided by the bird's age,
     * and told the founder the figure was being read off hatch rather than off
     * two weighings. It was not — but nothing in the digest could prove
     * otherwise, so the objection was reasonable and the answer was wrong.
     *
     * Third time this shape has appeared: the dates of the losses, then when the
     * herd moved onto its ground, now this. **When an answer is poor, the digest
     * is the first place to look.**
     */
    gainFrom: string | null;
    gainTo: string | null;
    gainDays: number | null;
    /** Pounds of feed per pound of gain. */
    conversion: number | null;
    conversionConfidence: string | null;
    blockedBy: string | null;
  } | null;
  /**
   * Where this lot stands on the withdrawal clock, and where the number came
   * from.
   *
   * **The only field in the digest with a legal edge.** Null when nothing has
   * been given, which is most lots. `unknown` is not clearance and the prompt
   * says so — a treatment recorded with no period looked up is the row somebody
   * has to resolve before a trailer moves, and an advisor that read the absence
   * as "clear" would be inventing the most dangerous number available to it.
   */
  withdrawal: {
    meatState: string;
    meatClearsOn: string | null;
    milkState: string;
    milkClearsOn: string | null;
    /** The treatment doing the blocking, so the answer can name it. */
    product: string | null;
    source: string | null;
  } | null;
}

export interface AdvisorZone {
  name: string;
  parcel: string;
  areaAcres: number | null;
  status: string;
  /** Null while occupied or never grazed — which are different facts, not zero. */
  restDays: number | null;
}

export interface AdvisorStock {
  name: string;
  onHand: number;
  unit: string;
}

export interface FarmSnapshot {
  today: string;
  /** Species the installed profile suggests. Empty for a tenant with no profile. */
  species: string[];
  lots: AdvisorLot[];
  /** Lots left out of the list because it was capped. See `SNAPSHOT_LOT_CAP`. */
  lotsOmitted: number;
  zones: AdvisorZone[];
  zonesOmitted: number;
  stock: AdvisorStock[];
  /** Consecutive days the daily round was walked, from slice 1a. */
  streakDays: number;
  checkedToday: number;
}

/**
 * How many lots and zones travel in full.
 *
 * At 1x the pilot has ~20 of each and everything fits. At 10x there are ~200
 * paddocks and ~30 pens, and a digest listing all of them would spend most of a
 * prompt on rows nobody asked about. The cap is stated in the text rather than
 * applied silently — an advisor that has seen 40 of 200 lots must not answer as
 * though it saw all of them.
 */
export const SNAPSHOT_LOT_CAP = 40;
export const SNAPSHOT_ZONE_CAP = 40;

function pct(died: number, intake: number): string {
  if (intake <= 0) return "—";
  return `${((died / intake) * 100).toFixed(1)}%`;
}

function age(days: number | null): string {
  if (days === null) return "age unknown";
  if (days < 14) return `${days}d old`;
  if (days < 120) return `${Math.floor(days / 7)}w old`;
  if (days < 730) return `${Math.floor(days / 30.44)}mo old`;
  return `${Math.floor(days / 365.25)}y old`;
}

/**
 * The digest as text, for the first user turn.
 *
 * Markdown-ish and deliberately readable by a person: when an answer is wrong,
 * the first question is always "what did it actually know", and a format only a
 * model can read makes that unanswerable.
 *
 * **A farm with no records produces a short digest, not an apologetic one.**
 * The advisory layer is the half of the wedge that works on day one precisely
 * because it needs no history — so an empty snapshot says plainly that there is
 * nothing recorded yet, and the answer falls back to general husbandry.
 */
export function formatSnapshot(snapshot: FarmSnapshot): string {
  const lines: string[] = [`Today is ${snapshot.today}.`];

  if (snapshot.lots.length === 0) {
    lines.push(
      "",
      "This farm has NO animal lots recorded yet. Answer from general husbandry, say plainly that you have no records for this farm, and keep it short.",
    );
  } else {
    lines.push("", "## Animals on this farm");
    for (const lot of snapshot.lots) {
      const bits = [
        `**${lot.code}** — ${lot.species}`,
        lot.breed || null,
        lot.sex,
        age(lot.ageDays),
        `${lot.head} head`,
        lot.intake > 0 ? `${lot.died} lost of ${lot.intake} placed (${pct(lot.died, lot.intake)})` : null,
        lot.where
          ? lot.whereSince
            ? `on ${lot.where} since ${lot.whereSince}`
            : `on ${lot.where}`
          : "not on a paddock",
        lot.lastCheckedOn ? `last checked ${lot.lastCheckedOn}` : "never checked",
      ].filter((b): b is string => Boolean(b));
      lines.push(`- ${bits.join(" · ")}`);
      if (lot.feed) {
        // Money without a symbol, because the tenant's currency is not this
        // file's business and the advisor is told the farm's own units of
        // account nowhere else either.
        const perHead =
          lot.feed.centsPerHead === null
            ? null
            : `${(lot.feed.centsPerHead / 100).toFixed(2)} a head`;
        lines.push(
          `  - feed: ${(lot.feed.cents / 100).toFixed(2)}${perHead ? `, ${perHead}` : ""} (${lot.feed.provenance})`,
        );
      }
      if (lot.withdrawal) {
        const w = lot.withdrawal;
        const meat =
          w.meatState === "under"
            ? `MEAT WITHDRAWAL until ${w.meatClearsOn}`
            : w.meatState === "unknown"
              ? "MEAT WITHDRAWAL UNKNOWN — a treatment was given and nobody looked the period up"
              : "meat clear";
        const milk =
          w.milkState === "under"
            ? `milk withdrawal until ${w.milkClearsOn}`
            : w.milkState === "unknown"
              ? "milk withdrawal unknown"
              : null;
        lines.push(
          `  - withdrawal: ${[meat, milk].filter(Boolean).join(" · ")}${w.product ? ` (${w.product}${w.source ? `, ${w.source}` : ""})` : ""}`,
        );
      }
      if (lot.weight) {
        const w = lot.weight;
        const bits = [
          w.latestLb === null
            ? null
            : `${w.latestLb} lb a head${w.weighedOn ? ` on ${w.weighedOn}` : ""}${w.method ? ` (${w.method})` : ""}`,
          w.adgLb === null
            ? null
            : `gaining ${w.adgLb} lb a day, measured between two weighings ${w.gainFrom} and ${w.gainTo} (${w.gainDays} days)`,
          w.conversion === null
            ? null
            : `${w.conversion} lb of feed per lb of gain (${w.conversionConfidence})`,
        ].filter((b): b is string => Boolean(b));
        if (bits.length > 0) lines.push(`  - weight: ${bits.join(" · ")}`);
        // The refusal travels with the reason, so the answer can give the
        // instruction rather than substituting a breed average for this farm's
        // own number.
        if (w.conversion === null && w.blockedBy) {
          lines.push(`  - no feed conversion for this lot: ${w.blockedBy}`);
        }
      }
      if (lot.losses.length > 0) {
        const when = lot.losses
          .map(
            (loss) =>
              `${loss.head} on ${loss.on}${loss.ageDays === null ? "" : ` (day ${loss.ageDays})`}`,
          )
          .join(", ");
        lines.push(`  - losses: ${when}`);
      }
    }
    if (snapshot.lotsOmitted > 0) {
      lines.push(
        `- …and ${snapshot.lotsOmitted} more lots NOT listed here. Say so if the question depends on them.`,
      );
    }
    if (snapshot.lots.some((lot) => lot.feed || lot.weight)) {
      const anyWeighed = snapshot.lots.some((lot) => lot.weight);
      lines.push(
        "",
        `Feed above is COST. \`measured\` means issued to that lot by name; \`allocated\` means a share of a shared feeder spread by head × days, which is an estimate and should be spoken about as one. ${
          anyWeighed
            ? "Feed conversion, where it is given, is pounds of feed per pound of GAIN over the period between that lot's first and last weighing. Where it is absent the reason is stated — repeat the reason rather than substituting a breed average and calling it this farm's."
            : "**Nothing on this farm has been weighed**, so feed conversion and feed per pound of gain cannot be computed at all — say that plainly rather than estimating one."
        }`,
      );
    }
  }

  if (snapshot.zones.length > 0) {
    lines.push("", "## Ground");
    for (const zone of snapshot.zones) {
      const bits = [
        `**${zone.name}** (${zone.parcel})`,
        zone.areaAcres !== null ? `${zone.areaAcres} ac` : null,
        zone.status === "occupied"
          ? "occupied now"
          : zone.status === "never_grazed"
            ? "never grazed"
            : zone.restDays !== null
              ? `rested ${zone.restDays} days`
              : "resting",
      ].filter((b): b is string => Boolean(b));
      lines.push(`- ${bits.join(" · ")}`);
    }
    if (snapshot.zonesOmitted > 0) {
      lines.push(`- …and ${snapshot.zonesOmitted} more not listed.`);
    }
  }

  if (snapshot.stock.length > 0) {
    lines.push("", "## On hand");
    for (const item of snapshot.stock) {
      lines.push(`- ${item.name}: ${item.onHand} ${item.unit}`);
    }
  }

  lines.push(
    "",
    "## Recording habit",
    snapshot.lots.length === 0
      ? "- Nothing recorded yet."
      : `- ${snapshot.checkedToday} of ${snapshot.lots.length} listed lots checked today; ${snapshot.streakDays === 0 ? "no current streak" : `${snapshot.streakDays}-day streak`}.`,
  );

  if (snapshot.species.length > 0) {
    lines.push("", `Profile species: ${snapshot.species.join(", ")}.`);
  }

  return lines.join("\n");
}

/**
 * What to offer somebody who has never asked software a farm question.
 *
 * The cold start applies to the advisor as much as to the log: a blank box
 * answers nothing, and the range of what can be asked is invisible until it is
 * shown. These are examples, not a menu — the whole argument for AI here over a
 * table of answers is that anything can be asked, so they exist to demonstrate
 * that rather than to bound it.
 *
 * Species-led, because the useful question is completely different per animal,
 * and capped at four: a wall of suggestions reads as a form.
 */
export function starterQuestions(input: {
  species: string[];
  /** A real lot code, so the first question is about their animals rather than a hypothetical. */
  sampleLotCode: string | null;
  hasZones: boolean;
}): string[] {
  const species = new Set(input.species.map((s) => s.toLowerCase()));
  const out: string[] = [];

  if (input.sampleLotCode) {
    out.push(`Is the loss rate on ${input.sampleLotCode} normal?`);
  }
  if (species.has("poultry")) {
    out.push("What mortality should I expect on Cornish Cross?");
  }
  if (species.has("swine")) {
    out.push("How much should a 3-month pig be eating?");
  }
  if (species.has("cattle")) {
    out.push("When should I wean the calves?");
  }
  if (input.hasZones) {
    out.push("Where should the herd go next?");
  }
  if (out.length === 0) {
    // No profile, no animals, no ground. The advisory layer is the half of the
    // wedge that works with nothing recorded, so this is a first-class case.
    out.push(
      "What should I expect for mortality on a first lot of broilers?",
      "How much pasture does a cow need?",
    );
  }
  return out.slice(0, 4);
}
