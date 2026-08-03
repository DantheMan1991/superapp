"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Paperclip, ShieldAlert, Type, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { parseRecipients } from "../compose/addresses";
import { sendMessageAction } from "../compose-actions";
import type { HeldMessage } from "../compose/send";
import {
  cancelHeldMessageAction,
  releaseHeldMessageAction,
  scheduleHeldMessageAction,
} from "../schedule/actions";
import { describeSendAt, UNDO_SECONDS } from "../schedule/times";
import { SendButton } from "./send-button";
import { Textarea } from "@/components/ui/textarea";
import { RichTextEditor, type RichTextEditorHandle } from "./rich-text-editor";
import { RecipientInput } from "./recipient-input";
import { htmlToPlainText } from "../compose/to-text";
import { applyTemplateSubject } from "../templates/validate";
import {
  composerPlaceholderValues,
  fillPlaceholders,
  unfilledPlaceholders,
} from "../templates/placeholders";
import { TemplatePicker, type PickableTemplate } from "../templates/picker";
import type { InlineImage } from "../compose/inline";

/**
 * Where somebody types.
 *
 * Holds a document and nothing else — every rule about what a reply should
 * contain was applied on the server before this rendered. The one piece of logic
 * here is parsing recipient lines, and that lives in a pure tested file rather
 * than in this component.
 *
 * No optimistic state, and here that is not a style choice: a message either
 * left the building or it did not, and there is no version of "probably sent"
 * worth showing anybody.
 *
 * THE BODY IS NOT REACT STATE. A `contenteditable` owns its own DOM, and
 * re-rendering it from state on every keystroke is what makes the caret jump to
 * the end of the document mid-word. The markup is read out of the editor once,
 * on submit, through a ref — which also means the send path handles exactly what
 * is on screen at the moment the button was pressed.
 *
 * The HTML is sanitized AGAIN on the server. Nothing this component produces is
 * trusted: see the header of `compose/html.ts` for why the write path is the
 * strictest boundary in the module.
 */

export interface ComposeDraft {
  to: string;
  cc: string;
  subject: string;
  /** The starting document for the rich editor, built and sanitized server-side. */
  bodyHtml: string;
  inReplyTo: string[];
  references: string[];
  showCc: boolean;
}

interface Attachment {
  blobId: string;
  name: string;
  type: string;
  size: number;
}

export function ComposeForm({
  mailboxId,
  accountId,
  draft,
  devNotice,
  closeHref,
  title,
  templates,
  senderName,
  senderEmail,
  businessName,
}: {
  mailboxId: string;
  accountId: string;
  draft: ComposeDraft;
  devNotice: string | null;
  closeHref: string;
  /** "Reply", "Forward" … — what the person actually pressed. */
  title: string;
  /** The business's canned responses. Bodies are already sanitized. */
  templates: PickableTemplate[];
  /** Placeholder values that do not change while a message is being written. */
  senderName: string;
  senderEmail: string;
  businessName: string;
}) {
  const router = useRouter();
  const [to, setTo] = useState(draft.to);
  const [cc, setCc] = useState(draft.cc);
  const [bcc, setBcc] = useState("");
  const [showCc, setShowCc] = useState(draft.showCc);
  const [showBcc, setShowBcc] = useState(false);
  const [subject, setSubject] = useState(draft.subject);
  /**
   * Plain-text mode.
   *
   * Switching INTO it converts what is written rather than discarding it — the
   * text alternative is already the thing the send path derives, so the
   * conversion is the same function the server would have run anyway. Switching
   * back gives a rich editor seeded with that text: the words survive both ways
   * and the formatting does not, which is the honest behaviour and the one every
   * other composer has.
   */
  const [plainText, setPlainText] = useState(false);
  const [plainBody, setPlainBody] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  /**
   * Pictures put in the body, kept HERE rather than in the editor.
   *
   * The editor owns the markup; these are the blob ids and content ids the send
   * action needs, and the DOM is not a place to keep them. The list only grows —
   * deleting an image from the body leaves its entry behind, and the ACTION is
   * what drops it, by attaching only the pictures the sanitized body still
   * references. Pruning here would mean watching the contenteditable for
   * deletions, which is a mutation observer for a problem the server already
   * answers correctly.
   */
  const [inlineImages, setInlineImages] = useState<InlineImage[]>([]);
  const [uploading, setUploading] = useState(false);
  const [pending, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);
  const editor = useRef<RichTextEditorHandle | null>(null);

  /**
   * Drop a canned response into what is already being written.
   *
   * INSERTS AT THE CARET, never replaces. Replacing the body is the obvious
   * reading of "apply a template" and is wrong the first time somebody uses one
   * in a reply: the quoted message and the signature are already in that editor
   * and both would vanish. Gmail inserts; so does this.
   *
   * The SUBJECT is filled only when empty, so a template cannot rewrite
   * "Re: …" on a reply. A template with no subject of its own never touches it.
   *
   * In plain-text mode the markup would arrive as literal tags in a textarea, so
   * the text rendering goes in instead — the same `htmlToPlainText` the send
   * path derives its text alternative with, rather than a second converter.
   */
  function insertTemplate(template: PickableTemplate) {
    /**
     * PLACEHOLDERS ARE FILLED HERE, AT INSERT, NOT AT SEND.
     *
     * The alternative — carry `{{recipient.name}}` through and substitute on
     * the server — would mean somebody sends a message they have never read in
     * its final form, and a value that failed to resolve arrives at a customer
     * as literal braces with nobody having had a chance to see it. Filling now
     * puts the result on screen while there is still a person there.
     *
     * It is the same rule the signature editor states: what is on screen is
     * what gets sent, and a second rendering somewhere else is only a place for
     * the two to disagree.
     *
     * The recipient is read from the To field AS IT IS RIGHT NOW, which is why
     * this reads `to` rather than a memoized value: somebody who types the
     * address first gets a filled greeting, and somebody who inserts first sees
     * the token and can fix it.
     */
    const first = parseRecipients(to).addresses[0];
    const values = composerPlaceholderValues({
      recipientName: first?.name ?? null,
      recipientEmail: first?.email ?? null,
      senderName,
      senderEmail,
      businessName,
      today: new Date(),
    });

    const filledHtml = fillPlaceholders(template.bodyHtml, values);
    const leftOver = unfilledPlaceholders(filledHtml);
    if (leftOver.length > 0) {
      // Said once, now, rather than discovered by the recipient. Not an error:
      // inserting a template before choosing who it is for is a normal order to
      // work in, and the tokens are visible in the body to be filled by hand.
      toast.message(
        leftOver.length === 1
          ? `{{${leftOver[0]}}} still needs filling in.`
          : `${leftOver.length} placeholders still need filling in.`,
      );
    }

    setSubject((current) =>
      applyTemplateSubject(current, fillPlaceholders(template.subject, values)),
    );
    if (plainText) {
      const text = htmlToPlainText(filledHtml);
      setPlainBody((current) => (current.length > 0 ? `${current}\n${text}` : text));
      return;
    }
    editor.current?.insertHtml(filledHtml);
  }

  async function upload(files: FileList) {
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        // Straight to a route handler, NOT through a server action — Next caps
        // an action's body at 4 MB, which would silently become the attachment
        // limit for the whole product.
        const response = await fetch(`/api/mail/${accountId}/upload`, {
          method: "POST",
          headers: {
            "Content-Type": file.type || "application/octet-stream",
            "x-file-type": file.type || "application/octet-stream",
            "x-file-name": file.name,
          },
          body: file,
        });
        if (!response.ok) {
          const detail = await response.json().catch(() => null);
          toast.error(detail?.error ?? `Couldn't attach ${file.name}.`);
          continue;
        }
        const blob = await response.json();
        setAttachments((prior) => [...prior, blob as Attachment]);
      }
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function togglePlainText() {
    if (!plainText) {
      // NOT sanitized here. `compose/html.ts` pulls in sanitize-html, and
      // importing it from a client component would ship a ~100 KB parser to
      // every reader of the mail page. It is unnecessary as well as expensive:
      // paste is plain text, so the editor's contents are only ever its own
      // toolbar's output, and the server sanitizes on send regardless.
      setPlainBody(htmlToPlainText(editor.current?.html() ?? ""));
      setPlainText(true);
      return;
    }
    setPlainText(false);
  }

  function send(at?: Date) {
    const parsedTo = parseRecipients(to);
    const parsedCc = parseRecipients(cc);
    const parsedBcc = parseRecipients(bcc);
    const bad = [...parsedTo.invalid, ...parsedCc.invalid, ...parsedBcc.invalid];
    if (bad.length > 0) {
      // Named rather than silently dropped: a message that goes to three people
      // when you meant four is worse than one that refuses to send.
      toast.error(`Couldn't read: ${bad.join(", ")}`);
      return;
    }
    if (parsedTo.addresses.length === 0) {
      toast.error("Add at least one recipient.");
      return;
    }

    // Read once, at submit. See the header: the editor owns its own DOM and this
    // is the only moment its contents matter.
    const htmlBody = plainText ? "" : (editor.current?.html() ?? "");

    startTransition(async () => {
      const result = await sendMessageAction({
        mailboxId,
        to: parsedTo.addresses,
        cc: parsedCc.addresses,
        bcc: parsedBcc.addresses,
        subject,
        // In rich mode the action sanitizes the HTML and DERIVES the text
        // alternative from what survives, so the two parts can never describe
        // different messages — sending a textBody from here as well would be a
        // second source of truth for the same words. In plain-text mode there
        // is no HTML at all and this IS the message.
        textBody: plainText ? plainBody : "",
        ...(htmlBody ? { htmlBody } : {}),
        ...(draft.inReplyTo.length > 0 ? { inReplyTo: draft.inReplyTo } : {}),
        ...(draft.references.length > 0 ? { references: draft.references } : {}),
        ...(inlineImages.length > 0
          ? {
              inlineImages: inlineImages.map((i) => ({
                blobId: i.blobId,
                cid: i.cid,
                type: i.type,
                name: i.name,
              })),
            }
          : {}),
        ...(attachments.length > 0
          ? {
              attachments: attachments.map((a) => ({
                blobId: a.blobId,
                type: a.type,
                name: a.name,
              })),
            }
          : {}),
      });
      if ("error" in result || !result.data) {
        toast.error("error" in result ? result.error : "Couldn't prepare that message.");
        return;
      }

      const held = result.data;
      // The composer closes NOW, before the message has actually gone. It is a
      // finished message on the mail server either way, and keeping the pane
      // open behind a countdown would suggest there is still something to edit.
      router.push(closeHref);

      if (at) {
        const queued = await scheduleHeldMessageAction({ ...heldPayload(held), sendAt: at.toISOString() });
        if ("error" in queued) {
          toast.error(queued.error);
          return;
        }
        toast.success(`Scheduled for ${describeSendAt(at, new Date())}.`);
        router.refresh();
        return;
      }

      startUndoWindow(held);
    });
  }

  /**
   * The undo window.
   *
   * A client-side countdown over a draft that is ALREADY on the mail server —
   * the only shape available, because `mail:probe-send` found this server
   * refuses a future-dated submission outright. If the tab closes mid-window the
   * message is not lost: it is a finished draft in Drafts, which is where anyone
   * would look for it. That recoverability is the whole reason the draft is
   * created up front rather than the text being held in the browser.
   */
  function startUndoWindow(held: HeldMessage) {
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      void releaseHeldMessageAction(heldPayload(held)).then((sent) => {
        if ("error" in sent) {
          toast.error(`${sent.error} The message is still in your drafts.`);
          return;
        }
        toast.success(
          held.redirected
            ? `Sent — delivered only to ${held.deliveredTo.join(", ")} (not production).`
            : "Sent.",
        );
        router.refresh();
      });
    }, UNDO_SECONDS * 1000);

    toast(`Sending in ${UNDO_SECONDS}s…`, {
      duration: UNDO_SECONDS * 1000,
      action: {
        label: "Undo",
        onClick: () => {
          cancelled = true;
          clearTimeout(timer);
          void cancelHeldMessageAction({
            mailboxId,
            emailId: held.emailId,
          }).then((result) => {
            toast.success(
              "error" in result
                ? "Held back. The message is in your drafts."
                : "Not sent.",
            );
            router.refresh();
          });
        },
      },
    });
  }

  /** The fields both follow-up actions need, in one place. */
  function heldPayload(held: HeldMessage) {
    return {
      mailboxId,
      emailId: held.emailId,
      identityId: held.identityId,
      fromEmail: held.fromEmail,
      draftsMailboxId: held.draftsMailboxId,
      sentMailboxId: held.sentMailboxId,
      envelopeRcptTo: held.deliveredTo,
    };
  }

  const busy = pending || uploading;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-2.5">
        <span className="text-sm font-medium">{title}</span>
        <Link
          href={closeHref}
          className="ml-auto text-sm text-muted-foreground hover:text-foreground"
        >
          Close
        </Link>
      </div>

      {devNotice && (
        <p className="flex items-start gap-2 border-b bg-secondary/40 px-4 py-2 text-xs text-muted-foreground">
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
          {devNotice}
        </p>
      )}

      <div className="min-h-0 flex-1 space-y-2 overflow-auto p-4">
        <div className="flex items-center gap-2">
          <label htmlFor="mail-to" className="w-12 shrink-0 text-xs text-muted-foreground">
            To
          </label>
          <RecipientInput
            id="mail-to"
            value={to}
            onChange={setTo}
            mailboxId={mailboxId}
            placeholder="Start typing a name or address"
            otherFields={`${cc}, ${bcc}`}
          />
          {!showCc && (
            <button
              type="button"
              className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setShowCc(true)}
            >
              Cc
            </button>
          )}
          {!showBcc && (
            <button
              type="button"
              className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setShowBcc(true)}
            >
              Bcc
            </button>
          )}
        </div>

        {showCc && (
          <div className="flex items-center gap-2">
            <label htmlFor="mail-cc" className="w-12 shrink-0 text-xs text-muted-foreground">
              Cc
            </label>
            <RecipientInput
              id="mail-cc"
              value={cc}
              onChange={setCc}
              mailboxId={mailboxId}
              otherFields={`${to}, ${bcc}`}
            />
          </div>
        )}

        {showBcc && (
          <div className="flex items-center gap-2">
            <label htmlFor="mail-bcc" className="w-12 shrink-0 text-xs text-muted-foreground">
              Bcc
            </label>
            <RecipientInput
              id="mail-bcc"
              value={bcc}
              onChange={setBcc}
              mailboxId={mailboxId}
              otherFields={`${to}, ${cc}`}
            />
          </div>
        )}

        <div className="flex items-center gap-2">
          <label
            htmlFor="mail-subject"
            className="w-12 shrink-0 text-xs text-muted-foreground"
          >
            Subject
          </label>
          <Input
            id="mail-subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            autoComplete="off"
          />
        </div>

        {/*
          Tall enough to write in — a composer you have to scroll to see three
          lines of is one people take to their phone instead.
        */}
        {plainText ? (
          <Textarea
            value={plainBody}
            onChange={(e) => setPlainBody(e.target.value)}
            className="min-h-[18rem] font-sans"
            placeholder="Write your message…"
            aria-label="Message body"
          />
        ) : (
          <RichTextEditor
            initialHtml={draft.bodyHtml}
            editorRef={editor}
            disabled={busy}
            accountId={accountId}
            mailboxId={mailboxId}
            onImageInserted={(image) =>
              setInlineImages((prior) => [...prior, image])
            }
          />
        )}

        {attachments.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {attachments.map((a) => (
              <li
                key={a.blobId}
                className="inline-flex items-center gap-1.5 rounded-full border py-1 pr-1.5 pl-2.5 text-xs"
              >
                <Paperclip className="size-3 text-muted-foreground" />
                <span className="max-w-[14rem] truncate">{a.name}</span>
                <span className="text-muted-foreground">
                  {Math.max(1, Math.round(a.size / 1024))} KB
                </span>
                <button
                  type="button"
                  aria-label={`Remove ${a.name}`}
                  className="rounded-sm p-0.5 opacity-60 hover:opacity-100"
                  onClick={() =>
                    setAttachments((prior) =>
                      prior.filter((p) => p.blobId !== a.blobId),
                    )
                  }
                >
                  <X className="size-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex items-center gap-2 border-t px-4 py-3">
        <SendButton
          busy={busy}
          pending={pending}
          onSend={() => send()}
          onSchedule={(at) => send(at)}
        />
        <TemplatePicker
          templates={templates}
          disabled={busy}
          onPick={insertTemplate}
        />
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => fileInput.current?.click()}
        >
          {uploading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Paperclip className="size-4" />
          )}
          Attach
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={togglePlainText}
          title={
            plainText
              ? "Back to formatting"
              : "Plain text only — formatting is discarded"
          }
        >
          <Type className="size-4" />
          {plainText ? "Rich text" : "Plain text"}
        </Button>
        <input
          ref={fileInput}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) void upload(e.target.files);
          }}
        />
      </div>
    </div>
  );
}
