"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { exportPayPeriodCsvAction } from "../actions";

/**
 * One pay period as a file, for whoever actually runs the payroll.
 *
 * The download is built in the browser from a string the server returned,
 * rather than served from a route: the report toolbar in accounting does the
 * same, and it means the file never exists on disk and the action keeps the
 * ordinary gate → Zod → withTenant shape instead of becoming a second kind of
 * endpoint with its own authorisation to get wrong.
 */
export function ExportPayPeriodButton({ on }: { on: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await exportPayPeriodCsvAction({ on });
          if ("error" in result) {
            toast.error(result.error);
            return;
          }
          const { filename, csv } = result.data!;
          const url = URL.createObjectURL(
            new Blob([csv], { type: "text/csv;charset=utf-8" }),
          );
          const a = document.createElement("a");
          a.href = url;
          a.download = filename;
          a.click();
          URL.revokeObjectURL(url);
          toast.success("Downloaded");
        })
      }
    >
      {pending ? "Preparing…" : "Download for payroll"}
    </Button>
  );
}
