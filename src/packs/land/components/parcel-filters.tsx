"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { statusFrom, type ParcelStatusFilter } from "../core/list";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** What the list shows. `active` is the default and is not written to the URL. */
export const PARCEL_STATUS: Record<ParcelStatusFilter, string> = {
  active: "In use",
  retired: "Retired",
  all: "Both",
};

/**
 * Which ground the list shows.
 *
 * **THIS REPLACES AN ADDRESS TRICK.** Retired parcels were opt-in via
 * `?retired=1` with nothing on the page to set it, and the tenant guide had to
 * tell people to edit the URL. Slice 6 made that worse rather than better: a
 * retired parcel now carries `Put it back`, and the only route to the page
 * holding that button was the trick.
 *
 * **`?retired=1` STILL WORKS**, because a guide told people to use it and a
 * bookmark should not break. It means the same as `Both`.
 *
 * It owns one parameter and reads it from the URL, the way `ListSearch` does —
 * so the choice survives a refresh and travels in a link.
 */
export function ParcelStatusSelect() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const current = statusFrom(params.get("status"), params.get("retired"));

  function choose(next: string) {
    const p = new URLSearchParams(params.toString());
    // The legacy parameter is dropped the moment somebody uses the control,
    // so the two cannot end up disagreeing in the same URL.
    p.delete("retired");
    if (next === "active") p.delete("status");
    else p.set("status", next);
    router.replace(p.size > 0 ? `${pathname}?${p}` : pathname);
  }

  return (
    <Select value={current} onValueChange={choose}>
      <SelectTrigger className="h-9 w-auto min-w-32 text-sm" aria-label="Status">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(Object.keys(PARCEL_STATUS) as ParcelStatusFilter[]).map((key) => (
          <SelectItem key={key} value={key}>
            {PARCEL_STATUS[key]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
