"use client";

import { useEffect, useState } from "react";
import { Download, Eye, Loader2, ShieldAlert, Unlock } from "lucide-react";
import type { ShareEventKind } from "@/db/schema";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { listShareActivityAction } from "../share-actions";
import type { ShareActivity } from "../shares/activity";
import { formatBytes } from "../lib/format";

/** Plain words for each event kind — no jargon, no implied certainty. */
const LABELS: Record<ShareEventKind, string> = {
  viewed: "Opened the link",
  unlocked: "Entered the passcode",
  downloaded: "Downloaded a file",
  denied_passcode: "Wrong passcode",
  denied_scope: "Asked for something not in this link",
  budget_hit: "Blocked — download limit reached",
};

function KindIcon({ kind }: { kind: ShareEventKind }) {
  if (kind === "downloaded") return <Download className="size-4" />;
  if (kind === "unlocked") return <Unlock className="size-4" />;
  if (kind === "viewed") return <Eye className="size-4" />;
  return <ShieldAlert className="size-4" />;
}

/**
 * One link's access log.
 *
 * Mount only while open — it fetches on mount, so a page of fifty links makes
 * no activity queries until somebody asks for one.
 */
export function ShareActivitySheet({
  open,
  onOpenChange,
  shareId,
  label,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shareId: string;
  label: string;
}) {
  const [activity, setActivity] = useState<ShareActivity | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const result = await listShareActivityAction({ shareId });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setActivity(result.data ?? null);
    })();
  }, [shareId]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Link activity</SheetTitle>
          <SheetDescription>{label}</SheetDescription>
        </SheetHeader>

        <div className="space-y-4 px-4 pb-6">
          {error ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {error}
            </p>
          ) : activity === null ? (
            <div className="flex justify-center py-10 text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
            </div>
          ) : activity.entries.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Nobody has opened this link yet.
            </p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                {activity.entries.length}{" "}
                {activity.entries.length === 1 ? "event" : "events"} from{" "}
                {activity.distinctVisitors}{" "}
                {activity.distinctVisitors === 1 ? "place" : "different places"}
                {activity.truncated && " · showing the most recent 100"}
              </p>

              <div className="divide-y rounded-md border">
                {activity.entries.map((entry) => (
                  <div key={entry.id} className="flex items-start gap-3 px-3 py-3">
                    <span
                      className={
                        entry.denied
                          ? "mt-0.5 text-destructive"
                          : "mt-0.5 text-muted-foreground"
                      }
                    >
                      <KindIcon kind={entry.kind} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">
                        {LABELS[entry.kind] ?? entry.kind}
                      </p>
                      {entry.documentName && (
                        <p className="truncate text-xs text-muted-foreground">
                          {entry.documentName}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        {entry.createdAt.toLocaleString()}
                        {entry.bytesSent > 0 &&
                          ` · ${formatBytes(entry.bytesSent)}`}
                      </p>
                    </div>
                    {entry.visitor && (
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {entry.visitor}
                      </Badge>
                    )}
                  </div>
                ))}
              </div>

              {/*
                Both caveats stated plainly, because this feed is the kind of
                thing people quote at each other later. The codes are derived
                from a one-way hash of the network address — they group opens
                that came from the same place and cannot be turned back into an
                address. And an "opened" row is a REQUEST, not a person: mail
                security scanners follow links before the recipient ever sees
                them, which lands here looking exactly like a human.
              */}
              <p className="text-xs text-muted-foreground">
                Codes like{" "}
                <span className="font-mono">
                  {activity.entries.find((e) => e.visitor)?.visitor ?? "a1b2c3"}
                </span>{" "}
                group opens that came from the same place. They are derived from
                a one-way hash and cannot be turned back into an address.
              </p>
              <p className="text-xs text-muted-foreground">
                An open means the link was <em>requested</em> — email security
                scanners often follow links before the recipient does, and that
                looks the same here as a person.
              </p>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
