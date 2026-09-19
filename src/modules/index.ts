import type { ModuleDefinition } from "./types";
import { AccountingModule } from "./accounting/AccountingModule";
import { CrmModule } from "./crm/CrmModule";
import { DocumentsModule } from "./documents/DocumentsModule";
import { EmailModule } from "./email/EmailModule";
import { HelloModule } from "./hello/HelloModule";
import { MarketingModule } from "./marketing/MarketingModule";
import { SchedulingModule } from "./scheduling/SchedulingModule";
import { TimeModule } from "./time/TimeModule";
import { WorkModule } from "./work/WorkModule";

/**
 * Code-side module registry: slug → how it renders. The DB `modules` table
 * decides what exists and what's switched on per tenant; this map is the
 * implementation seam where real modules (accounting, CRM, …) get added in
 * Phase 2 without touching the shell.
 */
export const moduleRegistry: Record<string, ModuleDefinition> = {
  hello: {
    slug: "hello",
    name: "Hello Module",
    icon: "sparkles",
    Component: HelloModule,
  },
  accounting: {
    slug: "accounting",
    /**
     * ACCOUNTING IS SPLIT TO THE LEAF (ADR 0097), because the founder's two
     * examples are both leaves: *"a project manager might need the invoicing
     * and bills but shouldn't see anything else"*, and *"an office person might
     * have access to journal entries, but not certain reports."* Twelve
     * sections could express neither.
     *
     * **A SECTION'S LANDING PAGE BELONGS TO NO AREA, AND REDIRECTS TO THE
     * FIRST CHILD THE READER CAN OPEN.** `/accounting/sales` used to redirect
     * to `sales/invoices` flatly. Giving that landing page to `invoices` was
     * the first thing tried here and it was worse: denying Invoices would hide
     * the Sales tab, stranding Customers — reachable by URL, with no door.
     * Leaving it unclaimed and redirecting past what somebody cannot open
     * means any combination of children works.
     *
     * **LONGEST MATCH WINS**, which is what lets `banking/deposits` carve
     * itself out of `banking`, and each report out of the Reports index. The
     * index itself is deliberately NOT an area: it is the section's front door,
     * and it filters its own list to what the reader can open.
     */
    areas: [
      { key: "receipts", name: "Inbox" },
      // The register list, one register, its import and its reconcile. The two
      // children below carve themselves out by being longer.
      { key: "banking", name: "Banking" },
      { key: "deposits", name: "Deposits", paths: ["banking/deposits"] },
      { key: "bank-rules", name: "Bank rules", paths: ["banking/rules"] },
      { key: "invoices", name: "Invoices", paths: ["sales/invoices"] },
      { key: "customers", name: "Customers", paths: ["sales/customers"] },
      { key: "credit-memos", name: "Credit memos", paths: ["sales/credit-memos"] },
      { key: "catalogue", name: "Catalogue", paths: ["sales/catalogue"] },
      {
        key: "invoice-recurring",
        name: "Recurring invoices",
        paths: ["sales/recurring"],
      },
      { key: "reminders", name: "Reminders", paths: ["sales/reminders"] },
      { key: "bills", name: "Bills", paths: ["purchases/bills"] },
      { key: "vendors", name: "Vendors", paths: ["purchases/vendors"] },
      { key: "accounts", name: "Chart of accounts" },
      { key: "journal", name: "Journal" },
      { key: "recurring", name: "Recurring entries" },
      { key: "pnl", name: "Profit & loss", paths: ["reports/pnl"] },
      { key: "balance-sheet", name: "Balance sheet", paths: ["reports/balance-sheet"] },
      {
        key: "general-ledger",
        name: "General ledger",
        paths: ["reports/general-ledger"],
      },
      { key: "ar-aging", name: "Who owes you", paths: ["reports/ar-aging"] },
      { key: "ap-aging", name: "What you owe", paths: ["reports/ap-aging"] },
      { key: "cash", name: "Cash", paths: ["reports/cash"] },
      { key: "sales-tax", name: "Sales tax", paths: ["reports/sales-tax"] },
      { key: "trial-balance", name: "Trial balance" },
      { key: "opening", name: "Opening balances" },
      { key: "close", name: "Close" },
      { key: "companies", name: "Companies" },
    ],
    name: "Accounting",
    icon: "calculator",
    /**
     * **THE FIRST VOCABULARY A CORE MODULE HAS EVER DECLARED.**
     *
     * Every one of the fifteen keys in the registry before this came from a
     * PACK, which left the two words an industry most reliably renames — the
     * people you bill and the people you buy from — as hardcoded English with
     * no way to change them. `packs-and-profiles.md` had called that "the
     * bigger gap" since 2026-08-14; the construction pilot is what made it
     * urgent, because that business says **client** and the invoice said
     * Customer.
     *
     * ACCOUNTING OWNS THEM, not CRM, even though both render them. A key may
     * have exactly one owner (`collectLabelDefinitions` reports two as a
     * conflict rather than merging), and accounting is where the Customers and
     * Vendors pages live, where an invoice picks one and a bill the other. CRM
     * reads these keys the way `livestock` reads `land`'s `zone` — a feature
     * displaying another's word is the normal case, not a violation.
     *
     * NOT `client`: that key already belongs to `professional-services`, and a
     * second claim on it would be a registry conflict. A profile renames
     * `customer` TO "Client", which is the mechanism working as designed rather
     * than a workaround.
     *
     * ONE KEY PER WORD, with its plural on the definition. The plural of an
     * UNRENAMED word is declared (a phrase like "Lines of business" cannot take
     * an "s"); a tenant's own word takes an "s", which is the rule `pluralOf`
     * holds for the whole product. An earlier draft of this slice gave the
     * plurals keys of their own so an irregular one could be overridden — it put
     * four rows in the admin editor where two belong, and disagreed with the
     * rule the tenant guides already used, so a guide could print a different
     * plural from the screen it describes.
     */
    labels: [
      {
        key: "customer",
        fallback: "Customer",
        plural: "Customers",
        describes:
          "Somebody you invoice. A builder or a consultancy says client, a shop says customer, a surgery says patient — and whichever word you choose appears on invoices, statements, reminders and the navigation.",
      },
      {
        key: "vendor",
        fallback: "Vendor",
        plural: "Vendors",
        describes:
          "Somebody you buy from and owe money to. Trades usually say supplier; whichever word you choose appears on bills, receipts and the purchases screens.",
      },
    ],
    Component: AccountingModule,
  },
  crm: {
    slug: "crm",
    areas: [
      { key: "records", name: "Records" },
      { key: "deals", name: "Deals" },
      { key: "tasks", name: "Tasks" },
      { key: "pipelines", name: "Pipelines" },
      { key: "automations", name: "Automations" },
      { key: "fields", name: "Custom fields" },
      { key: "duplicates", name: "Duplicates" },
      { key: "reports", name: "Reports" },
    ],
    name: "CRM",
    icon: "contact",
    Component: CrmModule,
  },
  documents: {
    slug: "documents",
    areas: [
      { key: "browse", name: "Browse" },
      { key: "inbox", name: "Inbox" },
      { key: "search", name: "Search" },
      { key: "tags", name: "Tags" },
      { key: "templates", name: "Templates" },
      { key: "shares", name: "Shares" },
      { key: "trash", name: "Trash" },
    ],
    name: "Documents",
    icon: "folder",
    Component: DocumentsModule,
  },
  email: {
    slug: "email",
    name: "Mail",
    icon: "mail",
    // The one surface in the product that reads as a list beside a detail
    // pane; the shell's centred column would spend half a monitor on margin.
    layout: "full",
    Component: EmailModule,
  },
  // Registered from slice 1 so the UI has somewhere to live, while the seed row
  // stays `coming_soon` — a superadmin can switch it on for one tenant to try
  // it, and nobody is sold it. Slice 4 flips the seed row.
  scheduling: {
    slug: "scheduling",
    areas: [
      { key: "calendars", name: "Calendars" },
    ],
    name: "Scheduling",
    icon: "calendar",
    Component: SchedulingModule,
  },
  // Registered from slice 1, while the seed row stays `coming_soon` — the same
  // arrangement scheduling used. A superadmin can switch it on for one tenant
  // to try it, and nobody is sold it. Slice 4 flips the seed row.
  work: {
    slug: "work",
    areas: [
      { key: "lists", name: "Lists" },
    ],
    name: "Work",
    icon: "check-square",
    Component: WorkModule,
  },
  // Registered from slice 0 (the brand kit) while the seed row stays
  // `coming_soon`, the arrangement scheduling and work used: a superadmin can
  // switch it on for one tenant, and nobody is sold it until the website and
  // domains slices make it a marketing tool rather than a settings page.
  marketing: {
    slug: "marketing",
    areas: [
      { key: "website", name: "Website" },
      { key: "social", name: "Social" },
    ],
    name: "Marketing",
    icon: "megaphone",
    // The page editor is a form beside a live preview; the rest of the module
    // reads better in the standard column.
    fullWidthPaths: ["website/pages"],
    Component: MarketingModule,
  },
  // Registered from slice 0 while the seed row stays `coming_soon` — the
  // arrangement scheduling, work and marketing each used: a superadmin can
  // switch it on for one tenant to try it, and nobody is sold it until the week
  // can do arithmetic. Hours that cannot become overtime, a cost or a paycheck
  // are a notebook with extra steps, so slice 2 is the earliest this is
  // `available`.
  time: {
    slug: "time",
    areas: [
      { key: "clock", name: "Clock" },
      { key: "people", name: "People" },
      { key: "pay", name: "Pay" },
    ],
    name: "Time",
    icon: "clock",
    Component: TimeModule,
  },
};

export function getModuleDefinition(slug: string): ModuleDefinition | null {
  return moduleRegistry[slug] ?? null;
}
