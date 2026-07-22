"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Paperclip, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  attachDocumentAction,
  detachDocumentAction,
  listInboxDocumentsAction,
} from "@/modules/accounting/documents/actions";

interface InboxDoc {
  id: string;
  fileName: string;
  vendorName: string | null;
  totalLabel: string | null;
}

export function DetachAttachmentButton({ linkId }: { linkId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await detachDocumentAction({ linkId });
          if ("error" in result && result.error) toast.error(result.error);
          else {
            toast.success("Detached.");
            router.refresh();
          }
        })
      }
    >
      <X className="h-3.5 w-3.5" />
    </Button>
  );
}

export function AttachExistingButton({
  target,
}: {
  target: { type: "entry" | "bank_transaction" | "invoice"; id: string };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [docs, setDocs] = useState<InboxDoc[] | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    void (async () => {
      const result = await listInboxDocumentsAction();
      setDocs("error" in result ? [] : (result.data?.documents ?? []));
    })();
  }, [open]);

  function attach(documentId: string) {
    startTransition(async () => {
      const result = await attachDocumentAction({ documentId, target });
      if ("error" in result && result.error) toast.error(result.error);
      else {
        toast.success("Receipt attached.");
        setOpen(false);
        router.refresh();
      }
    });
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Paperclip className="mr-1 h-3.5 w-3.5" /> Attach
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Attach a receipt</DialogTitle>
            <DialogDescription>
              Pick from the receipt inbox.
            </DialogDescription>
          </DialogHeader>
          {docs === null ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : docs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              The inbox is empty — upload or email a receipt first.
            </p>
          ) : (
            <div className="max-h-72 divide-y overflow-y-auto rounded-md border">
              {docs.map((doc) => (
                <button
                  key={doc.id}
                  type="button"
                  disabled={pending}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50 disabled:opacity-50"
                  onClick={() => attach(doc.id)}
                >
                  <span className="truncate">
                    {doc.vendorName ?? doc.fileName}
                  </span>
                  {doc.totalLabel && (
                    <span className="font-mono text-xs text-muted-foreground">
                      {doc.totalLabel}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
