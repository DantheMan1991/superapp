"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

/**
 * Full-books export launcher. The download itself is a plain GET to the
 * streaming route — the browser handles the file; no payload ever rides a
 * server action.
 */
export function ExportBooksDialog() {
  const [open, setOpen] = useState(false);
  const [includeFiles, setIncludeFiles] = useState(true);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Download className="mr-1.5 h-4 w-4" />
          Export books
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Export your books</DialogTitle>
          <DialogDescription>
            A complete copy of your accounting records — chart of accounts,
            every journal entry, sales, purchases, banking, the audit trail,
            and current statements — as CSV files in one zip. Your books
            belong to you.
          </DialogDescription>
        </DialogHeader>
        <label className="flex items-start gap-2.5 rounded-md border p-3">
          <input
            type="checkbox"
            checked={includeFiles}
            onChange={(e) => setIncludeFiles(e.target.checked)}
            className="mt-0.5 h-4 w-4"
          />
          <span>
            <Label className="cursor-pointer">Include document files</Label>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              Every uploaded or emailed receipt and bill, as the original
              files. Can make the download large.
            </span>
          </span>
        </label>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              window.location.href = `/api/accounting/export${
                includeFiles ? "?files=1" : ""
              }`;
              setOpen(false);
            }}
          >
            <Download className="mr-1.5 h-4 w-4" />
            Download zip
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
