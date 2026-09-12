"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Check, Copy, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createPreviewLinkAction,
  revealPreviewLinkAction,
  revokePreviewLinkAction,
} from "../preview-actions";
import type { PreviewLinkView } from "../preview-ops";

/**
 * Links that show an unpublished site to somebody who cannot sign in
 * (ADR 0046).
 *
 * THE LINK IS SHOWN, NOT JUST MADE. A control that creates a secret and then
 * leaves you to find it is a control people press twice. It appears in a box
 * with a Copy button the moment it exists, and `Show the link` brings it back
 * for anybody who closed the screen before copying.
 *
 * `navigator.clipboard` can be absent or refused — an insecure origin, a
 * browser setting — so the link stays selectable text and a failed copy says
 * so rather than silently doing nothing.
 */
export function PreviewLinks({
  siteId,
  links,
  canWrite,
}: {
  siteId: string;
  links: PreviewLinkView[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [label, setLabel] = useState("");
  const [shown, setShown] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy it. Select the link and copy it by hand.");
    }
  };

  const live = links.filter((l) => !l.revoked);
  const done = links.filter((l) => l.revoked);

  return (
    <div className="space-y-4">
      {shown && (
        <div className="space-y-2 rounded-lg border bg-muted/40 p-4">
          <p className="text-sm font-medium">Send this to whoever should see it.</p>
          <div className="flex flex-wrap items-center gap-2">
            {/* Selectable, so a failed clipboard is never a dead end. */}
            <code className="min-w-0 flex-1 truncate rounded border bg-background px-2 py-1.5 font-mono text-xs">
              {shown}
            </code>
            <Button size="sm" variant="outline" onClick={() => void copy(shown)}>
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Anybody with the link can see the site. They cannot change anything,
            and the form on it does not take messages.
          </p>
        </div>
      )}

      {canWrite && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1 space-y-1">
            <Label htmlFor="preview-label">Who is it for? (optional)</Label>
            <Input
              id="preview-label"
              value={label}
              maxLength={80}
              placeholder="Hilltop Farm"
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <Button
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await createPreviewLinkAction({ siteId, label, days: 30 });
                if ("error" in result) {
                  toast.error(result.error);
                  return;
                }
                setShown(result.data?.url ?? null);
                setLabel("");
                toast.success("Link made. It works for 30 days.");
                router.refresh();
              })
            }
          >
            <Link2 className="size-4" />
            {pending ? "One moment…" : "Make a preview link"}
          </Button>
        </div>
      )}

      {links.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No preview links yet. Make one to show this site to somebody before it
          is on the internet.
        </p>
      ) : (
        <ul className="divide-y divide-divider rounded-lg border">
          {[...live, ...done].map((link) => (
            <li key={link.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">
                  {link.label || "Preview link"}
                  {link.revoked && (
                    <span className="ml-2 text-xs font-normal text-subtle-foreground">
                      no longer works
                    </span>
                  )}
                </div>
                <div className="text-xs text-subtle-foreground">
                  {/* The question an owner actually asks. */}
                  {link.viewCount === 0
                    ? "Not opened yet"
                    : `Opened ${link.viewCount} ${link.viewCount === 1 ? "time" : "times"}`}
                  {!link.revoked &&
                    ` · works until ${new Date(link.expiresAt).toLocaleDateString()}`}
                </div>
              </div>
              {canWrite && !link.revoked && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        const result = await revealPreviewLinkAction({ previewId: link.id });
                        if ("error" in result) {
                          toast.error(result.error);
                          return;
                        }
                        setShown(result.data?.url ?? null);
                      })
                    }
                  >
                    Show the link
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() => {
                      if (
                        !window.confirm(
                          `Stop this link working? Anybody you sent it to will see "no longer available".`,
                        )
                      ) {
                        return;
                      }
                      startTransition(async () => {
                        const result = await revokePreviewLinkAction({ previewId: link.id });
                        if ("error" in result) {
                          toast.error(result.error);
                          return;
                        }
                        setShown(null);
                        toast.success("That link no longer works.");
                        router.refresh();
                      });
                    }}
                  >
                    Stop it
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
