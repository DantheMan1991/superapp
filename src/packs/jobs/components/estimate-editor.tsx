"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import {
  BookOpen,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardPaste,
  Copy,
  CornerDownLeft,
  Eye,
  EyeOff,
  FileText,
  FolderPlus,
  GripVertical,
  History,
  Link2,
  Package,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import Link from "next/link";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { StatusBadge, type StatusTone } from "./status-badge";
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
  dragTo,
  dropInSection,
  inVisualOrder,
  lineNumber,
  linesIn,
  moveItem,
  parseAddress,
  placeLine,
  sectionOf,
} from "../estimate-order";
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

/** 2 Sep, the way the header and the folded summaries say a date. */
function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/**
 * THE ITEM COLOURS ON THE RAIL. Four steps down the MODULE's accent — which
 * the jobs route sets — rather than N invented hues: a rail of twelve distinct
 * colours is a chart nobody asked for, and the dot's whole job is to tie a row
 * in the list to a header in the grid. Mixing towards `--card` rather than
 * towards white is what makes the ramp work on the dark theme too.
 */
const RAIL_STEPS = [100, 74, 52, 34];
const railColour = (i: number): string =>
  `color-mix(in oklab, var(--module-accent) ${RAIL_STEPS[i % RAIL_STEPS.length]}%, var(--card))`;

/**
 * WHAT THIS BROWSER REMEMBERS about the screen — which sections are folded
 * shut, whether the hints line is showing. The BROWSER's business, not the
 * server's and not the estimate's, so it never reaches a payload.
 *
 * Read through `useSyncExternalStore` rather than an effect: the server
 * renders the defaults, the client reads what was last chosen on the same
 * commit, and nothing calls `setState` inside an effect — which is the
 * cascading render the lint refuses, and it is right to.
 *
 * `session` is the fallback for a browser that refuses storage: the choice
 * still holds for as long as the tab is open, it is simply not remembered.
 */
const REMEMBERED_EVENT = "yosher:estimate-view";
const session = new Map<string, string>();

function readRemembered(key: string): string {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw !== null) return raw;
  } catch {
    // Storage refused: what was clicked this session still holds.
  }
  return session.get(key) ?? "";
}

function subscribeRemembered(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(REMEMBERED_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(REMEMBERED_EVENT, onChange);
  };
}

/** Never clears a key it did not write. */
function writeRemembered(key: string, value: string) {
  session.set(key, value);
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Not remembered, still applied.
  }
  window.dispatchEvent(new Event(REMEMBERED_EVENT));
}

function useRemembered(key: string): [string, (value: string) => void] {
  const value = useSyncExternalStore(
    subscribeRemembered,
    () => readRemembered(key),
    () => "",
  );
  return [value, (next: string) => writeRemembered(key, next)];
}

/**
 * WHAT THE PINNED STACK COSTS. The card header is 60px and the column header
 * 32.5, so an item header pins at 60 narrow and 93 wide — **measured, not
 * rounded**, because `position: sticky` pushes an element DOWN to its `top`
 * even when it has not been scrolled. A `top` larger than the stack floats
 * every item header below its own first row, with a gap where the rows show
 * through; a `top` smaller leaves it under the column header. Both look like
 * the sticky is broken, and neither is.
 *
 * This constant is the same distance plus the column's 20px padding, for the
 * two places that scroll something out from under the stack by hand.
 */
const STICKY_STACK = 116;

const STATUS_TONES: Record<string, StatusTone> = {
  accepted: "good",
  sent: "info",
  draft: "pending",
  declined: "quiet",
  superseded: "quiet",
};

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
  /** The heading it prints under. A label, never a code. */
  section: string;
  /** Whether the client sees what is in it. */
  showLines: boolean;
  priceMode: GroupPriceMode;
  fixedPrice: string;
}

let nextKey = 0;
const emptyGroup = (): GroupDraft => ({
  id: null,
  key: `new-item-${(nextKey += 1)}`,
  name: "",
  clientNote: "",
  section: "",
  showLines: true,
  priceMode: "rollup",
  fixedPrice: "",
});

interface LineDraft {
  id: string | null;
  /**
   * WHAT THIS ROW IS CALLED FOR AS LONG AS IT EXISTS — its id once it has one,
   * a local key until then. React's key, dnd-kit's id and `focusRow` are all
   * this, because the alternative (the row's index) changes the moment
   * anything is reordered, and a Ctrl+D that copies the wrong row is worse
   * than one that does nothing.
   */
  key: string;
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

let nextLineKey = 0;
const emptyLine = (groupKey = ""): LineDraft => ({
  id: null,
  key: `new-line-${(nextLineKey += 1)}`,
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
    section: string;
    showLines: boolean;
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

/** What the saved lines add up to per cost code, worked out on the server. */
export interface ByCodeRow {
  costCodeId: string | null;
  codeLabel: string | null;
  costCents: number;
  priceCents: number;
}

/** Which folded sections are open. Kept per estimate in `localStorage`. */
interface OpenSections {
  details: boolean;
  rates: boolean;
  proposal: boolean;
  codes: boolean;
}

/**
 * THE ESTIMATE EDITOR — a working panel, not a page (E8).
 *
 * One panel with its own height: a header that always shows what the client
 * pays, a rail that says where that money is and how it was built, and a work
 * column whose orientation furniture — the column headers, the item you are
 * inside, the entry bar — is pinned. On an estimate of eighty lines nothing
 * you need to keep your place ever scrolls away.
 *
 * **COST AND PRICE ARE TWO NUMBERS ON EVERY LINE.** A line sells at a markup
 * on its cost — the line's own or the estimate's default — unless a price per
 * unit is typed, which is how a unit-price bid is written. The extended
 * figures are never typed; the same rule the change order and the schedule of
 * values keep.
 *
 * **AN ACCEPTED ESTIMATE IS FIXED.** Its money became a contract's value, a
 * budget or a schedule; the rates and lines are shown and not sent. Revise by
 * starting a new one and marking this one superseded.
 *
 * **EVERY ROW HAS A NUMBER AND THE NUMBER IS AN ADDRESS** (ADR 0087): drag it
 * by the grip, or type where it should be. See `estimate-order.ts`.
 */
export function EstimateEditor({
  projectId,
  projectLabel,
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
  byCode,
}: {
  projectId: string;
  /** "Job 24-118 · 118 Oak Row" — worded by the page, so the editor holds no vocabulary. */
  projectLabel: string;
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
  byCode: ByCodeRow[];
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
   * Writing the client's words is a pass of its own, so the item's own
   * sentence is behind one switch and off by default: a second input under
   * every item header would slow down typing a takeoff. A line's client
   * wording lives in that line's expansion, which is opt-in already.
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
          key: l.id,
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
      section: g.section,
      showLines: g.showLines,
      priceMode: g.priceMode === "fixed" ? "fixed" : "rollup",
      fixedPrice: g.fixedPriceCents === null ? "" : (g.fixedPriceCents / 100).toFixed(2),
    })),
  );
  const named = groups.filter((g) => g.name.trim() !== "");
  const groupFigures = named.map((g) => ({
    id: g.key,
    priceMode: g.priceMode,
    showLines: g.showLines,
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
   * The sections IN THE ORDER THEY ARE DRAWN — every item, named or not, and
   * then the loose pile. `named` is what the arithmetic counts; this is what
   * the screen shows and therefore what a dragged row is addressed against.
   */
  const sectionKeys = useMemo(() => groups.map((g) => g.key), [groups]);

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
  /** The row the cursor is in, BY KEY, so Ctrl+D knows what to copy after a reorder. */
  const [focusRow, setFocusRow] = useState<string | null>(null);

  /* ------------------------------------------------------- what is unfolded */

  const isNew = estimate.number.trim() === "" || estimate.title.trim() === "";
  const signedShare = shares.find((s) => s.signedAt !== null) ?? null;
  const [openRows, setOpenRows] = useState<Set<string>>(new Set());
  const [collapsedItems, setCollapsedItems] = useState<Set<string>>(new Set());
  const [pinnedItem, setPinnedItem] = useState<string | null>(null);

  const foldKey = `estimate-sections:${estimate.id}`;
  const [storedFolds, setStoredFolds] = useRemembered(foldKey);
  const [storedHints, setStoredHints] = useRemembered("estimate-hints");
  const showHints = storedHints !== "off";

  /**
   * Shut by default except Lines — but a BRAND-NEW estimate opens Details,
   * because it has no number yet, and a SIGNED share force-opens the proposal,
   * because that acceptance is the reason this page was opened. Both beat the
   * remembered choice.
   */
  const open = useMemo<OpenSections>(() => {
    const base: OpenSections = {
      details: isNew,
      rates: false,
      proposal: signedShare !== null,
      codes: false,
    };
    if (storedFolds === "") return base;
    try {
      const stored = JSON.parse(storedFolds) as Partial<OpenSections>;
      return {
        details: stored.details ?? base.details,
        rates: stored.rates ?? base.rates,
        proposal: (stored.proposal ?? false) || base.proposal,
        codes: stored.codes ?? base.codes,
      };
    } catch {
      return base;
    }
  }, [storedFolds, isNew, signedShare]);

  const setOpenSections = (next: OpenSections) => setStoredFolds(JSON.stringify(next));
  const toggleSection = (which: keyof OpenSections) =>
    setOpenSections({ ...open, [which]: !open[which] });
  const toggleHints = () => setStoredHints(showHints ? "off" : "on");

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

  function setLine(key: string, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
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
      const at = prev.findIndex((l) => l.key === focusRow);
      if (at < 0) return prev;
      const copy = { ...prev[at], id: null, key: `new-line-${(nextLineKey += 1)}` };
      return [...prev.slice(0, at + 1), copy, ...prev.slice(at + 1)];
    });
  }
  function setGroup(key: string, patch: Partial<GroupDraft>) {
    setGroups((prev) => prev.map((g) => (g.key === key ? { ...g, ...patch } : g)));
  }
  /** Removing an item leaves its lines loose, never deletes what was priced. */
  function removeGroup(key: string) {
    setLines((prev) => prev.map((l) => (l.groupKey === key ? { ...l, groupKey: "" } : l)));
    setGroups((prev) => prev.filter((g) => g.key !== key));
  }
  function addLine(groupKey: string) {
    setLines((prev) => [...prev, emptyLine(groupKey)]);
  }
  function addItem() {
    setGroups((prev) => [...prev, emptyGroup()]);
  }

  /* --------------------------------------------- the order of it (ADR 0087) */

  /** Move an item to a 1-based place, from its number box or from a drag. */
  function moveItemTo(key: string, position: number) {
    setGroups((prev) => moveItem(prev, prev.findIndex((g) => g.key === key), position));
  }

  /**
   * A TYPED NUMBER on a line. `3` is a place in its own item, `3.2` is item 3,
   * place 2 — which is how a line leaves one item for another without a mouse.
   * The loose pile is the section after the last item, so `4.1` on a
   * three-item estimate takes the line out of its item.
   */
  function moveLineTo(key: string, address: { section: number | null; position: number }) {
    setLines((prev) => {
      const row = prev.find((l) => l.key === key);
      if (!row) return prev;
      const sections = [...sectionKeys, ""];
      const here = sectionOf(row, sectionKeys);
      const wanted =
        address.section === null
          ? here
          : (sections[Math.min(address.section, sections.length) - 1] ?? "");
      return placeLine(prev, sectionKeys, key, wanted, address.position);
    });
  }

  const sensors = useSensors(
    // 4px, so a click into a cell is never read as the beginning of a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [dragging, setDragging] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  /**
   * A LINE IS NEVER DROPPED ON AN ITEM'S HEADER BY ACCIDENT. The item wrappers
   * are droppables too — they have to be, or an item with no lines could not be
   * dragged into — so collisions are resolved against the containers of the
   * SAME KIND as what is being dragged, plus the per-section drop zones. Left
   * to itself, `closestCenter` hands back the enclosing item every time,
   * because an item's box is taller than any row inside it.
   */
  const collisions: CollisionDetection = useCallback((args) => {
    const kind = String(args.active.id).split(":")[0];
    const wanted =
      kind === "item"
        ? (id: string) => id.startsWith("item:")
        : (id: string) => id.startsWith("line:") || id.startsWith("zone:");
    return closestCenter({
      ...args,
      droppableContainers: args.droppableContainers.filter((c) => wanted(String(c.id))),
    });
  }, []);

  function onDragStart(e: DragStartEvent) {
    setDragging(String(e.active.id));
    setDragOver(null);
  }
  function onDragOver(e: DragOverEvent) {
    setDragOver(e.over ? String(e.over.id) : null);
  }
  function onDragEnd(e: DragEndEvent) {
    setDragging(null);
    setDragOver(null);
    const active = String(e.active.id);
    const over = e.over ? String(e.over.id) : null;
    if (!over || over === active) return;
    if (active.startsWith("item:") && over.startsWith("item:")) {
      const to = groups.findIndex((g) => g.key === over.slice(5));
      if (to >= 0) moveItemTo(active.slice(5), to + 1);
      return;
    }
    if (!active.startsWith("line:")) return;
    const key = active.slice(5);
    if (over.startsWith("line:")) {
      setLines((prev) => dragTo(prev, sectionKeys, key, over.slice(5)));
      return;
    }
    if (over.startsWith("zone:")) {
      setLines((prev) => dropInSection(prev, sectionKeys, key, over.slice(5)));
    }
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
    const rows = assemblyLinesOf(groupKey);
    const driver = suggestDriver(rows);
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
        {
          key,
          id: null,
          name: res.name,
          clientNote: res.clientNote,
          section: "",
          showLines: true,
          priceMode: "rollup",
          fixedPrice: "",
        },
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
   * already gives — walks sideways through description, unit and cost to get
   * there. **Up and Down move within the column**; Tab is left exactly as it
   * was, because it is the one key a keyboard user must be able to trust.
   *
   * **Left and Right are deliberately NOT claimed.** They move the caret
   * inside the field, and a grid that stole them would make a price with a
   * typo in the middle of it unfixable.
   *
   * Movement is resolved in DOM ORDER, not by index into `lines`: rows are
   * grouped under their items on screen and can be dragged between them, so
   * the row below is a fact about the document rather than about the array,
   * and asking the document costs nothing and cannot disagree with what
   * somebody is looking at.
   */
  const gridRef = useRef<HTMLDivElement>(null);
  const workRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  /**
   * THE PANEL FILLS WHAT IS LEFT OF THE WINDOW, MEASURED.
   *
   * A `calc(100dvh - <a number>)` cannot be right, because the chrome above it
   * is not a number: the job's vitals strip is five cards that wrap to two rows
   * on a narrower window, and the job's name wraps too. Tuned to a wide window
   * the panel hangs 95px below the fold on a narrow one; tuned to a narrow one
   * it wastes a hand's width of screen on every other.
   *
   * So it is measured here and written straight to the node — a DOM write in an
   * effect, which is what effects are for, and no state to re-render. The CSS
   * height in `className` is the first paint before this runs, and below `md`
   * the panel has no height of its own at all.
   */
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const fit = () => {
      if (!window.matchMedia("(min-width: 768px)").matches) {
        el.style.height = "";
        return;
      }
      el.style.height = "";
      const top = el.getBoundingClientRect().top;
      el.style.height = `${Math.max(520, window.innerHeight - top - 16)}px`;
    };
    fit();
    window.addEventListener("resize", fit);
    // The chrome above it changes height on its own — the vitals strip wraps.
    const watch = new ResizeObserver(fit);
    if (el.parentElement) watch.observe(el.parentElement);
    return () => {
      window.removeEventListener("resize", fit);
      watch.disconnect();
    };
  }, []);
  /**
   * WHICH BOX IS ACTUALLY SCROLLING. At `lg` and up the work column has its own
   * overflow; below it the rail sits on top and the two share the body's. Asking
   * rather than assuming is what keeps the rail's jump and the keyboard's
   * scroll-out-from-under-the-header working at every width.
   */
  const scroller = useCallback((): HTMLElement | null => {
    let el: HTMLElement | null = workRef.current;
    while (el) {
      const overflow = window.getComputedStyle(el).overflowY;
      if ((overflow === "auto" || overflow === "scroll") && el.scrollHeight > el.clientHeight + 1) {
        return el;
      }
      el = el.parentElement;
    }
    return (document.scrollingElement as HTMLElement | null) ?? null;
  }, []);
  /**
   * A cell to focus once React has rendered the row that holds it. A REF, not
   * state: there is nothing to re-render for, and clearing state from inside
   * the effect that read it is the cascading render eslint refuses.
   */
  const pendingCell = useRef<{ group: string; col: string } | null>(null);

  function cellsIn(col: string): HTMLInputElement[] {
    const root = gridRef.current;
    if (!root) return [];
    return [...root.querySelectorAll<HTMLInputElement>(`input[data-cell="${col}"]`)].filter(
      // A cell the layout has taken away at this width is not somewhere to go.
      (el) => el.offsetParent !== null,
    );
  }

  /** Focus and SELECT, the spreadsheet idiom: arriving at a cell means retyping it. */
  const goTo = useCallback(
    (cell: HTMLInputElement | undefined) => {
      if (!cell || cell.disabled) return false;
      cell.focus();
      cell.select();
      // The column header and the item's header are pinned over the top of the
      // column; a cell that arrives underneath them has been focused invisibly.
      const column = scroller();
      if (column) {
        const over =
          column.getBoundingClientRect().top + STICKY_STACK - cell.getBoundingClientRect().top;
        if (over > 0) column.scrollTop -= over;
      }
      return true;
    },
    [scroller],
  );

  function gridKeyDown(e: React.KeyboardEvent, groupKey: string) {
    const el = e.target as HTMLElement;
    const col = el.dataset?.cell;
    // A select, a checkbox, the number box or the remove button is not a cell.
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
    const rows = [...root.querySelectorAll<HTMLElement>(`[data-row][data-group="${want.group}"]`)];
    const last = rows[rows.length - 1];
    goTo(last?.querySelector<HTMLInputElement>(`input[data-cell="${want.col}"]`) ?? undefined);
  }, [lines.length, goTo]);

  /** An item's cost and price as the editor shows them, from the same pure arithmetic. */
  function groupMoney(g: GroupDraft) {
    const children = lines
      .filter((l) => l.groupKey === g.key && l.description.trim() !== "")
      .map(figuresOf);
    const fixed = g.priceMode === "fixed" ? toCents(g.fixedPrice) : null;
    const costCents = groupCostCents(children);
    const priceCents = groupPriceCents(
      { id: g.key, priceMode: g.priceMode, showLines: g.showLines, fixedPriceCents: fixed },
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
                section: g.section,
                showLines: g.showLines,
                priceMode: g.priceMode,
                fixedPriceCents: g.priceMode === "fixed" ? g.fixedPrice : "",
              })),
              // In the order shown: each item's lines beneath it, the loose ones last,
              // so what comes back from the database is already grouped — and so the
              // order somebody dragged them into is the order that is saved (ADR 0087).
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

  /* ------------------------------------------------- the client's link, up here */

  const liveShares = shares.filter((s) => s.standing === "open" || s.standing === "signed");
  const linkRef = useRef<HTMLButtonElement>(null);

  const copyLink = (url: string, note: string) => {
    void navigator.clipboard.writeText(url).then(
      () => toast.success(note),
      // A clipboard a browser refused is not a failure worth hiding.
      () => toast.message("Copy this link", { description: url }),
    );
  };

  const makeLink = useCallback(() => {
    startTransition(async () => {
      const res = await createEstimateShareAction({ projectId, id: estimate.id });
      if ("error" in res) return void toast.error(res.error);
      copyLink(res.url, "Link made and copied — paste it into your email");
      router.refresh();
    });
  }, [projectId, estimate.id, router]);

  /**
   * SEND TO CLIENT is the one button the header carries, and it does the one
   * thing the screen exists for. It saves first — what goes out is what is
   * saved, never what is on screen — and then either makes the link or takes
   * you to the one that is already open.
   */
  function sendToClient() {
    saveRef.current(false);
    if (liveShares.length === 0) {
      makeLink();
      return;
    }
    setOpenSections({ ...open, proposal: true });
    window.setTimeout(() => linkRef.current?.focus(), 60);
  }

  /**
   * The rows an item holds, and the rows no item holds — by the item's local
   * key, so a line under an item whose name is still blank shows where it was
   * put even though the arithmetic counts it loose (a blank row is ignored).
   */
  const rowsOf = (key: string) => linesIn(lines, sectionKeys, key);
  const loose = rowsOf("");
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

  /* ------------------------------------------------------------- the rail */

  /** What each section is worth to the client, for the bar and the jump list. */
  const railRows = useMemo(() => {
    const rows = groups.map((g, i) => ({
      key: g.key,
      index: i,
      name: g.name.trim() || `Item ${i + 1}`,
      priceCents: groupMoney(g).priceCents,
      colour: railColour(i),
    }));
    const loosePrice = lines
      .filter((l) => sectionOf(l, sectionKeys) === "" && l.description.trim() !== "")
      .reduce((sum, l) => sum + linePriceCents(figuresOf(l), terms.markupPpm), 0);
    if (loosePrice !== 0 || (groups.length > 0 && loose.length > 0)) {
      rows.push({
        key: "",
        index: groups.length,
        name: "Not in an item",
        priceCents: loosePrice,
        colour: "var(--muted-foreground)",
      });
    }
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, lines, sectionKeys, terms.markupPpm, loose.length]);
  const railWeight = railRows.reduce((sum, r) => sum + Math.max(0, r.priceCents), 0);

  /** Which item's header is currently pinned, so the rail can mark it. */
  const itemHeaderRefs = useRef(new Map<string, HTMLDivElement>());
  useEffect(() => {
    const column = scroller();
    if (!column) return;
    const read = () => {
      const edge = column.getBoundingClientRect().top + STICKY_STACK;
      let here: string | null = null;
      for (const [key, el] of itemHeaderRefs.current) {
        if (el.getBoundingClientRect().top <= edge + 4) here = key;
      }
      setPinnedItem(here);
    };
    read();
    column.addEventListener("scroll", read, { passive: true });
    return () => column.removeEventListener("scroll", read);
  }, [groups.length, scroller]);

  /** Jump the work column to a section. Never `scrollIntoView` — it moves the app shell. */
  function jumpTo(key: string) {
    const column = scroller();
    const el = itemHeaderRefs.current.get(key);
    if (!column || !el) return;
    column.scrollTop += el.getBoundingClientRect().top - column.getBoundingClientRect().top - STICKY_STACK + 8;
  }

  /* --------------------------------------------------------------- pieces */

  const money = (cents: number) => fmt(cents, symbol);
  const marginPercent = totals.marginPpm === null ? null : totals.marginPpm / 10_000;

  const statusTone = STATUS_TONES[status] ?? "quiet";
  const statusLabel =
    status in ESTIMATE_STATUS_LABELS
      ? ESTIMATE_STATUS_LABELS[status as keyof typeof ESTIMATE_STATUS_LABELS]
      : status;

  /** The estimate's coordinates, under its title: only the parts it has. */
  const coordinates = [
    number.trim(),
    status === "sent" && sentOn ? `sent ${shortDate(sentOn)}` : null,
    validUntil ? `valid to ${shortDate(validUntil)}` : null,
    projectLabel,
  ]
    .filter(Boolean)
    .join(" · ");

  /**
   * THE WHOLE GRID'S COLUMN TEMPLATE, in one place so every row lines up — and
   * measured against THE WORK COLUMN, not the window (`@container/work`).
   *
   * The window is the wrong ruler here and it is the bug the 1a layout had: a
   * 1,200px window with the nav open and a 252px rail leaves the grid about
   * 560px, and seven fixed tracks in 560px collapse `minmax(0,1fr)` to **zero**
   * — the description column disappears rather than the table scrolling
   * sideways. Asking the box that actually holds the rows is the only ruler
   * that cannot be wrong.
   *
   * Narrow, the row is two lines — description and price up top, the quantity
   * and the unit cost under them — rather than dropping a cell. Every input
   * stays in the DOM at every width, because the keyboard grid walks the
   * document and a cell that only exists at some widths is a column that
   * sometimes goes nowhere.
   */
  const PAD = "px-2.5 @sm/work:px-[18px]";
  const ROW_GRID =
    `items-center gap-2 ${PAD} grid-cols-[64px_minmax(0,1fr)_78px] ` +
    "@sm/work:grid-cols-[76px_minmax(0,1fr)_92px_34px] " +
    "@3xl/work:grid-cols-[84px_minmax(0,1fr)_92px_100px_112px_34px] " +
    "@5xl/work:grid-cols-[88px_minmax(0,1fr)_96px_104px_108px_116px_34px]";
  const GUTTER_GRID =
    `grid gap-2 ${PAD} grid-cols-[64px_minmax(0,1fr)] @sm/work:grid-cols-[76px_minmax(0,1fr)] ` +
    "@3xl/work:grid-cols-[84px_minmax(0,1fr)] @5xl/work:grid-cols-[88px_minmax(0,1fr)]";
  const AUTO = "@3xl/work:col-start-auto @3xl/work:row-start-auto";
  const FIRST = `col-start-1 row-start-1 ${AUTO}`;
  const CELL_DESC = `col-start-2 row-start-1 min-w-0 ${AUTO}`;
  const CELL_QTY = `col-start-2 row-start-2 ${AUTO}`;
  const CELL_UNITCOST = `col-start-3 row-start-2 ${AUTO}`;
  const CELL_PRICE = `col-start-3 row-start-1 ${AUTO}`;
  // On a phone there is no fourth track, so the bin sits under the row's number.
  const CELL_LAST = `col-start-1 row-start-2 @sm/work:col-start-4 @sm/work:row-start-1 ${AUTO}`;
  const BARE = "border-transparent bg-transparent hover:border-border dark:bg-transparent";

  const lineIds = inVisualOrder(lines, sectionKeys).map((l) => `line:${l.key}`);
  const sortableIds = [...groups.map((g) => `item:${g.key}`), ...lineIds];

  /** One line's row, with its number, its grip and its expansion. */
  function lineRow(l: LineDraft, sectionIndex: number, position: number) {
    const f = figuresOf(l);
    const blank = l.description.trim() === "";
    const inItem = keyOf(l) !== null;
    const group = groups.find((g) => g.key === l.groupKey);
    const insideFixed = group?.priceMode === "fixed" && inItem;
    const expanded = openRows.has(l.key);
    const marginCents = linePriceCents(f, terms.markupPpm) - lineCostCents(f);
    const priceCents = linePriceCents(f, terms.markupPpm);
    return (
      <SortableRow
        key={l.key}
        id={`line:${l.key}`}
        disabled={!editable}
        over={dragOver === `line:${l.key}` && dragging !== `line:${l.key}`}
      >
        {(grip) => (
          <>
            <div
              data-row=""
              data-group={l.groupKey}
              className={cn("grid", ROW_GRID, "border-b border-divider py-[5px]")}
              onFocus={() => setFocusRow(l.key)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && (e.key === "d" || e.key === "D")) {
                  e.preventDefault();
                  if (editable) duplicateFocused();
                  return;
                }
                gridKeyDown(e, l.groupKey);
              }}
            >
              <div className={cn(FIRST, "flex items-center gap-0.5")}>
                {grip}
                <RowNumber
                  value={lineNumber(sectionIndex, position, groups.length > 0)}
                  label={`Where line ${lineNumber(sectionIndex, position, groups.length > 0)} sits`}
                  disabled={!editable}
                  onCommit={(address) => moveLineTo(l.key, address)}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-[26px] shrink-0 rounded-lg"
                  aria-expanded={expanded}
                  onClick={() =>
                    setOpenRows((prev) => {
                      const next = new Set(prev);
                      if (next.has(l.key)) next.delete(l.key);
                      else next.add(l.key);
                      return next;
                    })
                  }
                >
                  {expanded ? (
                    <ChevronDown className="size-[15px] text-subtle-foreground" />
                  ) : (
                    <ChevronRight className="size-[15px] text-subtle-foreground" />
                  )}
                  <span className="sr-only">The rest of this line</span>
                </Button>
              </div>

              <div className={CELL_DESC}>
                <Input
                  aria-label={`Description, line ${lineNumber(sectionIndex, position, groups.length > 0)}`}
                  data-cell="description"
                  value={l.description}
                  onChange={(e) => setLine(l.key, { description: e.target.value })}
                  placeholder="Tile, master bath floor"
                  maxLength={300}
                  className={cn("h-9 px-2 text-sm", BARE)}
                  disabled={!editable}
                />
                {/* A line you cannot see is a line you will forget, so it says so. */}
                {!l.clientVisible && inItem && (
                  <p className="flex items-center gap-1 px-2 text-[11px] text-subtle-foreground">
                    <EyeOff className="size-3" /> off the proposal
                  </p>
                )}
              </div>

              <div className={cn(CELL_QTY, "flex items-center justify-end gap-1")}>
                <Input
                  aria-label={`Quantity, line ${lineNumber(sectionIndex, position, groups.length > 0)}`}
                  data-cell="quantity"
                  value={l.quantity}
                  onChange={(e) => setLine(l.key, { quantity: e.target.value })}
                  placeholder="1"
                  inputMode="decimal"
                  className={cn("h-9 w-[54px] text-right tabular-nums", BARE)}
                  disabled={!editable}
                />
                <Input
                  aria-label={`Unit, line ${lineNumber(sectionIndex, position, groups.length > 0)}`}
                  data-cell="unit"
                  value={l.unit}
                  onChange={(e) => setLine(l.key, { unit: e.target.value })}
                  placeholder="ls"
                  maxLength={20}
                  className={cn("h-9 w-11 px-1.5 text-[13px] text-subtle-foreground", BARE)}
                  disabled={!editable}
                />
              </div>

              <div className={CELL_UNITCOST}>
                <Input
                  aria-label={`Unit cost, line ${lineNumber(sectionIndex, position, groups.length > 0)}`}
                  data-cell="unitCost"
                  value={l.unitCost}
                  onChange={(e) => setLine(l.key, { unitCost: e.target.value })}
                  placeholder="0.00"
                  inputMode="decimal"
                  className={cn("h-9 text-right tabular-nums", BARE)}
                  disabled={!editable}
                />
              </div>

              <div className="hidden text-right text-sm tabular-nums text-muted-foreground @5xl/work:block">
                {blank ? "—" : money(lineCostCents(f))}
              </div>

              <div className={cn(CELL_PRICE, "text-right text-sm font-medium tabular-nums")}>
                {insideFixed ? (
                  <span className="text-[13px] font-normal text-subtle-foreground">in the item</span>
                ) : blank ? (
                  "—"
                ) : (
                  money(priceCents)
                )}
              </div>

              <div className={CELL_LAST}>
                {editable && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    disabled={lines.length === 1}
                    onClick={() => setLines((prev) => prev.filter((x) => x.key !== l.key))}
                  >
                    <Trash2 className="size-[15px]" />
                    <span className="sr-only">
                      Remove line {lineNumber(sectionIndex, position, groups.length > 0)}
                    </span>
                  </Button>
                )}
              </div>
            </div>

            {expanded && (
              <div className="grid grid-cols-1 gap-3.5 border-b border-divider bg-background px-2.5 py-4 @sm/work:grid-cols-2 @sm/work:px-[18px] @sm/work:pl-14 @3xl/work:grid-cols-3 @5xl/work:grid-cols-5">
                <div className="space-y-1">
                  <Label className="text-xs font-medium text-muted-foreground">In item</Label>
                  <Select
                    value={l.groupKey === "" ? NONE : l.groupKey}
                    onValueChange={(v) => setLine(l.key, { groupKey: v === NONE ? "" : v })}
                    disabled={!editable || groups.length === 0}
                  >
                    <SelectTrigger className="h-9 w-full rounded-[10px]">
                      <SelectValue placeholder="Not in an item" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Not in an item</SelectItem>
                      {groups.map((g, gi) => (
                        <SelectItem key={g.key} value={g.key}>
                          {g.name.trim() || `Item ${gi + 1}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-medium text-muted-foreground">Cost code</Label>
                  <Select
                    value={l.costCodeId}
                    onValueChange={(v) => setLine(l.key, { costCodeId: v })}
                    disabled={!editable}
                  >
                    <SelectTrigger className="h-9 w-full rounded-[10px]">
                      <SelectValue placeholder="No code" />
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
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-medium text-muted-foreground">Markup</Label>
                  <Input
                    data-cell="markup"
                    value={l.markup}
                    onChange={(e) => setLine(l.key, { markup: e.target.value })}
                    placeholder={markup.trim() === "" ? "0% — the estimate's" : `${markup}% — the estimate's`}
                    inputMode="decimal"
                    className="h-9 rounded-[10px] text-right tabular-nums"
                    disabled={!editable || l.unitPrice.trim() !== ""}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-medium text-muted-foreground">Price per unit</Label>
                  <Input
                    data-cell="unitPrice"
                    value={l.unitPrice}
                    onChange={(e) => setLine(l.key, { unitPrice: e.target.value })}
                    placeholder="by markup"
                    inputMode="decimal"
                    className="h-9 rounded-[10px] text-right tabular-nums"
                    disabled={!editable}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-medium text-muted-foreground">What the client reads</Label>
                  <Input
                    data-cell="clientDescription"
                    value={l.clientDescription}
                    onChange={(e) => setLine(l.key, { clientDescription: e.target.value })}
                    placeholder="Blank uses the description"
                    maxLength={300}
                    className="h-9 rounded-[10px] text-sm"
                    disabled={!editable}
                  />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 @sm/work:col-span-2 @3xl/work:col-span-3 @5xl/work:col-span-5">
                  {/* Only a line IN an item may be kept off the proposal: hidden money
                      needs somewhere to hide, or the printed rows stop adding up (ADR 0080). */}
                  {inItem ? (
                    <label className="flex cursor-pointer items-center gap-2 text-[13px] text-muted-foreground">
                      <Checkbox
                        checked={l.clientVisible}
                        onCheckedChange={(v) => setLine(l.key, { clientVisible: v === true })}
                        disabled={!editable}
                      />
                      {l.clientVisible ? <Eye className="size-[15px]" /> : <EyeOff className="size-[15px]" />}
                      Shown on the proposal
                    </label>
                  ) : (
                    <span className="text-xs text-subtle-foreground">
                      A line in no item is always shown on the proposal.
                    </span>
                  )}
                  {!blank && (
                    <span className="text-xs tabular-nums text-subtle-foreground">
                      margin {money(marginCents)}
                      {priceCents > 0 && ` · ${((marginCents / priceCents) * 100).toFixed(1)}%`}
                    </span>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </SortableRow>
    );
  }

  /** The "Add a line here" row, which is also where a dragged line can land. */
  function addLineRow(sectionKey: string) {
    return (
      <DropZone id={`zone:${sectionKey}`} over={dragOver === `zone:${sectionKey}`} disabled={!editable}>
        <div className={cn(GUTTER_GRID, "border-b border-divider pb-2 pt-1")}>
          <span />
          {editable && (
            <div>
              <button
                type="button"
                onClick={() => addLine(sectionKey)}
                className="inline-flex h-[30px] items-center gap-1.5 rounded-full px-2 text-[13px] font-medium text-module-accent transition-colors hover:bg-module-accent/10"
              >
                <Plus className="size-3.5" /> Add a line here
              </button>
            </div>
          )}
        </div>
      </DropZone>
    );
  }

  const savedState = pending
    ? "Saving…"
    : failed
      ? "Not saved — try Save"
      : unsaved
        ? "Unsaved changes"
        : "Saved";

  return (
    <div
      ref={panelRef}
      className="flex flex-col rounded-3xl bg-card shadow-elevation-1 md:h-[calc(100dvh-320px)] md:min-h-[520px] md:overflow-hidden"
    >
      {/* ─────────────────────────────────────────────────────── the header bar */}
      <div className="flex flex-none flex-wrap items-center gap-5 rounded-t-3xl border-b border-border bg-card px-6 py-3.5">
        <Link
          href={`/dashboard/m/jobs/${projectId}/estimates`}
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="size-[18px]" />
          <span className="sr-only">Back to the estimates</span>
        </Link>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-heading text-[19px] font-semibold tracking-heading">
              {title.trim() || number.trim() || "Untitled estimate"}
            </h1>
            <StatusBadge tone={statusTone} className="h-5 px-2 text-[11px]">
              {statusLabel}
            </StatusBadge>
          </div>
          {coordinates && <p className="mt-0.5 text-xs text-subtle-foreground">{coordinates}</p>}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-4 lg:gap-6">
          <div>
            <p className="text-[11px] uppercase tracking-[0.04em] text-subtle-foreground">Margin</p>
            <p
              className={cn(
                "text-[15px] font-medium tabular-nums",
                totals.marginCents < 0 ? "text-destructive" : "text-success-foreground",
              )}
            >
              {marginPercent === null ? "—" : `${marginPercent.toFixed(1)}%`}{" "}
              <span className="font-normal text-subtle-foreground">{money(totals.marginCents)}</span>
            </p>
          </div>
          <div className="hidden h-[34px] w-px bg-divider sm:block" />
          <div>
            <p className="text-[11px] uppercase tracking-[0.04em] text-subtle-foreground">The client pays</p>
            <p className="font-heading text-[26px] font-semibold tabular-nums tracking-heading">
              {money(totals.totalCents)}
            </p>
          </div>
          {canEdit && (
            <span
              className="flex items-center gap-1.5 text-xs text-subtle-foreground"
              aria-live="polite"
              data-testid="estimate-save-state"
            >
              {savedState === "Saved" && <Check className="size-3.5" />}
              {savedState}
            </span>
          )}
          {canEdit && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9"
              onClick={() => saveRef.current(false)}
              disabled={pending || number.trim() === ""}
            >
              {pending ? "Saving…" : "Save"}
            </Button>
          )}
          {canEdit && (
            <Button
              type="button"
              className="h-9 rounded-lg px-4"
              onClick={sendToClient}
              disabled={pending || number.trim() === ""}
            >
              Send to client
            </Button>
          )}
        </div>
      </div>

      {/* ───────────────────────────────────────── the body: rail + work column */}
      <div
        ref={bodyRef}
        className="grid min-h-0 flex-1 grid-cols-1 md:overflow-y-auto lg:grid-cols-[252px_minmax(0,1fr)] lg:overflow-hidden"
      >
        {/* ── the rail ── */}
        <div className="flex flex-col gap-5 border-b border-border py-5 pl-6 pr-[18px] lg:overflow-y-auto lg:border-b-0 lg:border-r">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-subtle-foreground">
              Where the money is
            </p>
            <div className="mt-2.5 flex h-2 gap-[0.6%] overflow-hidden rounded-full bg-divider">
              {railWeight > 0 &&
                railRows.map((r) => (
                  <span
                    key={r.key || "loose"}
                    style={{
                      flexBasis: `${(Math.max(0, r.priceCents) / railWeight) * 100}%`,
                      background: r.colour,
                    }}
                    className="h-full rounded-full"
                  />
                ))}
            </div>
            <div className="mt-2 flex flex-col">
              {railRows.length === 0 ? (
                <p className="px-2 py-[7px] text-[13px] text-subtle-foreground">
                  Nothing priced yet. Type a line below and it appears here.
                </p>
              ) : (
                railRows.map((r) => (
                  <button
                    key={r.key || "loose"}
                    type="button"
                    onClick={() => jumpTo(r.key)}
                    className="flex items-start gap-2 rounded-[10px] px-2 py-[7px] text-left transition-colors hover:bg-muted"
                  >
                    <span
                      style={{ background: r.colour }}
                      className="mt-[6px] size-1.5 shrink-0 rounded-full"
                    />
                    <span
                      className={cn(
                        "min-w-0 flex-1 text-[13px] leading-[1.35]",
                        pinnedItem === r.key && "font-medium",
                      )}
                    >
                      {r.name}
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-subtle-foreground">
                      {totals.totalCents > 0
                        ? `${Math.round((r.priceCents / totals.totalCents) * 100)}%`
                        : "—"}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2 border-t border-divider pt-[18px]">
            <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-subtle-foreground">
              How the total is built
            </p>
            {(
              [
                ["Cost", totals.costCents],
                ["Markup", totals.subtotalCents - totals.costCents],
                ["Overhead", totals.overheadCents],
                ["Profit", totals.profitCents],
              ] as const
            ).map(([label, cents]) => (
              <div key={label} className="flex items-baseline justify-between gap-3">
                <span className="text-[13px] text-muted-foreground">{label}</span>
                <span className="text-[13px] tabular-nums">{money(cents)}</span>
              </div>
            ))}
            <div className="flex items-baseline justify-between gap-3 border-t border-divider pt-2">
              <span className="text-[13px] font-medium">Total</span>
              <span className="text-[15px] font-semibold tabular-nums">{money(totals.totalCents)}</span>
            </div>
            {totals.fixedCents > 0 && (
              <p className="text-xs text-subtle-foreground">
                {money(totals.fixedCents)} of this you priced by hand, so it takes no overhead or profit
                again.
              </p>
            )}
            {ratesIdle && (
              <p className="text-xs text-subtle-foreground">
                Every item is priced by hand, so overhead and profit have nothing left to be taken on. If
                you meant the rates to apply, let an item&apos;s lines add up instead.
              </p>
            )}
          </div>

          {isOwner && (
            <div className="mt-auto flex flex-col gap-2 border-t border-divider pt-[18px]">
              <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-subtle-foreground">
                When the client says yes
              </p>
              <ApplyToBudgetButton
                projectId={projectId}
                estimateId={estimate.id}
                costCents={totals.costCents}
                symbol={symbol}
              />
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
            </div>
          )}
        </div>

        {/* ── the work column ── */}
        <div
          ref={workRef}
          className="@container/work flex min-w-0 flex-col gap-3 px-6 lg:overflow-y-auto"
        >
          {/* Every direct child is `flex-none`, or the column's children shrink to
              fit its height and it never overflows — which clips the grid with no
              way to scroll to it. The two spacers are the column's padding: real
              padding on a scroll container is a gap nothing pinned inside it can
              cover, and rows scroll up through it. */}
          <div className="h-5 flex-none" />

          {/* ── 3a. Details and Rates ── */}
          <div className="grid flex-none gap-3 @3xl/work:grid-cols-2">
            <FoldedCard
              title="Details"
              summary={[number.trim(), sentOn ? shortDate(sentOn) : null, validUntil ? `→ ${shortDate(validUntil)}` : null]
                .filter(Boolean)
                .join(" · ")}
              open={open.details}
              onToggle={() => toggleSection("details")}
            >
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-[7rem_1fr]">
                  <div className="space-y-1.5">
                    <Label htmlFor="est-number" className="text-xs font-medium text-muted-foreground">
                      Number
                    </Label>
                    <Input
                      id="est-number"
                      value={number}
                      onChange={(e) => setNumber(e.target.value)}
                      maxLength={40}
                      className="h-10"
                      disabled={!canEdit}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="est-title" className="text-xs font-medium text-muted-foreground">
                      Title
                    </Label>
                    <Input
                      id="est-title"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      maxLength={200}
                      className="h-10"
                      disabled={!canEdit}
                    />
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="est-sent" className="text-xs font-medium text-muted-foreground">
                      Sent
                    </Label>
                    <Input
                      id="est-sent"
                      type="date"
                      value={sentOn}
                      onChange={(e) => setSentOn(e.target.value)}
                      className="h-10"
                      disabled={!canEdit}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="est-valid" className="text-xs font-medium text-muted-foreground">
                      Valid until
                    </Label>
                    <Input
                      id="est-valid"
                      type="date"
                      value={validUntil}
                      onChange={(e) => setValidUntil(e.target.value)}
                      className="h-10"
                      disabled={!canEdit}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="est-status" className="text-xs font-medium text-muted-foreground">
                    Status
                  </Label>
                  <Select value={status} onValueChange={changeStatus} disabled={!canEdit || locked}>
                    <SelectTrigger className="h-10 w-full" id="est-status">
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
                {(decidedOn !== "" || status === "declined" || locked) && (
                  <div className="space-y-1.5">
                    <Label htmlFor="est-decided" className="text-xs font-medium text-muted-foreground">
                      Decided
                    </Label>
                    <Input
                      id="est-decided"
                      type="date"
                      value={decidedOn}
                      onChange={(e) => setDecidedOn(e.target.value)}
                      className="h-10"
                      disabled={!canEdit}
                    />
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="est-notes" className="text-xs font-medium text-muted-foreground">
                    Notes
                  </Label>
                  <Textarea
                    id="est-notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={2}
                    maxLength={4000}
                    className="rounded-xl p-3 text-[13px]"
                    placeholder="Anything this estimate should remember that the client does not see."
                    disabled={!canEdit}
                  />
                </div>
                {locked && (
                  <p className="text-xs text-subtle-foreground">
                    Accepted, so the rates, the lines and the proposal&apos;s words are fixed. To revise,
                    start a new estimate and mark this one superseded.
                  </p>
                )}
              </div>
            </FoldedCard>

            <FoldedCard
              title="Rates"
              summary={`${markup.trim() || "0"} · ${overhead.trim() || "0"} · ${profit.trim() || "0"}%`}
              open={open.rates}
              onToggle={() => toggleSection("rates")}
            >
              <div className="space-y-3">
                {(
                  [
                    ["Markup on cost", markup, setMarkup, "est-markup"],
                    ["Overhead", overhead, setOverhead, "est-overhead"],
                    ["Profit", profit, setProfit, "est-profit"],
                  ] as const
                ).map(([label, value, set, id]) => (
                  <div key={id} className="flex items-center justify-between gap-3">
                    <Label htmlFor={id} className="text-[13px] font-medium">
                      {label}
                    </Label>
                    <div className="flex items-center gap-1.5">
                      <Input
                        id={id}
                        value={value}
                        onChange={(e) => set(e.target.value)}
                        placeholder="0"
                        inputMode="decimal"
                        className="h-[38px] w-[76px] text-right text-[15px] tabular-nums"
                        disabled={!editable}
                      />
                      <span className="text-[13px] text-muted-foreground">%</span>
                    </div>
                  </div>
                ))}
                {showHints && (
                  <p className="text-xs text-subtle-foreground">
                    Markup is on a line&apos;s cost. Overhead, then profit, are taken on the priced lines —
                    never again on an item you priced yourself.
                  </p>
                )}
                {ratesIdle && (
                  <p className="text-xs text-warning-foreground">
                    Every item is priced by hand, so these two have nothing left to be taken on.
                  </p>
                )}
              </div>
            </FoldedCard>
          </div>

          {/* ── 3b. Lines ── */}
          {/*
            `relative` is load-bearing, not decoration. The row buttons carry
            `sr-only` labels, which Tailwind makes `position: absolute` — so
            without a positioned ancestor their containing block is the PAGE,
            they sit at their static x and they stretch the DOCUMENT's scroll
            width. That is what made this screen scroll sideways by 276px.

            And NOT `overflow-hidden`: a clipping ancestor becomes the
            containing block for `position: sticky` and silently disables every
            pinned row inside. The corners are rounded on the header and the
            entry bar instead.
          */}
          <div ref={gridRef} className="relative flex-none rounded-xl bg-card shadow-elevation-1">
            <DndContext
              id="estimate-rows"
              sensors={sensors}
              collisionDetection={collisions}
              onDragStart={onDragStart}
              onDragOver={onDragOver}
              onDragEnd={onDragEnd}
              onDragCancel={() => {
                setDragging(null);
                setDragOver(null);
              }}
            >
              <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
                {/* the card header, pinned */}
                <div className={cn("sticky top-0 z-30 flex flex-wrap items-center gap-3 rounded-t-xl bg-card py-3.5", PAD)}>
                  <span className="text-[15px] font-medium">Lines</span>
                  <span className="text-[13px] text-subtle-foreground">
                    {named.length > 0 && `${named.length} ${named.length === 1 ? "item" : "items"} · `}
                    {lines.filter((l) => l.description.trim() !== "").length} lines
                  </span>
                  <div className="ml-auto flex flex-wrap items-center gap-2">
                    <Pill onClick={toggleHints} pressed={showHints}>
                      {showHints ? <Check className="size-3.5" /> : <Plus className="size-3.5" />} Hints
                    </Pill>
                    {editable && (
                      <>
                        <Pill onClick={() => setClientWording((v) => !v)} pressed={clientWording}>
                          {clientWording ? <Check className="size-3.5" /> : <Plus className="size-3.5" />}{" "}
                          Client wording
                        </Pill>
                        <Pill onClick={addItem}>
                          <FolderPlus className="size-3.5" /> Add item
                        </Pill>
                      </>
                    )}
                  </div>
                </div>

                {/* the column header, pinned under it */}
                <div
                  className={cn(
                    ROW_GRID,
                    "sticky top-[60px] z-30 hidden border-y border-divider bg-background py-[7px] text-[11px] font-medium uppercase tracking-[0.04em] text-subtle-foreground @3xl/work:grid",
                  )}
                >
                  <span>#</span>
                  <span>Description</span>
                  <span className="text-right">Qty</span>
                  <span className="text-right">Unit cost</span>
                  <span className="hidden text-right @5xl/work:block">Cost</span>
                  <span className="text-right">Price</span>
                  <span />
                </div>

                {/**
                  * The sections already on this estimate, offered as you type,
                  * so `Structural` does not become `structural` on row nine.
                  */}
                <datalist id="estimate-section-names">
                  {[...new Set(groups.map((x) => x.section.trim()).filter(Boolean))].map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
                {groups.map((g, gi) => {
                  const m = groupMoney(g);
                  const own = rowsOf(g.key);
                  const collapsed = collapsedItems.has(g.key);
                  return (
                    <SortableRow
                      key={g.key}
                      id={`item:${g.key}`}
                      disabled={!editable}
                      over={dragOver === `item:${g.key}` && dragging !== `item:${g.key}`}
                    >
                      {(grip) => (
                        <>
                          <div
                            ref={(el) => {
                              if (el) itemHeaderRefs.current.set(g.key, el);
                              else itemHeaderRefs.current.delete(g.key);
                            }}
                            className={cn(
                              "sticky top-[60px] z-20 flex flex-wrap items-center gap-2 border-b border-divider bg-muted/92 py-2.5 backdrop-blur-[6px] @3xl/work:top-[93px]",
                              PAD,
                            )}
                          >
                            <div className="flex items-center gap-0.5">
                              {grip}
                              <RowNumber
                                value={String(gi + 1)}
                                label={`Where item ${gi + 1} sits`}
                                disabled={!editable}
                                onCommit={(address) => {
                                  // An item has no section of its own: `2.1` is not an
                                  // address it can be at, so the number goes back.
                                  if (address.section === null) moveItemTo(g.key, address.position);
                                }}
                              />
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="size-[26px] shrink-0 rounded-lg"
                                aria-expanded={!collapsed}
                                onClick={() =>
                                  setCollapsedItems((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(g.key)) next.delete(g.key);
                                    else next.add(g.key);
                                    return next;
                                  })
                                }
                              >
                                {collapsed ? (
                                  <ChevronRight className="size-[15px] text-subtle-foreground" />
                                ) : (
                                  <ChevronDown className="size-[15px] text-subtle-foreground" />
                                )}
                                <span className="sr-only">
                                  {collapsed ? "Show" : "Hide"} the lines under item {gi + 1}
                                </span>
                              </Button>
                            </div>
                            <span
                              style={{ background: railColour(gi) }}
                              className="size-1.5 shrink-0 rounded-full"
                            />
                            <Input
                              aria-label={`Item name, item ${gi + 1}`}
                              value={g.name}
                              onChange={(e) => setGroup(g.key, { name: e.target.value })}
                              placeholder="Tile flooring, master and hall baths"
                              maxLength={200}
                              className={cn(
                                "h-[34px] min-w-[140px] flex-1 text-[15px] font-medium",
                                BARE,
                              )}
                              disabled={!editable}
                            />
                            {/**
                              * THE HEADING THIS ITEM PRINTS UNDER. Free text,
                              * suggesting the sections already on this estimate
                              * so they stay spelled the same.
                              */}
                            <Input
                              aria-label={`Section, item ${gi + 1}`}
                              value={g.section}
                              onChange={(e) => setGroup(g.key, { section: e.target.value })}
                              placeholder="Section"
                              maxLength={120}
                              list="estimate-section-names"
                              className={cn("h-[34px] w-[124px] shrink-0 text-xs", BARE)}
                              disabled={!editable}
                            />
                            {/**
                              * **ONE PRICE, OR WHAT IS IN IT** — the founder's
                              * own words, and both halves of his price sheet.
                              * A typed price or a hidden line closes an item
                              * whatever this says (ADR 0080), so the control
                              * says so rather than lying about what it does.
                              */}
                            {(() => {
                              const forced =
                                g.priceMode === "fixed" ||
                                lines.some((l) => l.groupKey === g.key && !l.clientVisible);
                              return (
                                <button
                                  type="button"
                                  disabled={!editable || forced}
                                  onClick={() => setGroup(g.key, { showLines: !g.showLines })}
                                  title={
                                    forced
                                      ? g.priceMode === "fixed"
                                        ? "A price you typed is always shown on its own."
                                        : "A line kept off the proposal means this is always one price."
                                      : g.showLines
                                        ? "The client sees what is in this item. Press to show one price."
                                        : "The client sees one price. Press to show what is in it."
                                  }
                                  aria-label={`What the client sees of item ${gi + 1}`}
                                  className={cn(
                                    "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs transition-colors disabled:opacity-60",
                                    g.showLines && !forced
                                      ? "border border-border text-muted-foreground hover:bg-muted"
                                      : "bg-muted text-muted-foreground",
                                  )}
                                >
                                  {g.showLines && !forced ? (
                                    <>
                                      <Eye className="size-3" /> Shows its lines
                                    </>
                                  ) : (
                                    <>
                                      <EyeOff className="size-3" /> One price
                                    </>
                                  )}
                                </button>
                              );
                            })()}
                            {/* The two modes are a binary; a chip switches faster than a select. */}
                            <button
                              type="button"
                              disabled={!editable}
                              onClick={() =>
                                setGroup(g.key, {
                                  priceMode: g.priceMode === "fixed" ? "rollup" : "fixed",
                                })
                              }
                              aria-label={`How item ${gi + 1} is priced`}
                              className={cn(
                                "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition-colors disabled:opacity-60",
                                g.priceMode === "fixed"
                                  ? "bg-module-accent/12 text-module-accent"
                                  : "border border-border text-muted-foreground hover:bg-muted",
                              )}
                            >
                              {g.priceMode === "fixed" ? (
                                <>
                                  <Pencil className="size-3" /> Priced by hand
                                </>
                              ) : (
                                "Lines add up"
                              )}
                            </button>
                            {m.priceCents !== 0 && (
                              <span
                                className={cn(
                                  "hidden shrink-0 text-xs tabular-nums @xl/work:inline",
                                  m.marginCents < 0 ? "text-destructive" : "text-success-foreground",
                                )}
                              >
                                {((m.marginCents / m.priceCents) * 100).toFixed(1)}% margin
                              </span>
                            )}
                            {g.priceMode === "fixed" ? (
                              <Input
                                aria-label={`Price the client pays, item ${gi + 1}`}
                                value={g.fixedPrice}
                                onChange={(e) => setGroup(g.key, { fixedPrice: e.target.value })}
                                placeholder="0.00"
                                inputMode="decimal"
                                className="h-[34px] w-[108px] shrink-0 text-right text-[15px] font-semibold tabular-nums"
                                disabled={!editable}
                              />
                            ) : (
                              <span className="min-w-24 shrink-0 text-right text-[15px] font-semibold tabular-nums">
                                {money(m.priceCents)}
                              </span>
                            )}
                            {editable && (
                              <div className="flex shrink-0 items-center">
                                {/* An assembly is this item, saved — E6, ADR 0086. */}
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="size-7"
                                  onClick={() => openSaveAssembly(g.key)}
                                  disabled={own.every((l) => l.description.trim() === "")}
                                >
                                  <Package className="size-[15px]" />
                                  <span className="sr-only">Save item {gi + 1} as an assembly</span>
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="size-7"
                                  onClick={() => removeGroup(g.key)}
                                >
                                  <Trash2 className="size-[15px]" />
                                  <span className="sr-only">
                                    Remove item {gi + 1}; its lines stay, on their own
                                  </span>
                                </Button>
                              </div>
                            )}
                          </div>

                          {clientWording && (
                            <div className={cn(GUTTER_GRID, "border-b border-divider pb-2 pt-0.5")}>
                              <span />
                              <Input
                                aria-label={`What the client reads under item ${gi + 1}`}
                                value={g.clientNote}
                                onChange={(e) => setGroup(g.key, { clientNote: e.target.value })}
                                placeholder="One sentence the client reads under this item on the proposal. Optional."
                                maxLength={4000}
                                className={cn("h-8 text-[13px] text-muted-foreground", BARE)}
                                disabled={!editable}
                              />
                            </div>
                          )}

                          {collapsed ? (
                            <div className={cn(GUTTER_GRID, "border-b border-divider py-2")}>
                              <span />
                              <span className="text-[13px] text-subtle-foreground">
                                {own.length} {own.length === 1 ? "line" : "lines"} hidden ·{" "}
                                {money(m.costCents)} cost
                              </span>
                            </div>
                          ) : (
                            <>
                              {own.map((l, li) => lineRow(l, gi, li + 1))}
                              {addLineRow(g.key)}
                            </>
                          )}
                        </>
                      )}
                    </SortableRow>
                  );
                })}

                {/* ── the loose pile ── */}
                {groups.length > 0 && (
                  <div
                    ref={(el) => {
                      if (el) itemHeaderRefs.current.set("", el);
                      else itemHeaderRefs.current.delete("");
                    }}
                    className={cn(
                      "sticky top-[60px] z-20 flex flex-wrap items-center gap-3 border-b border-divider bg-muted/92 py-2.5 backdrop-blur-[6px] @3xl/work:top-[93px]",
                      PAD,
                    )}
                  >
                    <span className="w-[64px] text-[13px] tabular-nums text-subtle-foreground @sm/work:w-[76px] @3xl/work:w-[84px] @5xl/work:w-[88px]">
                      {groups.length + 1}
                    </span>
                    <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground/50" />
                    <span className="flex-1 text-[13px] font-medium text-muted-foreground">
                      Not in an item
                    </span>
                    <span className="text-[15px] font-semibold tabular-nums">
                      {money(
                        loose
                          .filter((l) => l.description.trim() !== "")
                          .reduce((sum, l) => sum + linePriceCents(figuresOf(l), terms.markupPpm), 0),
                      )}
                    </span>
                  </div>
                )}
                {loose.map((l, li) => lineRow(l, groups.length, li + 1))}
                {addLineRow("")}

                {/* ── the entry bar, pinned ── */}
                {editable && (
                  <div className={cn("sticky bottom-0 z-30 flex flex-col gap-2 rounded-b-xl border-t border-border bg-card py-3.5", PAD)}>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="relative min-w-0 flex-1 basis-[240px]">
                        <Plus className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-subtle-foreground" />
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
                          className="h-11 rounded-full pl-10 pr-[100px] text-[15px]"
                        />
                        <span className="pointer-events-none absolute right-3.5 top-1/2 flex -translate-y-1/2 items-center gap-1 text-xs text-subtle-foreground">
                          Enter <CornerDownLeft className="size-3.5" />
                        </span>
                      </div>
                      {hasGroups && (
                        <Select
                          value={intoKey === "" ? NONE : intoKey}
                          onValueChange={(v) => setInto(v === NONE ? "" : v)}
                        >
                          <SelectTrigger
                            aria-label="The item a typed line lands in"
                            className="h-11 rounded-full px-4 text-[13px]"
                          >
                            <span className="text-subtle-foreground">Into:</span>
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
                      <button
                        type="button"
                        onClick={() => setPasteOpen(true)}
                        className="inline-flex h-11 items-center gap-1.5 rounded-full border border-border px-4 text-[13px] font-medium transition-colors hover:bg-muted"
                      >
                        <ClipboardPaste className="size-[15px]" /> Paste a takeoff
                      </button>
                      {assemblies.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setDropOpen(true)}
                          className="inline-flex h-11 items-center gap-1.5 rounded-full border border-border px-4 text-[13px] font-medium transition-colors hover:bg-muted"
                        >
                          <Package className="size-[15px]" /> Add an assembly
                        </button>
                      )}
                    </div>
                    {entryError !== null ? (
                      <p className="text-xs text-destructive">{entryError}</p>
                    ) : entryMemory ? (
                      <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
                        <History className="size-3.5 text-module-accent" />
                        Last priced{" "}
                        <span className="font-medium tabular-nums text-foreground">
                          {priceHint(entryMemory, fmt(entryMemory.unitCostCents, symbol), today())}
                        </span>{" "}
                        — <strong className="font-medium text-foreground">Tab</strong> to use it
                      </p>
                    ) : showHints ? (
                      <p className="text-xs text-subtle-foreground">
                        <code className="text-foreground">320 sf tile @ 4.20</code> ·{" "}
                        <code className="text-foreground">plumbing rough 12000</code> for a lump sum ·{" "}
                        <strong className="font-medium">↑↓</strong> walks a column ·{" "}
                        <strong className="font-medium">Ctrl+D</strong> copies a row · type a row&apos;s
                        number to move it
                      </p>
                    ) : null}
                  </div>
                )}
              </SortableContext>

              <DragOverlay dropAnimation={null}>
                {dragging && <DragChip label={dragLabel(dragging, groups, lines)} />}
              </DragOverlay>
            </DndContext>
          </div>

          {/* ── 3c. Proposal and the client's link ── */}
          <FoldedCard
            className="flex-none"
            title="Proposal and the client's link"
            summary={
              <span className="flex items-center gap-2">
                {PROPOSAL_FORMAT_LABELS[format as keyof typeof PROPOSAL_FORMAT_LABELS] ?? format} ·{" "}
                {PROPOSAL_PRESENTATION_LABELS[presentation as keyof typeof PROPOSAL_PRESENTATION_LABELS] ??
                  presentation}
                {liveShares.length > 0 && (
                  <span className="inline-flex h-[22px] items-center gap-1 rounded-full bg-success/15 px-[9px] text-xs font-medium text-success-foreground">
                    <Link2 className="size-3" />
                    {liveShares[0].viewCount === 0
                      ? "not opened"
                      : `opened ${liveShares[0].viewCount} ${liveShares[0].viewCount === 1 ? "time" : "times"}`}
                  </span>
                )}
              </span>
            }
            open={open.proposal}
            onToggle={() => toggleSection("proposal")}
            bodyClassName="p-[18px]"
          >
            <div className="grid gap-5 @5xl/work:grid-cols-[minmax(0,1fr)_300px]">
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="est-format" className="text-xs font-medium text-muted-foreground">
                      What it is
                    </Label>
                    <Select value={format} onValueChange={setFormat} disabled={!canEdit}>
                      <SelectTrigger className="h-10 w-full" id="est-format">
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
                    <Label htmlFor="est-presentation" className="text-xs font-medium text-muted-foreground">
                      Show the price
                    </Label>
                    <Select value={presentation} onValueChange={setPresentation} disabled={!canEdit}>
                      <SelectTrigger className="h-10 w-full" id="est-presentation">
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
                    {presentation === "codes" && (
                      <label className="flex cursor-pointer items-start gap-2 pt-1 text-xs text-muted-foreground">
                        <Checkbox
                          checked={showCodeNumbers}
                          onCheckedChange={(v) => setShowCodeNumbers(v === true)}
                          aria-label="Print the cost code numbers on the proposal"
                          disabled={!canEdit}
                          className="mt-0.5"
                        />
                        <span>
                          Print the code numbers too —{" "}
                          <span className="tabular-nums">09 30 00 · Tiling</span> rather than Tiling.
                        </span>
                      </label>
                    )}
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="est-letter" className="text-xs font-medium text-muted-foreground">
                      {format === "brochure" ? "The letter it opens with" : "A letter (brochure only)"}
                    </Label>
                    <Textarea
                      id="est-letter"
                      value={letterText}
                      onChange={(e) => setLetterText(e.target.value)}
                      rows={4}
                      maxLength={8000}
                      placeholder="Dear Mr and Mrs Shrock, thank you for asking us to price the house at 118 Oak Row…"
                      className="rounded-xl p-3 text-[13px]"
                      disabled={!editable}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="est-scope" className="text-xs font-medium text-muted-foreground">
                      Scope of work
                    </Label>
                    <Textarea
                      id="est-scope"
                      value={scope}
                      onChange={(e) => setScope(e.target.value)}
                      rows={4}
                      maxLength={8000}
                      className="rounded-xl p-3 text-[13px]"
                      placeholder="What the price covers, in the client's words."
                      disabled={!editable}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="est-exclusions" className="text-xs font-medium text-muted-foreground">
                      Not included
                    </Label>
                    <Textarea
                      id="est-exclusions"
                      value={exclusions}
                      onChange={(e) => setExclusions(e.target.value)}
                      rows={3}
                      maxLength={8000}
                      className="rounded-xl p-3 text-[13px]"
                      placeholder="Permits and utility fees. Landscaping. Anything not listed above."
                      disabled={!editable}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="est-terms" className="text-xs font-medium text-muted-foreground">
                      Terms
                    </Label>
                    <Textarea
                      id="est-terms"
                      value={termsText}
                      onChange={(e) => setTermsText(e.target.value)}
                      rows={3}
                      maxLength={8000}
                      className="rounded-xl p-3 text-[13px]"
                      placeholder="The payment schedule, what a change costs, how long the price holds."
                      disabled={!editable}
                    />
                    {showHints && (
                      <p className="text-xs text-subtle-foreground">
                        A new estimate starts with the terms of the last one you wrote.
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <ClientLinks
                projectId={projectId}
                estimateId={estimate.id}
                shares={shares}
                canEdit={canEdit}
                symbol={symbol}
                format={format}
                pending={pending}
                copyRef={linkRef}
                onMake={makeLink}
                onCopy={copyLink}
              />
            </div>
          </FoldedCard>

          {/* ── 3d. By cost code ── */}
          {byCode.length > 0 && (
            <FoldedCard
              className="flex-none"
              title="By cost code"
              summary={`${byCode.length} ${byCode.length === 1 ? "code" : "codes"} · ${money(
                byCode.reduce((sum, c) => sum + c.costCents, 0),
              )} cost`}
              open={open.codes}
              onToggle={() => toggleSection("codes")}
            >
              {showHints && (
                <p className="mb-3 text-xs text-subtle-foreground">
                  What the <strong>saved</strong> lines add up to per code: the cost is what{" "}
                  <em>Use as budget</em> writes, the price is what the job cost report will compare it with
                  once the job is billed.
                </p>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-[11px] font-medium uppercase tracking-[0.04em] text-subtle-foreground">
                    <tr>
                      <th className="py-1.5 text-left">Cost code</th>
                      <th className="py-1.5 text-right">Cost</th>
                      <th className="py-1.5 text-right">Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byCode.map((c) => (
                      <tr key={c.costCodeId ?? "none"} className="border-t border-divider">
                        <td className={cn("py-1.5", c.costCodeId ? "" : "text-muted-foreground")}>
                          {c.codeLabel ?? "No cost code"}
                        </td>
                        <td className="py-1.5 text-right tabular-nums">{money(c.costCents)}</td>
                        <td className="py-1.5 text-right tabular-nums">{money(c.priceCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </FoldedCard>
          )}
          <div className="h-6 flex-none" />
        </div>
      </div>

      {/* ───────────────────────────────────────────────────────────── dialogs */}

      <Dialog open={pasteOpen} onOpenChange={setPasteOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Paste a takeoff</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              One line each, in the same words the box under the lines takes — or straight out of a
              spreadsheet, columns and all. Every line is shown below before anything is added
              {hasGroups && intoKey !== ""
                ? `, and they land in ${named.find((g) => g.key === intoKey)?.name.trim() ?? "the item"}`
                : ""}
              .
            </p>
            <Textarea
              aria-label="The lines to add"
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              rows={6}
              placeholder={"320 sf tile @ 4.20\ntile labour 320 sf @ 3.50\nplumbing rough 12000"}
              className="rounded-xl font-mono text-xs"
            />
            {pasted.length > 0 && (
              <div className="max-h-64 overflow-y-auto rounded-xl border border-border">
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
                      <tr key={i} className="border-t border-divider">
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
                              className={cn(
                                "px-2 py-1.5 text-right tabular-nums",
                                r.remembered && "font-medium",
                              )}
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
              Its lines, their quantities and their cost codes, kept so the next job can have them. It goes
              in at the size you say it is per, and scales from there.
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
                className="h-10"
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
                  className="h-10"
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
                  className="h-10"
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
                className="rounded-xl p-3 text-[13px]"
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
                <SelectTrigger id="drop-which" className="h-10 w-full">
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
                className="h-10 w-32"
                placeholder={assemblies.find((a) => a.id === dropId)?.per.replace(/^per /, "") ?? "500"}
              />
            </div>
            {dropId !== "" && (
              <p className="text-xs text-muted-foreground">
                One of these costs{" "}
                <span className="tabular-nums">
                  {fmt(assemblies.find((a) => a.id === dropId)?.costCents ?? 0, symbol)}
                </span>{" "}
                {assemblies.find((a) => a.id === dropId)?.per}. Check the quantities afterwards — an
                assembly is a starting point, not a quote.
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
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════ the pieces */

/**
 * A ROW'S NUMBER, WHICH IS ALSO WHERE IT GOES (ADR 0087). Type over it and
 * press Enter — or leave the box — and the row moves there. Escape puts the
 * number back, and so does anything the address grammar cannot read: a box
 * that quietly did nothing is better than one that moved a row somewhere
 * nobody asked for.
 */
function RowNumber({
  value,
  label,
  disabled,
  onCommit,
}: {
  value: string;
  label: string;
  disabled: boolean;
  onCommit: (address: { section: number | null; position: number }) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value;
  const commit = () => {
    if (draft === null) return;
    const address = parseAddress(draft);
    setDraft(null);
    if (address && draft.trim() !== value) onCommit(address);
  };
  if (disabled) {
    return (
      <span className="w-9 shrink-0 text-right text-xs tabular-nums text-subtle-foreground">{value}</span>
    );
  }
  return (
    <input
      aria-label={label}
      value={shown}
      inputMode="decimal"
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          commit();
          e.currentTarget.blur();
        }
        if (e.key === "Escape") {
          setDraft(null);
          e.currentTarget.blur();
        }
      }}
      className="w-9 shrink-0 rounded border border-transparent bg-transparent px-1 py-0.5 text-right text-xs tabular-nums text-subtle-foreground outline-none transition-colors hover:border-border focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
    />
  );
}

/**
 * A SORTABLE BLOCK — an item and everything under it, or one line and its
 * expansion.
 *
 * The transform dnd-kit offers is deliberately NOT applied: an ancestor with a
 * transform becomes the containing block for `position: sticky`, and every
 * header on this screen is pinned. The dragged row is shown in a `DragOverlay`
 * instead, and where it will land is drawn as a rule across the row under the
 * cursor.
 */
function SortableRow({
  id,
  disabled,
  over,
  children,
}: {
  id: string;
  disabled: boolean;
  over: boolean;
  children: (grip: ReactNode) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useSortable({
    id,
    disabled,
  });
  const grip = disabled ? (
    <span className="hidden w-[18px] shrink-0 @sm/work:block" />
  ) : (
    <button
      type="button"
      ref={setActivatorNodeRef}
      className="hidden w-[18px] shrink-0 cursor-grab touch-none text-transparent transition-colors hover:text-muted-foreground group-hover/row:text-subtle-foreground @sm/work:block"
      {...attributes}
      {...listeners}
    >
      <GripVertical className="size-[18px]" />
      <span className="sr-only">Drag to move, or type its number</span>
    </button>
  );
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "group/row",
        isDragging && "opacity-40",
        over && "shadow-[inset_0_2px_0_0_var(--module-accent)]",
      )}
    >
      {children(grip)}
    </div>
  );
}

/** A section's own landing strip: where a line dropped on nothing in particular goes. */
function DropZone({
  id,
  over,
  disabled,
  children,
}: {
  id: string;
  over: boolean;
  disabled: boolean;
  children: ReactNode;
}) {
  const { setNodeRef } = useDroppable({ id, disabled });
  return (
    <div ref={setNodeRef} className={cn(over && "bg-module-accent/8")}>
      {children}
    </div>
  );
}

/** What is being dragged, under the cursor. */
function DragChip({ label }: { label: string }) {
  return (
    <div className="pointer-events-none max-w-[280px] truncate rounded-lg bg-card px-3 py-1.5 text-[13px] font-medium shadow-elevation-1">
      {label}
    </div>
  );
}

function dragLabel(
  id: string,
  groups: Array<{ key: string; name: string }>,
  lines: Array<{ key: string; description: string }>,
): string {
  if (id.startsWith("item:")) {
    const g = groups.find((x) => x.key === id.slice(5));
    return g?.name.trim() || "An item";
  }
  const l = lines.find((x) => x.key === id.slice(5));
  return l?.description.trim() || "A line";
}

/** A pill in the Lines header. */
function Pill({
  children,
  onClick,
  pressed,
}: {
  children: ReactNode;
  onClick: () => void;
  pressed?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors",
        pressed
          ? "border-module-accent/30 bg-module-accent/10 text-module-accent"
          : "border-border bg-card text-muted-foreground hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}

/**
 * A FOLDED SECTION. Shut, it says what is inside it in one line of figures —
 * which is the whole point of folding it: the estimate's number and dates, the
 * three rates, what the proposal is set to. Everything that used to be a
 * paragraph of explanation now lives in the guide behind the `?`.
 */
function FoldedCard({
  title,
  summary,
  open,
  onToggle,
  children,
  className,
  bodyClassName,
}: {
  title: string;
  summary: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <div className={cn("rounded-xl bg-card shadow-elevation-1", className)}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-4 py-3.5 text-left"
      >
        {open ? (
          <ChevronDown className="size-[15px] shrink-0 text-subtle-foreground" />
        ) : (
          <ChevronRight className="size-[15px] shrink-0 text-subtle-foreground" />
        )}
        <span className="text-sm font-medium">{title}</span>
        <span className="ml-auto truncate text-xs tabular-nums text-subtle-foreground">{summary}</span>
      </button>
      {open && <div className={cn("border-t border-divider p-4", bodyClassName)}>{children}</div>}
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
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="h-[34px] rounded-lg border border-border bg-card px-3 text-[13px] font-medium transition-colors hover:bg-muted"
      >
        Use as budget
      </button>
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
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={contracts.length === 0}
        className="h-[34px] rounded-lg border border-border bg-card px-3 text-[13px] font-medium transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
      >
        Schedule of values
      </button>
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
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={contracts.length === 0}
        className="h-[34px] rounded-lg bg-success/15 px-3 text-center text-[13px] font-semibold text-success-foreground transition-colors hover:bg-success/25 disabled:pointer-events-none disabled:opacity-50"
      >
        Accept onto a contract
      </button>
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
 * accepted by an owner, onto a contract, from the rail's own button. This
 * block is the reason to press it.
 *
 * A LIVE LINK IS ONE BLOCK; DEAD ONES ARE ONE LINE. A column of five rows, four
 * of them expired, buries the one that is working.
 */
function ClientLinks({
  projectId,
  estimateId,
  shares,
  canEdit,
  symbol,
  format,
  pending,
  copyRef,
  onMake,
  onCopy,
}: {
  projectId: string;
  estimateId: string;
  shares: ShareView[];
  canEdit: boolean;
  symbol: string | null;
  format: string;
  pending: boolean;
  copyRef: React.RefObject<HTMLButtonElement | null>;
  onMake: () => void;
  onCopy: (url: string, note: string) => void;
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const signed = shares.find((s) => s.signedAt !== null);
  const live = shares.filter((s) => s.standing === "open" || s.standing === "signed");
  const dead = shares.filter((s) => s.standing !== "open" && s.standing !== "signed");
  const working = pending || busy;

  const reveal = (shareId: string) => {
    startTransition(async () => {
      const res = await revealEstimateShareTokenAction({ projectId, id: estimateId, shareId });
      if ("error" in res) return void toast.error(res.error);
      onCopy(res.url, "Link copied");
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
    <div className="space-y-3">
      {signed && signed.signedAt && (
        <div className="rounded-xl bg-success/10 p-3 text-sm text-foreground">
          <span className="font-medium">{signed.signedName}</span> accepted this proposal on{" "}
          {new Date(signed.signedAt).toLocaleDateString()}
          {signed.signedTotalCents !== null && <> at {fmt(signed.signedTotalCents, symbol)}</>}.
          <p className="mt-1 text-xs text-muted-foreground">
            That is their acceptance on the record. The estimate itself is still accepted here, onto the
            contract it priced — the button on the left.
          </p>
        </div>
      )}

      {live.length === 0 ? (
        <div className="space-y-2">
          <p className="text-xs text-subtle-foreground">
            Send the client a link instead of an attachment: they read the proposal on any device and accept
            it by typing their name. It stops working on the date the proposal is valid until, or in thirty
            days when there is no date.
          </p>
          {canEdit && (
            <Button ref={copyRef} variant="outline" size="sm" onClick={onMake} disabled={working}>
              <Link2 className="mr-1.5 size-4" /> Make a link
            </Button>
          )}
        </div>
      ) : (
        live.map((s, i) => (
          <div key={s.id} className="rounded-xl bg-success/8 px-3.5 py-3">
            <div className="flex items-center gap-1.5">
              <Link2 className="size-[15px] text-success-foreground" />
              <span className="text-[13px] font-medium">
                {live.length === 1 ? "One link open" : SHARE_STANDING_LABELS[s.standing]}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {s.viewCount === 0
                ? "Not opened yet"
                : `Opened ${s.viewCount} ${s.viewCount === 1 ? "time" : "times"}`}
              {s.lastViewedAt && `, last ${new Date(s.lastViewedAt).toLocaleDateString()}`} · expires{" "}
              {new Date(s.expiresAt).toLocaleDateString()}
            </p>
            {canEdit && s.standing === "open" && (
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  ref={i === 0 ? copyRef : undefined}
                  onClick={() => reveal(s.id)}
                  disabled={working}
                  className="inline-flex h-[30px] items-center gap-1 rounded-full border border-border bg-card px-3 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-50"
                >
                  <Copy className="size-3" /> Copy link
                </button>
                <button
                  type="button"
                  onClick={() => revoke(s.id)}
                  disabled={working}
                  className="inline-flex h-[30px] items-center rounded-full border border-border bg-card px-3 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-50"
                >
                  Revoke
                </button>
              </div>
            )}
          </div>
        ))
      )}

      {canEdit && live.length > 0 && (
        <Button variant="ghost" size="sm" onClick={onMake} disabled={working} className="h-7 px-2 text-xs">
          <Link2 className="mr-1.5 size-3.5" /> New link
        </Button>
      )}

      {/* Four expired links in four rows bury the one that is working, so the
          dead ones are one quiet line between them. */}
      {dead.length > 0 && (
        <p className="text-xs text-subtle-foreground">
          {dead.length === 1 ? "One dead link" : `${dead.length} dead links`}:{" "}
          {dead
            .map(
              (s) =>
                `${SHARE_STANDING_LABELS[s.standing].toLowerCase()}, ${
                  s.viewCount === 0
                    ? "never opened"
                    : `opened ${s.viewCount === 1 ? "once" : `${s.viewCount} times`}`
                }`,
            )
            .join(" · ")}
          .
        </p>
      )}

      {shares.some((s) => s.standing === "superseded") && (
        <p className="text-xs text-subtle-foreground">
          A link reading <span className="font-medium">Estimate changed</span> was accepted and then the
          estimate was edited, so it has stopped working — it cannot go on showing a document that is not
          the one that was signed. The acceptance stands, at the version it names. Make a new link for the
          revision.
        </p>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        <Button variant="outline" size="sm" className="h-9" asChild>
          <a href={`/api/jobs/estimates/${estimateId}/document`} target="_blank" rel="noopener noreferrer">
            <BookOpen className="mr-1.5 size-4" /> Open{" "}
            {format === "brochure"
              ? "brochure"
              : format === "price_sheet"
                ? "price sheet"
                : "document"}
          </a>
        </Button>
        <Button variant="outline" size="sm" className="h-9" asChild>
          <a href={`/api/jobs/estimates/${estimateId}/pdf`} target="_blank" rel="noopener noreferrer">
            <FileText className="mr-1.5 size-4" /> Print proposal
          </a>
        </Button>
      </div>
    </div>
  );
}
