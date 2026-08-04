"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Archive, ArchiveRestore, Loader2, Plus, Unlink } from "lucide-react";
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
  adoptRecordAction,
  addAffiliationAction,
  endAffiliationAction,
  searchRecordsAction,
  setRecordActiveAction,
} from "../actions";

/** "Start working this one" for a party Accounting created. */
export function AdoptButton({ partyId }: { partyId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await adoptRecordAction({ partyId });
          if ("error" in result) {
            toast.error(result.error);
            return;
          }
          toast.success("Added to CRM");
          router.refresh();
        })
      }
    >
      {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
      Add to CRM
    </Button>
  );
}

export function ArchiveButton({
  partyId,
  partyVersion,
  isActive,
}: {
  partyId: string;
  partyVersion: number;
  isActive: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await setRecordActiveAction({
            partyId,
            partyVersion,
            isActive: !isActive,
          });
          if ("error" in result) {
            toast.error(result.error);
            return;
          }
          // Says what happened rather than "Saved" — archiving is the kind of
          // action somebody wants confirmed in the words they chose.
          toast.success(isActive ? "Record archived" : "Record restored");
          router.refresh();
        })
      }
    >
      {pending ? (
        <Loader2 className="mr-2 size-4 animate-spin" />
      ) : isActive ? (
        <Archive className="mr-2 size-4" />
      ) : (
        <ArchiveRestore className="mr-2 size-4" />
      )}
      {isActive ? "Archive" : "Restore"}
    </Button>
  );
}

/**
 * Connect a person to a company, from either end.
 *
 * The picker searches the OPPOSITE kind to whatever is being viewed, which is
 * the only pairing the record can form — a person connects to a company, so
 * offering people on a person's page would be a list of things that cannot be
 * chosen.
 */
export function AddAffiliationButton({
  partyId,
  partyKind,
}: {
  partyId: string;
  partyKind: "person" | "organization";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [title, setTitle] = useState("");
  const [results, setResults] = useState<{ id: string; displayName: string }[]>([]);
  const [chosen, setChosen] = useState<{ id: string; displayName: string } | null>(
    null,
  );
  const [searching, startSearch] = useTransition();
  const [pending, startTransition] = useTransition();

  const wantedKind = partyKind === "person" ? "organization" : "person";

  function search(next: string) {
    setTerm(next);
    setChosen(null);
    if (next.trim().length === 0) {
      setResults([]);
      return;
    }
    startSearch(async () => {
      const result = await searchRecordsAction({ query: next, kind: wantedKind });
      if ("error" in result) {
        setResults([]);
        return;
      }
      setResults((result.data ?? []).filter((r) => r.id !== partyId));
    });
  }

  function submit() {
    if (!chosen) {
      toast.error(
        wantedKind === "organization" ? "Pick a company" : "Pick a person",
      );
      return;
    }
    startTransition(async () => {
      const result = await addAffiliationAction({
        personPartyId: partyKind === "person" ? partyId : chosen.id,
        organizationPartyId: partyKind === "person" ? chosen.id : partyId,
        title: title.trim() || undefined,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Connected");
      setOpen(false);
      setTerm("");
      setTitle("");
      setChosen(null);
      setResults([]);
      router.refresh();
    });
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Plus className="mr-2 size-4" />
        Connect
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {wantedKind === "organization"
                ? "Connect to a company"
                : "Connect a person"}
            </DialogTitle>
            <DialogDescription>
              Both records stay their own; this records the relationship between
              them, and keeps it when it ends.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="crm-affiliation-search">
                {wantedKind === "organization" ? "Company" : "Person"}
              </Label>
              <Input
                id="crm-affiliation-search"
                value={chosen ? chosen.displayName : term}
                onChange={(e) => search(e.target.value)}
                placeholder="Start typing a name"
                autoComplete="off"
              />
              {searching && (
                <p className="text-xs text-muted-foreground">Searching…</p>
              )}
              {!chosen && results.length > 0 && (
                <ul className="max-h-48 divide-y overflow-y-auto rounded-md border">
                  {results.map((r) => (
                    <li key={r.id}>
                      <button
                        type="button"
                        className="w-full px-3 py-2 text-left text-sm transition-colors hover:bg-accent/40"
                        onClick={() => {
                          setChosen(r);
                          setResults([]);
                        }}
                      >
                        {r.displayName}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {!chosen && !searching && term.trim() && results.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No match. The other record has to exist first.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="crm-affiliation-title">Role (optional)</Label>
              <Input
                id="crm-affiliation-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Operations Manager"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={pending}>
              {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
              Connect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * End a connection. Not "remove" — the wording matters, because the row
 * survives and the former employer is exactly what somebody wants when an old
 * thread turns up.
 */
export function EndAffiliationButton({
  affiliationId,
  expectedVersion,
  partyId,
  counterpartyName,
}: {
  affiliationId: string;
  expectedVersion: number;
  partyId: string;
  counterpartyName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const result = await endAffiliationAction({
        affiliationId,
        expectedVersion,
        // Today. Computed in the browser deliberately: "when did this end"
        // means the person's own date, not the server's timezone.
        endedOn: new Date().toISOString().slice(0, 10),
        partyId,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Marked as ended. The connection stays on the record.");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        aria-label={`End connection with ${counterpartyName}`}
      >
        <Unlink className="size-4" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>End this connection?</DialogTitle>
            <DialogDescription>
              {counterpartyName} will show as a former connection rather than
              disappearing — the history is usually the point.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={pending}>
              {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
              End connection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
