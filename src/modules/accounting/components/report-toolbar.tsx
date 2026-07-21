"use client";

import { useTransition } from "react";
import { Download, Printer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { exportReportCsv } from "../actions";

type ExportParams = Parameters<typeof exportReportCsv>[0];

export function ReportToolbar({ exportParams }: { exportParams: ExportParams }) {
  const [pending, startTransition] = useTransition();

  function download() {
    startTransition(async () => {
      const result = await exportReportCsv(exportParams);
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
    });
  }

  return (
    <div className="flex gap-2 print:hidden">
      <Button variant="outline" size="sm" onClick={download} disabled={pending}>
        <Download className="mr-1.5 size-3.5" />
        {pending ? "Exporting…" : "Export CSV"}
      </Button>
      <Button variant="outline" size="sm" onClick={() => window.print()}>
        <Printer className="mr-1.5 size-3.5" />
        Print
      </Button>
    </div>
  );
}
