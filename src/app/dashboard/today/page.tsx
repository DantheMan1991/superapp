import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { todayInTimezone } from "@/lib/timezone";
import {
  collectAttention,
  sortAttention,
} from "@/lib/attention-sources/resolve";
import type { AttentionItem } from "@/lib/attention-sources/types";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { DigestToggle } from "./digest-toggle";

export const dynamic = "force-dynamic";

/**
 * What needs you — the in-app reference copy of the daily digest.
 *
 * The email is the primary channel; this page is what it links to and what it
 * must agree with. "One number everywhere" is the rule: if this page and the
 * morning email disagree about how much is outstanding, both stop being
 * believed, so both render from `collectAttention` over the same sources with
 * the same tenant `today`.
 *
 * Everything here is DERIVED. There is nothing to mark read and no way to
 * dismiss an item — you make it go away by doing it, or by changing the date
 * you agreed. That is the property an events-table design cannot have, and the
 * reason this list can be trusted not to nag about work already done.
 */
export default async function TodayPage() {
  const ctx = await requireTenant();
  const today = todayInTimezone(ctx.tenant.timezone);

  const { result, wantsDaily } = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const [collected, pref] = await Promise.all([
        collectAttention(tx, {
          tenantId: ctx.tenant.id,
          userId: ctx.userId,
          role: ctx.role,
          today,
        }),
        // The policy scopes this to the caller's own row, so no `where` on
        // profile is needed — and adding one would imply the filter is what
        // protects it. A missing row means daily.
        tx.query.notificationPreferences.findFirst(),
      ]);
      return { result: collected, wantsDaily: (pref?.digest ?? "daily") === "daily" };
    },
    // Every option matters here. `role` decides owners-only visibility,
    // `userId` scopes anything per-person — including the preference row above.
    { role: ctx.role, userId: ctx.userId },
  );

  const sorted = sortAttention(result.items);
  const mine = sorted.filter((i) => !i.unassigned);
  const unassigned = sorted.filter((i) => i.unassigned);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            What needs you
          </h1>
          <p className="text-sm text-muted-foreground">
            Outstanding work as of {today}, in{" "}
            {ctx.tenant.timezone.replace("_", " ")}.
          </p>
        </div>
        <DigestToggle daily={wantsDaily} />
      </div>

      {/* A source that could not be asked is stated, never swallowed. An
          undercount presented as a total is worse than no number at all. */}
      {result.failed.length > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
          <div className="text-sm">
            <p className="font-medium">This list may be incomplete.</p>
            <p className="text-muted-foreground">
              {result.failed.map((f) => f.label).join(" and ")} could not be
              checked just now, so anything from{" "}
              {result.failed.length > 1 ? "those sections" : "that section"} is
              missing. Reload in a moment.
            </p>
          </div>
        </div>
      )}

      {mine.length === 0 && unassigned.length === 0 ? (
        // Silence is ambiguous — it reads as "did this break?". An explicit
        // all-clear is a message, and it is the one that earns the channel its
        // credibility on the days it has nothing to say.
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-sm font-medium">
            {result.complete
              ? "Nothing needs you today."
              : "Nothing to show from the sections we could check."}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {result.complete
              ? "No follow-ups due and nothing waiting on you."
              : "Reload in a moment for the full picture."}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {mine.length > 0 && <ItemList items={mine} today={today} />}

          {unassigned.length > 0 && (
            <div className="space-y-3">
              <Separator />
              <div>
                <h2 className="text-sm font-semibold">Not assigned to anyone</h2>
                <p className="text-xs text-muted-foreground">
                  Nobody has picked these up. You see them because you own the
                  business, not because they are yours.
                </p>
              </div>
              <ItemList items={unassigned} today={today} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ItemList({
  items,
  today,
}: {
  items: AttentionItem[];
  today: string;
}) {
  return (
    <ul className="divide-y rounded-lg border">
      {items.map((item) => (
        <li key={item.key}>
          {/* The whole row is the link. Every item is one click from the record
              it is about — a digest that lands you on a list page has made you
              do the finding twice. */}
          <Link
            href={item.href}
            className="flex items-start justify-between gap-4 p-4 hover:bg-muted/50"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{item.title}</p>
              {item.detail && (
                <p className="truncate text-xs text-muted-foreground">
                  {item.detail}
                </p>
              )}
            </div>
            <UrgencyBadge urgency={item.urgency} dueOn={item.dueOn} today={today} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

function UrgencyBadge({
  urgency,
  dueOn,
  today,
}: {
  urgency: AttentionItem["urgency"];
  dueOn: string | null;
  today: string;
}) {
  if (urgency === "overdue") return <Badge variant="destructive">Overdue</Badge>;
  if (urgency === "today") return <Badge>Today</Badge>;
  // Computed from the tenant's today on the SERVER, not the browser's clock —
  // the badge and the grouping have to be the same answer.
  return (
    <Badge variant="secondary">
      {dueOn && dueOn > today ? "Soon" : "Open"}
    </Badge>
  );
}
