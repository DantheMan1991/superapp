"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  importCsvTransactionsAction,
  parseCsvPreviewAction,
  type CsvPreview,
} from "@/modules/accounting/banking/actions";

const MAX_FILE_BYTES = 1_000_000;
const NONE = "__none__";

type AmountMode = "single" | "split";

export function ImportWizard({
  bankAccountId,
  canImport,
}: {
  bankAccountId: string;
  canImport: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [csvText, setCsvText] = useState<string | null>(null);
  const [preview, setPreview] = useState<CsvPreview | null>(null);
  const [done, setDone] = useState<{ imported: number; skippedDuplicates: number } | null>(null);
  const [mapping, setMapping] = useState({
    dateCol: NONE,
    descCol: NONE,
    amountMode: "single" as AmountMode,
    amountCol: NONE,
    debitCol: NONE,
    creditCol: NONE,
    dateFormat: "MM/DD/YYYY" as "YYYY-MM-DD" | "MM/DD/YYYY" | "DD/MM/YYYY",
    negate: false,
  });

  async function onFile(file: File) {
    if (file.size > MAX_FILE_BYTES) {
      toast.error("File is too large (max ~1 MB). Export a shorter date range.");
      return;
    }
    const text = await file.text();
    setCsvText(text);
    startTransition(async () => {
      const result = await parseCsvPreviewAction({ bankAccountId, csvText: text });
      if ("error" in result) {
        toast.error(result.error);
        setCsvText(null);
        return;
      }
      const p = result.data!;
      setPreview(p);
      const m = p.suggestedMapping;
      setMapping({
        dateCol: m.dateCol !== undefined ? String(m.dateCol) : NONE,
        descCol: m.descCol !== undefined ? String(m.descCol) : NONE,
        amountMode:
          m.debitCol !== undefined && m.creditCol !== undefined ? "split" : "single",
        amountCol: m.amountCol !== undefined ? String(m.amountCol) : NONE,
        debitCol: m.debitCol !== undefined ? String(m.debitCol) : NONE,
        creditCol: m.creditCol !== undefined ? String(m.creditCol) : NONE,
        dateFormat: p.dateFormat?.format ?? "MM/DD/YYYY",
        negate: false,
      });
      if (p.dateFormat?.ambiguous) {
        toast.info("Date format looks ambiguous — double-check month vs day below.");
      }
    });
  }

  function runImport() {
    if (!csvText || !preview) return;
    const m = mapping;
    if (m.dateCol === NONE || m.descCol === NONE) {
      toast.error("Pick the date and description columns");
      return;
    }
    if (m.amountMode === "single" && m.amountCol === NONE) {
      toast.error("Pick the amount column");
      return;
    }
    if (m.amountMode === "split" && (m.debitCol === NONE || m.creditCol === NONE)) {
      toast.error("Pick both the money-out and money-in columns");
      return;
    }
    startTransition(async () => {
      const result = await importCsvTransactionsAction({
        bankAccountId,
        csvText,
        mapping: {
          dateCol: Number(m.dateCol),
          descCol: Number(m.descCol),
          dateFormat: m.dateFormat,
          negate: m.negate,
          hasHeader: preview.hasHeader,
          ...(m.amountMode === "single"
            ? { amountCol: Number(m.amountCol) }
            : { debitCol: Number(m.debitCol), creditCol: Number(m.creditCol) }),
        },
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setDone(result.data!);
    });
  }

  if (!canImport) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Only the business owner can import statements.
        </CardContent>
      </Card>
    );
  }

  if (done) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Import complete</CardTitle>
          <CardDescription>
            {done.imported} transaction{done.imported === 1 ? "" : "s"} imported
            {done.skippedDuplicates > 0
              ? ` · ${done.skippedDuplicates} duplicate${done.skippedDuplicates === 1 ? "" : "s"} skipped`
              : ""}
            .
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href={`/dashboard/m/accounting/banking/${bankAccountId}`}>
              Go review them
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!preview) {
    return (
      <Card>
        <CardContent className="py-10">
          <label className="mx-auto flex max-w-md cursor-pointer flex-col items-center gap-3 rounded-lg border-2 border-dashed p-8 text-center hover:border-brand/50">
            <Upload className="size-6 text-muted-foreground" />
            <span className="text-sm font-medium">
              {pending ? "Reading…" : "Choose a CSV file"}
            </span>
            <span className="text-xs text-muted-foreground">
              The statement export from your bank&apos;s website
            </span>
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              disabled={pending}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
                e.target.value = "";
              }}
            />
          </label>
        </CardContent>
      </Card>
    );
  }

  const colOptions = preview.headers.map((h, i) => ({
    value: String(i),
    label: preview.hasHeader ? `${h || `Column ${i + 1}`}` : `Column ${i + 1}`,
  }));
  const colSelect = (
    value: string,
    onChange: (v: string) => void,
    placeholder: string,
  ) => (
    <Select value={value === NONE ? undefined : value} onValueChange={onChange}>
      <SelectTrigger className="h-9">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {colOptions.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Map the columns</CardTitle>
          <CardDescription>
            {preview.rowCount} row{preview.rowCount === 1 ? "" : "s"} found
            {preview.hasHeader ? " (header detected)" : " (no header row)"} —
            check the mapping, then import.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Date column</Label>
              {colSelect(mapping.dateCol, (v) => setMapping({ ...mapping, dateCol: v }), "Pick")}
            </div>
            <div className="space-y-1.5">
              <Label>Description column</Label>
              {colSelect(mapping.descCol, (v) => setMapping({ ...mapping, descCol: v }), "Pick")}
            </div>
            <div className="space-y-1.5">
              <Label>Date format</Label>
              <Select
                value={mapping.dateFormat}
                onValueChange={(v) =>
                  setMapping({ ...mapping, dateFormat: v as typeof mapping.dateFormat })
                }
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MM/DD/YYYY">MM/DD/YYYY</SelectItem>
                  <SelectItem value="DD/MM/YYYY">DD/MM/YYYY</SelectItem>
                  <SelectItem value="YYYY-MM-DD">YYYY-MM-DD</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Amount style</Label>
              <Select
                value={mapping.amountMode}
                onValueChange={(v) =>
                  setMapping({ ...mapping, amountMode: v as AmountMode })
                }
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="single">One signed column</SelectItem>
                  <SelectItem value="split">Separate in/out columns</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {mapping.amountMode === "single" ? (
              <div className="space-y-1.5">
                <Label>Amount column</Label>
                {colSelect(mapping.amountCol, (v) => setMapping({ ...mapping, amountCol: v }), "Pick")}
              </div>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label>Money out column</Label>
                  {colSelect(mapping.debitCol, (v) => setMapping({ ...mapping, debitCol: v }), "Pick")}
                </div>
                <div className="space-y-1.5">
                  <Label>Money in column</Label>
                  {colSelect(mapping.creditCol, (v) => setMapping({ ...mapping, creditCol: v }), "Pick")}
                </div>
              </>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4"
              checked={mapping.negate}
              onChange={(e) => setMapping({ ...mapping, negate: e.target.checked })}
            />
            Flip signs (my bank shows money out as positive)
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Preview</CardTitle>
          <CardDescription>First {preview.sampleRows.length} rows as parsed.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {preview.headers.map((h, i) => (
                    <TableHead key={i} className="whitespace-nowrap text-xs">
                      {preview.hasHeader ? h || `Col ${i + 1}` : `Col ${i + 1}`}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.sampleRows.map((row, ri) => (
                  <TableRow key={ri}>
                    {preview.headers.map((_, ci) => (
                      <TableCell key={ci} className="whitespace-nowrap text-xs">
                        {row[ci] ?? ""}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button onClick={runImport} disabled={pending}>
          {pending ? "Importing…" : "Import transactions"}
        </Button>
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => {
            setPreview(null);
            setCsvText(null);
          }}
        >
          Start over
        </Button>
      </div>
    </div>
  );
}
