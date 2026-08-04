"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { CrmRecordFilter } from "../core/types";

const BASE = "/dashboard/m/crm";

/**
 * Search and the two filters, kept in the URL rather than in component state.
 *
 * The house pattern, and it earns its keep here: a filtered list is something
 * people paste to a colleague, and the back button should undo a filter rather
 * than leave the module. It also means the server component does the filtering,
 * so RLS applies to the query instead of to a set already sent to the browser.
 */
export function RecordSearch({ filter }: { filter: CrmRecordFilter }) {
  const router = useRouter();
  const params = useSearchParams();

  // The box is UNCONTROLLED, and keyed on the URL's own value.
  //
  // The obvious alternative — mirror the URL into state and re-sync it in an
  // effect — is a cascading render, and React's own guidance is not to. Keying
  // the input means a back button or a link from elsewhere remounts it with the
  // right value, which is the same outcome with nothing to keep in step.
  const urlQuery = params.get("q") ?? "";

  function apply(next: Record<string, string | null>) {
    const search = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value === null || value === "") search.delete(key);
      else search.set(key, value);
    }
    const qs = search.toString();
    router.push(qs ? `${BASE}?${qs}` : BASE);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <form
        className="relative min-w-0 flex-1"
        onSubmit={(e) => {
          e.preventDefault();
          const value = new FormData(e.currentTarget).get("q");
          apply({ q: (typeof value === "string" ? value.trim() : "") || null });
        }}
      >
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          key={urlQuery}
          name="q"
          defaultValue={urlQuery}
          placeholder="Search by name"
          className="pl-9"
          aria-label="Search records"
        />
      </form>

      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          size="sm"
          variant={filter.kind === "person" ? "default" : "outline"}
          onClick={() =>
            apply({ kind: filter.kind === "person" ? null : "person" })
          }
        >
          People
        </Button>
        <Button
          type="button"
          size="sm"
          variant={filter.kind === "organization" ? "default" : "outline"}
          onClick={() =>
            apply({
              kind: filter.kind === "organization" ? null : "organization",
            })
          }
        >
          Companies
        </Button>
        <Button
          type="button"
          size="sm"
          variant={filter.workedOnly ? "default" : "outline"}
          onClick={() => apply({ worked: filter.workedOnly ? null : "1" })}
        >
          In CRM
        </Button>
        <Button
          type="button"
          size="sm"
          variant={filter.includeInactive ? "default" : "outline"}
          onClick={() => apply({ archived: filter.includeInactive ? null : "1" })}
        >
          Archived
        </Button>
      </div>
    </div>
  );
}
