"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { upload as uploadPresigned } from "@vercel/blob/client";
import { Download, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  addDocumentVersionAction,
  listDocumentVersionsAction,
  restoreDocumentVersionAction,
} from "../document-actions";
import type { VersionEntry } from "../versions";
import {
  isAllowedUpload,
  MAX_FILE_BYTES,
  UPLOAD_ACCEPT_ATTR,
} from "../allowlist";
import { formatBytes } from "../lib/format";

/**
 * Replace a file, keeping the old one.
 *
 * The note is offered but never required — a crew member emailing back a
 * marked-up drawing will not write one, and demanding a changelog is how a
 * version history stops being used.
 */
export function NewVersionDialog({
  open,
  onOpenChange,
  tenantId,
  documentId,
  fileName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantId: string;
  documentId: string;
  fileName: string;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  function reset() {
    setFile(null);
    setNote("");
    if (inputRef.current) inputRef.current.value = "";
  }

  async function submit() {
    if (!file) return;
    // A courtesy check that saves a round trip; the server re-reads the blob's
    // real type and size and re-applies the same allowlist.
    if (!isAllowedUpload(file.type, file.size)) {
      toast.error(
        `That type or size isn't accepted (up to ${Math.round(MAX_FILE_BYTES / 1024 / 1024)}MB)`,
      );
      return;
    }
    setBusy(true);
    try {
      const blob = await uploadPresigned(
        `docs/${tenantId}/files/${file.name}`,
        file,
        { access: "private", handleUploadUrl: "/api/documents/blob/upload" },
      );
      const result = await addDocumentVersionAction({
        documentId,
        pathname: blob.pathname,
        note,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      if (result.data?.sameAsCurrent) {
        toast.warning(
          `Saved as v${result.data.versionNo}, but it's identical to the version it replaced`,
        );
      } else {
        toast.success(`Saved as v${result.data?.versionNo}`);
      }
      reset();
      onOpenChange(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload a new version</DialogTitle>
          <DialogDescription>
            This becomes the file everyone opens. The current version is kept in
            the history — nothing is overwritten, and any share links you have
            already sent will show the new version.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={`file-${documentId}`}>
              Replacing <span className="font-normal">{fileName}</span>
            </Label>
            <input
              ref={inputRef}
              id={`file-${documentId}`}
              type="file"
              accept={UPLOAD_ACCEPT_ATTR}
              className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`note-${documentId}`}>
              What changed? <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id={`note-${documentId}`}
              value={note}
              maxLength={500}
              rows={2}
              placeholder="Revised after the site walk"
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={busy || !file} onClick={() => void submit()}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            Upload version
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The history panel. Loaded when the dialog opens rather than with the folder
 * listing, so browsing a folder never pays for history nobody asked to see.
 */
export function VersionHistoryDialog({
  open,
  onOpenChange,
  documentId,
  title,
  canRestore,
}: {
  /** Mount this component only while open — it fetches on mount. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentId: string;
  title: string;
  /** False for the accountant role, which may read history but not rewrite it. */
  canRestore: boolean;
}) {
  const router = useRouter();
  const [versions, setVersions] = useState<VersionEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function apply(
    result: Awaited<ReturnType<typeof listDocumentVersionsAction>>,
  ) {
    if ("error" in result) {
      setError(result.error);
      setVersions([]);
      return;
    }
    setError(null);
    setVersions(result.data?.versions ?? []);
  }

  // The caller mounts this component only while the dialog is open, so this
  // runs once per opening and there is never a stale list to clear.
  useEffect(() => {
    void (async () => {
      apply(await listDocumentVersionsAction({ documentId }));
    })();
  }, [documentId]);

  function restore(versionId: string, versionNo: number) {
    startTransition(async () => {
      const result = await restoreDocumentVersionAction({
        documentId,
        versionId,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`v${versionNo} restored as v${result.data?.versionNo}`);
      apply(await listDocumentVersionsAction({ documentId }));
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Version history</DialogTitle>
          <DialogDescription>{title}</DialogDescription>
        </DialogHeader>

        {versions === null ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
          </div>
        ) : error ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {error}
          </p>
        ) : (
          <div className="max-h-[22rem] divide-y overflow-y-auto rounded-md border">
            {versions.map((v) => (
              <div key={v.id ?? "current"} className="flex items-start gap-3 px-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">v{v.versionNo}</span>
                    {v.isCurrent && <Badge variant="secondary">Current</Badge>}
                    {v.restoredFromVersionNo !== null && (
                      <Badge variant="outline">
                        Restored from v{v.restoredFromVersionNo}
                      </Badge>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {v.fileName} · {formatBytes(v.sizeBytes)} ·{" "}
                    {v.createdAt.toLocaleDateString()}
                  </p>
                  {v.note && <p className="mt-1 text-xs">{v.note}</p>}
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    asChild
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Download v${v.versionNo}`}
                  >
                    {/* A null id means there is no history row yet, so the
                        document's own URL already serves these bytes. */}
                    <a
                      href={`/api/documents/${documentId}/file?download=1${v.id ? `&v=${v.id}` : ""}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Download className="size-4" />
                    </a>
                  </Button>
                  {canRestore && v.id && !v.isCurrent && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Restore v${v.versionNo}`}
                      disabled={pending}
                      onClick={() => restore(v.id!, v.versionNo)}
                    >
                      <RotateCcw className="size-4" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {versions !== null && versions.length === 1 && !error && (
          <p className="text-xs text-muted-foreground">
            This file has not been replaced yet. Upload a new version and the
            current one is kept here.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
