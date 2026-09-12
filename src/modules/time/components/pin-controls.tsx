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
import { useConfirm } from "@/components/app/use-confirm";
import {
  clearWorkerPinAction,
  resetPinLockoutAction,
  setWorkerPinAction,
} from "../actions";
import { PIN_MAX_LENGTH, PIN_MIN_LENGTH } from "../core/pin";

/**
 * Give somebody a PIN for the shared clock, or take it away.
 *
 * **THE OWNER TYPES IT, AND THEN TELLS THEM.** There is no "send a PIN" and no
 * self-service reset, because a worker on the shared clock is by definition
 * somebody who may have no login and no email — the two channels a reset would
 * use. Handing over four digits in a yard is the real workflow, so the product
 * does that one properly instead of a worse version of something else.
 *
 * The dialog shows the digits as they are typed. An owner setting somebody
 * else's PIN needs to read it back to them; masking it here would protect
 * nothing and cause a second attempt.
 */
export function SetPinButton({
  workerId,
  name,
  hasPin,
}: {
  workerId: string;
  name: string;
  hasPin: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [pending, startTransition] = useTransition();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setPin("");
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          {hasPin ? "Change PIN" : "Give a PIN"}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{hasPin ? "Change" : "Set"} {name}&rsquo;s PIN</DialogTitle>
          <DialogDescription>
            {PIN_MIN_LENGTH} to {PIN_MAX_LENGTH} digits, for the shared clock by
            the door. Tell them what it is — there is no way to send it, and no
            way to read it back later.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 py-2">
          <Label htmlFor="pin">PIN</Label>
          <Input
            id="pin"
            inputMode="numeric"
            autoFocus
            value={pin}
            maxLength={PIN_MAX_LENGTH}
            placeholder="4821"
            onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, ""))}
          />
          <p className="text-xs text-subtle-foreground">
            Not 1234, not 0000, and not a run of digits — those are the first
            ones anybody tries.
          </p>
        </div>
        <DialogFooter>
          <Button
            disabled={pin.length < PIN_MIN_LENGTH || pending}
            onClick={() =>
              startTransition(async () => {
                const result = await setWorkerPinAction({ workerId, pin });
                if ("error" in result) {
                  toast.error(result.error);
                  return;
                }
                toast.success(`${name} can use the shared clock`);
                setOpen(false);
                setPin("");
                router.refresh();
              })
            }
          >
            {pending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Take the PIN away. Their hours and their history are untouched. */
export function ClearPinButton({
  workerId,
  name,
}: {
  workerId: string;
  name: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { confirm, confirmDialog } = useConfirm();

  return (
    <>
      {confirmDialog}
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={async () => {
          const ok = await confirm({
            title: `Remove ${name}'s PIN?`,
            description:
              "They will not be able to use the shared clock, and their name " +
              "stops appearing on it. Everything they have already worked stays " +
              "exactly as it is, and you can still log their hours by hand.",
            confirmLabel: "Remove it",
            destructive: true,
          });
          if (!ok) return;
          startTransition(async () => {
            const result = await clearWorkerPinAction({ workerId });
            if ("error" in result) {
              toast.error(result.error);
              return;
            }
            toast.success("PIN removed");
            router.refresh();
          });
        }}
      >
        Remove PIN
      </Button>
    </>
  );
}

/**
 * Let somebody back in before the lockout expires.
 *
 * Only rendered while they are actually locked out, which is derived from the
 * counter and the timestamp rather than stored — so this button appears and
 * disappears on its own, and pressing it is never the only way back in.
 */
export function ResetLockoutButton({
  workerId,
  name,
}: {
  workerId: string;
  name: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await resetPinLockoutAction({ workerId });
          if ("error" in result) {
            toast.error(result.error);
            return;
          }
          toast.success(`${name} can try again`);
          router.refresh();
        })
      }
    >
      Let them try again
    </Button>
  );
}
