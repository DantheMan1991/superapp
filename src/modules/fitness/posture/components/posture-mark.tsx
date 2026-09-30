import Link from "next/link";
import { Check, ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { shiftDay } from "../../core/day";
import { askWords, markName, type Mark } from "../core/marks";

export const POSTURE_CHECK_HREF = "/personal/m/fitness/posture/check";
const REPORT_HREF = "/personal/m/fitness/posture/checks";

/** "today", "yesterday", or "Tue, Oct 3": a day on the personal space's calendar. */
function dayWords(day: string, today: string): string {
  if (day === today) return "today";
  if (day === shiftDay(today, -1)) return "yesterday";
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * A PROGRAM'S POSTURE MARK, ON ITS PAGE (docs/help/fitness/program.md;
 * docs/modules/posture.md, slice 3c): asked for, with the way into the check,
 * or, once a check has marked it, which check did, with its report.
 */
export function PostureMark({ mark, today }: { mark: Mark; today: string }) {
  if (mark.met) {
    return (
      <p className="flex items-start gap-2 text-sm">
        <Check className="mt-0.5 size-4 shrink-0 text-module-accent" aria-hidden />
        <span>
          {`Posture checked ${dayWords(mark.met.localDay, today)}, marking ${markName(mark)}. `}
          <Link href={`${REPORT_HREF}/${mark.met.id}`} className="font-medium text-module-accent underline-offset-4 hover:underline">
            See the report
          </Link>
        </span>
      </p>
    );
  }
  const { ask, why } = askWords(mark);
  return (
    <div className="space-y-2 rounded-lg bg-muted/60 px-3 py-2 text-sm">
      <p className="flex items-start gap-2">
        <ScanLine className="mt-0.5 size-4 shrink-0 text-module-accent" aria-hidden />
        <span>
          {ask}
          {why && <span className="text-muted-foreground">{` ${why}`}</span>}
        </span>
      </p>
      <Button asChild variant="outline" size="sm">
        <Link href={POSTURE_CHECK_HREF}>Start a posture check</Link>
      </Button>
    </div>
  );
}
