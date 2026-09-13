"use client";

import { useRef, useState } from "react";
import { uploadPresigned } from "@vercel/blob/client";
import { ImagePlus, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  ATTACHMENT_ACCEPT_ATTR,
  formatBytes,
  isAllowedAttachment,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_MESSAGE,
} from "@/lib/feedback/attachments";
import { cn } from "@/lib/utils";

/**
 * "Show me what you saw" — the picker on a feedback report and on a reply.
 *
 * ── IT UPLOADS ON PICK, NOT ON SUBMIT ────────────────────────────────────────
 *
 * `uploadPresigned`, NOT `upload`: the blob store is PRIVATE and refuses the
 * classic client flow. The bytes go straight from the browser to the store, so
 * a 4MB server-action body never has to carry a screenshot, and the form
 * submits pathnames.
 *
 * Uploading as soon as a file is chosen means the wait happens while somebody
 * is still typing their sentence, rather than after they press Send — and it
 * means a rejected file is refused next to the picker instead of taking the
 * whole report down with it.
 *
 * ── WHAT ORPHANS COST, AND WHY THAT IS THE RIGHT TRADE ───────────────────────
 *
 * A file uploaded and then abandoned — the sheet closed, the tab shut — leaves
 * a blob with no row. Nothing collects it today. The alternative is uploading
 * on submit, which puts the whole wait after the button and makes a failed
 * upload fail the report; for a store that will hold a handful of screenshots
 * a week, an occasional orphan is cheaper than that. Recorded as an open item
 * in the dossier rather than pretended away.
 *
 * ── ON A PHONE ───────────────────────────────────────────────────────────────
 *
 * A plain file input with `accept` is what opens the camera AND the camera roll
 * on both iOS and Android, inside the Capacitor shell as well as a browser. No
 * native bridge, nothing to add to the app — the web decides, as ADR 0032 says
 * it should.
 */

export interface PickedFile {
  pathname: string;
  name: string;
  size: number;
  type: string;
}

export function AttachmentPicker({
  tenantId,
  files,
  onChange,
  disabled,
  className,
}: {
  /** The namespace to upload into. Re-checked server-side at both ends. */
  tenantId: string;
  files: PickedFile[];
  onChange: (files: PickedFile[]) => void;
  disabled?: boolean;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const room = MAX_ATTACHMENTS_PER_MESSAGE - files.length;

  async function onFiles(chosen: FileList | null) {
    if (!chosen || chosen.length === 0) return;
    const list = Array.from(chosen).slice(0, room);
    if (chosen.length > room) {
      toast.error(
        `Up to ${MAX_ATTACHMENTS_PER_MESSAGE} files. The rest were left out.`,
      );
    }
    setBusy(true);
    const added: PickedFile[] = [];
    try {
      for (const file of list) {
        // A courtesy check that saves a round trip. The upload door binds the
        // real one when it mints the token, and the server re-reads the stored
        // blob afterwards — nothing here is trusted.
        if (!isAllowedAttachment(file.type, file.size)) {
          toast.error(
            `${file.name}: pictures or a PDF, up to ${Math.round(
              MAX_ATTACHMENT_BYTES / 1024 / 1024,
            )}MB`,
          );
          continue;
        }
        const blob = await uploadPresigned(
          `feedback/${tenantId}/${file.name}`,
          file,
          { access: "private", handleUploadUrl: "/api/feedback/blob/upload" },
        );
        added.push({
          pathname: blob.pathname,
          name: file.name,
          size: file.size,
          type: file.type,
        });
      }
      if (added.length > 0) onChange([...files, ...added]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "That file did not upload.");
    } finally {
      setBusy(false);
      // Without this, choosing the same file twice in a row fires no change
      // event the second time and looks broken.
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className={cn("space-y-2", className)}>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ATTACHMENT_ACCEPT_ATTR}
        className="hidden"
        onChange={(event) => void onFiles(event.target.files)}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || busy || room <= 0}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? <Loader2 className="animate-spin" /> : <ImagePlus />}
        {files.length === 0 ? "Add a screenshot" : "Add another"}
      </Button>

      {files.length > 0 && (
        <ul className="space-y-1">
          {files.map((file) => (
            <li
              key={file.pathname}
              className="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-xs"
            >
              <span className="min-w-0 flex-1 truncate" title={file.name}>
                {file.name}
              </span>
              <span className="shrink-0 text-muted-foreground">
                {formatBytes(file.size)}
              </span>
              <button
                type="button"
                aria-label={`Remove ${file.name}`}
                className="shrink-0 text-muted-foreground hover:text-foreground"
                onClick={() =>
                  onChange(files.filter((f) => f.pathname !== file.pathname))
                }
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
