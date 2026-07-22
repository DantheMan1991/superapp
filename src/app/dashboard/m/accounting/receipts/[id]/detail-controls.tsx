"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { detachDocumentAction } from "@/modules/accounting/documents/actions";

export function DetachLinkButton({ linkId }: { linkId: string }) {
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
