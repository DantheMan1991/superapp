"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/** The printed statement carries the business header the page hides on screen. */
export function PrintStatementButton() {
  return (
    <Button size="sm" variant="outline" onClick={() => window.print()}>
      <Printer className="size-4" />
      Print
    </Button>
  );
}
