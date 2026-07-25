"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { upload as uploadPresigned } from "@vercel/blob/client";
import { FolderInput, Loader2, MoreHorizontal, Trash2, Upload } from "lucide-react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  isAllowedUpload,
  MAX_FILE_BYTES,
  UPLOAD_ACCEPT_ATTR,
} from "../allowlist";
import {
  moveDocumentsAction,
  registerDocumentUploadAction,
  restoreDocumentsAction,
  trashDocumentsAction,
} from "../document-actions";

export interface FolderChoice {
  id: string;
  label: string;
}

/**
 * Two-phase upload: the file goes client-direct to private blob storage using
 * a short-lived presigned token, then a server action registers it. The action
 * re-reads the blob's real metadata and hashes the actual bytes — nothing the
 * client asserts about the file is trusted.
 */
export function UploadButton({
  tenantId,
  folderId,
}: {
  tenantId: string;
  folderId: string | null;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    let ok = 0;
    try {
      for (const file of Array.from(files)) {
        // A courtesy check that saves a round trip; the server re-checks.
        if (!isAllowedUpload(file.type, file.size)) {
          toast.error(
            `${file.name}: that type or size isn't accepted (up to ${Math.round(MAX_FILE_BYTES / 1024 / 1024)}MB)`,
          );
          continue;
        }
        const blob = await uploadPresigned(
          `docs/${tenantId}/files/${file.name}`,
          file,
          { access: "private", handleUploadUrl: "/api/documents/blob/upload" },
        );
        const result = await registerDocumentUploadAction({
          pathname: blob.pathname,
          folderId,
          title: "",
          description: "",
        });
        if ("error" in result) {
          toast.error(`${file.name}: ${result.error}`);
          continue;
        }
        if (result.data?.duplicateOfId) {
          toast.warning(`${file.name} looks like a file you already have`);
        }
        ok += 1;
      }
      if (ok > 0) {
        toast.success(ok === 1 ? "File uploaded" : `${ok} files uploaded`);
        router.refresh();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={UPLOAD_ACCEPT_ATTR}
        className="hidden"
        onChange={(e) => void onFiles(e.target.files)}
      />
      <Button
        variant="outline"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Upload className="size-4" />
        )}
        Upload
      </Button>
    </>
  );
}

export function DocumentRowMenu({
  documentId,
  folders,
  trashed,
}: {
  documentId: string;
  folders: FolderChoice[];
  trashed?: boolean;
}) {
  const router = useRouter();
  const [filing, setFiling] = useState(false);
  const [target, setTarget] = useState("__inbox__");
  const [pending, startTransition] = useTransition();

  function run(
    fn: () => Promise<{ ok: true; data?: unknown } | { error: string }>,
    msg: string,
  ) {
    startTransition(async () => {
      const result = await fn();
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(msg);
      setFiling(false);
      router.refresh();
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="File actions">
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {trashed ? (
            <DropdownMenuItem
              onSelect={() =>
                run(
                  () => restoreDocumentsAction({ documentIds: [documentId] }),
                  "File restored",
                )
              }
            >
              Restore
            </DropdownMenuItem>
          ) : (
            <>
              <DropdownMenuItem onSelect={() => setFiling(true)}>
                <FolderInput className="size-4" />
                File into…
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onSelect={() =>
                  run(
                    () => trashDocumentsAction({ documentIds: [documentId] }),
                    "Moved to trash",
                  )
                }
              >
                <Trash2 className="size-4" />
                Move to trash
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={filing} onOpenChange={setFiling}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>File this document</DialogTitle>
            <DialogDescription>
              Filing into an owners-only folder hides the file from staff.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Folder</Label>
            <Select value={target} onValueChange={setTarget}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__inbox__">Inbox (unfiled)</SelectItem>
                {folders.map((folder) => (
                  <SelectItem key={folder.id} value={folder.id}>
                    {folder.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFiling(false)}>
              Cancel
            </Button>
            <Button
              disabled={pending}
              onClick={() =>
                run(
                  () =>
                    moveDocumentsAction({
                      documentIds: [documentId],
                      folderId: target === "__inbox__" ? null : target,
                    }),
                  "Filed",
                )
              }
            >
              {pending && <Loader2 className="size-4 animate-spin" />}
              File
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
