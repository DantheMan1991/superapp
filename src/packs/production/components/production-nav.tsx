"use client";

import {
  Building2,
  CalendarDays,
  ClipboardList,
  LayoutDashboard,
  Receipt,
} from "lucide-react";
import {
  CategoryStrip,
  type CategoryItem,
} from "@/components/app/category-strip";

const BASE = "/dashboard/m/production";

/**
 * Production's sections.
 *
 * **THESE WERE FOUR OUTLINE BUTTONS IN THE PAGE HEADER'S ACTIONS ROW**, beside
 * `StartRunForm` — the one control that is a verb. Same shape as inventory's
 * before it, and the same fix: a header's actions are things you DO, and Booked
 * dates, the sheet list, the reconciliation and the directory are all places.
 *
 * **THE LABELS COME IN AS PROPS BECAUSE TWO OF THEM ARE THE TENANT'S WORDS.**
 * `cutSheet` and `processor` are renamed by the installed profile — the
 * homestead one calls a processor a *Butcher* — so unlike `AccountingNav` this
 * cannot be a module-level constant. They arrive already resolved by
 * `labelFor`, so this component never learns what a profile is.
 *
 * **AND NEITHER IS PLURALISED HERE.** `production.md` records the rule and the
 * reason: appending `"s"` to a word somebody else owns produces nonsense on the
 * profile that renames it. "Every {sheet}" is a list without needing a plural,
 * which is why the page itself is titled that way.
 */
export function ProductionNav({
  sheetWord,
  processorWord,
}: {
  /** Already through `labelFor(pack.labels, "cutSheet", …)`, lowercased. */
  sheetWord: string;
  /** Already through `labelFor(pack.labels, "processor", …)`. */
  processorWord: string;
}) {
  const items: CategoryItem[] = [
    /**
     * "Overview" rather than "Runs", and that is the pluralisation rule again:
     * `run` is a tenant-owned word too, so a hardcoded plural would be wrong on
     * any profile that renames it and there is no safe way to pluralise one
     * generically. Accounting's hub tab is called the same thing.
     */
    { href: BASE, label: "Overview", icon: LayoutDashboard, exact: true },
    {
      href: `${BASE}/orders`,
      /* Lowercased HERE rather than at each call site, so no page has to
         remember to. The page this leads to titles itself the same way. */
      label: `Every ${sheetWord.toLowerCase()}`,
      icon: ClipboardList,
    },
    { href: `${BASE}/bookings`, label: "Booked dates", icon: CalendarDays },
    {
      href: `${BASE}/billing`,
      label: "Processing not invoiced",
      icon: Receipt,
    },
    {
      href: `${BASE}/processors`,
      label: `${processorWord} directory`,
      icon: Building2,
    },
  ];

  return <CategoryStrip items={items} />;
}
