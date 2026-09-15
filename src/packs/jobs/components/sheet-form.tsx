"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { deleteSheetAction, updateSheetAction } from "../actions";

export interface EditableSheet {
  id: string;
  version: number;
  sheetNumber: string;
  title: string;
  revision: string;
  pageNumber: number;
  setName: string;
}

/**
 * One sheet's words: its number, title and revision mark, as the office
 * corrects what the title block reading got wrong; and the page taken back
 * out of the set when it was never a sheet. The file is untouched either way.
 */
export function SheetForm({ projectId, sheet, afterDelete }: { projectId: string; sheet: EditableSheet; afterDelete: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [sheetNumber, setSheetNumber] = useState(sheet.sheetNumber);
  const [title, setTitle] = useState(sheet.title);
  const [revision, setRevision] = useState(sheet.revision);
  const [armed, setArmed] = useState(false);

  function save() {
    startTransition(async () => {
      const result = await updateSheetAction({ id: sheet.id, projectId, version: sheet.version, sheetNumber, title, revision });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Sheet saved");
      setOpen(false);
      router.refresh();
    });
  }

  function remove() {
    startTransition(async () => {
      const result = await deleteSheetAction({ id: sheet.id, projectId });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Page taken out of the set — the file is untouched");
      setOpen(false);
      router.push(afterDelete);
      router.refresh();
    });
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Pencil className="mr-1.5 size-4" /> Edit
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setArmed(false);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{sheet.sheetNumber}</DialogTitle>
            <DialogDescription>
              Page {sheet.pageNumber} of the {sheet.setName} file.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-[9rem_1fr]">
              <div className="space-y-1.5">
                <Label htmlFor="sh-number">Sheet</Label>
                <Input id="sh-number" value={sheetNumber} onChange={(e) => setSheetNumber(e.target.value)} maxLength={40} className="font-mono uppercase" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sh-rev">Revision</Label>
                <Input id="sh-rev" value={revision} onChange={(e) => setRevision(e.target.value)} maxLength={40} placeholder="2, B, ASI-3" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sh-title">Title</Label>
              <Input id="sh-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} placeholder="First floor plan" />
            </div>
          </div>
          <DialogFooter className="flex-row items-center justify-between sm:justify-between">
            {armed ? (
              <Button type="button" variant="destructive" size="sm" disabled={pending} onClick={remove}>
                Take {sheet.sheetNumber} out
              </Button>
            ) : (
              <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => setArmed(true)}>
                <Trash2 className="mr-1.5 size-4" /> Not a sheet
              </Button>
            )}
            <Button onClick={save} disabled={pending || sheetNumber.trim() === ""}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
