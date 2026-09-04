"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Sparkles } from "lucide-react";
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
import { cn } from "@/lib/utils";
import {
  LOGO_LINE_MAX,
  initialsFor,
  type LogoCandidate,
} from "@/lib/brand/logo-spec";
import { adoptLogoAction, draftLogosAction } from "../actions";

/**
 * "Draw one for me": the kit sets the business's name as a wordmark or a
 * monogram, six ways, and the owner picks one.
 *
 * The candidates arrive as SVG strings our own renderer produced from a
 * validated spec, and are shown through `<img src="data:…">` so they stay
 * inert markup rather than live DOM. Adopting sends the SPEC back, never the
 * picture; the server re-draws it.
 */
export function LogoGenerator({
  entityId,
  defaultName,
  hasLogo,
}: {
  entityId: string | null;
  /** The kit's display name, else the business's name — what goes on the logo. */
  defaultName: string;
  hasLogo: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(defaultName);
  const [initials, setInitials] = useState(initialsFor(defaultName));
  const [candidates, setCandidates] = useState<LogoCandidate[] | null>(null);
  const [standardSet, setStandardSet] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [drafting, startDraft] = useTransition();
  const [adopting, startAdopt] = useTransition();

  function openDialog() {
    setName(defaultName);
    setInitials(initialsFor(defaultName));
    setCandidates(null);
    setPicked(null);
    setOpen(true);
  }

  function draft() {
    startDraft(async () => {
      const result = await draftLogosAction({ entityId, name, initials });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setCandidates(result.data?.candidates ?? []);
      setStandardSet(result.data?.source === "standard");
      setPicked(null);
    });
  }

  function adopt() {
    const chosen = candidates?.find((c) => c.key === picked);
    if (!chosen) return;
    startAdopt(async () => {
      const result = await adoptLogoAction({ entityId, spec: chosen.spec });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Logo updated.");
      setOpen(false);
      router.refresh();
    });
  }

  const busy = drafting || adopting;

  return (
    <>
      <Button variant="outline" size="sm" onClick={openDialog}>
        <Sparkles className="size-4" />
        Draw one for me
      </Button>
      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Draw a logo</DialogTitle>
            <DialogDescription>
              Yosher sets your name as a wordmark or a monogram in your colors,
              six ways, drawn cleanly at any size. It is your name set in type,
              not an illustration.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-[1fr_8rem_auto] sm:items-end">
            <div className="space-y-2">
              <Label htmlFor="logo-gen-name">Name on the logo</Label>
              <Input
                id="logo-gen-name"
                value={name}
                maxLength={LOGO_LINE_MAX * 2}
                onChange={(e) => {
                  setName(e.target.value);
                  setInitials(initialsFor(e.target.value));
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="logo-gen-initials">Initials</Label>
              <Input
                id="logo-gen-initials"
                value={initials}
                maxLength={3}
                className="font-mono uppercase"
                onChange={(e) => setInitials(e.target.value.toUpperCase())}
              />
            </div>
            <Button onClick={draft} disabled={busy || name.trim() === ""}>
              {drafting ? "Drawing…" : candidates ? "Draw six more" : "Draw six"}
            </Button>
          </div>

          {candidates && candidates.length > 0 && (
            <div className="space-y-2">
              <div
                role="radiogroup"
                aria-label="Logo candidates"
                className="grid gap-3 sm:grid-cols-3"
              >
                {candidates.map((c) => {
                  const selected = picked === c.key;
                  return (
                    <button
                      key={c.key}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      disabled={busy}
                      onClick={() => setPicked(c.key)}
                      className={cn(
                        "flex flex-col gap-2 rounded-xl bg-white p-3 text-left ring-1 ring-foreground/10 transition-shadow hover:ring-foreground/30",
                        selected && "ring-2 ring-module-accent",
                      )}
                    >
                      {/* Our own renderer's output, kept inert as an image. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`data:image/svg+xml;utf8,${encodeURIComponent(c.svg)}`}
                        alt=""
                        width={c.width}
                        height={c.height}
                        className="h-24 w-full object-contain"
                      />
                      <span className="text-xs text-muted-foreground">
                        {c.spec.rationale}
                      </span>
                    </button>
                  );
                })}
              </div>
              {standardSet && (
                <p className="text-xs text-muted-foreground">
                  The drafting assistant isn&rsquo;t available right now, so
                  these are the standard set.
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={adopt} disabled={!picked || busy}>
              {adopting
                ? "Saving…"
                : hasLogo
                  ? "Replace the logo with this"
                  : "Use this logo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
