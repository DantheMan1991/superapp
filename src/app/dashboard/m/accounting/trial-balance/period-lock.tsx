"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import { toast } from "sonner";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateClosedThrough } from "@/modules/accounting/actions";

export function PeriodLockControl({
  closedThrough,
}: {
  closedThrough: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [date, setDate] = useState(closedThrough ?? "");

  function save(value: string | null) {
    startTransition(async () => {
      const result = await updateClosedThrough({ date: value });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(value ? `Books closed through ${value}` : "Books reopened");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Lock className="mr-1.5 size-3.5" />
          {closedThrough ? `Closed through ${closedThrough}` : "Close the books"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Close the books</DialogTitle>
          <DialogDescription>
            Entries dated on or before the closing date become locked —
            corrections then require a reversal entry.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5 py-2">
          <Label htmlFor="closed-through">Closed through</Label>
          <Input
            id="closed-through"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <DialogFooter className="gap-2">
          {closedThrough && (
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => save(null)}
            >
              Reopen books
            </Button>
          )}
          <Button disabled={pending || !date} onClick={() => save(date)}>
            {pending ? "Saving…" : "Close books"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
