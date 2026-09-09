"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Panel } from "@/components/app/panel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  proposeTellAction,
  recordTellAction,
} from "@/lib/tell-sources/actions";
import {
  checkEntry,
  TELL_MAX_CHARS,
  type TellCard,
} from "@/lib/tell-sources/shape";
import type { TellField, TellValue } from "@/lib/tell-sources/types";
import { cn } from "@/lib/utils";

const NONE = "__none__";

interface ActionView {
  slug: string;
  title: string;
  label: string;
  fields: TellField[];
}

/**
 * Say what happened, in one sentence (onboarding slice 6).
 *
 * THE CARDS ARE THE FEATURE, not a courtesy. Nothing is written until
 * somebody has read every one and pressed the button — the reading returns
 * cards and the record call takes only what is still here, as edited. A
 * sentence misread cannot reach the herd.
 *
 * BUILT FOR A PHONE IN A BARN: the box is three lines and always visible, the
 * cards stack, every field is full width, and the button says how many things
 * it is about to record. Nothing here knows what a pen or a paddock is — the
 * fields, the choices and the words all come from the pack that declared the
 * action.
 */
export function TellBox({ placeholder }: { placeholder?: string }) {
  const router = useRouter();
  const [sentence, setSentence] = useState("");
  const [cards, setCards] = useState<TellCard[] | null>(null);
  const [actions, setActions] = useState<ActionView[]>([]);
  const [reading, startReading] = useTransition();
  const [saving, startSaving] = useTransition();

  const actionOf = (slug: string) => actions.find((a) => a.slug === slug);
  const problems = (cards ?? []).map((c) => {
    const action = actionOf(c.actionSlug);
    return action ? checkEntry(c.values, action as never) : "That is not something you can record here.";
  });
  const ready = (cards?.length ?? 0) > 0 && problems.every((p) => p === null);

  function reset() {
    setSentence("");
    setCards(null);
    setActions([]);
  }

  function read() {
    if (sentence.trim() === "") return;
    startReading(async () => {
      const result = await proposeTellAction({ sentence });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setActions(result.data.actions as ActionView[]);
      setCards(result.data.cards);
      if (result.data.cards.length === 0) {
        // An explicit message, not an empty panel: "nothing found" and "it
        // broke" must not look the same.
        toast.info("Nothing to record from that.");
      }
    });
  }

  function save() {
    if (!cards || !ready) return;
    startSaving(async () => {
      const result = await recordTellAction({
        entries: cards.map((c) => ({ actionSlug: c.actionSlug, values: c.values })),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      const n = result.data.summaries.length;
      toast.success(
        n === 1 ? result.data.summaries[0] : `Recorded ${n} things`,
      );
      reset();
      router.refresh();
    });
  }

  function setValue(i: number, key: string, value: TellValue) {
    if (!cards) return;
    setCards(
      cards.map((c, j) => {
        if (j !== i) return c;
        const hints = { ...c.hints };
        delete hints[key];
        return { ...c, values: { ...c.values, [key]: value }, hints };
      }),
    );
  }

  return (
    <Panel className="p-4">
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="tell-sentence" className="text-sm font-medium">
            Tell it what happened
          </Label>
          <Textarea
            id="tell-sentence"
            value={sentence}
            onChange={(e) => setSentence(e.target.value)}
            rows={2}
            maxLength={TELL_MAX_CHARS}
            placeholder={placeholder ?? "Three chicks dead in pen two"}
          />
        </div>

        {cards === null ? (
          <div className="flex justify-end">
            <Button onClick={read} disabled={reading || sentence.trim() === ""} size="sm">
              {reading ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" /> Reading…
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 size-4" /> Read it
                </>
              )}
            </Button>
          </div>
        ) : (
          <>
            {cards.length === 0 ? (
              <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                Nothing to record from that.
              </p>
            ) : (
              <ul className="space-y-3">
                {cards.map((card, i) => {
                  const action = actionOf(card.actionSlug);
                  if (!action) return null;
                  return (
                    <li key={i} className="space-y-3 rounded-md border p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium">{action.title}</p>
                          <p className="text-xs text-muted-foreground">{action.label}</p>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 shrink-0"
                          onClick={() => setCards(cards.filter((_, j) => j !== i))}
                        >
                          <X className="size-4" />
                          <span className="sr-only">Drop this</span>
                        </Button>
                      </div>

                      <div className="grid gap-2">
                        {action.fields.map((f) => (
                          <div key={f.key} className="space-y-1">
                            <Label htmlFor={`tell-${i}-${f.key}`} className="text-xs">
                              {f.label}
                              {f.required && <span aria-hidden> *</span>}
                            </Label>
                            <Cell
                              id={`tell-${i}-${f.key}`}
                              field={f}
                              value={card.values[f.key] ?? null}
                              onChange={(v) => setValue(i, f.key, v)}
                            />
                            {card.hints[f.key] && (
                              <p className="text-xs text-amber-600">
                                It heard &ldquo;{card.hints[f.key]}&rdquo; — pick or type
                                the right one.
                              </p>
                            )}
                          </div>
                        ))}
                      </div>

                      {problems[i] && (
                        <p className="text-xs text-amber-600">{problems[i]}</p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={reset} disabled={saving}>
                Start over
              </Button>
              {cards.length > 0 && (
                <Button onClick={save} disabled={saving || !ready} size="sm">
                  {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
                  {saving
                    ? "Recording…"
                    : `Record ${cards.length} ${cards.length === 1 ? "thing" : "things"}`}
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </Panel>
  );
}

/** One field, drawn from its kind. Full width: this is used on a phone. */
function Cell({
  id,
  field,
  value,
  onChange,
}: {
  id: string;
  field: TellField;
  value: TellValue;
  onChange: (value: TellValue) => void;
}) {
  switch (field.kind) {
    case "choice":
      return (
        <Select
          value={typeof value === "string" && value !== "" ? value : NONE}
          onValueChange={(v) => onChange(v === NONE ? null : v)}
        >
          <SelectTrigger id={id} className={cn("h-9 w-full")} title={field.hint}>
            <SelectValue placeholder="Pick one" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Not set</SelectItem>
            {(field.choices ?? []).map((c) => (
              <SelectItem key={c.value} value={c.value}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case "number":
      return (
        <Input
          id={id}
          type="number"
          step="any"
          inputMode="decimal"
          className="h-9"
          value={typeof value === "number" ? value : ""}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
          title={field.hint}
        />
      );
    case "date":
      return (
        <Input
          id={id}
          type="date"
          className="h-9"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value || null)}
          title={field.hint}
        />
      );
    default:
      return (
        <Input
          id={id}
          className="h-9"
          value={value === null ? "" : String(value)}
          onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
          title={field.hint}
        />
      );
  }
}
