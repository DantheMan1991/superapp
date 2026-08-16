"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Label } from "@/components/ui/label";

/**
 * The company scope on a LIST page (ADR 0010).
 *
 * The reports use a plain GET form with a Run button, because a report is a
 * question you assemble — dates, basis, comparison — and then ask. A list is
 * not: you are already looking at it, and a "Run" button between you and the
 * rows you asked for is friction with no purpose. So this navigates on change.
 *
 * IT PRESERVES THE OTHER PARAMETERS, which is the whole reason it is a
 * component rather than four copies of a `<select>`. The invoice list carries a
 * status filter and a MoneyBar bucket in the query string, and a company picker
 * that dropped them would silently widen the list at the same moment it
 * narrowed it — you would pick a company and lose "Overdue" without being told.
 *
 * Renders NOTHING below two companies. The single-company client never learns
 * the concept exists, on this page as on every other.
 */
export function CompanyPicker({
  entities,
  className,
}: {
  entities: Array<{ id: string; name: string }>;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  if (entities.length < 2) return null;

  const current = params.get("entity") ?? "";

  function go(value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set("entity", value);
    else next.delete("entity");
    router.push(next.size > 0 ? `${pathname}?${next}` : pathname);
  }

  return (
    <div className={className}>
      <Label htmlFor="company-scope" className="sr-only">
        Company
      </Label>
      <select
        id="company-scope"
        value={current}
        onChange={(e) => go(e.target.value)}
        className="border-input h-9 w-52 rounded-md border bg-transparent px-3 text-sm shadow-xs"
      >
        <option value="">All companies</option>
        {entities.map((e) => (
          <option key={e.id} value={e.id}>
            {e.name}
          </option>
        ))}
      </select>
    </div>
  );
}
