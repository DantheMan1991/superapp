import { Badge } from "@/components/ui/badge";
import { kindLabel, statusLabel, statusTone } from "@/lib/feedback/core";
import { cn } from "@/lib/utils";

/**
 * The two chips a feedback report wears, on BOTH surfaces.
 *
 * One component rather than one per page, because the client's page and the
 * console render the same report and the words differ by audience alone —
 * which is `core.ts`'s job, not a page's. `side` is the only thing either
 * caller passes.
 *
 * The class pairs are lifted verbatim from `status-badge.tsx` rather than
 * invented: `bg-<token>/15` behind a matching FOREGROUND, never a fill used
 * where a foreground belongs. The design system's own trap, and the reason
 * `text-warning-foreground` exists at all.
 */
const TONE_STYLES: Record<ReturnType<typeof statusTone>, string> = {
  neutral: "bg-accent text-accent-foreground",
  attention: "bg-warning/15 text-warning-foreground",
  progress: "bg-primary/10 text-primary",
  positive: "bg-success/15 text-emerald-700 dark:text-emerald-300",
  muted: "bg-muted text-muted-foreground",
};

export function FeedbackStatusChip({
  status,
  side,
  className,
}: {
  status: string;
  side: "client" | "operator";
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "border-transparent",
        TONE_STYLES[statusTone(status)],
        className,
      )}
    >
      {statusLabel(status, side)}
    </Badge>
  );
}

export function FeedbackKindChip({
  kind,
  side,
  className,
}: {
  kind: string;
  side: "client" | "operator";
  className?: string;
}) {
  return (
    <Badge variant="outline" className={cn("text-muted-foreground", className)}>
      {kindLabel(kind, side)}
    </Badge>
  );
}
