"use client";
import { useState, useTransition } from "react";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { PageContent, Section } from "@/lib/sites/schema";
import { PAGE_SENTENCE_MAX, REWRITE_INSTRUCTION_MAX } from "../ai/assistant-prompt";
import { describePhotoAction, draftPageAction, rewriteSectionAction } from "../assistant-actions";

/**
 * The assistant's three controls in the editor (slice 12). Each asks, waits,
 * and hands the answer to the editor's own state: nothing is saved until
 * the owner presses Save, and the words that come back are theirs to read
 * first. Drawn only when the assistant is set up on this deployment.
 */
type Result<T> = { ok: true; data?: T } | { error: string };

/** Under a section's form: new words for it, with a request if the owner has one. */
export function RewriteWords({
  pageId,
  section,
  onRewritten,
}: {
  pageId: string;
  section: Section;
  onRewritten: (next: Section) => void;
}) {
  const [instruction, setInstruction] = useState("");
  const [pending, startTransition] = useTransition();
  const ask = () =>
    startTransition(async () => {
      const result: Result<{ section: Section }> = await rewriteSectionAction({ pageId, section, instruction });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      if (result.data) onRewritten(result.data.section);
      toast.success("Rewritten. Read it, then save.");
    });
  return (
    <div className="space-y-2 rounded-xl bg-muted/50 p-3">
      <Label htmlFor={`rewrite-${pageId}`}>Ask the assistant</Label>
      <div className="flex flex-wrap gap-2">
        <Input
          id={`rewrite-${pageId}`}
          value={instruction}
          maxLength={REWRITE_INSTRUCTION_MAX}
          placeholder="Shorter, warmer, mention Friday delivery… or leave blank"
          className="min-w-0 flex-1"
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !pending) ask();
          }}
        />
        <Button type="button" variant="outline" size="sm" disabled={pending} onClick={ask}>
          <Sparkles className="size-4" />
          {pending ? "Writing…" : "Rewrite the words"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Only the words change; photos, links and the look stay. Nothing is saved until you save.
      </p>
    </div>
  );
}

/** In the Page card: the whole page from a sentence. */
export function WritePage({
  pageId,
  hasSections,
  onWritten,
}: {
  pageId: string;
  hasSections: boolean;
  onWritten: (content: PageContent) => void;
}) {
  const [sentence, setSentence] = useState("");
  const [pending, startTransition] = useTransition();
  const ask = () => {
    if (
      hasSections &&
      !window.confirm("Replace the sections on this page with what the assistant writes? Nothing is saved until you save.")
    ) {
      return;
    }
    startTransition(async () => {
      const result: Result<{ content: PageContent }> = await draftPageAction({ pageId, sentence });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      if (result.data) onWritten(result.data.content);
      toast.success("Written. Read it, then save.");
    });
  };
  return (
    <div className="space-y-2 border-t border-divider pt-4">
      <Label htmlFor={`write-${pageId}`}>Write this page with the assistant</Label>
      <Textarea
        id={`write-${pageId}`}
        value={sentence}
        maxLength={PAGE_SENTENCE_MAX}
        rows={2}
        placeholder="A page about our farm tours: what a visit is like, that it's free, and how to book."
        onChange={(e) => setSentence(e.target.value)}
      />
      <div className="flex items-center gap-3">
        <Button type="button" variant="outline" size="sm" disabled={pending || sentence.trim().length < 3} onClick={ask}>
          <Sparkles className="size-4" />
          {pending ? "Writing…" : "Write the page"}
        </Button>
        <p className="text-xs text-muted-foreground">It chooses the sections and writes the words from your details.</p>
      </div>
    </div>
  );
}

/** Beside a photo's description: a sentence from the picture itself. */
export function SuggestDescription({ imageId, onSuggested }: { imageId: string; onSuggested: (alt: string) => void }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result: Result<{ alt: string }> = await describePhotoAction({ id: imageId });
          if ("error" in result) {
            toast.error(result.error);
            return;
          }
          if (result.data) onSuggested(result.data.alt);
        })
      }
    >
      <Sparkles className="size-4" />
      {pending ? "Looking…" : "Suggest"}
    </Button>
  );
}
