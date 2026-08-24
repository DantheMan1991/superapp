import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/money";
import type { ProductionOrderLine } from "@/db/schema";
import type { FeeLineTotal } from "../core/fee";
import {
  PORTION_REFUSALS,
  portionRefusal,
  portionSentence,
  tallyPortions,
} from "../core/portions";
import {
  PRICE_CATEGORY_LABELS,
  categoryRepeatsLabel,
  isComputablePriceUnit,
  isPriceUnit,
  priceWithUnit,
  slugLabel,
} from "../vocabulary";

import {
  AddInstructionDialog,
  AddOrderLineDialog,
  CountLineDialog,
  RemoveOrderLineButton,
  type PriceItemOption,
} from "./order-controls";

/** How a group reads. Falls back to the slug for a category nobody anticipated. */
function categoryLabel(category: string): string {
  return PRICE_CATEGORY_LABELS[category] ?? slugLabel(category);
}

/**
 * ONE CUT SHEET, RENDERED ONCE.
 *
 * **A SERVER COMPONENT, AND SHARED BECAUSE THE PRINTED SHEET AND THE SCREEN
 * MUST NOT DRIFT.** The thing handed to the plant has to say exactly what the
 * page says; two renderings of the same lines is how a farm ends up handing
 * over a sheet with an option on it that the app no longer thinks is there.
 * The `print:` variants are here rather than on the page for the same reason.
 *
 * **THE MONEY IS SCREEN-ONLY.** What the plant is handed is what to DO — the
 * options and the instructions. What it costs is the farm's side of the
 * arrangement, and the plant already knows its own rates; printing the farm's
 * running total onto a document somebody hands across a counter is an
 * unforced disclosure.
 */
export function CutSheet({
  order,
  lines,
  feeByLine,
  editable,
  priceOptions,
  currencySymbol,
  sheetWord,
}: {
  order: {
    id: string;
    title: string;
    kind: string;
    headCount: number | null;
    notes: string;
  };
  lines: ProductionOrderLine[];
  /** What each line works out to, when a run has measured it. */
  feeByLine: Map<string, FeeLineTotal>;
  editable: boolean;
  priceOptions: PriceItemOption[];
  currencySymbol: string | null;
  sheetWord: string;
}) {
  /**
   * Folded here rather than passed in, because this component is the only place
   * that holds both halves of the question — the sheet's head count and the
   * lines that divide it up — and a second caller working it out separately is
   * how the screen and the printout come to disagree.
   */
  const portions = tallyPortions(
    lines.map((line) => ({
      key: line.id,
      label: line.label,
      category: line.category,
      unit: line.unit !== null && isPriceUnit(line.unit) ? line.unit : null,
      quantity: line.quantity,
    })),
    order.headCount,
  );
  const portionsRefusedBecause = portionRefusal(portions);
  const portionLine = portionSentence(portions);

  return (
    <div className="space-y-2">
      {/*
        **SCREEN ONLY, BECAUSE THE PRINTED HEADER ALREADY SAYS ALL OF IT.**
        Found by printing one: the page's print header rendered "Cut sheet —
        Hendricks half" and this row rendered "Hendricks half · Cattle · 1 head"
        immediately under it, with the head count twice. On the run page this
        row is what tells two sheets apart, so it stays there — it is only
        redundant on the sheet's own page, which is the only thing that prints.
      */}
      <div className="flex flex-wrap items-baseline justify-between gap-2 print:hidden">
        <div className="flex flex-wrap items-baseline gap-2">
          <h3 className="text-sm font-medium">{order.title || sheetWord}</h3>
          {order.kind !== "" && (
            <Badge variant="outline">{slugLabel(order.kind)}</Badge>
          )}
          {order.headCount !== null && (
            <span className="text-sm text-muted-foreground">
              {order.headCount} head
            </span>
          )}
        </div>
        {editable && (
          <span className="flex items-center gap-2 print:hidden">
            {/*
              **WHAT IS ALREADY ON THE SHEET IS NOT OFFERED AGAIN.** The write
              refuses a second line for one option and the index makes that
              true of every path — this is what stops somebody meeting either.
            */}
            {/*
              **FILTERED TO THIS SHEET'S ANIMAL, and that is most of what makes
              a 108-item list usable.** A sheet for chickens offers chicken
              prices and the genuinely-any ones — a delivery charge, a
              container — and nothing about ducks. A sheet that has not said
              which animal offers everything, because there is nothing to
              filter on and hiding rows would be worse than a long list.

              **ALREADY-ADDED OPTIONS COME OUT INSIDE THE DIALOG, NOT HERE**,
              and the order matters: the bands have to resolve against the whole
              of a plant's list first, or a group whose covering band is already
              on the sheet reports that no band covers this batch — which is
              untrue and alarming. See `AddOrderLineDialog`.
            */}
            <AddOrderLineDialog
              orderId={order.id}
              options={priceOptions.filter(
                (o) =>
                  order.kind === "" || o.kind === "" || o.kind === order.kind,
              )}
              used={lines
                .map((l) => l.priceItemId)
                .filter((id): id is string => id !== null)}
              headCount={order.headCount}
              sheetWord={sheetWord}
            />
            <AddInstructionDialog orderId={order.id} />
          </span>
        )}
      </div>
      {order.notes !== "" && (
        <p className="text-sm text-muted-foreground">{order.notes}</p>
      )}

      {lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing on it yet. What they cut is what you told them to cut, and the
          plant reads this rather than guessing.
        </p>
      ) : (
        <ul className="text-sm">
          {lines.map((line) => {
            const total = feeByLine.get(line.id);
            return (
              <li
                key={line.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b py-1.5 last:border-0"
              >
                <span className="font-medium">{line.label}</span>
                {/*
                  **THE GROUPING IS SCREEN-ONLY, AND IT DISAPPEARS WHEN THE
                  LABEL ALREADY BEGINS WITH IT.** Both found by reading a real
                  one: "Slaughter · Slaughter" on five rows of Valley Poultry's
                  sheet, and on the printed page a butcher being told that
                  "Keep the heart and liver" is filed under "Extras" — which is
                  this farm's filing, not an instruction to them. The check
                  fired only on an EXACT match until 2f, so a label carrying its
                  own qualifiers still doubled: `Slaughter, Cornish x, 50 to 100
                  · Slaughter`.
                */}
                {!categoryRepeatsLabel(
                  categoryLabel(line.category),
                  line.label,
                ) && (
                  <span className="text-muted-foreground print:hidden">
                    {categoryLabel(line.category)}
                  </span>
                )}
                {line.notes !== "" && (
                  <span className="text-muted-foreground">{line.notes}</span>
                )}
                {/*
                  Not a charge at all, and saying so is what stops an
                  instruction reading as an option nobody priced.

                  **`ml-auto` IS ON BOTH BRANCHES OR THE ROW STOPS LINING UP.**
                  A priced row is pushed right by its price; an instruction row
                  had nothing to push it, so its Remove sat inline in the
                  sentence while every row above it had one at the margin.
                */}
                {line.unit === null && (
                  <span className="ml-auto text-xs text-muted-foreground print:hidden">
                    instruction
                  </span>
                )}
                {line.unit !== null && (
                  <span className="ml-auto text-muted-foreground print:hidden">
                    {priceWithUnit(line.unitPriceCents, line.unit) ??
                      "not quoted"}
                  </span>
                )}
                {/* A measured quantity says it was measured, so nobody reads it
                    as a figure they confirmed. */}
                {total && line.unit !== null && (
                  <span className="text-muted-foreground print:hidden">
                    {total.quantity === null
                      ? "not counted"
                      : `${formatCount(total.quantity)} ${
                          total.source === "typed" ? "counted" : "measured"
                        }`}
                  </span>
                )}
                {total?.cents != null && (
                  <span className="tabular-nums print:hidden">
                    {formatMoney(total.cents, currencySymbol)}
                    {total.atMinimum ? " (minimum)" : ""}
                  </span>
                )}
                {editable && (
                  <span className="flex items-center print:hidden">
                    {line.unit !== null && !isComputablePriceUnit(line.unit) && (
                      <CountLineDialog
                        lineId={line.id}
                        label={line.label}
                        unit={line.unit}
                        quantity={line.quantity}
                      />
                    )}
                    <RemoveOrderLineButton id={line.id} />
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/*
        **THE WHOLE-BIRD REMAINDER, AND IT PRINTS.** *"10 of the 100 birds might
        need to be whole birds and then some will get cut up."* Ninety quartered
        out of a hundred left ten animals nothing on this page mentioned, and the
        plant is the party that needs to know: the sentence it reads is "90
        Quartered · 10 back whole", so it is the one thing here besides the lines
        themselves that survives `print:`.

        Derived, never stored — `core/portions.ts` holds the argument, including
        why a blank quantity means all of them and why only `cutting` counts.
      */}
      {portionLine !== "" && (
        <p className="border-t pt-2 text-sm">
          <span className="text-muted-foreground">Of {portions.headCount} head — </span>
          <span className="font-medium">{portionLine}</span>
        </p>
      )}
      {portionsRefusedBecause === "SHEET_OVER_PORTIONED" && (
        <p className="border-t pt-2 text-sm text-destructive print:hidden">
          {PORTION_REFUSALS.SHEET_OVER_PORTIONED} The cutting adds up to{" "}
          {portions.headPortioned} against {portions.headCount} on the sheet.
        </p>
      )}
      {portionsRefusedBecause === "NO_HEAD_COUNT" && portions.shares.length > 0 && (
        <p className="border-t pt-2 text-xs text-muted-foreground print:hidden">
          {PORTION_REFUSALS.NO_HEAD_COUNT}
        </p>
      )}
      {/*
        Only worth saying on a sheet covering several animals. On a beef, where
        cutting is quoted per pound of hanging weight and the sheet is for one
        animal, it is a sentence about nothing.
      */}
      {portionsRefusedBecause === "CUT_NOT_BY_HEAD" &&
        order.headCount !== null &&
        order.headCount > 1 && (
          <p className="border-t pt-2 text-xs text-muted-foreground print:hidden">
            {PORTION_REFUSALS.CUT_NOT_BY_HEAD}
          </p>
        )}
    </div>
  );
}

/**
 * A quantity beside a fee, with no inventory unit to format it against.
 *
 * A price unit is not a stocking unit — a fee is charged per head or per pound
 * of hanging weight, neither of which the item ledger knows about. Trailing
 * zeroes go, because "12.0000 measured" reads as false precision on a count of
 * birds.
 */
function formatCount(value: number): string {
  return String(Number(value.toFixed(2)));
}
