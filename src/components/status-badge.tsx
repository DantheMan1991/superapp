import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const TENANT_STATUS_STYLES: Record<string, string> = {
  prospect: "bg-muted text-muted-foreground",
  onboarding: "bg-warning/15 text-warning-foreground text-amber-700 dark:text-amber-300",
  active: "bg-success/15 text-emerald-700 dark:text-emerald-300",
  paused: "bg-muted text-muted-foreground",
  churned: "bg-destructive/10 text-destructive",
};

const SUB_STATUS_STYLES: Record<string, string> = {
  none: "bg-muted text-muted-foreground",
  active: "bg-success/15 text-emerald-700 dark:text-emerald-300",
  trialing: "bg-accent text-accent-foreground",
  past_due: "bg-destructive/10 text-destructive",
  canceled: "bg-destructive/10 text-destructive",
  incomplete: "bg-warning/15 text-amber-700 dark:text-amber-300",
};

export function TenantStatusBadge({ status }: { status: string }) {
  return (
    <Badge
      variant="outline"
      className={cn("border-transparent capitalize", TENANT_STATUS_STYLES[status])}
    >
      {status}
    </Badge>
  );
}

export function SubscriptionStatusBadge({ status }: { status: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "border-transparent capitalize",
        SUB_STATUS_STYLES[status] ?? "bg-muted text-muted-foreground",
      )}
    >
      {status.replace("_", " ")}
    </Badge>
  );
}
