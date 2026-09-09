"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { exportValuationCsv } from "../actions";

/**
 * The date a valuation is as of.
 *
 * **A URL PARAMETER RATHER THAN COMPONENT STATE, deliberately.** A valuation is
 * a figure somebody quotes to an accountant, and a page whose number cannot be
 * linked to is a page whose number has to be described instead. It also means
 * the back button walks the dates somebody has already looked at, which is what
 * a person comparing two period ends is actually doing.
 *
 * There is no "clear" — an as-of of nothing is not a meaningful balance sheet
 * date, and the page defaults to today rather than to everything.
 */
export function AsOfPicker({ asOf, today }: { asOf: string; today: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [value, setValue] = useState(asOf);

  function go(next: string) {
    if (!next) return;
    const q = new URLSearchParams(params.toString());
    q.set("asOf", next);
    router.push(`?${q.toString()}`);
  }

  return (
    <div className="flex items-end gap-2">
      <div className="grid gap-1">
        <Label htmlFor="asOf" className="text-xs text-muted-foreground">
          As of
        </Label>
        <Input
          id="asOf"
          type="date"
          className="h-9 w-40"
          value={value}
          max={today}
          onChange={(e) => setValue(e.target.value)}
          // Enter is how a date field is finished by somebody who typed it
          // rather than picked it, and losing that would make the button the
          // only way through.
          onKeyDown={(e) => {
            if (e.key === "Enter") go(value);
          }}
        />
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={() => go(value)}
        disabled={value === asOf || !value}
      >
        Value it
      </Button>
    </div>
  );
}

/**
 * The valuation as a file.
 *
 * **THE BUTTON SENDS WHAT THE SCREEN IS SHOWING, AND NOTHING ELSE.** It passes
 * the four things in the URL and the server does the reading, so the file can
 * never be of a different question from the page it was pressed on — and the
 * labels in it are resolved from the same rows the figures come from rather
 * than from whatever the browser thought a place was called.
 *
 * The download itself is the same three lines accounting's report toolbar uses:
 * a blob, an anchor, a revoke. Nothing is written to disk on the server and
 * nothing is left behind in the page.
 */
export function ExportValuationButton({
  asOf,
  kind,
  enterpriseId,
  locationAssetId,
}: {
  asOf: string;
  kind?: string;
  enterpriseId?: string;
  locationAssetId?: string;
}) {
  const [pending, startTransition] = useTransition();

  function download() {
    startTransition(async () => {
      const result = await exportValuationCsv({
        asOf,
        kind,
        enterpriseId,
        locationAssetId,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      const url = URL.createObjectURL(
        new Blob([result.csv!], { type: "text/csv;charset=utf-8" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = result.filename!;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Downloaded");
    });
  }

  return (
    <Button variant="outline" size="sm" onClick={download} disabled={pending}>
      <Download className="mr-1.5 size-3.5" />
      {pending ? "Exporting…" : "Export"}
    </Button>
  );
}
