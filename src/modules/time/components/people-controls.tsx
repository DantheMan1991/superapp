"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import {
  addWorkerAction,
  setWeekStartsOnAction,
  setWorkerActiveAction,
  setWorkerUserAction,
} from "../actions";
import { WEEKDAYS } from "../core/week";

export interface PersonOption {
  id: string;
  name: string;
}

export interface MemberOption {
  clerkUserId: string;
  label: string;
}

const NEW_PERSON = "__new__";
const NO_SIGN_IN = "__none__";

/**
 * Add somebody whose hours the business records.
 *
 * TWO DOORS, because there are two kinds of new worker. Somebody the business
 * already deals with — a subcontractor who is also a vendor — should become a
 * worker without a second record of the same human being; that is the whole
 * point of hanging this off the party spine. Somebody nobody has ever invoiced
 * should need nothing but a name.
 */
export function AddWorker({
  people,
  members,
}: {
  /** People already on the party spine who are not workers yet. */
  people: PersonOption[];
  members: MemberOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [who, setWho] = useState(NEW_PERSON);
  const [signIn, setSignIn] = useState(NO_SIGN_IN);

  function submit(formData: FormData) {
    const name = String(formData.get("name") ?? "").trim();
    if (who === NEW_PERSON && !name) {
      toast.error("Give the person a name.");
      return;
    }
    startTransition(async () => {
      const result = await addWorkerAction({
        partyId: who === NEW_PERSON ? null : who,
        name: who === NEW_PERSON ? name : undefined,
        clerkUserId: signIn === NO_SIGN_IN ? null : signIn,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Added");
      setOpen(false);
      setWho(NEW_PERSON);
      setSignIn(NO_SIGN_IN);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Add someone</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form action={submit}>
          <DialogHeader>
            <DialogTitle>Add someone</DialogTitle>
            <DialogDescription>
              Anybody whose hours you want to keep. They do not need to be able
              to sign in.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="who">Who</Label>
              <Select value={who} onValueChange={setWho}>
                <SelectTrigger id="who">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NEW_PERSON}>Somebody new</SelectItem>
                  {people.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {people.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  People you already deal with are listed here, so nobody ends
                  up in your records twice.
                </p>
              )}
            </div>
            {who === NEW_PERSON && (
              <div className="grid gap-2">
                <Label htmlFor="name">Name</Label>
                <Input id="name" name="name" maxLength={120} autoFocus />
              </div>
            )}
            <div className="grid gap-2">
              <Label htmlFor="signIn">Signs in as</Label>
              <Select value={signIn} onValueChange={setSignIn}>
                <SelectTrigger id="signIn">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_SIGN_IN}>Nobody — they do not use the app</SelectItem>
                  {members.map((m) => (
                    <SelectItem key={m.clerkUserId} value={m.clerkUserId}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Linking a sign-in means their own time is the one the Log time
                box offers first.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Adding…" : "Add"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Mark that somebody has left, or bring them back.
 *
 * NEVER A DELETE, and the button says "Has left" rather than "Remove" for that
 * reason: their hours are what the business paid, and nothing on this screen
 * should suggest those can be made to disappear.
 */
export function WorkerActiveButton({
  workerId,
  version,
  isActive,
  name,
}: {
  workerId: string;
  version: number;
  isActive: boolean;
  name: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await setWorkerActiveAction({
            workerId,
            expectedVersion: version,
            isActive: !isActive,
          });
          if ("error" in result) {
            toast.error(result.error);
            return;
          }
          toast.success(isActive ? `${name} marked as left` : `${name} is back`);
          router.refresh();
        })
      }
    >
      {isActive ? "Has left" : "Bring back"}
    </Button>
  );
}

/** Link a worker to the sign-in they use, or unlink them. */
export function WorkerSignInPicker({
  workerId,
  version,
  clerkUserId,
  members,
}: {
  workerId: string;
  version: number;
  clerkUserId: string | null;
  members: MemberOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Select
      disabled={pending}
      value={clerkUserId ?? NO_SIGN_IN}
      onValueChange={(value) =>
        startTransition(async () => {
          const result = await setWorkerUserAction({
            workerId,
            expectedVersion: version,
            clerkUserId: value === NO_SIGN_IN ? null : value,
          });
          if ("error" in result) {
            toast.error(result.error);
            return;
          }
          toast.success("Saved");
          router.refresh();
        })
      }
    >
      <SelectTrigger className="h-8 w-[220px] text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_SIGN_IN}>No sign-in</SelectItem>
        {members.map((m) => (
          <SelectItem key={m.clerkUserId} value={m.clerkUserId}>
            {m.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Which day the week starts on.
 *
 * Looks like a display preference and is not. From slice 2 this is the anchor
 * of the workweek — the fixed recurring period overtime is computed over, which
 * is not the pay period — so the sentence under it says what it is for rather
 * than what it does.
 */
export function WeekStartPicker({ weekStartsOn }: { weekStartsOn: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Select
        disabled={pending}
        value={String(weekStartsOn)}
        onValueChange={(value) =>
          startTransition(async () => {
            const result = await setWeekStartsOnAction({
              weekStartsOn: Number(value),
            });
            if ("error" in result) {
              toast.error(result.error);
              return;
            }
            toast.success("Saved");
            router.refresh();
          })
        }
      >
        <SelectTrigger className="w-[160px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {WEEKDAYS.map((day, i) => (
            <SelectItem key={day} value={String(i)}>
              {day}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        Your week runs from here. Weekly totals are grouped by it.
      </p>
    </div>
  );
}
