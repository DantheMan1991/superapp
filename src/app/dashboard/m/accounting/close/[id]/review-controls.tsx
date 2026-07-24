"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PenLine, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  addCloseNoteAction,
  generateCloseNarrativeAction,
  signOffCloseAction,
} from "@/modules/accounting/close/actions";

export function SignOffButton({
  closeId,
  version,
}: {
  closeId: string;
  version: number;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <Button
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await signOffCloseAction({
            closeId,
            expectedVersion: version,
          });
          if ("error" in res) {
            toast.error(res.error);
            return;
          }
          toast.success("Close signed off.");
          router.refresh();
        })
      }
    >
      <PenLine className="mr-1.5 h-4 w-4" />
      {pending ? "Signing…" : "Sign off this close"}
    </Button>
  );
}

export function GenerateNarrativeButton({
  closeId,
  hasNarrative,
}: {
  closeId: string;
  hasNarrative: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await generateCloseNarrativeAction({ closeId });
          if ("error" in res) {
            toast.error(res.error);
            return;
          }
          toast.success("Narrative generated.");
          router.refresh();
        })
      }
    >
      <Sparkles className="mr-1.5 h-4 w-4" />
      {pending
        ? "Writing…"
        : hasNarrative
          ? "Regenerate narrative"
          : "Generate narrative"}
    </Button>
  );
}

export function AddNoteForm({ closeId }: { closeId: string }) {
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!body.trim()) return;
        startTransition(async () => {
          const res = await addCloseNoteAction({ closeId, body });
          if ("error" in res) {
            toast.error(res.error);
            return;
          }
          setBody("");
          router.refresh();
        });
      }}
    >
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Leave a review note for this close…"
        maxLength={2000}
        rows={3}
      />
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={pending || !body.trim()}>
          {pending ? "Adding…" : "Add note"}
        </Button>
      </div>
    </form>
  );
}
