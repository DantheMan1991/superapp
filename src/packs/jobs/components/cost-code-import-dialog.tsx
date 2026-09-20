"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, ClipboardPaste } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  importCostCodesAction,
  previewCostCodeImportAction,
} from "../actions";

/**
 * BRINGING A CHART OF COST IN FROM A SPREADSHEET.
 *
 * **IT SHOWS YOU WHAT IT WILL DO BEFORE IT DOES ANY OF IT.** A chart is what
 * every bill, budget and job cost report in the business is charged against,
 * and 291 rows is not something anybody can proofread in a textarea. So the
 * preview is the whole point of this dialog: how many are new, how many
 * change, how many the paste never mentioned, and **every line it could not
 * read, with its line number**.
 *
 * The preview and the write each parse the pasted TEXT on the server. Nothing
 * this component holds is trusted to describe a row.
 */

interface Preview {
  adding: number;
  updating: number;
  unchanged: number;
  untouched: number;
  reordered: boolean;
  categories: string[];
  skippedHeader: string;
  sample: { code: string; name: string; category: string }[];
  total: number;
  issues: { line: number; text: string; reason: string }[];
  issueCount: number;
}

export function ImportCodesButton({ setId, setName }: { setId: string; setName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [pending, startTransition] = useTransition();

  function look(next: string) {
    setText(next);
    setPreview(null);
  }

  function check() {
    startTransition(async () => {
      try {
        const result = await previewCostCodeImportAction({ setId, text });
        if ("error" in result) {
          toast.error(result.error);
          return;
        }
        setPreview(result as Preview);
      } catch {
        toast.error("That did not get through. Try again.");
      }
    });
  }

  function commit() {
    startTransition(async () => {
      try {
        const result = await importCostCodesAction({ setId, text });
        if ("error" in result) {
          toast.error(result.error);
          return;
        }
        toast.success(
          `${result.adding} added, ${result.updating} changed` +
            (result.skipped > 0 ? `, ${result.skipped} skipped` : ""),
        );
        setOpen(false);
        setText("");
        setPreview(null);
        router.refresh();
      } catch {
        toast.error("That did not get through. Try again.");
      }
    });
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <ClipboardPaste className="mr-1.5 size-4" /> Paste a list
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Paste a cost code list into {setName}</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="paste-codes">
                Copy the columns out of your spreadsheet and paste them here
              </Label>
              <Textarea
                id="paste-codes"
                value={text}
                onChange={(e) => look(e.target.value)}
                rows={8}
                className="font-mono text-xs"
                placeholder={
                  "03. Infrastructure\t03.20 - Excavation Labor\n" +
                  "03. Infrastructure\t03.40 - Excavation Material\n" +
                  "04. Structural\t04.00 - Foundation Labor"
                }
              />
              <p className="text-xs text-muted-foreground">
                One code per line. A grouping column to the left of the code is
                kept as its category; a column that reads the same on every row
                is ignored. Your order is kept exactly as pasted.
              </p>
            </div>

            {preview && (
              <div className="rounded-md border p-3 text-sm">
                {preview.total === 0 ? (
                  <p className="text-muted-foreground">
                    Nothing in that paste looked like a cost code.
                  </p>
                ) : (
                  <>
                    <p>
                      <span className="font-medium">{preview.adding}</span> new,{" "}
                      <span className="font-medium">{preview.updating}</span> changed,{" "}
                      {preview.unchanged} already the same.
                    </p>
                    {preview.adding === 0 && preview.updating === 0 && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        This list is already exactly what you pasted. Bringing it in
                        again changes nothing.
                      </p>
                    )}
                    {preview.untouched > 0 && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {preview.untouched} {preview.untouched === 1 ? "code" : "codes"} already
                        in this list {preview.untouched === 1 ? "is" : "are"} not in the paste.{" "}
                        {preview.untouched === 1 ? "It stays" : "They stay"} exactly as{" "}
                        {preview.untouched === 1 ? "it is" : "they are"} — nothing is deleted or
                        retired.
                      </p>
                    )}
                    {preview.reordered && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        The paste covers the whole list, so it sets the order.
                      </p>
                    )}
                    {preview.categories.length > 0 && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        {preview.categories.length} categories:{" "}
                        {preview.categories.slice(0, 8).join(" · ")}
                        {preview.categories.length > 8 && " …"}
                      </p>
                    )}
                    {preview.skippedHeader && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Header row ignored.
                      </p>
                    )}

                    <ul className="mt-3 border-t pt-2">
                      {preview.sample.map((c) => (
                        <li key={c.code} className="flex gap-3 py-0.5 text-xs">
                          <span className="w-20 shrink-0 font-mono">{c.code}</span>
                          <span className="flex-1">{c.name}</span>
                          <span className="text-muted-foreground">{c.category}</span>
                        </li>
                      ))}
                      {preview.total > preview.sample.length && (
                        <li className="py-0.5 text-xs text-muted-foreground">
                          and {preview.total - preview.sample.length} more
                        </li>
                      )}
                    </ul>

                    {preview.issueCount > 0 && (
                      <div className="mt-3 rounded-md bg-warning/20 p-2">
                        <p className="flex items-center gap-1.5 text-xs font-medium text-warning-foreground">
                          <AlertTriangle className="size-3.5" />
                          {preview.issueCount}{" "}
                          {preview.issueCount === 1 ? "line" : "lines"} will be skipped
                        </p>
                        <ul className="mt-1.5 space-y-0.5">
                          {preview.issues.map((i) => (
                            <li key={i.line} className="text-xs text-muted-foreground">
                              Line {i.line}: {i.reason} — {i.text.slice(0, 70)}
                            </li>
                          ))}
                          {preview.issueCount > preview.issues.length && (
                            <li className="text-xs text-muted-foreground">
                              and {preview.issueCount - preview.issues.length} more
                            </li>
                          )}
                        </ul>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            {preview && preview.total > 0 ? (
              <Button onClick={commit} disabled={pending}>
                {pending
                  ? "Bringing them in…"
                  : `Bring in ${preview.total} ${preview.total === 1 ? "code" : "codes"}`}
              </Button>
            ) : (
              <Button onClick={check} disabled={pending || text.trim() === ""}>
                {pending ? "Reading…" : "See what this does"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
