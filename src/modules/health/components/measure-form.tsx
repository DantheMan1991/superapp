"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ListPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveMeasurementsAction } from "../actions";
import { inchesFromCm, inchesWords, LENGTH_IN_MAX, LENGTH_IN_MIN, typedInches, type Better } from "../core/body";
import { shortDay } from "../core/days";

const BODY = "/personal/m/health/body";

/**
 * A DAY'S TAPE MEASURES (H2, docs/help/health/measure.md): a box for each of
 * the person's measures, in inches, already holding what was kept that day,
 * with the last one taken before it underneath. Save keeps every box filled
 * in and takes off any emptied, then goes back to Body.
 */
export function MeasureForm({
  day,
  today,
  asToday,
  measures,
  values,
  last,
}: {
  day: string;
  today: string;
  /** The page shows today. */
  asToday: boolean;
  measures: { id: string; name: string; better: Better | null }[];
  /** What was kept that day, in cm, by measure. */
  values: Record<string, number>;
  /** The latest of each before that day. */
  last: Record<string, { day: string; cm: number }>;
}) {
  const router = useRouter();
  const [texts, setTexts] = useState<Record<string, string>>(() =>
    Object.fromEntries(measures.map((m) => [m.id, m.id in values ? String(Math.round(inchesFromCm(values[m.id]) * 100) / 100) : ""])),
  );
  const [pending, startTransition] = useTransition();

  if (measures.length === 0) {
    return (
      <section className="space-y-2 rounded-2xl bg-card px-4 py-3 shadow-elevation-1">
        <p>Choose what you measure first, such as your waist.</p>
        <Button asChild variant="outline">
          <Link href={`${BODY}/measures`}>
            <ListPlus aria-hidden /> Choose your tape measures
          </Link>
        </Button>
      </section>
    );
  }

  const typed = measures.map((m) => ({ id: m.id, text: texts[m.id] ?? "", inches: typedInches(texts[m.id] ?? "") }));
  const wrong = typed.some((t) => t.text.trim() !== "" && t.inches === null);
  const anything = typed.some((t) => t.inches !== null) || Object.keys(values).length > 0;

  function save() {
    if (wrong || !anything) return;
    startTransition(async () => {
      const outcome = await saveMeasurementsAction({
        day,
        asToday,
        values: typed.map((t) => ({ measureId: t.id, inches: t.inches })),
      });
      if ("error" in outcome) {
        toast.error(outcome.error);
        return;
      }
      toast.success("Tape measures kept.");
      router.push(BODY);
    });
  }

  return (
    <form
      className="space-y-4 rounded-2xl bg-card px-4 py-3 shadow-elevation-1"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <ul className="space-y-3">
        {typed.map((t) => {
          const measure = measures.find((m) => m.id === t.id);
          const before = last[t.id];
          return (
            <li key={t.id} className="space-y-1">
              <Label htmlFor={`measure-${t.id}`}>{measure?.name}</Label>
              <div className="flex items-center gap-2">
                <Input
                  id={`measure-${t.id}`}
                  inputMode="decimal"
                  value={t.text}
                  onChange={(e) => setTexts((now) => ({ ...now, [t.id]: e.target.value }))}
                  className="w-28"
                />
                <span>in</span>
              </div>
              {t.text.trim() !== "" && t.inches === null ? (
                <p className="text-sm text-destructive">{`Inches between ${LENGTH_IN_MIN} and ${LENGTH_IN_MAX}, such as 36.25 or 36 1/4.`}</p>
              ) : (
                before && (
                  <p className="text-sm text-muted-foreground">{`Last: ${inchesWords(before.cm)}, ${shortDay(before.day, today)}`}</p>
                )
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted-foreground">
        Leave a box empty to skip that one. Emptying one kept that day takes it off.
      </p>
      <Button type="submit" className="w-full" disabled={pending || wrong || !anything}>
        {pending ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}
