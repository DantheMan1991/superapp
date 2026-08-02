"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { AlertTriangle, Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  RichTextEditor,
  type RichTextEditorHandle,
} from "../components/rich-text-editor";
import { saveSignatureAction } from "./actions";
import type { LoadedSignature } from "./load";

/**
 * The signature editor, in the reading pane.
 *
 * Same shape as the auto-reply form and the rules editor: it takes the pane
 * rather than floating over it, so the inbox stays visible behind the decision.
 *
 * IT IS THE COMPOSER'S OWN EDITOR, not a second one. A signature written in a
 * different control from the one it will appear in is how a signature ends up
 * looking wrong only in real messages — and reusing it means bold, links, colour
 * and the rest arrive here for free, already constrained to what the outbound
 * sanitizer accepts. The picture button is absent because a `cid:` is minted per
 * message; see the editor's prop comment.
 *
 * NO SEPARATE PREVIEW. The editor IS the preview — everything it can produce is
 * a declaration the sanitizer keeps, so what is on screen is what gets saved,
 * and a second rendering underneath would only be somewhere for the two to
 * disagree.
 */
export function SignatureForm({
  mailboxId,
  signature,
  closeHref,
}: {
  mailboxId: string;
  /** Null when the mail server would not say what the current signature is. */
  signature: LoadedSignature | null;
  closeHref: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const editor = useRef<RichTextEditorHandle | null>(null);
  /**
   * Remounts the editor after a clear.
   *
   * `initialHtml` is applied ONCE on mount by design — React must never
   * re-render a contenteditable's children or it fights the browser for the
   * caret. So emptying the box means giving it a new identity, which is what
   * this key does.
   */
  const [instance, setInstance] = useState(0);

  if (!signature) {
    return (
      <Shell closeHref={closeHref}>
        <p className="flex items-start gap-2 rounded-md border bg-secondary/40 p-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          {/* Deliberately NOT an empty editor. Showing a confident blank one
              would invite somebody to save over a signature we simply could not
              read — which is how a working signature gets deleted by a form. */}
          Your mail server didn&apos;t answer when we asked for your current
          signature, so there is nothing safe to edit here yet. Try again in a
          moment.
        </p>
      </Shell>
    );
  }

  function save() {
    const html = editor.current?.html() ?? "";
    startTransition(async () => {
      const result = await saveSignatureAction({
        mailboxId,
        identityId: signature!.identityId,
        // Only the HTML goes. The text version is derived on the server so the
        // two halves cannot describe different signatures.
        html,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Signature saved.");
      router.push(closeHref);
      router.refresh();
    });
  }

  return (
    <Shell closeHref={closeHref}>
      <p className="text-xs text-muted-foreground">
        Added to the bottom of messages you send from{" "}
        <span className="font-medium text-foreground">{signature.address}</span>.
        It is stored on your mail server, so it applies on your phone and in
        Outlook too.
      </p>

      {signature.hasOthers && (
        <p className="rounded-md border bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
          This mailbox has more than one send address. This edits the signature
          for the one above — the address Yosher composes from.
        </p>
      )}

      <RichTextEditor
        key={instance}
        initialHtml={signature.htmlSignature}
        editorRef={editor}
        disabled={pending}
        ariaLabel="Signature"
      />

      <p className="text-xs text-muted-foreground">
        A <code>--</code> separator line is added for you if it is not there.
        That is what stops your signature being quoted back into every reply in a
        thread.
      </p>

      <div className="flex items-center gap-2 pt-1">
        <Button onClick={save} disabled={pending} size="sm">
          {pending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Save className="size-4" />
          )}
          Save signature
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => {
            // Clearing is a normal thing to want, and it has to be expressible:
            // an empty signature saves as empty rather than being refused.
            setInstance((n) => n + 1);
            toast.message("Cleared — press Save to remove your signature.");
          }}
        >
          Clear
        </Button>
      </div>
    </Shell>
  );
}

function Shell({
  children,
  closeHref,
}: {
  children: React.ReactNode;
  closeHref: string;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-2.5">
        <span className="text-sm font-medium">Signature</span>
        <Link
          href={closeHref}
          className="ml-auto text-sm text-muted-foreground hover:text-foreground"
        >
          Close
        </Link>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-4">{children}</div>
    </div>
  );
}
