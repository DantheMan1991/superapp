import { desc, eq } from "drizzle-orm";
import { withTenant, schema } from "@/db";
import { requireTenant } from "@/lib/auth";
import { reconcileHourBlockPurchase } from "@/lib/retainer-billing";
import { loadRetainerView } from "@/lib/retainer";
import {
  formatMinutesAsHours,
  monthOf,
  type RetainerUsage,
} from "@/lib/retainer-core";
import { HOUR_BLOCKS, type HourBlockKey } from "@/lib/stripe";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { BuyHourBlockButton } from "./hours-buttons";

export const dynamic = "force-dynamic";

function Meter({ usage }: { usage: RetainerUsage }) {
  const over = usage.overageMinutesThisMonth > 0;
  const pct =
    usage.includedMinutes > 0
      ? Math.min(100, (usage.usedMinutes / usage.includedMinutes) * 100)
      : usage.usedMinutes > 0
        ? 100
        : 0;

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <p className="text-2xl font-semibold">
          {formatMinutesAsHours(usage.usedMinutes)}
          <span className="text-sm font-normal text-muted-foreground">
            {" "}
            of {formatMinutesAsHours(usage.includedMinutes)} this month
          </span>
        </p>
        {usage.isOver ? (
          <Badge variant="destructive">
            Over by {formatMinutesAsHours(usage.unpaidOverageMinutes)}
          </Badge>
        ) : over ? (
          <Badge variant="outline">Using purchased hours</Badge>
        ) : usage.isNearLimit ? (
          <Badge variant="outline">Near limit</Badge>
        ) : null}
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full ${over ? "bg-destructive" : "bg-primary"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {formatMinutesAsHours(usage.purchasedMinutesRemaining)} purchased hours
        remaining. Included hours reset on the 1st; purchased hours never
        expire.
      </p>
    </div>
  );
}

export default async function HoursPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; session_id?: string }>;
}) {
  const ctx = await requireTenant();
  const { status, session_id } = await searchParams;

  // Heal a missed webhook on checkout return. Idempotent; the session is
  // re-retrieved from Stripe and must belong to this tenant.
  if (status === "success" && session_id) {
    await reconcileHourBlockPurchase(ctx.tenant.id, session_id);
  }

  const [view, entries] = await withTenant(ctx.tenant.id, (tx) =>
    Promise.all([
      loadRetainerView(tx, ctx.tenant.id),
      tx.query.retainerTimeEntries.findMany({
        where: eq(schema.retainerTimeEntries.tenantId, ctx.tenant.id),
        orderBy: [
          desc(schema.retainerTimeEntries.workDate),
          desc(schema.retainerTimeEntries.createdAt),
        ],
      }),
    ]),
  );

  const { usage } = view;
  const isOwner = ctx.role === "owner";
  const emphasized = usage.isOver || usage.isNearLimit;

  const byMonth = new Map<string, typeof entries>();
  for (const e of entries) {
    const m = monthOf(e.workDate);
    const list = byMonth.get(m) ?? [];
    list.push(e);
    byMonth.set(m, list);
  }
  const months = [...byMonth.keys()].sort().reverse();

  if (!view.hasAnyData) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Hours</h1>
          <p className="text-sm text-muted-foreground">
            Retainer hours and the work log.
          </p>
        </div>
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Your plan doesn&apos;t include retainer hours yet — get in touch
            and we&apos;ll set it up.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Hours</h1>
        <p className="text-sm text-muted-foreground">
          Your monthly retainer, and exactly what we did with it.
        </p>
      </div>

      {status === "success" && (
        <div className="rounded-md border border-emerald-600/40 bg-emerald-600/10 px-4 py-3 text-sm">
          Payment received — your extra hours are on the meter below.
        </div>
      )}
      {status === "canceled" && (
        <div className="rounded-md border bg-muted/60 px-4 py-3 text-sm text-muted-foreground">
          Checkout canceled — no charge was made.
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">This month</CardTitle>
        </CardHeader>
        <CardContent>
          <Meter usage={usage} />
        </CardContent>
      </Card>

      {isOwner && (
        <div className="grid gap-4 sm:grid-cols-2">
          {(Object.keys(HOUR_BLOCKS) as HourBlockKey[]).map((key) => {
            const block = HOUR_BLOCKS[key];
            return (
              <Card
                key={key}
                className={emphasized ? "border-primary/50" : undefined}
              >
                <CardHeader>
                  <CardTitle className="text-base">{block.name}</CardTitle>
                  <CardDescription>{block.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <BuyHourBlockButton block={key} emphasized={emphasized} />
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Work log</CardTitle>
          <CardDescription>
            Every entry we log lands here — your record of the work.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {months.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No work logged yet.
            </p>
          )}
          {months.map((m) => (
            <div key={m}>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {m}
              </p>
              <div className="divide-y">
                {byMonth.get(m)!.map((e) => (
                  <div key={e.id} className="flex gap-3 py-2 text-sm">
                    <span className="w-24 shrink-0 text-muted-foreground">
                      {e.workDate}
                    </span>
                    <span className="w-14 shrink-0 font-medium">
                      {formatMinutesAsHours(e.minutes)}
                    </span>
                    <span className="min-w-0 break-words">{e.note}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
