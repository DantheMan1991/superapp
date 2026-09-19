/**
 * LEVELS YOU CAN START FROM. PURE — no imports, no database (ADR 0097).
 *
 * ── WHY THESE EXIST ─────────────────────────────────────────────────────────
 *
 * QuickBooks does not hand a small business a grid of sixty tick boxes. Below
 * its top tier it ships fixed user types — *Customers and sales*, *Vendors and
 * purchases*, *Reports only*, *Time tracking only* — and most people pick one
 * and never configure anything. Free-form permissions are an Advanced feature
 * because free-form permissions are work, and work nobody does is a feature
 * nobody has.
 *
 * So: the tick boxes stay, and these are somewhere to start. Picking one
 * creates an ORDINARY LEVEL the owner can then edit or delete — not a special
 * kind of row, not a template that keeps reasserting itself. After the click
 * there is nothing left of the starter but a name.
 *
 * ── AND WHY THE NAMES ARE THESE NAMES ───────────────────────────────────────
 *
 * They are the job, not the trade. A starter called "Field crew" would put a
 * construction word in Layer 0, which is the boundary ADR 0004 draws and the
 * reason a core module speaks no industry. QuickBooks' own four are neutral for
 * the same reason and they cover the same ground, which is some evidence the
 * seam is in the right place.
 *
 * ── WHAT A STARTER MAY NAME ─────────────────────────────────────────────────
 *
 * Keys, and only keys that might exist: a module slug, or `module:area`. A
 * starter naming something this business has not switched on is not an error —
 * the key is simply not on offer, and the level is created from whatever is.
 * That is what lets one list serve a farm and a builder.
 */

export interface StarterLevel {
  /** Stable, for the button that creates it. Never stored. */
  id: string;
  /** The level's name, which the owner can change immediately. */
  name: string;
  /** Goes into the level's notes, so the next owner knows what it was for. */
  notes: string;
  /** Whole tools this level may reach. */
  tools: string[];
  /**
   * Areas it may reach, as full keys. Naming one implies the tool — a part of
   * a tool you cannot open is a contradiction, and `allowedKeys` resolves it.
   */
  areas: string[];
}

export const STARTER_LEVELS: StarterLevel[] = [
  {
    id: "sales",
    name: "Sales and customers",
    notes:
      "Raises invoices and looks after customers. No bills, no bank, no reports.",
    tools: ["crm", "documents"],
    areas: [
      "accounting:invoices",
      "accounting:customers",
      "accounting:credit-memos",
      "accounting:catalogue",
      "accounting:invoice-recurring",
      "accounting:reminders",
      "accounting:ar-aging",
    ],
  },
  {
    id: "purchasing",
    name: "Bills and purchases",
    notes: "Enters bills and looks after suppliers. No sales, no bank, no reports.",
    tools: ["documents"],
    areas: [
      "accounting:bills",
      "accounting:vendors",
      "accounting:receipts",
      "accounting:ap-aging",
    ],
  },
  {
    /**
     * The founder's own example: *"a project manager might need the invoicing
     * and bills but shouldn't see anything else."* Both halves of the trade,
     * neither half of the books.
     */
    id: "both-sides",
    name: "Invoicing and bills",
    notes:
      "Both sides of the trade — raises invoices and enters bills — and nothing of the books behind them.",
    // Jobs and Time whole: a project manager lives in them, and neither is a
    // part of Accounting to be carved out of it.
    tools: ["documents", "jobs", "time"],
    areas: [
      "accounting:invoices",
      "accounting:customers",
      "accounting:credit-memos",
      "accounting:bills",
      "accounting:vendors",
      "accounting:receipts",
    ],
  },
  {
    id: "bookkeeper",
    name: "Bookkeeping",
    notes:
      "The books: journal, chart of accounts, bank and the statements. Not the settings, and not the other tools.",
    tools: [],
    areas: [
      "accounting:journal",
      "accounting:accounts",
      "accounting:banking",
      "accounting:deposits",
      "accounting:bank-rules",
      "accounting:recurring",
      "accounting:trial-balance",
      "accounting:pnl",
      "accounting:balance-sheet",
      "accounting:general-ledger",
      "accounting:cash",
      "accounting:receipts",
    ],
  },
  {
    id: "time-only",
    name: "Time only",
    notes: "Their own hours and nothing else. The narrowest level there is.",
    tools: ["time"],
    areas: [],
  },
];

/**
 * Every key a starter allows, with the tool implied by any area it names.
 *
 * Kept here rather than at the call site because it is the one rule that makes
 * a starter's list mean what it reads as: naming `accounting:bills` has to
 * bring Accounting with it, or the level would deny the tool and the area
 * underneath it would never be reached.
 */
export function allowedKeys(starter: StarterLevel): string[] {
  const modules = starter.areas.map((key) => key.split(":")[0]);
  return [...new Set([...starter.tools, ...modules, ...starter.areas])];
}

export function starterById(id: string): StarterLevel | null {
  return STARTER_LEVELS.find((s) => s.id === id) ?? null;
}
