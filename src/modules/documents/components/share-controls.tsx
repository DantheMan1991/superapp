"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, Copy, Link2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { createShareAction } from "../share-actions";

const EXPIRY_CHOICES = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
];

/**
 * Create a link. The URL is shown exactly once here, prominently — after this
 * the tenant has to use "Copy link" on the Shared links page, which decrypts
 * it server-side and records that it happened.
 */
export function ShareDialog({
  open,
  onOpenChange,
  scope,
  targetId,
  targetName,
  maxTtlDays,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: "document" | "folder";
  targetId: string;
  targetName: string;
  maxTtlDays: number;
}) {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [expiry, setExpiry] = useState("30");
  const [canDownload, setCanDownload] = useState(true);
  const [usePasscode, setUsePasscode] = useState(false);
  const [passcode, setPasscode] = useState("");
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  const allowed = EXPIRY_CHOICES.filter(
    (c) => Number.parseInt(c.value, 10) <= maxTtlDays,
  );

  function reset() {
    setUrl(null);
    setLabel("");
    setPasscode("");
    setUsePasscode(false);
    setCopied(false);
  }

  function submit() {
    if (usePasscode && passcode.trim().length < 4) {
      toast.error("A passcode needs at least 4 characters");
      return;
    }
    startTransition(async () => {
      const result = await createShareAction({
        scope,
        targetId,
        label: label.trim() || targetName,
        canDownload,
        expiresInDays: Number.parseInt(expiry, 10),
        ...(usePasscode ? { passcode: passcode.trim() } : {}),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setUrl(result.data?.url ?? null);
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        {url === null ? (
          <>
            <DialogHeader>
              <DialogTitle>Share “{targetName}”</DialogTitle>
              <DialogDescription>
                Creates a link anyone can open without signing in. Only what you
                pick here is reachable.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="share-label">Label</Label>
                <Input
                  id="share-label"
                  value={label}
                  maxLength={120}
                  placeholder={targetName}
                  onChange={(e) => setLabel(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Shown to whoever opens the link, and how you&apos;ll recognise
                  it later.
                </p>
              </div>

              <div className="space-y-2">
                <Label>Expires after</Label>
                <Select value={expiry} onValueChange={setExpiry}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {allowed.map((choice) => (
                      <SelectItem key={choice.value} value={choice.value}>
                        {choice.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-start justify-between gap-4 rounded-md border p-3">
                <div className="space-y-1">
                  <Label htmlFor="share-download">Allow downloading</Label>
                  <p className="text-xs text-muted-foreground">
                    Off shows files in the browser and hides the download
                    button. It makes saving inconvenient, not impossible.
                  </p>
                </div>
                <Switch
                  id="share-download"
                  checked={canDownload}
                  onCheckedChange={setCanDownload}
                />
              </div>

              <div className="space-y-3 rounded-md border p-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <Label htmlFor="share-passcode-on">Require a passcode</Label>
                    <p className="text-xs text-muted-foreground">
                      Give it to them by phone or text — not in the same email
                      as the link.
                    </p>
                  </div>
                  <Switch
                    id="share-passcode-on"
                    checked={usePasscode}
                    onCheckedChange={setUsePasscode}
                  />
                </div>
                {usePasscode && (
                  <Input
                    value={passcode}
                    maxLength={64}
                    placeholder="At least 4 characters"
                    onChange={(e) => setPasscode(e.target.value)}
                  />
                )}
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={submit} disabled={pending}>
                {pending && <Loader2 className="size-4 animate-spin" />}
                Create link
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Link ready</DialogTitle>
              <DialogDescription>
                Anyone with this link can open it until it expires. You can copy
                it again later from Shared links, or turn it off there.
              </DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-2">
              <Input readOnly value={url} className="font-mono text-xs" />
              <Button
                variant="outline"
                size="icon"
                aria-label="Copy link"
                onClick={() => {
                  void navigator.clipboard.writeText(url);
                  setCopied(true);
                  toast.success("Link copied");
                }}
              >
                {copied ? (
                  <Check className="size-4" />
                ) : (
                  <Copy className="size-4" />
                )}
              </Button>
            </div>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Trigger used from the row menus. */
export function ShareMenuItem({
  scope,
  targetId,
  targetName,
  maxTtlDays,
}: {
  scope: "document" | "folder";
  targetId: string;
  targetName: string;
  maxTtlDays: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent"
      >
        <Link2 className="size-4" />
        Share link…
      </button>
      <ShareDialog
        open={open}
        onOpenChange={setOpen}
        scope={scope}
        targetId={targetId}
        targetName={targetName}
        maxTtlDays={maxTtlDays}
      />
    </>
  );
}
