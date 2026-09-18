"use client";

import { Fragment, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  BookOpen,
  ClipboardPaste,
  Copy,
  CornerDownLeft,
  EyeOff,
  FileText,
  FolderPlus,
  Link2,
  Package,
  Plus,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  acceptEstimateAction,
  applyEstimateToBudgetAction,
  applyEstimateToScheduleAction,
  createEstimateAction,
  createEstimateShareAction,
  deleteAssemblyAction,
  dropAssemblyAction,
  saveAssemblyAction,
  revealEstimateShareTokenAction,
  revokeEstimateShareAction,
  updateEstimateAction,
} from "../actions";
import { quantityStringToThousandths, thousandthsToQuantityString } from "../billing-math";
import { parseEstimateLine, parseEstimateLines, unitsFor, type ParsedEstimateLine } from "../estimate-parse";
import { SHARE_STANDING_LABELS, type ShareStanding } from "../estimate-share-status";
import { suggestDriver } from "../assembly-math";
import {
  fillFromMemory,
  howLongAgo,
  priceBookFrom,
  priceHint,
  recall,
  type RememberedPrice,
} from "../price-memory";
import {
  estimateTotals,
  groupCostCents,
  groupPriceCents,
  lineCostCents,
  linePriceCents,
  rateStringToPpm,
} from "../estimate-math";
import {
  ESTIMATE_STATUSES,
  ESTIMATE_STATUS_LABELS,
  GROUP_PRICE_MODES,
  GROUP_PRICE_MODE_LABELS,
  PROPOSAL_FORMATS,
  PROPOSAL_FORMAT_LABELS,
  PROPOSAL_PRESENTATIONS,
  PROPOSAL_PRESENTATION_LABELS,
  type GroupPriceMode,
} from "../vocabulary";

const NONE = "__none__";

function fmt(cents: number, symbol: string | null): string {
  const abs = `${symbol ?? ""}${(Math.abs(cents) / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
  return cents < 0 ? `−${abs}` : abs;
}

const toCents = (s: string): number => {
  const n = Number(s.replace(/[,\s$]/g, ""));
  return Number.isFinite(n) && s.trim() !== "" ? Math.round(n * 100) : 0;
};

const ppmToRate = (ppm: number | null): string => (ppm === null ? "" : String(ppm / 10_000));

function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * A CLIENT-FACING ITEM being edited (ADR 0079). `key` is what this item's
 * lines hold: its id once it has one, a local key until then, which is what
 * lets a new item and its lines be saved in one go.
 */
interface GroupDraft {
  id: string | null;
  key: string;
  name: string;
  clientNote: string;
  priceMode: GroupPriceMode;
  fixedPrice: string;
}

let nextKey = 0;
const emptyGroup = (): GroupDraft => ({
  id: null,
  key: `new-item-${(nextKey += 1)}`,
  name: "",
  clientNote: "",
  priceMode: "rollup",
  fixedPrice: "",
});

interface LineDraft {
  id: string | null;
  /** The item this line sits in; "" leaves it loose. */
  groupKey: string;
  costCodeId: string;
  description: string;
  /** What the client reads instead (ADR 0080); blank uses the description. */
  clientDescription: string;
  /** Whether the line is a row on the proposal; only a line in an item may be hidden. */
  clientVisible: boolean;
  unit: string;
  quantity: string;
  unitCost: string;
  markup: string;
  unitPrice: string;
}

const emptyLine = (groupKey = ""): LineDraft => ({
  id: null,
  groupKey,
  costCodeId: NONE,
  description: "",
  clientDescription: "",
  clientVisible: true,
  unit: "",
  quantity: "",
  unitCost: "",
  markup: "",
  unitPrice: "",
});

/** A draft row as the arithmetic reads it. */
function figuresOf(l: LineDraft) {
  return {
    quantityThousandths: l.quantity.trim() === "" ? 1000 : (quantityStringToThousandths(l.quantity) ?? 0),
    unitCostCents: toCents(l.unitCost),
    markupPpm: l.markup.trim() === "" ? null : rateStringToPpm(l.markup),
    unitPriceCents: l.unitPrice.trim() === "" ? null : toCents(l.unitPrice),
  };
}

export interface EditableEstimate {
  id: string;
  version: number;
  number: string;
  title: string;
  status: string;
  sentOn: string | null;
  decidedOn: string | null;
  validUntil: string | null;
  markupPpm: number;
  overheadPpm: number;
  profitPpm: number;
  notes: string;
  presentation: string;
  scope: string;
  exclusions: string;
  terms: string;
  contractId: string | null;
  /** Whether the by-code proposal prints a code's number (ADR 0080). */
  showCodeNumbers: boolean;
  /** What the paper is (E5a, ADR 0083). */
  format: string;
  /** The letter the brochure opens with. */
  letter: string;
  /** The client-facing items, in their order (ADR 0079). */
  groups: Array<{
    id: string;
    name: string;
    clientNote: string;
    priceMode: string;
    fixedPriceCents: number | null;
  }>;
  lines: Array<{
    id: string;
    groupId: string | null;
    costCodeId: string | null;
    description: string;
    clientDescription: string;
    clientVisible: boolean;
    unit: string;
    quantityThousandths: number;
    unitCostCents: number;
    markupPpm: number | null;
    unitPriceCents: number | null;
  }>;
}

/**
 * Start an estimate: a number and a title, then the page for its lines. The
 * pack's other dialogs take everything at once; an estimate is too long for
 * one, and the lines are the work.
 */
export function NewEstimateDialog({ projectId, trigger }: { projectId: string; trigger?: ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [number, setNumber] = useState("");
  const [title, setTitle] = useState("");
  function submit() {
    startTransition(async () => {
      const result = await createEstimateAction({ projectId, number: number.trim(), title: title.trim() });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Estimate started");
      setOpen(false);
      router.push(`/dashboard/m/jobs/${projectId}/estimates/${result.estimateId}`);
    });
  }
  return (
    <>
      {trigger ? (
        <span onClick={() => setOpen(true)}>{trigger}</span>
      ) : (
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="mr-1.5 size-4" /> New estimate
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New estimate</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="ne-number">Number</Label>
              <Input
                id="ne-number"
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                placeholder="EST-1"
                maxLength={40}
              />
              <p className="text-xs text-muted-foreground">However you number them. Different from the job&apos;s other estimates.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ne-title">Title</Label>
              <Input
                id="ne-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="New home, as drawn"
                maxLength={200}
              />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={submit} disabled={pending || number.trim() === ""}>
              {pending ? "Starting…" : "Start estimate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * The estimate, whole: the header and its rates, the lines with cost and
 * price computed as they are typed, the totals, and — for an owner — the
 * three acts that make it money: accept it onto a contract, make it the
 * budget, make it a contract's schedule of values (ADR 0069).
 *
 * **COST AND PRICE ARE TWO NUMBERS ON EVERY LINE.** A line sells at a markup
 * on its cost — the line's own or the estimate's default — unless a price
 * per unit is typed, which is how a unit-price bid is written. The extended
 * figures are never typed; the same rule the change order and the schedule
 * of values keep.
 *
 * **AN ACCEPTED ESTIMATE IS FIXED.** Its money became a contract's value, a
 * budget or a schedule; the rates and lines are shown and not sent. Revise
 * by starting a new one and marking this one superseded.
 */
/** A saved item in the picker: enough to choose by, never its lines. */
export interface AssemblyOption {
  id: string;
  name: string;
  /** "per 320 sf" / "each", already worded by the page. */
  per: string;
  lineCount: number;
  costCents: number;
}

/** A client link as the builder reads it. The token is never among these. */
export interface ShareView {
  id: string;
  standing: ShareStanding;
  expiresAt: string;
  viewCount: number;
  lastViewedAt: string | null;
  signedName: string | null;
  signedAt: string | null;
  signedTotalCents: number | null;
}

export function EstimateEditor({
  projectId,
  estimate,
  codes,
  contracts,
  canEdit,
  isOwner,
  symbol,
  units,
  shares,
  prices,
  assemblies,
}: {
  projectId: string;
  estimate: EditableEstimate;
  /** Every unit this business has typed before, so the entry bar's grammar knows it. */
  units: string[];
  /** What each line cost the last time it was priced (E4a), newest first. */
  prices: RememberedPrice[];
  /** The saved items this business can drop in (E6), by name. */
  assemblies: AssemblyOption[];
  codes: Array<{ id: string; label: string }>;
  contracts: Array<{ id: string; label: string; status: string }>;
  canEdit: boolean;
  isOwner: boolean;
  symbol: string | null;
  shares: ShareView[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const locked = estimate.status === "accepted";
  const editable = canEdit && !locked;
  const [number, setNumber] = useState(estimate.number);
  const [title, setTitle] = useState(estimate.title);
  const [status, setStatus] = useState(estimate.status);
  const [sentOn, setSentOn] = useState(estimate.sentOn ?? "");
  const [decidedOn, setDecidedOn] = useState(estimate.decidedOn ?? "");
  const [validUntil, setValidUntil] = useState(estimate.validUntil ?? "");
  const [markup, setMarkup] = useState(ppmToRate(estimate.markupPpm));
  const [overhead, setOverhead] = useState(ppmToRate(estimate.overheadPpm));
  const [profit, setProfit] = useState(ppmToRate(estimate.profitPpm));
  const [notes, setNotes] = useState(estimate.notes);
  const [presentation, setPresentation] = useState(estimate.presentation);
  const [showCodeNumbers, setShowCodeNumbers] = useState(estimate.showCodeNumbers);
  const [format, setFormat] = useState(estimate.format);
  const [letterText, setLetterText] = useState(estimate.letter);
  /** The version every guarded verb is handed; it advances with each save. */
  const [version, setVersion] = useState(estimate.version);
  /**
   * Writing the client's words is a pass of its own, so the two controls that do
   * it are behind one switch and off by default: the table is already wider than
   * its box, and a second input on every row would slow down typing a takeoff.
   */
  const [clientWording, setClientWording] = useState(
    estimate.lines.some((l) => l.clientDescription.trim() !== "" || !l.clientVisible),
  );
  const [scope, setScope] = useState(estimate.scope);
  const [exclusions, setExclusions] = useState(estimate.exclusions);
  const [termsText, setTermsText] = useState(estimate.terms);
  const [lines, setLines] = useState<LineDraft[]>(
    estimate.lines.length > 0
      ? estimate.lines.map((l) => ({
          id: l.id,
          groupKey: l.groupId ?? "",
          clientDescription: l.clientDescription,
          clientVisible: l.clientVisible,
          costCodeId: l.costCodeId ?? NONE,
          description: l.description,
          unit: l.unit,
          quantity: l.quantityThousandths === 1000 ? "" : thousandthsToQuantityString(l.quantityThousandths),
          unitCost: l.unitCostCents === 0 ? "" : (l.unitCostCents / 100).toFixed(2),
          markup: ppmToRate(l.markupPpm),
          unitPrice: l.unitPriceCents === null ? "" : (l.unitPriceCents / 100).toFixed(2),
        }))
      : [emptyLine()],
  );

  const terms = {
    markupPpm: rateStringToPpm(markup) ?? 0,
    overheadPpm: rateStringToPpm(overhead) ?? 0,
    profitPpm: rateStringToPpm(profit) ?? 0,
  };
  const [groups, setGroups] = useState<GroupDraft[]>(
    estimate.groups.map((g) => ({
      id: g.id,
      key: g.id,
      name: g.name,
      clientNote: g.clientNote,
      priceMode: g.priceMode === "fixed" ? "fixed" : "rollup",
      fixedPrice: g.fixedPriceCents === null ? "" : (g.fixedPriceCents / 100).toFixed(2),
    })),
  );
  const named = groups.filter((g) => g.name.trim() !== "");
  const groupFigures = named.map((g) => ({
    id: g.key,
    priceMode: g.priceMode,
    fixedPriceCents: g.priceMode === "fixed" ? toCents(g.fixedPrice) : null,
  }));
  /** Only a named item can hold a line: a blank row is ignored, so its lines are loose. */
  const keyOf = (l: LineDraft): string | null =>
    named.some((g) => g.key === l.groupKey) ? l.groupKey : null;
  const figures = lines
    .filter((l) => l.description.trim() !== "")
    .map((l) => ({ ...figuresOf(l), groupId: keyOf(l) }));
  const totals = estimateTotals(figures, terms, groupFigures);
  const hasGroups = named.length > 0;
  /** Every item priced by hand leaves the rates nothing to spread over; the page says so. */
  const ratesIdle =
    totals.spreadableCents === 0 &&
    totals.fixedCents > 0 &&
    terms.overheadPpm + terms.profitPpm > 0;

  /**
   * THE ENTRY BAR (ADR 0081). One field, one sentence, Enter, and the cursor
   * never leaves it. `into` is the item the next line lands in and it STAYS
   * where it was put, because a builder types an item's lines together.
   */
  const [entry, setEntry] = useState("");
  const [entryError, setEntryError] = useState<string | null>(null);
  const [into, setInto] = useState("");
  const entryRef = useRef<HTMLInputElement>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  /** The row the cursor is in, so Ctrl+D knows what to copy. */
  const [focusRow, setFocusRow] = useState<number | null>(null);

  /**
   * The trade's units, the ones this business has typed on other estimates, and
   * the ones typed on THIS one since the page loaded — so a unit is known the
   * moment it is used rather than after a save.
   */
  const knownUnits = useMemo(
    () => unitsFor([...units, ...lines.map((l) => l.unit)]),
    [units, lines],
  );
  /** Built once from the rows the page shipped; the first for each key wins. */
  const priceBook = useMemo(() => priceBookFrom(prices), [prices]);

  function setLine(i: number, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l, j) => (i === j ? { ...l, ...patch } : l)));
  }
  /** A parsed sentence as a row of the table. */
  function draftOf(parsed: ParsedEstimateLine, groupKey: string): LineDraft {
    return {
      ...emptyLine(groupKey),
      description: parsed.description,
      unit: parsed.unit,
      quantity: parsed.quantityThousandths === 1000 ? "" : thousandthsToQuantityString(parsed.quantityThousandths),
      unitCost: parsed.unitCostCents === 0 ? "" : (parsed.unitCostCents / 100).toFixed(2),
    };
  }
  /**
   * WHAT THIS LINE COST LAST TIME, while it is still being typed (E4a).
   *
   * Only ever when the sentence names NO price: the memory fills a blank and
   * never argues with a number somebody typed. A sentence the grammar cannot
   * read has no description to look up, so it has no hint either.
   */
  const entryMemory = useMemo(() => {
    const parsed = parseEstimateLine(entry, knownUnits);
    if (parsed === null || parsed.unitCostCents !== 0) return null;
    return recall(priceBook, parsed.description);
  }, [entry, knownUnits, priceBook]);

  function commitEntry(useMemory = false) {
    const parsed = parseEstimateLine(entry, knownUnits);
    if (parsed === null) {
      setEntryError(
        entry.trim() === ""
          ? null
          : "Could not read that. Try 320 sf tile @ 4.20, or plumbing rough 12000.",
      );
      return;
    }
    // Tab took the remembered price; Enter alone leaves the line unpriced, so
    // a blank stays a blank unless somebody asked for the memory.
    const remembered = useMemory ? fillFromMemory(priceBook, parsed) : null;
    const line = remembered
      ? { ...parsed, unitCostCents: remembered.unitCostCents, unit: parsed.unit || remembered.unit }
      : parsed;
    setLines((prev) => [...prev, draftOf(line, into)]);
    setEntry("");
    setEntryError(null);
    entryRef.current?.focus();
  }
  /** Ctrl+D on a row: the line again, under it, without its id — most lines are near-copies. */
  function duplicateFocused() {
    if (focusRow === null) return;
    setLines((prev) => {
      const source = prev[focusRow];
      if (!source) return prev;
      const copy = { ...source, id: null };
      return [...prev.slice(0, focusRow + 1), copy, ...prev.slice(focusRow + 1)];
    });
  }
  function setGroup(i: number, patch: Partial<GroupDraft>) {
    setGroups((prev) => prev.map((g, j) => (i === j ? { ...g, ...patch } : g)));
  }
  /** Removing an item leaves its lines loose, never deletes what was priced. */
  function removeGroup(key: string) {
    setLines((prev) => prev.map((l) => (l.groupKey === key ? { ...l, groupKey: "" } : l)));
    setGroups((prev) => prev.filter((g) => g.key !== key));
  }
  function addLine(groupKey: string) {
    setLines((prev) => [...prev, emptyLine(groupKey)]);
  }

  /* --------------------------------------------------- assemblies (E6) */

  /**
   * SAVING AN ITEM reads the editor's OWN STATE, not the database, so an item
   * typed a minute ago and not yet saved can still go in the library — which
   * is the moment somebody knows it is worth keeping.
   */
  const [saveFor, setSaveFor] = useState<string | null>(null);
  const [asmName, setAsmName] = useState("");
  const [asmPer, setAsmPer] = useState("");
  const [asmUnit, setAsmUnit] = useState("");
  const [asmNotes, setAsmNotes] = useState("");
  const [dropOpen, setDropOpen] = useState(false);
  const [dropId, setDropId] = useState("");
  const [dropQty, setDropQty] = useState("");

  /** The lines of an item, as the library keeps them. */
  function assemblyLinesOf(groupKey: string) {
    return rowsOf(groupKey)
      .map(({ l }) => l)
      .filter((l) => l.description.trim() !== "")
      .map((l, i) => {
        const f = figuresOf(l);
        return {
          description: l.description.trim(),
          clientDescription: l.clientDescription.trim(),
          clientVisible: l.clientVisible,
          unit: l.unit.trim(),
          quantityThousandths: f.quantityThousandths,
          unitCostCents: f.unitCostCents,
          markupPpm: f.markupPpm,
          unitPriceCents: f.unitPriceCents,
          // The code AS WRITTEN, so it survives a move to another job's set.
          costCode: (codes.find((c) => c.id === l.costCodeId)?.label ?? "").split(" · ")[0].trim(),
          sortOrder: (i + 1) * 10,
        };
      });
  }

  function openSaveAssembly(groupKey: string) {
    const group = groups.find((g) => g.key === groupKey);
    const lines = assemblyLinesOf(groupKey);
    const driver = suggestDriver(lines);
    setSaveFor(groupKey);
    setAsmName(group?.name.trim() ?? "");
    setAsmPer(thousandthsToQuantityString(driver.quantityThousandths));
    setAsmUnit(driver.unit);
    setAsmNotes("");
  }

  function commitSaveAssembly() {
    if (saveFor === null) return;
    const group = groups.find((g) => g.key === saveFor);
    startTransition(async () => {
      const res = await saveAssemblyAction({
        projectId,
        name: asmName,
        clientNote: group?.clientNote ?? "",
        notes: asmNotes,
        drivingQuantity: asmPer,
        drivingUnit: asmUnit,
        lines: assemblyLinesOf(saveFor),
      });
      if ("error" in res) return void toast.error(res.error);
      toast.success(`Saved ${res.name} to your assemblies`);
      setSaveFor(null);
      router.refresh();
    });
  }

  /**
   * DROPPING one adds a NEW ITEM with its lines. The server explodes and
   * resolves the cost codes; the editor appends drafts and lets autosave write
   * them, because the estimate is held in this component's state (ADR 0082)
   * and a second writer to the same rows is how they come to disagree.
   */
  function commitDrop() {
    startTransition(async () => {
      const res = await dropAssemblyAction({ projectId, assemblyId: dropId, quantity: dropQty });
      if ("error" in res) return void toast.error(res.error);
      const key = `new-${Date.now()}`;
      setGroups((prev) => [
        ...prev,
        { key, id: null, name: res.name, clientNote: res.clientNote, priceMode: "rollup", fixedPrice: "" },
      ]);
      setLines((prev) => [
        ...prev,
        ...res.lines.map((l) => ({
          ...emptyLine(key),
          costCodeId: l.costCodeId ?? "",
          description: l.description,
          clientDescription: l.clientDescription,
          clientVisible: l.clientVisible,
          unit: l.unit,
          quantity:
            l.quantityThousandths === 1000 ? "" : thousandthsToQuantityString(l.quantityThousandths),
          unitCost: l.unitCostCents === 0 ? "" : (l.unitCostCents / 100).toFixed(2),
          markup: l.markupPpm === null ? "" : (l.markupPpm / 10_000).toString(),
          unitPrice: l.unitPriceCents === null ? "" : (l.unitPriceCents / 100).toFixed(2),
        })),
      ]);
      toast.success(
        res.uncoded > 0
          ? `Added ${res.name}. ${res.uncoded} ${res.uncoded === 1 ? "line has" : "lines have"} no code on this job — pick one.`
          : `Added ${res.name}`,
      );
      setDropOpen(false);
      setDropId("");
      setDropQty("");
    });
  }

  /* ------------------------------------------------ the keyboard grid (E3c) */

  /**
   * A TAKEOFF IS TYPED DOWN A COLUMN, NOT ACROSS A ROW. Somebody putting in
   * forty quantities wants the next quantity, and Tab — which the browser
   * already gives — walks sideways through description, unit, cost and markup
   * to get there. **Up and Down move within the column**; Tab is left exactly
   * as it was, because it is the one key a keyboard user must be able to
   * trust.
   *
   * **Left and Right are deliberately NOT claimed.** They move the caret
   * inside the field, and a grid that stole them would make a price with a
   * typo in the middle of it unfixable.
   *
   * Movement is resolved in DOM ORDER, not by index into `lines`: rows are
   * grouped under their items on screen, so the row below is a fact about the
   * document rather than about the array, and asking the document costs
   * nothing and cannot disagree with what somebody is looking at.
   */
  const gridRef = useRef<HTMLDivElement>(null);
  /**
   * A cell to focus once React has rendered the row that holds it. A REF, not
   * state: there is nothing to re-render for, and clearing state from inside
   * the effect that read it is the cascading render eslint refuses.
   */
  const pendingCell = useRef<{ group: string; col: string } | null>(null);

  function cellsIn(col: string): HTMLInputElement[] {
    const root = gridRef.current;
    if (!root) return [];
    return [...root.querySelectorAll<HTMLInputElement>(`input[data-cell="${col}"]`)];
  }

  /** Focus and SELECT, the spreadsheet idiom: arriving at a cell means retyping it. */
  function goTo(cell: HTMLInputElement | undefined) {
    if (!cell || cell.disabled) return false;
    cell.focus();
    cell.select();
    return true;
  }

  function gridKeyDown(e: React.KeyboardEvent, groupKey: string) {
    const el = e.target as HTMLElement;
    const col = el.dataset?.cell;
    // A select, a checkbox or the remove button is not a cell; leave them be.
    if (!col || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Enter") return;

    const cells = cellsIn(col);
    const at = cells.indexOf(el as HTMLInputElement);
    if (at < 0) return;

    if (e.key === "ArrowUp") {
      if (goTo(cells[at - 1])) e.preventDefault();
      return;
    }
    if (goTo(cells[at + 1])) {
      e.preventDefault();
      return;
    }
    /**
     * Past the last row, ENTER makes another — in the same item, because
     * somebody typing down an item's lines is still in that item. Arrow Down
     * does not: running off the end of a list is not a request for more of it.
     */
    if (e.key === "Enter" && editable) {
      e.preventDefault();
      addLine(groupKey);
      pendingCell.current = { group: groupKey, col };
    }
  }

  /**
   * Focus the new row once it exists. In an effect rather than after
   * `setLines`, because the row is not in the DOM until React has rendered
   * it — and assigning focus during render is the impurity eslint's
   * `react-hooks/refs` rule refuses.
   */
  useEffect(() => {
    const want = pendingCell.current;
    if (!want) return;
    // Cleared first, so a later change to the row count cannot focus twice.
    pendingCell.current = null;
    const root = gridRef.current;
    if (!root) return;
    const rows = [...root.querySelectorAll<HTMLElement>(`tr[data-group="${want.group}"]`)];
    const last = rows[rows.length - 1];
    goTo(last?.querySelector<HTMLInputElement>(`input[data-cell="${want.col}"]`) ?? undefined);
  }, [lines.length]);
  /** An item's cost and price as the editor shows them, from the same pure arithmetic. */
  function groupMoney(g: GroupDraft) {
    const children = lines
      .filter((l) => l.groupKey === g.key && l.description.trim() !== "")
      .map(figuresOf);
    const fixed = g.priceMode === "fixed" ? toCents(g.fixedPrice) : null;
    const costCents = groupCostCents(children);
    const priceCents = groupPriceCents(
      { id: g.key, priceMode: g.priceMode, fixedPriceCents: fixed },
      children,
      terms.markupPpm,
    );
    return { costCents, priceCents, marginCents: priceCents - costCents, lineCount: children.length };
  }
  function changeStatus(next: string) {
    setStatus(next);
    if (next === "sent" && sentOn === "") setSentOn(today());
    if ((next === "declined" || next === "accepted") && decidedOn === "") setDecidedOn(today());
  }

  /**
   * THE WHOLE FORM, as the action takes it. Built in one place because the
   * unsaved-changes check compares THIS against what was last saved — so a
   * field added to the payload is watched without anybody remembering to mark
   * it dirty, which is the failure a list of setters invites.
   */
  function buildPayload() {
      return {
        projectId,
        id: estimate.id,
        number: number.trim(),
        title: title.trim(),
        status,
        sentOn,
        decidedOn,
        validUntil,
        notes: notes.trim(),
        presentation,
        showCodeNumbers,
        format,
        // An accepted estimate's money is not sent, nor the proposal's words: they are the agreement.
        ...(locked
          ? {}
          : {
              markupPercent: markup,
              overheadPercent: overhead,
              profitPercent: profit,
              letter: letterText.trim(),
              scope: scope.trim(),
              exclusions: exclusions.trim(),
              terms: termsText.trim(),
              groups: named.map((g) => ({
                id: g.id ?? "",
                key: g.key,
                name: g.name.trim(),
                clientNote: g.clientNote.trim(),
                priceMode: g.priceMode,
                fixedPriceCents: g.priceMode === "fixed" ? g.fixedPrice : "",
              })),
              // In the order shown: each item's lines beneath it, the loose ones last,
              // so what comes back from the database is already grouped.
              lines: [...named.map((g) => g.key), ""]
                .flatMap((key) =>
                  lines.filter((l) => (keyOf(l) ?? "") === key && l.description.trim() !== ""),
                )
                .map((l) => ({
                  id: l.id ?? "",
                  groupRef: keyOf(l) ?? "",
                  costCodeId: l.costCodeId === NONE ? "" : l.costCodeId,
                  description: l.description.trim(),
                  clientDescription: l.clientDescription.trim(),
                  // A loose line is always shown: hidden money needs an item to hide in.
                  clientVisible: keyOf(l) === null ? true : l.clientVisible,
                  unit: l.unit.trim(),
                  quantity: l.quantity,
                  unitCostCents: l.unitCost,
                  markupPercent: l.markup,
                  unitPriceCents: l.unitPrice,
                })),
            }),
      };
  }

  /**
   * AUTOSAVE (E3b, ADR 0082). One Save button holding two hundred lines is a
   * way to lose an afternoon, so the form saves itself once typing stops.
   *
   * **Unsaved is derived, not flagged.** The payload is stringified and compared
   * with what was last saved, so a field added to `buildPayload` is watched with
   * no setter to remember — the alternative is twenty `setDirty(true)` calls and
   * one of them missing.
   *
   * The version comes back with every save and is kept HERE rather than read
   * from the props, because the props do not move until the page navigates; and
   * every verb that guards on a version is handed this one.
   */
  /**
   * The CONTENT, without the version: a concurrency token is not something the
   * form can be dirty about. Comparing it made every successful save dirty
   * again the moment the new version came back — two POSTs and a status stuck
   * on "Unsaved changes", found by driving it.
   */
  const payloadJson = JSON.stringify(buildPayload());
  const [savedJson, setSavedJson] = useState(payloadJson);
  const [failed, setFailed] = useState(false);
  const unsaved = payloadJson !== savedJson;

  /**
   * Held in a ref so the timer always fires the CURRENT closure without the
   * effect having to list the whole form as a dependency — and assigned in an
   * effect rather than during render, because writing a ref while rendering is
   * impure. This effect is declared first, so it has run before the timer below
   * can fire.
   */
  const saveRef = useRef<(quiet: boolean) => void>(() => undefined);
  useEffect(() => {
    saveRef.current = (quiet: boolean) => {
    const sending = buildPayload();
    const sendingJson = JSON.stringify(sending);
    startTransition(async () => {
      const result = await updateEstimateAction({ ...sending, version, quiet });
      if ("error" in result) {
        setFailed(true);
        // A failed autosave is as loud as a failed Save: it is the same lost work.
        toast.error(result.error);
        return;
      }
      setFailed(false);
      // What was SENT is what is saved; anything typed since stays unsaved.
      setSavedJson(sendingJson);
      if (typeof result.version === "number") setVersion(result.version);
      if (!quiet) {
        toast.success("Estimate saved");
        router.refresh();
      }
    });
    };
  });

  useEffect(() => {
    if (!canEdit || !unsaved || pending) return;
    // `payloadJson` is a dependency so each edit restarts the clock: a save
    // lands 1.2s after somebody STOPS typing, not 1.2s after they start.
    const timer = setTimeout(() => saveRef.current(true), 1_200);
    return () => clearTimeout(timer);
  }, [canEdit, unsaved, pending, payloadJson]);

  /**
   * The rows an item holds, and the rows no item holds — by the item's local
   * key, so a line under an item whose name is still blank shows where it was
   * put even though the arithmetic counts it loose (a blank row is ignored).
   */
  const rowsOf = (key: string) => lines.map((l, i) => ({ l, i })).filter(({ l }) => l.groupKey === key);
  const loose = lines
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => !groups.some((g) => g.key === l.groupKey));
  const colCount = (hasGroups ? 1 : 0) + 9 + (editable ? 1 : 0);
  /** The item a typed line lands in, or none once the item it named is gone. */
  const intoKey = named.some((g) => g.key === into) ? into : "";
  const pasted = useMemo(() => parseEstimateLines(pasteText, knownUnits), [pasteText, knownUnits]);
  /**
   * WHAT A PASTED TAKEOFF IS WORTH (E4a). A takeoff comes off a spreadsheet as
   * descriptions and quantities; the prices are what the estimator then types
   * forty times. Every pasted line with NO price and a memory is filled from
   * it, and the preview says how many — because a number that appeared without
   * being typed has to be accounted for out loud.
   */
  /**
   * ONE LIST FOR THE PREVIEW AND THE BUTTON, so the table cannot show a
   * different price from the one that will land. It kept the unreadable rows
   * (`line: null`) because the preview has to mark them, and the first version
   * of this filtered them out first — which made the indices disagree and the
   * table print $0.00 under a footer saying three had been priced.
   */
  const previewRows = useMemo(
    () =>
      pasted.map((r) => {
        if (r.parsed === null) return { input: r.input, line: null, remembered: null };
        const remembered = fillFromMemory(priceBook, r.parsed);
        return {
          input: r.input,
          line: remembered
            ? { ...r.parsed, unitCostCents: remembered.unitCostCents, unit: r.parsed.unit || remembered.unit }
            : r.parsed,
          remembered,
        };
      }),
    [pasted, priceBook],
  );
  const readable = previewRows.filter(
    (r): r is { input: string; line: ParsedEstimateLine; remembered: RememberedPrice | null } => r.line !== null,
  );
  const rememberedCount = readable.filter((r) => r.remembered !== null).length;

  /** One line's row. Its first cell is the item it sits in, once the estimate has any. */
  function lineRow(l: LineDraft, i: number) {
    const f = figuresOf(l);
    const blank = l.description.trim() === "";
    return (
      <tr
        key={l.id ?? `new-${i}`}
        data-group={l.groupKey}
        className="border-t border-border/50 align-top"
        onFocus={() => setFocusRow(i)}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && (e.key === "d" || e.key === "D")) {
            e.preventDefault();
            if (editable) duplicateFocused();
            return;
          }
          gridKeyDown(e, l.groupKey);
        }}
      >
        {hasGroups && (
          <td className="px-1 py-1">
            <Select
              value={l.groupKey === "" ? NONE : l.groupKey}
              onValueChange={(v) => setLine(i, { groupKey: v === NONE ? "" : v })}
              disabled={!editable}
            >
              <SelectTrigger aria-label={`Item, line ${i + 1}`} className="h-8 w-36">
                <SelectValue placeholder="Item" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Not in an item</SelectItem>
                {named.map((g) => (
                  <SelectItem key={g.key} value={g.key}>
                    {g.name.trim()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* Only a line IN an item may be kept off the proposal: hidden money needs
                somewhere to hide, or the printed rows stop adding up (ADR 0080). */}
            {clientWording && keyOf(l) !== null && (
              <label className="mt-1.5 flex cursor-pointer items-center gap-1.5 px-0.5 text-xs text-muted-foreground">
                <Checkbox
                  checked={l.clientVisible}
                  onCheckedChange={(v) => setLine(i, { clientVisible: v === true })}
                  aria-label={`Show line ${i + 1} on the proposal`}
                  disabled={!editable}
                />
                Show it
              </label>
            )}
          </td>
        )}
        <td className="px-1 py-1">
          <Select value={l.costCodeId} onValueChange={(v) => setLine(i, { costCodeId: v })} disabled={!editable}>
            <SelectTrigger aria-label={`Cost code, line ${i + 1}`} className="h-8 w-40">
              <SelectValue placeholder="Code" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>No code</SelectItem>
              {codes.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </td>
        <td className="px-1 py-1">
          <Input
            aria-label={`Description, line ${i + 1}`}
            data-cell="description"
            value={l.description}
            onChange={(e) => setLine(i, { description: e.target.value })}
            placeholder="Tile, master bath floor"
            maxLength={300}
            className="h-8 min-w-48"
            disabled={!editable}
          />
          {clientWording && (
            <Input
              aria-label={`What the client reads, line ${i + 1}`}
            data-cell="clientDescription"
              value={l.clientDescription}
              onChange={(e) => setLine(i, { clientDescription: e.target.value })}
              placeholder="What the client reads. Blank uses the line above."
              maxLength={300}
              className="mt-1 h-7 min-w-48 text-xs"
              disabled={!editable}
            />
          )}
          {/* A line you cannot see is a line you will forget, so it says so with the switch off too. */}
          {!l.clientVisible && keyOf(l) !== null && (
            <p className="mt-1 flex items-center gap-1 px-0.5 text-xs text-muted-foreground">
              <EyeOff className="size-3" /> Not on the proposal
            </p>
          )}
        </td>
        <td className="px-1 py-1">
          <Input
            aria-label={`Quantity, line ${i + 1}`}
            data-cell="quantity"
            value={l.quantity}
            onChange={(e) => setLine(i, { quantity: e.target.value })}
            placeholder="1"
            inputMode="decimal"
            className="h-8 w-20 text-right"
            disabled={!editable}
          />
        </td>
        <td className="px-1 py-1">
          <Input
            aria-label={`Unit, line ${i + 1}`}
            data-cell="unit"
            value={l.unit}
            onChange={(e) => setLine(i, { unit: e.target.value })}
            placeholder="ls"
            maxLength={20}
            className="h-8 w-16"
            disabled={!editable}
          />
        </td>
        <td className="px-1 py-1">
          <Input
            aria-label={`Unit cost, line ${i + 1}`}
            data-cell="unitCost"
            value={l.unitCost}
            onChange={(e) => setLine(i, { unitCost: e.target.value })}
            placeholder="0.00"
            inputMode="decimal"
            className="h-8 w-24 text-right"
            disabled={!editable}
          />
        </td>
        <td className="px-1 py-1">
          <Input
            aria-label={`Markup, line ${i + 1}`}
            data-cell="markup"
            value={l.markup}
            onChange={(e) => setLine(i, { markup: e.target.value })}
            placeholder={markup.trim() === "" ? "0" : markup}
            inputMode="decimal"
            className="h-8 w-20 text-right"
            disabled={!editable || l.unitPrice.trim() !== ""}
          />
        </td>
        <td className="px-1 py-1">
          <Input
            aria-label={`Unit price, line ${i + 1}`}
            data-cell="unitPrice"
            value={l.unitPrice}
            onChange={(e) => setLine(i, { unitPrice: e.target.value })}
            placeholder="by markup"
            inputMode="decimal"
            className="h-8 w-24 text-right"
            disabled={!editable}
          />
        </td>
        <td className="px-1 py-2 text-right tabular-nums text-muted-foreground">
          {blank ? "—" : fmt(lineCostCents(f), symbol)}
        </td>
        <td className="px-1 py-2 text-right tabular-nums">
          {blank ? "—" : fmt(linePriceCents(f, terms.markupPpm), symbol)}
        </td>
        {editable && (
          <td className="px-1 py-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              disabled={lines.length === 1}
              onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))}
            >
              <Trash2 className="size-4" />
              <span className="sr-only">Remove line {i + 1}</span>
            </Button>
          </td>
        )}
      </tr>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border/60 p-4">
        <div className="grid gap-3 sm:grid-cols-[8rem_1fr_10rem]">
          <div className="space-y-1.5">
            <Label htmlFor="est-number">Number</Label>
            <Input id="est-number" value={number} onChange={(e) => setNumber(e.target.value)} maxLength={40} disabled={!canEdit} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="est-title">Title</Label>
            <Input id="est-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} disabled={!canEdit} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="est-status">Status</Label>
            <Select value={status} onValueChange={changeStatus} disabled={!canEdit || locked}>
              <SelectTrigger className="w-full" id="est-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ESTIMATE_STATUSES.filter((s) => s !== "accepted" || locked).map((s) => (
                  <SelectItem key={s} value={s}>
                    {ESTIMATE_STATUS_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="est-sent">Sent</Label>
            <Input id="est-sent" type="date" value={sentOn} onChange={(e) => setSentOn(e.target.value)} disabled={!canEdit} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="est-valid">Valid until</Label>
            <Input id="est-valid" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} disabled={!canEdit} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="est-decided">Decided</Label>
            <Input id="est-decided" type="date" value={decidedOn} onChange={(e) => setDecidedOn(e.target.value)} disabled={!canEdit} />
          </div>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="est-markup">Markup on cost, %</Label>
            <Input id="est-markup" value={markup} onChange={(e) => setMarkup(e.target.value)} placeholder="0" inputMode="decimal" disabled={!editable} />
            <p className="text-xs text-muted-foreground">Every line takes this unless it says otherwise.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="est-overhead">Overhead, %</Label>
            <Input id="est-overhead" value={overhead} onChange={(e) => setOverhead(e.target.value)} placeholder="0" inputMode="decimal" disabled={!editable} />
            <p className="text-xs text-muted-foreground">On the lines&apos; price.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="est-profit">Profit, %</Label>
            <Input id="est-profit" value={profit} onChange={(e) => setProfit(e.target.value)} placeholder="0" inputMode="decimal" disabled={!editable} />
            <p className="text-xs text-muted-foreground">On the price plus overhead.</p>
          </div>
        </div>
        {locked && (
          <p className="mt-3 text-xs text-muted-foreground">
            Accepted, so the rates, the lines and the proposal&apos;s words are fixed. To revise, start a new estimate and mark this one superseded.
          </p>
        )}
      </div>

      <div className="rounded-lg border border-border/60 p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-heading text-sm font-medium tracking-heading">Lines</h2>
          {editable && (
            <div className="flex items-center gap-1">
              <label className="mr-2 flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                <Checkbox
                  checked={clientWording}
                  onCheckedChange={(v) => setClientWording(v === true)}
                  aria-label="Show the client wording on every line"
                />
                Client wording
              </label>
              <Button type="button" variant="ghost" size="sm" onClick={() => setGroups((prev) => [...prev, emptyGroup()])}>
                <FolderPlus className="mr-1.5 size-4" /> Add item
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => addLine("")}>
                <Plus className="mr-1.5 size-4" /> Add line
              </Button>
            </div>
          )}
        </div>
        {/*
          `relative` is load-bearing, not decoration. The row buttons carry
          `sr-only` labels, which Tailwind makes `position: absolute` — so
          without a positioned ancestor here their containing block is the PAGE,
          they sit at their static x (past 1,200px on this table) and they
          stretch the DOCUMENT's scroll width even though the table itself is
          clipped. That is what made this screen scroll sideways by 276px:
          `overflow-x-auto` never clipped them, because it was not their
          containing block. One word fixes it and the table still scrolls in its
          own box.
        */}
        <div ref={gridRef} className="relative overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr>
                {hasGroups && <th className="px-1 py-1.5 text-left">Item</th>}
                <th className="px-1 py-1.5 text-left">Cost code</th>
                <th className="px-1 py-1.5 text-left">Description</th>
                <th className="px-1 py-1.5 text-right">Qty</th>
                <th className="px-1 py-1.5 text-left">Unit</th>
                <th className="px-1 py-1.5 text-right">Unit cost</th>
                <th className="px-1 py-1.5 text-right">Markup %</th>
                <th className="px-1 py-1.5 text-right">Unit price</th>
                <th className="px-1 py-1.5 text-right">Cost</th>
                <th className="px-1 py-1.5 text-right">Price</th>
                {editable && <th className="w-8" />}
              </tr>
            </thead>
            <tbody>
              {groups.map((g, gi) => {
                const money = groupMoney(g);
                const own = rowsOf(g.key);
                return (
                  <Fragment key={g.key}>
                    <tr className="border-t-2 border-border bg-muted/30 align-top">
                      <td className="px-1 py-1.5" colSpan={3}>
                        <Input
                          aria-label={`Item name, item ${gi + 1}`}
                          value={g.name}
                          onChange={(e) => setGroup(gi, { name: e.target.value })}
                          placeholder="Tile flooring, master and hall baths"
                          maxLength={200}
                          className="h-8 min-w-48 font-medium"
                          disabled={!editable}
                        />
                        {/*
                          The item's money lives UNDER ITS NAME, not in the Cost and Price
                          columns where it would line up with its lines: the table is wider
                          than the page and those columns are the first thing to go off the
                          right edge — and an item's margin is the number that says whether
                          a round price was a safe one. It has to be readable without
                          scrolling anything.
                        */}
                        {/* The price and the margin FIRST: on a phone this line is cut off at the
                            right edge, and the last thing to lose is what the client pays and
                            what it leaves. */}
                        <p className="mt-1 px-0.5 text-xs text-muted-foreground tabular-nums">
                          {fmt(money.priceCents, symbol)} to the client
                          {money.priceCents > 0 && (
                            <>
                              {" · "}
                              <span className="font-medium text-foreground">
                                {fmt(money.marginCents, symbol)} margin
                              </span>{" "}
                              · {((money.marginCents / money.priceCents) * 100).toFixed(1)}%
                            </>
                          )}
                          {" · "}
                          {fmt(money.costCents, symbol)} cost
                          {money.lineCount === 0 && " · no lines under it yet"}
                        </p>
                      </td>
                      <td className="px-1 py-1.5" colSpan={3}>
                        <Select
                          value={g.priceMode}
                          onValueChange={(v) => setGroup(gi, { priceMode: v as GroupPriceMode })}
                          disabled={!editable}
                        >
                          <SelectTrigger aria-label={`How item ${gi + 1} is priced`} className="h-8">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {GROUP_PRICE_MODES.map((m) => (
                              <SelectItem key={m} value={m}>
                                {GROUP_PRICE_MODE_LABELS[m]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-1 py-1.5" colSpan={2}>
                        {g.priceMode === "fixed" ? (
                          <Input
                            aria-label={`Price the client pays, item ${gi + 1}`}
                            value={g.fixedPrice}
                            onChange={(e) => setGroup(gi, { fixedPrice: e.target.value })}
                            placeholder="0.00"
                            inputMode="decimal"
                            className="ml-auto h-8 w-28 text-right"
                            disabled={!editable}
                          />
                        ) : (
                          <span className="block text-right text-xs text-muted-foreground">Its lines add up</span>
                        )}
                      </td>
                      <td colSpan={2} />
                      {editable && (
                        <td className="whitespace-nowrap px-1 py-1">
                          {/* An assembly is this item, saved — E6, ADR 0086. */}
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            onClick={() => openSaveAssembly(g.key)}
                            disabled={rowsOf(g.key).every((r) => r.l.description.trim() === "")}
                          >
                            <Package className="size-4" />
                            <span className="sr-only">Save item {gi + 1} as an assembly</span>
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            onClick={() => removeGroup(g.key)}
                          >
                            <Trash2 className="size-4" />
                            <span className="sr-only">Remove item {gi + 1}; its lines stay, on their own</span>
                          </Button>
                        </td>
                      )}
                    </tr>
                    <tr>
                      <td colSpan={colCount} className="px-1 pb-1">
                        <Input
                          aria-label={`What the client reads under item ${gi + 1}`}
                          value={g.clientNote}
                          onChange={(e) => setGroup(gi, { clientNote: e.target.value })}
                          placeholder="One sentence the client reads under this item on the proposal. Optional."
                          maxLength={4000}
                          className="h-8 w-full"
                          disabled={!editable}
                        />
                      </td>
                    </tr>
                    {own.map(({ l, i }) => lineRow(l, i))}
                    {editable && (
                      <tr>
                        <td colSpan={colCount} className="px-1 pb-2">
                          <Button type="button" variant="ghost" size="sm" onClick={() => addLine(g.key)}>
                            <Plus className="mr-1.5 size-4" /> Add line to {g.name.trim() || `item ${gi + 1}`}
                          </Button>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {hasGroups && loose.length > 0 && (
                <tr>
                  <td
                    colSpan={colCount}
                    className="px-1 pt-3 text-xs uppercase tracking-wide text-muted-foreground"
                  >
                    Not in an item
                  </td>
                </tr>
              )}
              {loose.map(({ l, i }) => lineRow(l, i))}
            </tbody>
          </table>
        </div>
        {editable && (
          <div className="mt-3 space-y-1.5 border-t border-border/50 pt-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <Input
                  ref={entryRef}
                  aria-label="Type a line"
                  value={entry}
                  onChange={(e) => {
                    setEntry(e.target.value);
                    setEntryError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitEntry();
                      return;
                    }
                    /**
                     * Tab takes the remembered price — and ONLY when one is
                     * showing, so Tab still moves focus the rest of the time
                     * and nobody is trapped in the field.
                     */
                    if (e.key === "Tab" && !e.shiftKey && entryMemory) {
                      e.preventDefault();
                      commitEntry(true);
                    }
                  }}
                  placeholder="320 sf tile @ 4.20"
                  maxLength={400}
                  className="h-9 pr-9"
                />
                <CornerDownLeft className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              </div>
              {hasGroups && (
                <Select value={intoKey === "" ? NONE : intoKey} onValueChange={(v) => setInto(v === NONE ? "" : v)}>
                  <SelectTrigger aria-label="The item a typed line lands in" className="h-9 w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Not in an item</SelectItem>
                    {named.map((g) => (
                      <SelectItem key={g.key} value={g.key}>
                        {g.name.trim()}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Button type="button" variant="outline" size="sm" onClick={() => setPasteOpen(true)}>
                <ClipboardPaste className="mr-1.5 size-4" /> Paste lines
              </Button>
              {assemblies.length > 0 && (
                <Button type="button" variant="outline" size="sm" onClick={() => setDropOpen(true)}>
                  <Package className="mr-1.5 size-4" /> Add an assembly
                </Button>
              )}
            </div>
            {entryError === null && entryMemory ? (
              <p className="text-xs">
                <span className="text-muted-foreground">Last priced</span>{" "}
                <span className="font-medium tabular-nums text-foreground">
                  {priceHint(entryMemory, fmt(entryMemory.unitCostCents, symbol), today())}
                </span>{" "}
                <span className="text-muted-foreground">
                  — <strong className="text-foreground">Tab</strong> to use it, Enter to leave it blank
                </span>
              </p>
            ) : entryError === null ? (
              <p className="text-xs text-muted-foreground">
                Type a line and press Enter. <code className="text-foreground">320 sf tile @ 4.20</code>
                {" · "}
                <code className="text-foreground">tile labour 320 sf @ 3.50</code>
                {" · "}
                <code className="text-foreground">plumbing rough 12000</code> for a lump sum. The{" "}
                <code className="text-foreground">@</code> is optional. <strong>Ctrl+D</strong> in a row copies it.
              </p>
            ) : (
              <p className="text-xs text-destructive">{entryError}</p>
            )}
          </div>
        )}

        <Dialog open={pasteOpen} onOpenChange={setPasteOpen}>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Paste lines</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                One line each, in the same words the box under the table takes — or straight out of a spreadsheet,
                columns and all. Every line is shown below before anything is added
                {hasGroups && intoKey !== "" ? `, and they land in ${named.find((g) => g.key === intoKey)?.name.trim() ?? "the item"}` : ""}.
              </p>
              <Textarea
                aria-label="The lines to add"
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                rows={6}
                placeholder={"320 sf tile @ 4.20\ntile labour 320 sf @ 3.50\nplumbing rough 12000"}
                className="font-mono text-xs"
              />
              {pasted.length > 0 && (
                <div className="max-h-64 overflow-y-auto rounded-md border border-border/60">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-muted/60 text-muted-foreground">
                      <tr>
                        <th className="px-2 py-1.5 text-left">Description</th>
                        <th className="px-2 py-1.5 text-right">Qty</th>
                        <th className="px-2 py-1.5 text-left">Unit</th>
                        <th className="px-2 py-1.5 text-right">Unit cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((r, i) => (
                        <tr key={i} className="border-t border-border/50">
                          {r.line === null ? (
                            <td colSpan={4} className="px-2 py-1.5 text-destructive">
                              Could not read <span className="font-mono">{r.input}</span> — it will be left out
                            </td>
                          ) : (
                            <>
                              <td className="px-2 py-1.5">
                                {r.line.description}
                                {r.remembered && (
                                  <span className="block text-muted-foreground">
                                    priced from {r.remembered.projectNumber},{" "}
                                    {howLongAgo(r.remembered.pricedOn, today())}
                                  </span>
                                )}
                              </td>
                              <td className="px-2 py-1.5 text-right tabular-nums">
                                {r.line.quantityThousandths === 1000 && r.line.unit === ""
                                  ? "—"
                                  : thousandthsToQuantityString(r.line.quantityThousandths)}
                              </td>
                              <td className="px-2 py-1.5">{r.line.unit || "—"}</td>
                              <td
                                className={`px-2 py-1.5 text-right tabular-nums${
                                  r.remembered ? " font-medium" : ""
                                }`}
                              >
                                {fmt(r.line.unitCostCents, symbol)}
                              </td>
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <DialogFooter className="sm:justify-between">
              {rememberedCount > 0 ? (
                <p className="text-xs text-muted-foreground sm:self-center">
                  <span className="font-medium text-foreground">{rememberedCount}</span> priced from what you
                  charged last time. Check them — a price can be a year old.
                </p>
              ) : (
                <span />
              )}
              <Button
                type="button"
                disabled={readable.length === 0}
                onClick={() => {
                  setLines((prev) => [...prev, ...readable.map((r) => draftOf(r.line, intoKey))]);
                  setPasteText("");
                  setPasteOpen(false);
                }}
              >
                Add {readable.length} {readable.length === 1 ? "line" : "lines"}
                {pasted.length > readable.length ? `, leave out ${pasted.length - readable.length}` : ""}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Save this item as an assembly (E6, ADR 0086). */}
        <Dialog open={saveFor !== null} onOpenChange={(o) => !o && setSaveFor(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Save this item as an assembly</DialogTitle>
              <DialogDescription>
                Its lines, their quantities and their cost codes, kept so the next job can have them. It goes in
                at the size you say it is per, and scales from there.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="asm-name">Call it</Label>
                <Input
                  id="asm-name"
                  value={asmName}
                  onChange={(e) => setAsmName(e.target.value)}
                  placeholder="Tile flooring"
                  maxLength={160}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-[8rem_8rem]">
                <div className="space-y-1.5">
                  <Label htmlFor="asm-per">It is per</Label>
                  <Input
                    id="asm-per"
                    value={asmPer}
                    onChange={(e) => setAsmPer(e.target.value)}
                    inputMode="decimal"
                    placeholder="320"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="asm-unit">Of</Label>
                  <Input
                    id="asm-unit"
                    value={asmUnit}
                    onChange={(e) => setAsmUnit(e.target.value)}
                    maxLength={20}
                    placeholder="sf"
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Guessed from the lines themselves. Drop it at 500 sf later and every quantity scales with it —
                <strong> the costs and markups do not</strong>, because they are already per unit.
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="asm-notes">A note to yourself</Label>
                <Textarea
                  id="asm-notes"
                  value={asmNotes}
                  onChange={(e) => setAsmNotes(e.target.value)}
                  rows={2}
                  maxLength={2000}
                  placeholder="What is in it, what it assumes. Never printed."
                />
              </div>
              {saveFor !== null && (
                <p className="text-xs text-muted-foreground">
                  <strong>{assemblyLinesOf(saveFor).length}</strong> lines will be saved.
                </p>
              )}
            </div>
            <DialogFooter>
              <Button type="button" onClick={commitSaveAssembly} disabled={pending || asmName.trim() === ""}>
                {pending ? "Saving…" : "Save the assembly"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Drop one in: it arrives as a new item with its lines under it. */}
        <Dialog open={dropOpen} onOpenChange={setDropOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add an assembly</DialogTitle>
              <DialogDescription>
                It comes in as an item with its lines underneath, priced as you saved it, with the cost codes
                matched against the code list this estimate uses. A code that list has not got is left blank.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="drop-which">Which one</Label>
                <Select value={dropId} onValueChange={setDropId}>
                  <SelectTrigger id="drop-which" className="w-full">
                    <SelectValue placeholder="Choose an assembly" />
                  </SelectTrigger>
                  <SelectContent>
                    {assemblies.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name} · {a.per} · {a.lineCount} {a.lineCount === 1 ? "line" : "lines"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="drop-qty">How many</Label>
                <Input
                  id="drop-qty"
                  value={dropQty}
                  onChange={(e) => setDropQty(e.target.value)}
                  inputMode="decimal"
                  className="w-32"
                  placeholder={assemblies.find((a) => a.id === dropId)?.per.replace(/^per /, "") ?? "500"}
                />
              </div>
              {dropId !== "" && (
                <p className="text-xs text-muted-foreground">
                  One of these costs{" "}
                  <span className="tabular-nums">
                    {fmt(assemblies.find((a) => a.id === dropId)?.costCents ?? 0, symbol)}
                  </span>{" "}
                  {" "}
                  {assemblies.find((a) => a.id === dropId)?.per}. Check the quantities afterwards — an assembly
                  is a starting point, not a quote.
                </p>
              )}
            </div>
            <DialogFooter className="sm:justify-between">
              {/* A library you cannot take things out of fills up with mistakes. */}
              {dropId !== "" ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => {
                    const gone = assemblies.find((a) => a.id === dropId)?.name ?? "It";
                    startTransition(async () => {
                      const res = await deleteAssemblyAction({ projectId, id: dropId });
                      if ("error" in res) return void toast.error(res.error);
                      toast.success(`${gone} is out of your assemblies. Lines it already made are untouched.`);
                      setDropId("");
                      router.refresh();
                    });
                  }}
                >
                  Take it out of the library
                </Button>
              ) : (
                <span />
              )}
              <Button
                type="button"
                onClick={commitDrop}
                disabled={pending || dropId === "" || dropQty.trim() === ""}
              >
                {pending ? "Adding…" : "Add it"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <p className="mt-2 text-xs text-muted-foreground">
          A line is a quantity of a unit at a cost — a blank quantity is one, a lump sum. It sells at the markup on its
          cost, this line&apos;s or the estimate&apos;s, unless a price per unit is typed, which wins. A line with no
          description is ignored.
          {" "}
          An <strong>item</strong> is what the client buys: name it in their words, put the lines that build it up
          underneath, and the proposal shows the item and its price with the build-up nowhere. Let its lines add up, or
          price it yourself — <strong>a price you type is the price that prints</strong>, so overhead and profit are not
          added to it again. Removing an item leaves its lines; an item with no name is ignored, as a line with no
          description is.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-6">
        {(
          [
            ["Cost", totals.costCents],
            ["Price", totals.subtotalCents],
            ["Overhead", totals.overheadCents],
            ["Profit", totals.profitCents],
            ["Total", totals.totalCents],
            ["Margin", totals.marginCents],
          ] as const
        ).map(([label, cents]) => (
          <div key={label} className="rounded-lg bg-muted/40 px-3 py-2">
            <dt className="text-xs text-muted-foreground">
              {label}
              {label === "Margin" && totals.marginPpm !== null && ` · ${(totals.marginPpm / 10_000).toFixed(1)}%`}
              {label === "Price" && totals.fixedCents > 0 && ` · ${fmt(totals.fixedCents, symbol)} priced by hand`}
            </dt>
            <dd className="text-base font-medium tabular-nums">{fmt(cents, symbol)}</dd>
          </div>
        ))}
      </div>

      {ratesIdle && (
        <p className="text-xs text-muted-foreground">
          Every item is priced by hand, so overhead and profit have nothing left to be taken on and the total is the
          sum of the prices you typed. That is how a typed price works — it is the price that prints — but if you meant
          the rates to apply, let an item&apos;s lines add up instead.
        </p>
      )}

      <div className="rounded-lg border border-border/60 p-4">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-heading text-sm font-medium tracking-heading">Proposal</h2>
          <div className="flex items-center gap-1">
            {/* The brochure is the HTML document; the letter is the PDF ADR 0070 built. */}
            <Button variant="outline" size="sm" asChild>
              <a href={`/api/jobs/estimates/${estimate.id}/document`} target="_blank" rel="noopener noreferrer">
                <BookOpen className="mr-1.5 size-4" /> Open {format === "brochure" ? "brochure" : "document"}
              </a>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href={`/api/jobs/estimates/${estimate.id}/pdf`} target="_blank" rel="noopener noreferrer">
                <FileText className="mr-1.5 size-4" /> Print proposal
              </a>
            </Button>
          </div>
        </div>
        <ClientLinks projectId={projectId} estimateId={estimate.id} shares={shares} canEdit={canEdit} symbol={symbol} />
        <p className="mb-3 text-xs text-muted-foreground">
          What the client is sent: the price as saved, shown the way you choose, with the words below around it.
          Cost, markup, overhead and profit never print — they are in the prices.
        </p>
        <div className="mb-3 grid gap-3 sm:grid-cols-[14rem_1fr]">
          <div className="space-y-1.5">
            <Label htmlFor="est-format">What it is</Label>
            <Select value={format} onValueChange={setFormat} disabled={!canEdit}>
              <SelectTrigger className="w-full" id="est-format">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROPOSAL_FORMATS.map((f) => (
                  <SelectItem key={f} value={f}>
                    {PROPOSAL_FORMAT_LABELS[f]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="est-letter">
              {format === "brochure" ? "The letter it opens with" : "A letter (printed on the brochure only)"}
            </Label>
            <Textarea
              id="est-letter"
              value={letterText}
              onChange={(e) => setLetterText(e.target.value)}
              rows={3}
              maxLength={8000}
              placeholder="Dear Mr and Mrs Shrock, thank you for asking us to price the house at 118 Oak Row…"
              disabled={!editable}
            />
            <p className="text-xs text-muted-foreground">
              {format === "brochure"
                ? "In your own voice, over your name. Each line is its own paragraph; leave it blank and the page is left out."
                : "A letterhead proposal has no page for this. Switch to a brochure and it opens with it."}
            </p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-[14rem_1fr]">
          <div className="space-y-1.5">
            <Label htmlFor="est-presentation">Show the price</Label>
            <Select value={presentation} onValueChange={setPresentation} disabled={!canEdit}>
              <SelectTrigger className="w-full" id="est-presentation">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROPOSAL_PRESENTATIONS.map((p) => (
                  <SelectItem key={p} value={p}>
                    {PROPOSAL_PRESENTATION_LABELS[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Each item&apos;s price, every line, each cost code&apos;s sum, or one figure.
            </p>
            {presentation === "codes" && (
              <label className="flex cursor-pointer items-start gap-2 text-xs text-muted-foreground">
                <Checkbox
                  checked={showCodeNumbers}
                  onCheckedChange={(v) => setShowCodeNumbers(v === true)}
                  aria-label="Print the cost code numbers on the proposal"
                  disabled={!canEdit}
                  className="mt-0.5"
                />
                <span>
                  Print the code numbers too — <span className="tabular-nums">09 30 00 · Tiling</span> rather than{" "}
                  Tiling. Leave it off unless the client is reading a trade breakdown.
                </span>
              </label>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="est-scope">Scope of work</Label>
            <Textarea
              id="est-scope"
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              rows={3}
              maxLength={8000}
              disabled={!editable}
              placeholder="What the price covers, in the client's words."
            />
          </div>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="est-exclusions">Not included</Label>
            <Textarea
              id="est-exclusions"
              value={exclusions}
              onChange={(e) => setExclusions(e.target.value)}
              rows={4}
              maxLength={8000}
              disabled={!editable}
              placeholder="Permits and utility fees. Landscaping. Anything not listed above."
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="est-terms">Terms</Label>
            <Textarea
              id="est-terms"
              value={termsText}
              onChange={(e) => setTermsText(e.target.value)}
              rows={4}
              maxLength={8000}
              disabled={!editable}
              placeholder="The payment schedule, what a change costs, how long the price holds."
            />
            <p className="text-xs text-muted-foreground">A new estimate starts with the terms of the last one you wrote.</p>
          </div>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="est-notes">Notes</Label>
        <Textarea id="est-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={4000} disabled={!canEdit} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {isOwner && (
            <>
              <ApplyToBudgetButton projectId={projectId} estimateId={estimate.id} costCents={totals.costCents} symbol={symbol} />
              <ApplyToScheduleDialog
                projectId={projectId}
                estimateId={estimate.id}
                contracts={contracts}
                totalCents={totals.totalCents}
                itemCount={estimate.groups.length}
                symbol={symbol}
              />
              {!locked && (
                <AcceptEstimateDialog
                  projectId={projectId}
                  estimateId={estimate.id}
                  version={version}
                  contracts={contracts}
                  totalCents={totals.totalCents}
                  symbol={symbol}
                />
              )}
            </>
          )}
        </div>
        {canEdit && (
          <span
            className="mr-3 text-xs text-muted-foreground"
            aria-live="polite"
            data-testid="estimate-save-state"
          >
            {pending
              ? "Saving…"
              : failed
                ? "Not saved — try Save"
                : unsaved
                  ? "Unsaved changes"
                  : "Saved"}
          </span>
        )}
        {canEdit && (
          <Button onClick={() => saveRef.current(false)} disabled={pending || number.trim() === ""}>
            {pending ? "Saving…" : "Save"}
          </Button>
        )}
      </div>
    </div>
  );
}

function ApplyToBudgetButton({
  projectId,
  estimateId,
  costCents,
  symbol,
}: {
  projectId: string;
  estimateId: string;
  costCents: number;
  symbol: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Use as budget
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Make this the budget</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Each cost code&apos;s cost on this estimate — {fmt(costCents, symbol)}{" "}in all, as saved — becomes that
            code&apos;s original budget on the job, replacing what the code had. Lines with no cost code have
            nowhere to land and are left out. Change orders keep revising the budget from there.
          </p>
          <DialogFooter>
            <Button
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await applyEstimateToBudgetAction({ projectId, id: estimateId });
                  if ("error" in result) {
                    toast.error(result.error);
                    return;
                  }
                  toast.success(
                    `Budget set on ${result.codes} ${result.codes === 1 ? "code" : "codes"}${
                      result.uncodedCents > 0 ? ` — ${fmt(result.uncodedCents, symbol)} on lines with no code left out` : ""
                    }`,
                  );
                  setOpen(false);
                  router.refresh();
                })
              }
            >
              {pending ? "Writing…" : "Make it the budget"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ApplyToScheduleDialog({
  projectId,
  estimateId,
  contracts,
  totalCents,
  itemCount,
  symbol,
}: {
  projectId: string;
  estimateId: string;
  contracts: Array<{ id: string; label: string; status: string }>;
  totalCents: number;
  /** How many client-facing items the estimate has, as SAVED: none means there is no choice to offer. */
  itemCount: number;
  symbol: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [contractId, setContractId] = useState(contracts.length === 1 ? contracts[0].id : "");
  // By item once there are items: the schedule the owner certifies against should
  // read like the proposal they signed, not like the takeoff behind it (ADR 0079).
  const [shape, setShape] = useState<"group" | "line">(itemCount > 0 ? "group" : "line");
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} disabled={contracts.length === 0}>
        Use as schedule of values
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Make this the schedule of values</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {shape === "group"
                ? "One schedule line per item, and one for every line in no item, each at its price"
                : "One schedule line per estimate line at its price"}
              , with overhead and profit spread across them in proportion, so the schedule adds up to the
              estimate&apos;s total — {fmt(totalCents, symbol)}{" "}as saved — replacing the contract&apos;s schedule. A
              line sold at a price per unit keeps billing by the quantity, its unit price raised by the same share. A
              line an application has billed against cannot be removed.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="ats-contract">Contract</Label>
              <Select value={contractId} onValueChange={setContractId}>
                <SelectTrigger className="w-full" id="ats-contract">
                  <SelectValue placeholder="Which agreement" />
                </SelectTrigger>
                <SelectContent>
                  {contracts.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {itemCount > 0 && (
              <div className="space-y-1.5">
                <Label htmlFor="ats-shape">Written</Label>
                <Select value={shape} onValueChange={(v) => setShape(v as "group" | "line")}>
                  <SelectTrigger className="w-full" id="ats-shape">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="group">
                      By item — {itemCount} {itemCount === 1 ? "item" : "items"}, as the proposal shows them
                    </SelectItem>
                    <SelectItem value="line">Line by line — the whole takeoff</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              disabled={pending || contractId === ""}
              onClick={() =>
                startTransition(async () => {
                  const result = await applyEstimateToScheduleAction({
                    projectId,
                    id: estimateId,
                    contractId,
                    shape,
                  });
                  if ("error" in result) {
                    toast.error(result.error);
                    return;
                  }
                  toast.success(`Schedule written: ${result.lines} ${result.lines === 1 ? "line" : "lines"}, ${fmt(result.scheduledCents, symbol)}`);
                  setOpen(false);
                  router.refresh();
                })
              }
            >
              {pending ? "Writing…" : "Make it the schedule"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function AcceptEstimateDialog({
  projectId,
  estimateId,
  version,
  contracts,
  totalCents,
  symbol,
}: {
  projectId: string;
  estimateId: string;
  version: number;
  contracts: Array<{ id: string; label: string; status: string }>;
  totalCents: number;
  symbol: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [contractId, setContractId] = useState(contracts.length === 1 ? contracts[0].id : "");
  const [decidedOn, setDecidedOn] = useState(today());
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)} disabled={contracts.length === 0}>
        Accept
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Accept this estimate</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              The client said yes. The estimate becomes the contract&apos;s value — {fmt(totalCents, symbol)}, as saved —
              and is fixed from here; a signed contract&apos;s value is refused, and moves by change order.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="acc-contract">Contract</Label>
              <Select value={contractId} onValueChange={setContractId}>
                <SelectTrigger className="w-full" id="acc-contract">
                  <SelectValue placeholder="Which agreement it priced" />
                </SelectTrigger>
                <SelectContent>
                  {contracts.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="acc-decided">Accepted on</Label>
              <Input id="acc-decided" type="date" value={decidedOn} onChange={(e) => setDecidedOn(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button
              disabled={pending || contractId === "" || decidedOn === ""}
              onClick={() =>
                startTransition(async () => {
                  const result = await acceptEstimateAction({ projectId, id: estimateId, contractId, decidedOn, version });
                  if ("error" in result) {
                    toast.error(result.error);
                    return;
                  }
                  toast.success("Estimate accepted");
                  setOpen(false);
                  router.refresh();
                })
              }
            >
              {pending ? "Accepting…" : "Accept"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * THE CLIENT'S LINK, AND WHAT CAME BACK ON IT (E5c, ADR 0085).
 *
 * A builder's view of an anonymous surface, so it says things the visitor's
 * page never does: which links are open, which expired, which was revoked,
 * and — the one that matters — **who accepted, when, and at what price**.
 *
 * The acceptance is evidence, not a state change: the estimate is still
 * accepted by an owner, onto a contract, from the button above. This block is
 * the reason to press it.
 */
function ClientLinks({
  projectId,
  estimateId,
  shares,
  canEdit,
  symbol,
}: {
  projectId: string;
  estimateId: string;
  shares: ShareView[];
  canEdit: boolean;
  symbol: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const signed = shares.find((s) => s.signedAt !== null);
  const live = shares.filter((s) => s.standing === "open" || s.standing === "signed");

  const copy = (url: string, note: string) => {
    void navigator.clipboard.writeText(url).then(
      () => toast.success(note),
      // A clipboard a browser refused is not a failure worth hiding.
      () => toast.message("Copy this link", { description: url }),
    );
  };

  const make = () => {
    startTransition(async () => {
      const res = await createEstimateShareAction({ projectId, id: estimateId });
      if ("error" in res) return void toast.error(res.error);
      copy(res.url, "Link made and copied — paste it into your email");
      router.refresh();
    });
  };

  const reveal = (shareId: string) => {
    startTransition(async () => {
      const res = await revealEstimateShareTokenAction({ projectId, id: estimateId, shareId });
      if ("error" in res) return void toast.error(res.error);
      copy(res.url, "Link copied");
    });
  };

  const revoke = (shareId: string) => {
    startTransition(async () => {
      const res = await revokeEstimateShareAction({ projectId, id: estimateId, shareId });
      if ("error" in res) return void toast.error(res.error);
      toast.success("Link revoked");
      router.refresh();
    });
  };

  return (
    <div className="mb-3 rounded-lg border border-border/60 p-3">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">The client&apos;s link</h3>
        {canEdit && (
          <Button variant="outline" size="sm" onClick={make} disabled={pending}>
            <Link2 className="mr-1.5 size-4" /> {live.length > 0 ? "New link" : "Make a link"}
          </Button>
        )}
      </div>

      {signed && signed.signedAt && (
        <div className="mb-2 rounded-md border border-emerald-600/30 bg-emerald-600/10 p-2.5 text-sm">
          <span className="font-medium">{signed.signedName}</span> accepted this proposal on{" "}
          {new Date(signed.signedAt).toLocaleDateString()}
          {signed.signedTotalCents !== null && <> at {fmt(signed.signedTotalCents, symbol)}</>}.
          <p className="mt-1 text-xs text-muted-foreground">
            That is their acceptance on the record. The estimate itself is still accepted here, onto the contract it
            priced — the button below.
          </p>
        </div>
      )}

      {shares.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Send the client a link instead of an attachment: they read the proposal on any device and accept it by
          typing their name. The link stops working on{" "}
          <span className="tabular-nums">the date the proposal is valid until</span>, or in thirty days when there is
          no date.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {shares.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant={s.standing === "signed" ? "default" : s.standing === "open" ? "secondary" : "outline"}>
                {SHARE_STANDING_LABELS[s.standing]}
              </Badge>
              <span className="text-muted-foreground">
                {s.viewCount === 0
                  ? "Not opened yet"
                  : `Opened ${s.viewCount} ${s.viewCount === 1 ? "time" : "times"}`}
                {s.lastViewedAt && `, last on ${new Date(s.lastViewedAt).toLocaleDateString()}`}
              </span>
              <span className="text-muted-foreground">
                · {s.standing === "expired" ? "Expired" : "Expires"} {new Date(s.expiresAt).toLocaleDateString()}
              </span>
              {canEdit && s.standing === "open" && (
                <>
                  <Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => reveal(s.id)} disabled={pending}>
                    <Copy className="mr-1 size-3.5" /> Copy
                  </Button>
                  <Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => revoke(s.id)} disabled={pending}>
                    Revoke
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {shares.some((s) => s.standing === "superseded") && (
        <p className="mt-2 text-xs text-muted-foreground">
          A link reading <span className="font-medium">Estimate changed</span> was accepted and then the estimate was
          edited, so it has stopped working — it cannot go on showing a document that is not the one that was signed.
          The acceptance stands, at the version it names. Make a new link for the revision.
        </p>
      )}
    </div>
  );
}
