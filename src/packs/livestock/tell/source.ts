import type { Tx } from "@/db";
import {
  TellRefusal,
  type TellAction,
  type TellCandidate,
  type TellChoice,
  type TellCtx,
  type TellSource,
  type TellValues,
} from "@/lib/tell-sources/types";
import { listItems, listLots, movementKindsForLots } from "@/packs/inventory/ops";
import { listZones } from "@/packs/land/ops";
import { packContext } from "@/lib/packs/tenant-context";
import { summariseHead } from "../core/herd";
import {
  LivestockError,
  listLivestockLots,
  moveLotToZone,
  recordDailyCheck,
  recordDirectFeed,
} from "../ops";

/**
 * What this pack can be told in one sentence (onboarding slice 6).
 *
 * THREE ACTIONS, and they are the three the plan opens with: *"three chicks
 * dead in pen two"*, *"moved cows to paddock seven"*, *"fed two bags to the
 * broilers"*. Each is a verb this pack already has and a screen already
 * calls, so what the box adds is not a new way to write to the herd — it is
 * not having to find the screen.
 *
 * ONLY RECORDS WITH ANIMALS STILL IN THEM are offered, groups and named
 * animals alike. A finished group is not something anybody is standing in
 * front of, and a hundred dead pens in the picker is how the right one gets
 * picked wrongly.
 *
 * NO TREATMENTS, DELIBERATELY. A treatment sets a withdrawal clock that
 * decides whether meat may be sold, and its route and dose change that clock
 * ([livestock.md](../../../../docs/modules/livestock.md)). Recording one from
 * a sentence would be the one place in this pack where a misread word has a
 * food-safety consequence, and the form asks four questions for that reason.
 * Weights are left out for a duller reason: nobody says a weight out loud
 * without a scale in the other hand, and the scale screen is already open.
 */

const LOSS_REASONS: TellChoice[] = [
  { value: "death", label: "Died" },
  { value: "cull", label: "Culled" },
  { value: "sold_live", label: "Sold live" },
];

const text = (v: TellValues[string]): string | null =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : null;

/**
 * A refusal from this pack OR from one it composes, in the thrower's own
 * words; anything else is a failure.
 *
 * `recordDirectFeed` issues stock and `moveLotToZone` writes into land, so
 * inventory's and land's refusals arrive here as legitimately as this pack's
 * — a feed of nothing is `an issue has to be a positive quantity`, and that
 * sentence is already written for a person. Matched by `name` rather than by
 * class for the reason `livestock/actions.ts` does the same: importing three
 * packs' error classes to compare them would be a dependency taken for a
 * `catch`.
 */
const REFUSING = new Set(["LivestockError", "InventoryError", "LandError"]);

function refusal(err: unknown): unknown {
  if (err instanceof LivestockError) return new TellRefusal(err.message);
  return err instanceof Error && REFUSING.has(err.name)
    ? new TellRefusal(err.message)
    : err;
}

/**
 * One thing that can be told about — a group of animals, or a named animal —
 * and what tells it from its neighbours.
 *
 * **`isAnimal` IS WHY THIS IS NOT SIMPLY A LOT.** The list holds Bluebell
 * beside a pen of ninety-six, and both are rows in `livestock_lots`; without
 * this the detail line described her as "Cattle · 1 head", which is the pen's
 * vocabulary applied to a cow and no help to anybody choosing between them. A
 * lot is a GROUP of animals (`docs/modules/livestock.md`, "The model,
 * settled").
 */
interface LiveLot {
  value: string;
  label: string;
  species: string;
  head: number;
  isAnimal: boolean;
}

/** Everything with animals still in it — groups and named animals alike. */
async function liveLots(tx: Tx, tenantId: string): Promise<LiveLot[]> {
  const lots = await listLivestockLots(tx, tenantId);
  if (lots.length === 0) return [];
  const [inventoryLots, movements] = await Promise.all([
    listLots(tx, tenantId),
    movementKindsForLots(
      tx,
      tenantId,
      lots.map((l) => l.inventoryLotId),
    ),
  ]);
  const byId = new Map(inventoryLots.map((l) => [l.id, l]));
  return lots
    .map((lot) => ({
      value: lot.id,
      label: byId.get(lot.inventoryLotId)?.code ?? "",
      species: lot.species,
      head: summariseHead(movements.get(lot.inventoryLotId) ?? []).balance,
      // Said once, on the record, since slice 8c — never re-derived from a
      // head count, which turns a pen that lost all but one into an animal.
      isAnimal: lot.recordKind === "animal",
    }))
    .filter((c) => c.label !== "" && c.head > 0);
}

/**
 * "Meadow — Cattle · 12 head", "Bluebell — Cattle · one animal". What lets a
 * person, or a model, choose.
 *
 * **A NAMED ANIMAL IS NOT DESCRIBED BY A HEAD COUNT.** "1 head" is true of her
 * and tells nobody what she is; between a cow with a name and a pen of twenty
 * the useful fact is which of the two this is.
 *
 * The count is still printed when a record calls itself an animal and holds
 * some other number of head — that should not happen, and if it ever does the
 * count is the surprising fact, so hiding it would be the lie.
 */
function describe(lot: LiveLot): string {
  const species = lot.species
    ? lot.species.charAt(0).toUpperCase() + lot.species.slice(1)
    : "";
  const shape = lot.isAnimal && lot.head === 1 ? "one animal" : `${lot.head} head`;
  return species ? `${species} · ${shape}` : shape;
}

/**
 * What to call the record in the line somebody reads back afterwards.
 *
 * **NEVER "THE LOT".** Every summary below fell back to that string, and what
 * it names is as often a cow with a name as it is a pen. The fallback is only
 * reached if the id stopped matching between the proposal and the record, so
 * it has to be a word that is honest about either — and it is reached from
 * four places, which is three more than should have been writing it by hand.
 */
function nameOf(lots: LiveLot[], value: TellValues[string]): string {
  return lots.find((l) => l.value === value)?.label ?? "the animals";
}

function words(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w !== "");
}

/**
 * WHAT THESE WORDS COULD MEAN — the search behind `lotField`.
 *
 * Three passes, loosest last, and the order is the whole design:
 *
 *  1. **The name.** "Meadow", "Rosie", "PEN-1". An exact name wins outright
 *     and a contained one is still a strong signal.
 *  2. **The species, in the words people actually use.** "the cows" is not a
 *     name and never will be; `speciesWords` comes from the INDUSTRY PROFILE
 *     (`src/industries/homestead-farm`), because a pack that knew a cow was
 *     cattle would know it was on a farm.
 *  3. **Everything alive.** When nothing matched, offer what there is rather
 *     than nothing at all. A shortlist is a question; an empty result is a
 *     dead end, and the dead end is what the founder hit.
 *
 * Never fuzzy, never "nearest". "Pen 3" is one character from "Pen 2" and
 * choosing between them on edit distance is exactly how the wrong pen gets
 * animals moved into it.
 */
function findLots(lots: LiveLot[], speciesWords: Record<string, string[]>) {
  return (said: string): TellCandidate[] => {
    const asked = words(said);
    if (asked.length === 0) return [];
    const spoken = new Set(asked);
    const phrase = asked.join(" ");

    const named = lots.filter((lot) => {
      const label = words(lot.label).join(" ");
      return label !== "" && (label === phrase || phrase.includes(label));
    });
    if (named.length > 0) return named.map(toCandidate);

    const species = Object.entries(speciesWords)
      .filter(([, ws]) => ws.some((w) => spoken.has(w.toLowerCase())))
      .map(([name]) => name.toLowerCase());
    if (species.length > 0) {
      const kind = lots.filter((lot) =>
        species.includes((lot.species ?? "").toLowerCase()),
      );
      if (kind.length > 0) return kind.map(toCandidate);
    }

    return lots.map(toCandidate);
  };
}

function toCandidate(lot: LiveLot): TellCandidate {
  return { value: lot.value, label: lot.label, detail: describe(lot) };
}

/**
 * The farm's own words for its animals, from the industry profile. An industry
 * that supplies none simply searches by name, which is the honest default.
 */
function speciesWordsFrom(packConfig: unknown): Record<string, string[]> {
  const config = packConfig as { speciesWords?: unknown } | null | undefined;
  const raw = config?.speciesWords;
  if (typeof raw !== "object" || raw === null) return {};
  const out: Record<string, string[]> = {};
  for (const [species, list] of Object.entries(raw as Record<string, unknown>)) {
    if (Array.isArray(list)) {
      out[species] = list.filter((w): w is string => typeof w === "string");
    }
  }
  return out;
}

export const livestockTellSource: TellSource = {
  slug: "livestock",
  moduleSlug: "livestock",
  label: "Livestock",
  revalidate: [
    "/dashboard/m/livestock",
    "/dashboard/m/livestock/log",
    "/dashboard/m/inventory",
    "/dashboard/today",
  ],
  async actions(tx: Tx, ctx: TellCtx): Promise<TellAction[]> {
    const lots = await liveLots(tx, ctx.tenantId);
    if (lots.length === 0) return [];

    const pack = await packContext(tx, ctx.tenantId, ctx.industry, "livestock");
    const search = findLots(lots, speciesWordsFrom(pack.config));
    const lotField = {
      key: "lot",
      label: "Which animals",
      kind: "choice" as const,
      required: true,
      hint: "The pen, group or animal the sentence is about.",
      // SEARCHED, NOT LISTED. Nothing is written into the model's prompt; the
      // words come back as they were said and this goes and looks. It is what
      // lets "the cows" find the cattle, and it is why a farm with three
      // hundred pens costs the same as one with three.
      find: async (_tx: Tx, _ctx: TellCtx, said: string) => search(said),
    };
    const dayField = {
      key: "on",
      label: "When",
      kind: "date" as const,
      required: true,
      hint: "The day it happened.",
      defaultToday: true,
    };

    const [zones, items] = await Promise.all([
      listZones(tx, ctx.tenantId, { status: "active" }),
      listItems(tx, ctx.tenantId, { status: "active" }),
    ]);

    const actions: TellAction[] = [
      {
        slug: "livestock.loss",
        title: "Animals lost",
        about:
          "Animals died, were culled, or were sold live. Example: “three chicks dead in pen two”.",
        fields: [
          lotField,
          {
            key: "head",
            label: "How many",
            kind: "number",
            required: true,
            hint: "How many animals left. A whole number.",
          },
          {
            key: "reason",
            label: "What happened",
            kind: "choice",
            required: true,
            hint: "Died, culled, or sold live. Use Died unless the sentence says otherwise.",
            choices: LOSS_REASONS,
          },
          dayField,
          {
            key: "notes",
            label: "Notes",
            kind: "text",
            hint: "What was seen, in the sentence's own words, when it says more than the count.",
          },
        ],
        async record(tx, ctx, values) {
          const head = Math.round(values.head as number);
          try {
            await recordDailyCheck(tx, ctx, {
              livestockLotId: text(values.lot)!,
              loggedOn: text(values.on)!,
              status: "attention",
              notes: text(values.notes) ?? undefined,
              loss: {
                head,
                reason: text(values.reason) as "death" | "cull" | "sold_live",
                notes: text(values.notes) ?? undefined,
              },
            });
          } catch (err) {
            throw refusal(err);
          }
          const label = nameOf(lots, values.lot);
          const word = LOSS_REASONS.find((r) => r.value === values.reason)?.label ?? "left";
          return { summary: `${head} head — ${word.toLowerCase()} — from ${label}` };
        },
      },
      {
        slug: "livestock.check",
        title: "Looked at them",
        about:
          "Somebody walked the pen and nothing left it — either all was well, or something worth writing down was seen. Examples: “checked the broilers, water was frozen”, “checked on Bluebell and she is doing well”. Use this rather than a loss when no animal died.",
        fields: [
          lotField,
          dayField,
          {
            key: "notes",
            label: "What you saw",
            kind: "text",
            hint: "What was seen, in the sentence's own words — GOOD OR BAD. “Water trough was frozen” and “doing well” both belong here. Only leave it out when the sentence says nothing about them at all.",
          },
          {
            /*
             * WHETHER SOMETHING IS WRONG, SAID SEPARATELY FROM WHAT WAS SEEN.
             *
             * It used to be derived: notes present meant `attention`. So
             * "she is doing well" could not be written down without flagging
             * her as a problem, and the model was told to drop it instead. The
             * founder asked the obvious question — *"shouldn't it also fill out
             * the what you saw field?"* — and the honest answer was that a good
             * observation had nowhere to go.
             *
             * A note is a note. Whether it needs somebody is a different fact,
             * and now it is a different field.
             */
            key: "state",
            label: "Anything wrong?",
            kind: "choice",
            required: true,
            hint: "“All fine” unless the sentence says something is wrong, hurt, broken, empty, escaped or unwell. “Doing well”, “looking good” and “all quiet” are all fine.",
            choices: [
              { value: "normal", label: "All fine" },
              { value: "attention", label: "Something’s up" },
            ],
          },
        ],
        async record(tx, ctx, values) {
          const notes = text(values.notes);
          const wrong = text(values.state) === "attention";
          try {
            await recordDailyCheck(tx, ctx, {
              livestockLotId: text(values.lot)!,
              loggedOn: text(values.on)!,
              status: wrong ? "attention" : "normal",
              notes: notes ?? undefined,
            });
          } catch (err) {
            throw refusal(err);
          }
          const label = nameOf(lots, values.lot);
          if (wrong) return { summary: `${label} — ${notes ?? "something's up"}` };
          return { summary: notes ? `${label} — ${notes}` : `${label} — looked at, all normal` };
        },
      },
    ];

    if (zones.length > 0) {
      actions.push({
        slug: "livestock.move",
        title: "Moved somewhere",
        about:
          "Animals were moved onto a paddock or field. Example: “moved cows to paddock seven”.",
        fields: [
          lotField,
          {
            key: "zone",
            label: "Where to",
            kind: "choice",
            required: true,
            hint: "The paddock or field they went onto.",
            choices: zones.map((z) => ({ value: z.id, label: z.name })),
          },
          { ...dayField, hint: "The day they were moved." },
        ],
        async record(tx, ctx, values) {
          try {
            await moveLotToZone(tx, ctx, {
              livestockLotId: text(values.lot)!,
              zoneId: text(values.zone)!,
              startedOn: text(values.on)!,
            });
          } catch (err) {
            throw refusal(err);
          }
          const label = nameOf(lots, values.lot);
          const zone = zones.find((z) => z.id === values.zone)?.name ?? "the paddock";
          return { summary: `${label} moved to ${zone}` };
        },
      });
    }

    /**
     * Feed comes out of stock, so the quantity is in the item's OWN unit and
     * the sentence's "two bags" has to become that. The field says so and the
     * card shows the unit; a bag is not a unit this pack knows, and inventing
     * a conversion from the word would be inventing how much was eaten.
     */
    const feeds = items.filter((i) => i.itemKind !== "livestock");
    if (feeds.length > 0) {
      actions.push({
        slug: "livestock.feed",
        title: "Fed them",
        about:
          "Feed or anything else out of stock was given to animals. Example: “fed two bags to the broilers”. The amount must be in the unit the item is counted in.",
        fields: [
          lotField,
          {
            key: "item",
            label: "What",
            kind: "choice",
            required: true,
            hint: "What was fed.",
            choices: feeds.map((i) => ({
              value: i.id,
              label: `${i.name} (${i.stockingUnit})`,
            })),
          },
          {
            key: "quantity",
            label: "How much",
            kind: "number",
            required: true,
            hint: "In the unit that item is counted in, shown beside its name. Leave out when the sentence gives an amount in something else, such as bags or scoops.",
          },
          { ...dayField, hint: "The day they were fed." },
        ],
        async record(tx, ctx, values) {
          try {
            await recordDirectFeed(tx, ctx, {
              livestockLotId: text(values.lot)!,
              itemId: text(values.item)!,
              quantity: values.quantity as number,
              occurredOn: text(values.on)!,
            });
          } catch (err) {
            throw refusal(err);
          }
          const label = nameOf(lots, values.lot);
          const item = feeds.find((i) => i.id === values.item);
          return {
            summary: `${values.quantity} ${item?.stockingUnit ?? ""} of ${item?.name ?? "feed"} to ${label}`,
          };
        },
      });
    }

    return actions;
  },
};
