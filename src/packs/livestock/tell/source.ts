import type { Tx } from "@/db";
import {
  TellRefusal,
  type TellAction,
  type TellChoice,
  type TellCtx,
  type TellSource,
  type TellValues,
} from "@/lib/tell-sources/types";
import { listItems, listLots, movementKindsForLots } from "@/packs/inventory/ops";
import { listZones } from "@/packs/land/ops";
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
 * ONLY LOTS WITH ANIMALS IN THEM are offered. A finished group is not
 * something anybody is standing in front of, and a hundred dead pens in the
 * picker is how the right one gets picked wrongly.
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

/** The lots with animals standing in them, by name. */
async function liveLots(tx: Tx, tenantId: string): Promise<TellChoice[]> {
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
      head: summariseHead(movements.get(lot.inventoryLotId) ?? []).balance,
    }))
    .filter((c) => c.label !== "" && c.head > 0)
    .map(({ value, label }) => ({ value, label }));
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

    const lotField = {
      key: "lot",
      label: "Which animals",
      kind: "choice" as const,
      required: true,
      hint: "The pen, group or animal the sentence is about.",
      choices: lots,
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
          const label = lots.find((l) => l.value === values.lot)?.label ?? "the lot";
          const word = LOSS_REASONS.find((r) => r.value === values.reason)?.label ?? "left";
          return { summary: `${head} head — ${word.toLowerCase()} — from ${label}` };
        },
      },
      {
        slug: "livestock.check",
        title: "Looked at them",
        about:
          "Somebody walked the pen and nothing left it — either all was well, or something worth writing down was seen. Example: “checked the broilers, water was frozen”. Use this rather than a loss when no animal died.",
        fields: [
          lotField,
          dayField,
          {
            key: "notes",
            label: "What you saw",
            kind: "text",
            hint: "What was seen, in the sentence's own words. Leave out when the sentence only says they were fine.",
          },
        ],
        async record(tx, ctx, values) {
          const notes = text(values.notes);
          try {
            await recordDailyCheck(tx, ctx, {
              livestockLotId: text(values.lot)!,
              loggedOn: text(values.on)!,
              status: notes ? "attention" : "normal",
              notes: notes ?? undefined,
            });
          } catch (err) {
            throw refusal(err);
          }
          const label = lots.find((l) => l.value === values.lot)?.label ?? "the lot";
          return { summary: notes ? `${label} — noted` : `${label} — looked at, all normal` };
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
          const label = lots.find((l) => l.value === values.lot)?.label ?? "the lot";
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
          const label = lots.find((l) => l.value === values.lot)?.label ?? "the lot";
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
