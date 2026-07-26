"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { uploadPresigned } from "@vercel/blob/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  isAllowedUpload,
  MAX_FILE_BYTES,
} from "../allowlist";
import {
  moveDocumentsAction,
  registerDocumentUploadAction,
} from "../document-actions";
import { moveFolderAction } from "../actions";

/**
 * Drag and drop for the file browser.
 *
 * Three gestures, one vocabulary:
 *   - drag a FILE onto a folder      → file moves
 *   - drag a FOLDER onto a folder    → folder moves (owner only)
 *   - drop files from the DESKTOP    → upload into whatever you dropped on
 *
 * Everything routes through the same server actions the menus already use, so
 * drag-and-drop adds no new authority: RLS still refuses a staff member
 * dropping something into an owners-only folder, and the cycle check still
 * refuses a folder dropped inside itself.
 */

/** What an internal drag carries. Kept minimal — ids, never whole rows. */
interface DragPayload {
  kind: "document" | "folder";
  id: string;
  /** Folders only: needed to refuse a drop into the folder's own subtree. */
  path?: string;
  /** Folders only: the move action is a compare-and-set. */
  version?: number;
}

/**
 * A private MIME type, so the browser can tell OUR drags from a desktop file
 * drop before either has been dropped. `dragover` cannot read dataTransfer
 * contents for security reasons — only the type list — which is exactly why
 * the payload type has to be distinguishable by name alone.
 */
const INTERNAL = "application/x-yosher-doc";

function readPayload(dt: DataTransfer): DragPayload | null {
  const raw = dt.getData(INTERNAL);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as DragPayload;
    return parsed.kind && parsed.id ? parsed : null;
  } catch {
    return null;
  }
}

function hasExternalFiles(dt: DataTransfer): boolean {
  return Array.from(dt.types).includes("Files");
}

function hasInternalDrag(dt: DataTransfer): boolean {
  return Array.from(dt.types).includes(INTERNAL);
}

/** Shared upload loop, used by every drop target that accepts desktop files. */
async function uploadFiles(
  tenantId: string,
  folderId: string | null,
  files: File[],
): Promise<number> {
  let ok = 0;
  for (const file of files) {
    if (!isAllowedUpload(file.type, file.size)) {
      toast.error(
        `${file.name}: that type or size isn't accepted (up to ${Math.round(MAX_FILE_BYTES / 1024 / 1024)}MB)`,
      );
      continue;
    }
    try {
      // uploadPresigned, never upload — the store is private.
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
    } catch (err) {
      toast.error(
        `${file.name}: ${err instanceof Error ? err.message : "upload failed"}`,
      );
    }
  }
  return ok;
}

/** Make a row draggable. Wraps content; adds no layout of its own. */
export function DraggableRow({
  payload,
  disabled,
  children,
  className,
}: {
  payload: DragPayload;
  /** Folders are only draggable for owners — moving one is owner-only. */
  disabled?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const [dragging, setDragging] = useState(false);

  if (disabled) return <div className={className}>{children}</div>;

  return (
    <div
      draggable
      className={cn(className, dragging && "opacity-40")}
      onDragStart={(e) => {
        e.dataTransfer.setData(INTERNAL, JSON.stringify(payload));
        e.dataTransfer.effectAllowed = "move";
        setDragging(true);
      }}
      onDragEnd={() => setDragging(false)}
    >
      {children}
    </div>
  );
}

/**
 * A folder row that accepts drops: files and folders to move, desktop files to
 * upload into it.
 */
export function FolderDropTarget({
  tenantId,
  folderId,
  folderPath,
  children,
  className,
}: {
  tenantId: string;
  folderId: string;
  /** This folder's materialized path, to refuse a drop into its own subtree. */
  folderPath: string;
  children: ReactNode;
  className?: string;
}) {
  const router = useRouter();
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  // dragenter/dragleave fire for every child element, so a naive boolean
  // flickers as the pointer crosses the row's own contents. Counting depth is
  // the standard fix.
  const depth = useRef(0);

  const leave = useCallback(() => {
    depth.current -= 1;
    if (depth.current <= 0) {
      depth.current = 0;
      setOver(false);
    }
  }, []);

  async function onDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    depth.current = 0;
    setOver(false);

    const payload = readPayload(e.dataTransfer);
    if (payload) {
      if (payload.kind === "document") {
        setBusy(true);
        const result = await moveDocumentsAction({
          documentIds: [payload.id],
          folderId,
        });
        setBusy(false);
        if ("error" in result) return toast.error(result.error);
        toast.success("Moved");
        router.refresh();
        return;
      }

      if (payload.id === folderId) return;
      // The same rule the server enforces, applied here so an impossible move
      // is never even attempted.
      if (payload.path && folderPath.startsWith(payload.path)) {
        toast.error("A folder can't be moved inside itself.");
        return;
      }
      setBusy(true);
      const result = await moveFolderAction({
        folderId: payload.id,
        newParentId: folderId,
        expectedVersion: payload.version ?? 1,
      });
      setBusy(false);
      if ("error" in result) return toast.error(result.error);
      toast.success("Folder moved");
      router.refresh();
      return;
    }

    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length === 0) return;
    setBusy(true);
    const ok = await uploadFiles(tenantId, folderId, files);
    setBusy(false);
    if (ok > 0) {
      toast.success(ok === 1 ? "File uploaded" : `${ok} files uploaded`);
      router.refresh();
    }
  }

  return (
    <div
      className={cn(
        className,
        over && "bg-brand/10 ring-1 ring-brand ring-inset",
        busy && "opacity-60",
      )}
      onDragEnter={(e) => {
        if (!hasExternalFiles(e.dataTransfer) && !hasInternalDrag(e.dataTransfer))
          return;
        depth.current += 1;
        setOver(true);
      }}
      onDragOver={(e) => {
        if (!hasExternalFiles(e.dataTransfer) && !hasInternalDrag(e.dataTransfer))
          return;
        // Both preventDefault calls are required: without them the browser
        // navigates to the dropped file instead of firing onDrop.
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = hasInternalDrag(e.dataTransfer)
          ? "move"
          : "copy";
      }}
      onDragLeave={leave}
      onDrop={(e) => void onDrop(e)}
    >
      {children}
    </div>
  );
}

/**
 * The page-level catcher: desktop files dropped anywhere that is not a folder
 * row land in the folder currently being viewed.
 *
 * Deliberately does NOT accept internal drags — dropping a file onto the
 * background of the folder it already lives in should do nothing, not fire a
 * no-op move.
 */
export function UploadDropZone({
  tenantId,
  folderId,
  children,
}: {
  tenantId: string;
  folderId: string | null;
  children: ReactNode;
}) {
  const router = useRouter();
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const depth = useRef(0);

  async function onDrop(e: React.DragEvent) {
    if (!hasExternalFiles(e.dataTransfer)) return;
    e.preventDefault();
    depth.current = 0;
    setOver(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length === 0) return;
    setBusy(true);
    const ok = await uploadFiles(tenantId, folderId, files);
    setBusy(false);
    if (ok > 0) {
      toast.success(ok === 1 ? "File uploaded" : `${ok} files uploaded`);
      router.refresh();
    }
  }

  return (
    <div
      className="relative"
      onDragEnter={(e) => {
        if (!hasExternalFiles(e.dataTransfer)) return;
        depth.current += 1;
        setOver(true);
      }}
      onDragOver={(e) => {
        if (!hasExternalFiles(e.dataTransfer)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={() => {
        depth.current -= 1;
        if (depth.current <= 0) {
          depth.current = 0;
          setOver(false);
        }
      }}
      onDrop={(e) => void onDrop(e)}
    >
      {children}
      {(over || busy) && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-md border-2 border-dashed border-brand bg-background/80">
          <p className="text-sm font-medium">
            {busy ? "Uploading…" : "Drop to upload here"}
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * A breadcrumb crumb that accepts a drop, so dragging something UP a level is
 * possible at all — otherwise the only direction you can drag is deeper.
 */
export function BreadcrumbDropTarget({
  folderId,
  children,
}: {
  /** Null means the root. */
  folderId: string | null;
  children: ReactNode;
}) {
  const router = useRouter();
  const [over, setOver] = useState(false);

  async function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setOver(false);
    const payload = readPayload(e.dataTransfer);
    if (!payload) return;

    if (payload.kind === "document") {
      const result = await moveDocumentsAction({
        documentIds: [payload.id],
        folderId,
      });
      if ("error" in result) return toast.error(result.error);
      toast.success("Moved");
      router.refresh();
      return;
    }
    if (payload.id === folderId) return;
    const result = await moveFolderAction({
      folderId: payload.id,
      newParentId: folderId,
      expectedVersion: payload.version ?? 1,
    });
    if ("error" in result) return toast.error(result.error);
    toast.success("Folder moved");
    router.refresh();
  }

  return (
    <span
      className={cn(
        "rounded px-1",
        over && "bg-brand/15 ring-1 ring-brand",
      )}
      onDragEnter={(e) => {
        if (hasInternalDrag(e.dataTransfer)) setOver(true);
      }}
      onDragOver={(e) => {
        if (!hasInternalDrag(e.dataTransfer)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => void onDrop(e)}
    >
      {children}
    </span>
  );
}
