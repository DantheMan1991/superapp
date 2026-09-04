"use client";
import { Globe, Palette } from "lucide-react";
import { CategoryStrip } from "@/components/app/category-strip";

/**
 * The module's sections. A client component so the icons never cross the
 * server/client boundary as components (design-system gotcha); the server
 * pages just render `<MarketingStrip />`.
 */
const BASE = "/dashboard/m/marketing";

export function MarketingStrip() {
  return (
    <CategoryStrip
      items={[
        { href: BASE, label: "Brand", icon: Palette, exact: true },
        { href: `${BASE}/website`, label: "Website", icon: Globe },
      ]}
    />
  );
}
