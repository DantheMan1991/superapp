"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { replyToBidAction } from "./actions";

/**
 * What a subcontractor fills in.
 *
 * **NO SIGN-IN, AND NOTHING ABOUT ANYBODY ELSE.** They see the scope they
 * were sent and a box for their number. Not the estimate, not the other
 * bidders, not what anybody else said — a bid request that leaked the
 * competition would be worse than no bid request.
 */
export function ReplyForm({ token, symbol }: { token: string; symbol: string }) {
  const [state, action, pending] = useActionState(
    replyToBidAction.bind(null, token),
    null,
  );
  const [declined, setDeclined] = useState(false);

  if (state?.done) {
    return (
      <div className="rounded-md border border-success/40 bg-success/10 p-4">
        <p className="text-sm font-medium">Thank you — that has gone through.</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Nothing more is needed. They will be in touch if they have questions.
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="bid-name">Your name</Label>
        <Input id="bid-name" name="name" required maxLength={120} autoComplete="name" />
      </div>

      <label className="flex items-start gap-2 text-sm">
        <Checkbox
          name="declined"
          className="mt-0.5"
          checked={declined}
          onCheckedChange={(next) => setDeclined(next === true)}
        />
        <span>
          <span className="font-medium">Not bidding this one.</span>{" "}
          <span className="text-muted-foreground">
            Worth saying — it tells them not to wait on you.
          </span>
        </span>
      </label>
      {/* A checkbox contributes nothing when it is off, so the shape is explicit. */}
      <input type="hidden" name="declined" value={declined ? "on" : ""} />

      {!declined && (
        <div className="space-y-1.5">
          <Label htmlFor="bid-amount">Your price</Label>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">{symbol}</span>
            <Input
              id="bid-amount"
              name="amount"
              inputMode="decimal"
              placeholder="12,500"
              maxLength={40}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            The whole scope as it is written above. Put anything you are leaving
            out in the notes.
          </p>
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="bid-note">Anything they should know</Label>
        <Textarea
          id="bid-note"
          name="note"
          rows={4}
          maxLength={2000}
          placeholder="Exclusions, lead time, what the price assumes."
        />
      </div>

      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Sending…" : declined ? "Send my answer" : "Send my price"}
        </Button>
        <p className="text-xs text-muted-foreground">You can only send this once.</p>
      </div>
    </form>
  );
}
