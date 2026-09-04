"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Copy, Rss, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { FeedTokenRow } from "../feed-ops";
import { mintFeedTokenAction, revokeFeedTokenAction } from "../actions";

/**
 * Subscribe links, for a calendar app that will never open Yosher.
 *
 * The whole surface is shaped by one fact: **the URL is the credential.** So it
 * is shown exactly once, the copy is loud about that, and revoking says plainly
 * what it can and cannot undo.
 */
export function FeedSubscription({
  tokens,
  canWrite,
}: {
  tokens: FeedTokenRow[];
  /** `roleMayWrite(role)`. An accountant sees the links and mints none. */
  canWrite: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [label, setLabel] = useState("");
  const [minted, setMinted] = useState<string | null>(null);

  function mint() {
    startTransition(async () => {
      const result = await mintFeedTokenAction({ label: label.trim() });
      if ("error" in result) toast.error(result.error);
      else {
        // Held in component state and nowhere else. There is no way to fetch it
        // again — only the hash was stored.
        setMinted(result.data!.url);
        setLabel("");
        router.refresh();
      }
    });
  }

  function revoke(tokenId: string) {
    startTransition(async () => {
      const result = await revokeFeedTokenAction({ tokenId });
      if ("error" in result) toast.error(result.error);
      else {
        toast.success("Link revoked");
        router.refresh();
      }
    });
  }

  return (
    <section className="space-y-3 rounded-2xl bg-card p-4 shadow-elevation-1">
      <div>
        <h2 className="flex items-center gap-1.5 text-sm font-medium">
          <Rss className="size-3.5" /> Subscribe from another calendar
        </h2>
        <p className="text-xs text-muted-foreground">
          Add your Yosher calendar to the calendar app on your phone or laptop.
          It updates on its own and is read-only there — you cannot add or
          change anything from that side.
        </p>
      </div>

      {minted && (
        <div className="space-y-2 rounded-xl border border-warning/40 bg-warning/10 p-3">
          <p className="text-xs font-medium">
            Copy this now — it is not shown again.
          </p>
          <div className="flex gap-2">
            <Input readOnly value={minted} className="font-mono text-xs" />
            <Button
              variant="outline"
              onClick={() => {
                navigator.clipboard.writeText(minted);
                toast.success("Copied");
              }}
            >
              <Copy className="size-4" />
              <span className="sr-only">Copy link</span>
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {/* Said plainly, because the URL will end up in a clipboard, a
                screenshot and possibly a support ticket. */}
            Anyone with this link can read your calendar without signing in.
            Treat it like a password, and revoke it if it gets out.
          </p>
        </div>
      )}

      {tokens.length > 0 && (
        <ul className="divide-y divide-divider rounded-xl border border-border">
          {tokens.map((t) => (
            <li
              key={t.id}
              className="flex items-center justify-between gap-3 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm">{t.label || "Subscribe link"}</p>
                <p className="text-xs text-muted-foreground">
                  {t.lastUsedAt
                    ? `Last used ${t.lastUsedAt.toLocaleDateString()}`
                    : "Never used yet"}
                </p>
              </div>
              {canWrite && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 shrink-0"
                  disabled={pending}
                  onClick={() => revoke(t.id)}
                >
                  <X className="size-4" />
                  <span className="sr-only">Revoke</span>
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canWrite && (
        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="feed-label" className="text-xs">
              What is it for?
            </Label>
            <Input
              id="feed-label"
              value={label}
              maxLength={60}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="iPhone"
            />
          </div>
          <Button onClick={mint} disabled={pending}>
            Create link
          </Button>
        </div>
      )}

      {tokens.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {/* The honest limitation. Nothing on this side can reach a copy that
              a phone has already downloaded. */}
          Revoking stops any new downloads. A device that already has a copy may
          keep showing it until it next refreshes.
        </p>
      )}
    </section>
  );
}
