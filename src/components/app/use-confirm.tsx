"use client";

import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * "Are you sure?" as a real dialog, shaped like `window.confirm` at the call
 * site.
 *
 * Accounting had five native confirms guarding Issue, Void, Delete, Unapply
 * payment, Disconnect bank and Cancel/Reopen reconciliation — every
 * irreversible action in the module. Native confirms are worse than ugly:
 * embedded browsers and webviews SUPPRESS them, and a suppressed confirm
 * returns false, so the button silently does nothing. That is exactly the
 * failure mode you cannot debug from a support ticket, and it is how this was
 * found — clicking Issue in an in-app browser did nothing at all, with no
 * toast, no error and no request.
 *
 * PROMISE-SHAPED ON PURPOSE. The declarative form — hold "what am I
 * confirming" in state, render a dialog, wire its button to the action — is
 * the same component the rest of the app writes by hand, and it forces every
 * call site to be turned inside out: the guard clause at the top of the
 * handler becomes a callback somewhere else. Here the guard stays a guard:
 *
 *     if (!(await confirm({ title: "Void INV-0007?", ... }))) return;
 *
 * which is the line `window.confirm` occupied, so what a reader has to check
 * is that the message is right rather than that the control flow still is.
 */

export interface ConfirmOptions {
  /** The question. A question mark earns its place here. */
  title: string;
  /** What actually happens, in a sentence. Say what cannot be undone. */
  description?: string;
  /** The verb, not "OK" — "Void invoice" beats "Confirm". */
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red button. For anything that destroys or reverses posted money. */
  destructive?: boolean;
}

interface ConfirmState extends ConfirmOptions {
  open: boolean;
}

const CLOSED: ConfirmState = { open: false, title: "" };

export function useConfirm(): {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  /** Render this ONCE, anywhere in the component's tree. */
  confirmDialog: React.ReactNode;
} {
  const [state, setState] = useState<ConfirmState>(CLOSED);
  /**
   * The pending question's resolver. A ref rather than state because
   * resolving must not wait for a render — and because two overlapping
   * questions would otherwise leave the first promise hanging forever, which
   * is a leaked `await` in the caller's transition.
   */
  const resolver = useRef<((answer: boolean) => void) | null>(null);

  const settle = useCallback((answer: boolean) => {
    resolver.current?.(answer);
    resolver.current = null;
    setState(CLOSED);
  }, []);

  const confirm = useCallback(
    (options: ConfirmOptions) => {
      // A second question supersedes the first, which is answered "no" rather
      // than left dangling.
      resolver.current?.(false);
      setState({ ...options, open: true });
      return new Promise<boolean>((resolve) => {
        resolver.current = resolve;
      });
    },
    [],
  );

  const confirmDialog = (
    <Dialog
      open={state.open}
      // Covers Escape, the overlay and the close button in one place: any
      // route out that is not the confirm button means no.
      onOpenChange={(next) => {
        if (!next) settle(false);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{state.title}</DialogTitle>
          {state.description && (
            <DialogDescription>{state.description}</DialogDescription>
          )}
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => settle(false)}>
            {state.cancelLabel ?? "Cancel"}
          </Button>
          <Button
            variant={state.destructive ? "destructive" : "default"}
            onClick={() => settle(true)}
          >
            {state.confirmLabel ?? "Confirm"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { confirm, confirmDialog };
}
