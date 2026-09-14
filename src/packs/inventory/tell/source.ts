import type { Tx } from "@/db";
import { saidWords } from "@/lib/tell-sources/shape";
import {
  TellRefusal,
  type TellAction,
  type TellCandidate,
  type TellChoice,
  type TellCtx,
  type TellSource,
  type TellValues,
} from "@/lib/tell-sources/types";
import { formatQuantity } from "../core/units";
import { ADJUSTMENT_REASON_LABELS } from "../vocabulary";
import {
  InventoryError,
  adjustStock,
  issueStock,
  listItems,
  onHandByItem,
} from "../ops";

/**
 * What stock can be told in one sentence (tell.md, Phase B, slice B1).
 *
 * **THE FIRST PACK WITH A NUMBER THAT HAS TO BE RIGHT.** `time` records a
 * moment, `work` records a sentence, `livestock` records head — and this
 * records the quantity every one of those eventually costs money against, on
 * the spine every other pack hangs off. It is also the most-said thing in the
 * whole product: stock gets used every day, by everybody, on the way past.
 *
 * ── THREE ACTIONS, AND THE THIRD IS THE ONE WORTH HAVING ─────────────────────
 *
 * `used` and `adjusted` are the obvious pair: stock left for a purpose, or
 * stock left for a reason. `counted` is the one that could not exist before
 * slice A2, because it is the action where **what you say and what gets
 * recorded are different numbers**: somebody says *"counted forty-two bags"*
 * and what the books need is the DIFFERENCE. A card showing `42` while writing
 * `−3` would be the most convincing wrong thing on the screen, so the preview
 * is not a nicety here — it is the reason the action is allowed to exist.
 *
 * ── WHAT IT DELIBERATELY DOES NOT TAKE ───────────────────────────────────────
 *
 * **A DELIVERY.** *"Twenty bags of crumble came in at nine pounds a bag"* is
 * the sentence everybody wants, and it is three facts this cannot yet check: a
 * quantity, a cost, and a supplier who may not exist. It also posts — to GRNI,
 * against a bill that has not arrived — so
 * [ADR 0054](../../../../docs/decisions/0054-tell-may-draft-never-send.md) §2
 * requires a preview of the POSTING rather than of the stock, which is a
 * different thing from the one built here. It gets its own slice, with its own
 * arithmetic, rather than riding in on the back of this one.
 *
 * **A MOVE BETWEEN PLACES.** Two locations in one sentence, and the failure —
 * stock in the wrong shed — is invisible on every screen that totals by item.
 * Worth having, not worth guessing at.
 *
 * ── NOTHING HERE RECORDS ITSELF ──────────────────────────────────────────────
 *
 * Every action moves a quantity, which fails
 * [ADR 0050](../../../../docs/decisions/0050-a-safe-verb-records-itself.md)'s
 * third test outright. `unattended` is absent from all three and is expected to
 * stay that way.
 */

const text = (v: TellValues[string]): string | null =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : null;

/** Inventory's own refusals, in its own words — ADR 0039's third rule. */
function refusal(err: unknown): unknown {
  return err instanceof InventoryError ? new TellRefusal(err.message) : err;
}

/**
 * **THE REASONS SOMEBODY SAYS OUT LOUD**, not the whole taxonomy.
 *
 * `SUGGESTED_ADJUSTMENT_REASONS` has eight and two of them have no spoken
 * form: `correction` is what a person does at a desk with a screen open, and
 * `count_variance` is what COUNTING produces rather than what anybody says. A
 * menu the model must choose from earns its length in the prompt, so the ones
 * nobody would say are left out of it.
 */
const ADJUSTMENT_REASONS: TellChoice[] = [
  "spoilage",
  "waste",
  "damage",
  "shrinkage",
  "theft",
  "personal_use",
  "found",
].map((value) => ({ value, label: ADJUSTMENT_REASON_LABELS[value] ?? value }));

/** The only reason that ADDS stock. Everything else takes it away. */
const ADDS_STOCK = new Set(["found"]);

interface Stocked {
  value: string;
  label: string;
  unit: string;
  onHand: number;
}

/**
 * What this business keeps, with what it has of each.
 *
 * **ACTIVE ONLY, AND THE COUNT IS NOT A FILTER.** Something at zero is still
 * something a delivery arrives for and something a count corrects — it is
 * `livestock`'s "only lots with animals in them" applied wrongly if copied
 * here, because an empty feed bin is a real thing to say a sentence about and
 * an empty pen is not.
 */
async function stocked(tx: Tx, tenantId: string): Promise<Stocked[]> {
  const [items, onHand] = await Promise.all([
    listItems(tx, tenantId, { status: "active" }),
    onHandByItem(tx, tenantId),
  ]);
  return items
    .filter((item) => item.name.trim() !== "")
    .map((item) => ({
      value: item.id,
      label: item.name,
      unit: item.stockingUnit,
      onHand: onHand.get(item.id) ?? 0,
    }));
}

/** "42 lb on hand". What tells one thing from another in a shortlist. */
function describe(item: Stocked): string {
  return `${formatQuantity(item.onHand, item.unit)} on hand`;
}

/**
 * WHICH THING THOSE WORDS MEAN — the same three passes the other sources use,
 * loosest last, and **never edit distance**: "Layer pellets" and "Layer mash"
 * are one character apart in the places that matter and are not the same bag.
 */
function findStocked(items: Stocked[], said: string): TellCandidate[] {
  const toCandidate = (item: Stocked): TellCandidate => ({
    value: item.value,
    label: item.label,
    detail: describe(item),
  });

  const asked = saidWords(said);
  if (asked.length === 0) return items.map(toCandidate);
  const phrase = asked.join(" ");

  const named = items.filter((item) => {
    const name = saidWords(item.label).join(" ");
    return name !== "" && (name === phrase || phrase.includes(name) || name.includes(phrase));
  });
  if (named.length > 0) return named.map(toCandidate);

  const spoken = new Set(asked);
  const overlapping = items.filter((item) =>
    saidWords(item.label).some((w) => spoken.has(w)),
  );
  if (overlapping.length > 0) return overlapping.map(toCandidate);

  return items.map(toCandidate);
}

/** The lines every one of these previews opens and closes with. */
function movementPreview(item: Stocked, change: number) {
  const after = item.onHand + change;
  return {
    now: { label: `${item.label} now`, value: formatQuantity(item.onHand, item.unit) },
    after: {
      label: `${item.label} after this`,
      value: formatQuantity(after, item.unit),
    },
    /*
     * A WARNING, NOT A REFUSAL. Stock is allowed to go negative here on
     * purpose — it is how a receipt nobody entered becomes visible instead of
     * being quietly absorbed — so this says what will happen and lets somebody
     * who means it carry on.
     */
    warning:
      after < 0
        ? `That is ${formatQuantity(Math.abs(after), item.unit)} more than is counted as being there.`
        : undefined,
  };
}

export const inventoryTellSource: TellSource = {
  slug: "inventory",
  moduleSlug: "inventory",
  label: "Stock",
  revalidate: ["/dashboard/m/inventory", "/dashboard/today"],

  async actions(tx: Tx, ctx: TellCtx): Promise<TellAction[]> {
    const items = await stocked(tx, ctx.tenantId);
    if (items.length === 0) return [];

    const itemField = {
      key: "item",
      label: "What",
      kind: "choice" as const,
      required: true,
      hint: "The thing the sentence is about, in its own words.",
      find: async (_tx: Tx, _ctx: TellCtx, said: string) => findStocked(items, said),
    };
    const dayField = {
      key: "on",
      label: "When",
      kind: "date" as const,
      required: true,
      hint: "The day it happened.",
      defaultToday: true,
    };
    const found = (id: string | null) => items.find((i) => i.value === id) ?? null;

    return [
      {
        slug: "inventory.used",
        title: "Stock used",
        about:
          "Something was taken out of stock and used up. Examples: “used two bags of crumble”, “took twenty pounds of seed for the top field”, “we went through a roll of wire”. Use this when stock was CONSUMED on purpose — not when it went off or was lost, and not when it was fed to animals, which are both other actions.",
        fields: [
          itemField,
          {
            key: "quantity",
            label: "How much",
            kind: "number",
            required: true,
            hint: "In the unit that thing is counted in, shown beside its name. Leave it out when the sentence gives an amount in something else, such as bags or scoops.",
          },
          dayField,
          {
            key: "notes",
            label: "What for",
            kind: "text",
            hint: "What it went on, when the sentence says. Usually empty.",
          },
        ],
        async preview(_tx, _ctx, values) {
          const item = found(text(values.item));
          const quantity = Number(values.quantity);
          if (!item || !Number.isFinite(quantity) || quantity <= 0) return null;
          const { now, after, warning } = movementPreview(item, -quantity);
          return {
            lines: [now, { label: "used", value: `−${quantity}` }, after],
            warning,
          };
        },
        async record(tx, ctx, values) {
          const itemId = text(values.item);
          const quantity = Number(values.quantity);
          if (!itemId) throw new TellRefusal("say what was used");
          try {
            await issueStock(tx, ctx, {
              itemId,
              quantity,
              occurredOn: text(values.on)!,
              notes: text(values.notes) ?? undefined,
            });
          } catch (err) {
            throw refusal(err);
          }
          const item = found(itemId);
          return {
            summary: `${formatQuantity(quantity, item?.unit ?? "each")} of ${item?.label ?? "stock"} used`,
          };
        },
      },

      {
        slug: "inventory.adjusted",
        title: "Stock lost or found",
        about:
          "Stock went away for a reason nobody chose, or turned up unexpectedly. Examples: “twenty pounds of feed went off”, “a bag of seed got wet”, “found half a roll of wire behind the shed”. Use this rather than Stock used when it was NOT used on purpose.",
        fields: [
          itemField,
          {
            key: "quantity",
            label: "How much",
            kind: "number",
            required: true,
            hint: "How much was lost or found, as a positive number, in the unit that thing is counted in. Whether it is added or taken away comes from the reason.",
          },
          {
            key: "reason",
            label: "What happened",
            kind: "choice",
            required: true,
            hint: "Why it went or turned up. Use Thrown away when the sentence says it was binned, and Went off for anything spoiled or perished.",
            choices: ADJUSTMENT_REASONS,
          },
          dayField,
          {
            key: "notes",
            label: "Anything else",
            kind: "text",
            hint: "Detail the reason does not carry. Usually empty.",
          },
        ],
        async preview(_tx, _ctx, values) {
          const item = found(text(values.item));
          const reason = text(values.reason);
          const size = Math.abs(Number(values.quantity));
          if (!item || !reason || !Number.isFinite(size) || size === 0) return null;
          const change = ADDS_STOCK.has(reason) ? size : -size;
          const { now, after, warning } = movementPreview(item, change);
          return {
            lines: [
              now,
              {
                label: ADJUSTMENT_REASON_LABELS[reason] ?? reason,
                value: `${change > 0 ? "+" : "−"}${size}`,
              },
              after,
            ],
            warning,
          };
        },
        async record(tx, ctx, values) {
          const itemId = text(values.item);
          const reason = text(values.reason);
          const size = Math.abs(Number(values.quantity));
          if (!itemId || !reason) throw new TellRefusal("say what happened, and to what");
          try {
            await adjustStock(tx, ctx, {
              itemId,
              // SIGNED, and the sign comes from the reason rather than from the
              // sentence: nobody says "minus twenty pounds went off".
              quantity: ADDS_STOCK.has(reason) ? size : -size,
              reason,
              occurredOn: text(values.on)!,
              notes: text(values.notes) ?? undefined,
            });
          } catch (err) {
            throw refusal(err);
          }
          const item = found(itemId);
          const word = ADJUSTMENT_REASON_LABELS[reason]?.toLowerCase() ?? reason;
          return {
            summary: `${formatQuantity(size, item?.unit ?? "each")} of ${item?.label ?? "stock"} — ${word}`,
          };
        },
      },

      {
        slug: "inventory.counted",
        title: "Counted what is there",
        about:
          "Somebody counted a thing and is saying the TOTAL they found, not what changed. Examples: “counted forty two bags of crumble”, “there are only nine rolls of wire left”, “I make it three hundred pounds of seed”. The number in the sentence is how much is THERE now.",
        fields: [
          itemField,
          {
            key: "counted",
            label: "How many are there",
            kind: "number",
            required: true,
            hint: "The total counted, in the unit that thing is counted in — NOT the difference. Nobody counts a difference.",
          },
          dayField,
          {
            key: "notes",
            label: "Anything else",
            kind: "text",
            hint: "Usually empty.",
          },
        ],
        /**
         * **THE ACTION THAT COULD NOT EXIST BEFORE SLICE A2.**
         *
         * What somebody SAYS is a total and what gets WRITTEN is a difference,
         * so the card shows `42` and the books move by `−3`. Without this the
         * most convincing thing on the screen would be the wrong number, which
         * is the failure [ADR 0054](../../../../docs/decisions/0054-tell-may-draft-never-send.md) §2
         * exists for.
         */
        async preview(_tx, _ctx, values) {
          const item = found(text(values.item));
          const counted = Number(values.counted);
          if (!item || !Number.isFinite(counted) || counted < 0) return null;
          const change = counted - item.onHand;
          if (change === 0) {
            return {
              lines: [
                { label: `${item.label} on the books`, value: formatQuantity(item.onHand, item.unit) },
                { label: "counted", value: formatQuantity(counted, item.unit) },
              ],
              // The pack refuses an adjustment of nothing, in its own words. Far
              // better to say so BEFORE the button than to explain it after.
              warning: "That is what the books already say — there is nothing to correct.",
            };
          }
          return {
            lines: [
              { label: `${item.label} on the books`, value: formatQuantity(item.onHand, item.unit) },
              { label: "counted", value: formatQuantity(counted, item.unit) },
              {
                label: change > 0 ? "adding" : "taking off",
                value: `${change > 0 ? "+" : "−"}${Math.abs(change)}`,
              },
            ],
          };
        },
        async record(tx, ctx, values) {
          const itemId = text(values.item);
          const counted = Number(values.counted);
          if (!itemId) throw new TellRefusal("say what was counted");
          const item = found(itemId);
          if (!item) throw new TellRefusal("say what was counted");
          const change = counted - item.onHand;
          try {
            await adjustStock(tx, ctx, {
              itemId,
              quantity: change,
              // What counting produces, which is why it is not in the spoken
              // reason menu: nobody says "count variance" out loud.
              reason: "count_variance",
              occurredOn: text(values.on)!,
              notes: text(values.notes) ?? undefined,
            });
          } catch (err) {
            throw refusal(err);
          }
          return {
            summary: `${item.label} counted at ${formatQuantity(counted, item.unit)} — ${
              change > 0 ? "+" : "−"
            }${Math.abs(change)}`,
          };
        },
      },
    ];
  },
};
