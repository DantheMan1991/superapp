"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Paperclip, Send, ShieldAlert, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { parseRecipients } from "../compose/addresses";
import { sendMessageAction } from "../compose-actions";

/**
 * Where somebody types.
 *
 * Holds text and nothing else — every rule about what a reply should contain was
 * applied on the server before this rendered. The one piece of logic here is
 * parsing recipient lines, and that lives in a pure tested file rather than in
 * this component.
 *
 * No optimistic state, and here that is not a style choice: a message either
 * left the building or it did not, and there is no version of "probably sent"
 * worth showing anybody.
 */

export interface ComposeDraft {
  to: string;
  cc: string;
  subject: string;
  body: string;
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
}: {
  mailboxId: string;
  accountId: string;
  draft: ComposeDraft;
  devNotice: string | null;
  closeHref: string;
  /** "Reply", "Forward" … — what the person actually pressed. */
  title: string;
}) {
  const router = useRouter();
  const [to, setTo] = useState(draft.to);
  const [cc, setCc] = useState(draft.cc);
  const [showCc, setShowCc] = useState(draft.showCc);
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [pending, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

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

  function send() {
    const parsedTo = parseRecipients(to);
    const parsedCc = parseRecipients(cc);
    const bad = [...parsedTo.invalid, ...parsedCc.invalid];
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

    startTransition(async () => {
      const result = await sendMessageAction({
        mailboxId,
        to: parsedTo.addresses,
        cc: parsedCc.addresses,
        bcc: [],
        subject,
        textBody: body,
        ...(draft.inReplyTo.length > 0 ? { inReplyTo: draft.inReplyTo } : {}),
        ...(draft.references.length > 0 ? { references: draft.references } : {}),
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
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(
        result.data?.redirected
          ? `Sent — delivered only to ${result.data.deliveredTo.join(", ")} (not production).`
          : "Sent.",
      );
      router.push(closeHref);
      router.refresh();
    });
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
          <Input
            id="mail-to"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="name@example.com, another@example.com"
            autoComplete="off"
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
        </div>

        {showCc && (
          <div className="flex items-center gap-2">
            <label htmlFor="mail-cc" className="w-12 shrink-0 text-xs text-muted-foreground">
              Cc
            </label>
            <Input
              id="mail-cc"
              value={cc}
              onChange={(e) => setCc(e.target.value)}
              autoComplete="off"
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

        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          // Tall enough to write in. A composer you have to scroll to see three
          // lines of is one people take to their phone instead.
          className="min-h-[18rem] font-sans"
          placeholder="Write your message…"
        />

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
        <Button onClick={send} disabled={busy} size="sm">
          {pending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Send className="size-4" />
          )}
          Send
        </Button>
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
