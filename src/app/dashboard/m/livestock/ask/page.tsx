import Link from "next/link";
import { MessageSquarePlus, Sparkles } from "lucide-react";
import { LivestockNav } from "@/packs/livestock/components/livestock-nav";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { packContext } from "@/lib/packs/tenant-context";
import { todayInTimezone } from "@/lib/timezone";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { listLots, movementKindsForLots } from "@/packs/inventory/ops";
import { listZones } from "@/packs/land/ops";
import { listLivestockLots } from "@/packs/livestock/ops";
import { summariseHead } from "@/packs/livestock/core/herd";
import { starterQuestions } from "@/packs/livestock/core/digest";
import { ADVISOR_DAILY_CAP, capMessage } from "@/packs/livestock/core/threads";
import {
  getAdvisorThread,
  latestAdvisorThread,
  listAdvisorThreads,
  questionsAskedInLastDay,
} from "@/packs/livestock/ai/threads";
import { speciesFrom } from "@/packs/livestock/vocabulary";
import {
  AdvisorChat,
  RemoveThreadButton,
  type Turn,
} from "@/packs/livestock/components/advisor-chat";

export const dynamic = "force-dynamic";

const BASE = "/dashboard/m/livestock";

/**
 * Ask the advisor — livestock slice 1b, and the half of the day-one wedge that
 * needs no records at all.
 *
 * The design's cold-start argument in one screen: FCR trends, sire comparison
 * and rest analysis all produce nothing until a season has been recorded, so if
 * the first useful thing this pack does requires history, nobody gets to the
 * history. This page is useful on the day a tenant is created and gets better
 * every time something is entered — which is the same curve the recording habit
 * follows, deliberately.
 *
 * **The page fetches almost nothing about the farm.** The farm digest is
 * assembled inside the action, per question, so an answer is never given from
 * a snapshot taken when the tab was opened. What is read here is enough to
 * suggest what to ask — and, since 2026-09-08, the asker's own threads:
 * `?thread=<id>` opens one, `?thread=new` starts fresh, and no parameter
 * lands on the newest, which is where somebody who just closed the tab in
 * the barn expects to be.
 */
export default async function AdvisorPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "livestock");

  const today = todayInTimezone(ctx.tenant.timezone);
  const wanted = typeof params.thread === "string" ? params.thread : null;

  const data = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const [lots, pack, zones, threads, asked] = await Promise.all([
        listLivestockLots(tx, ctx.tenant.id),
        packContext(tx, ctx.tenant.id, ctx.tenant.industry, "livestock"),
        listZones(tx, ctx.tenant.id, { status: "active" }),
        listAdvisorThreads(tx, ctx.tenant.id, ctx.userId),
        questionsAskedInLastDay(tx, ctx.tenant.id),
      ]);
      const inventoryLotIds = lots.map((l) => l.inventoryLotId);
      const [inventoryLots, movements] = await Promise.all([
        listLots(tx, ctx.tenant.id),
        movementKindsForLots(tx, ctx.tenant.id, inventoryLotIds),
      ]);
      const byId = new Map(inventoryLots.map((l) => [l.id, l]));
      // The biggest live lot, so the suggested question is about the animals
      // somebody actually thinks about rather than a lot that has gone.
      const live = lots
        .map((lot) => ({
          code: byId.get(lot.inventoryLotId)?.code ?? null,
          head: summariseHead(movements.get(lot.inventoryLotId) ?? []).balance,
        }))
        .filter((row) => row.code !== null && row.head > 0)
        .sort((a, b) => b.head - a.head);
      // Which thread is on screen: the one asked for when it is theirs, a
      // fresh one when asked for, else the newest.
      const current =
        wanted === "new"
          ? null
          : wanted
            ? await getAdvisorThread(tx, ctx.tenant.id, ctx.userId, wanted)
            : await latestAdvisorThread(tx, ctx.tenant.id, ctx.userId);
      return {
        species: speciesFrom(pack.config),
        sampleLotCode: live[0]?.code ?? null,
        hasZones: zones.length > 0,
        threads,
        asked,
        current,
      };
    },
    { role: ctx.role },
  );

  const { threads, asked, current } = data;
  const notFound = wanted !== null && wanted !== "new" && current === null;
  const currentId = current?.thread.id ?? null;
  const turns: Turn[] = (current?.turns ?? []).map((t) => ({
    role: t.role as Turn["role"],
    content: t.content,
  }));
  const dateOf = new Intl.DateTimeFormat("en-CA", {
    timeZone: ctx.tenant.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const list =
    threads.length === 0 ? (
      <p className="px-1 text-sm text-muted-foreground">
        Your threads are listed here once you have asked something. The first
        question starts one.
      </p>
    ) : (
      <ul className="divide-y rounded-2xl bg-card shadow-elevation-1">
        {threads.map((t) => (
          <li
            key={t.id}
            className={cn(
              "flex items-center justify-between gap-2 px-3 py-2 text-sm",
              t.id === currentId && "bg-muted",
            )}
          >
            <Link
              href={`${BASE}/ask?thread=${t.id}`}
              aria-current={t.id === currentId ? "page" : undefined}
              className="min-w-0 flex-1 underline-offset-4 hover:underline"
            >
              <span className="block truncate font-medium">{t.title}</span>
              <span className="block text-xs text-muted-foreground">
                {dateOf.format(t.updatedAt)}
              </span>
            </Link>
            <RemoveThreadButton
              threadId={t.id}
              title={t.title}
              current={t.id === currentId}
            />
          </li>
        ))}
      </ul>
    );

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<Sparkles />}
        title="Ask"
        description={`Husbandry questions, answered against your own records as of ${today}.`}
        actions={
          <Button asChild variant="outline">
            <Link href={`${BASE}/ask?thread=new`}>
              <MessageSquarePlus />
              New thread
            </Link>
          </Button>
        }
      />

      <LivestockNav />

      {notFound && (
        <p className="text-sm text-muted-foreground">
          That thread is not yours or no longer exists. This is a fresh one.
        </p>
      )}

      {/* The threads beside the conversation from `md`; folded under a
          disclosure on a phone, where a list of twenty above the box would
          put the question two screens down. Rendered twice because the
          Remove button is a client component with a dialog of its own. */}
      <div className="grid gap-6 md:grid-cols-[18rem_minmax(0,1fr)]">
        <details className="md:hidden">
          <summary className="cursor-pointer text-sm font-medium">
            Threads
            <span className="font-normal text-muted-foreground"> · {threads.length}</span>
          </summary>
          <div className="mt-2">{list}</div>
        </details>
        <aside className="hidden md:block">
          <h2 className="mb-2 px-1 text-sm font-medium">
            Threads
            <span className="font-normal text-muted-foreground"> · {threads.length}</span>
          </h2>
          {list}
        </aside>

        {/* Keyed on the thread, so opening another one from the list starts
            the component over with that thread's turns rather than carrying
            the last one's state across. */}
        <AdvisorChat
          key={currentId ?? "new"}
          starters={starterQuestions(data)}
          threadId={currentId}
          initialTurns={turns}
          capMessage={asked >= ADVISOR_DAILY_CAP ? capMessage(ADVISOR_DAILY_CAP) : null}
        />
      </div>
    </div>
  );
}
