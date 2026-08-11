"use client";

import {
  BookOpen,
  ChartColumn,
  Inbox,
  Landmark,
  LayoutDashboard,
  ListTree,
  Lock,
  Receipt,
  Scale,
  ShoppingCart,
} from "lucide-react";
import {
  CategoryStrip,
  type CategoryItem,
} from "@/components/app/category-strip";

/**
 * Accounting's ten sections.
 *
 * These used to render as `flex flex-wrap gap-1 border-b` — ten text tabs that
 * wrapped onto two lines at anything under a wide monitor, and on a page inside
 * Sales they sat above a second sub-nav and a third filter row, so three rows of
 * navigation stood between the page title and the first invoice.
 *
 * `CategoryStrip` is one row that scrolls instead of wrapping, with an icon over
 * each label so ten items stay scannable rather than reading as a wall of words.
 * The component and its export are unchanged, so all ~25 pages that import
 * `AccountingNav` picked this up without an edit.
 */
const TABS: CategoryItem[] = [
  {
    href: "/dashboard/m/accounting",
    label: "Overview",
    icon: LayoutDashboard,
    exact: true,
  },
  { href: "/dashboard/m/accounting/banking", label: "Banking", icon: Landmark },
  { href: "/dashboard/m/accounting/receipts", label: "Inbox", icon: Inbox },
  { href: "/dashboard/m/accounting/sales", label: "Sales", icon: Receipt },
  {
    href: "/dashboard/m/accounting/purchases",
    label: "Purchases",
    icon: ShoppingCart,
  },
  {
    href: "/dashboard/m/accounting/accounts",
    label: "Chart of Accounts",
    icon: ListTree,
  },
  { href: "/dashboard/m/accounting/journal", label: "Journal", icon: BookOpen },
  {
    href: "/dashboard/m/accounting/reports",
    label: "Reports",
    icon: ChartColumn,
  },
  {
    href: "/dashboard/m/accounting/trial-balance",
    label: "Trial Balance",
    icon: Scale,
  },
  { href: "/dashboard/m/accounting/close", label: "Close", icon: Lock },
];

export function AccountingNav() {
  return <CategoryStrip items={TABS} className="print:hidden" />;
}
