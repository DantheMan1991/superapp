"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  Copy,
  FolderPlus,
  Link2,
  Loader2,
  Lock,
  Mail,
  MoreHorizontal,
  Pencil,
  Trash2,
  Unlock,
} from "lucide-react";
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  createFolderAction,
  deleteFolderAction,
  disableFolderInboundAction,
  enableFolderInboundAction,
  moveFolderAction,
  renameFolderAction,
  setFolderVisibilityAction,
} from "@/modules/documents/actions";
import { ShareDialog } from "@/modules/documents/components/share-controls";

/**
 * Client controls for the folder browser. Server components fetch and lay
 * out; everything interactive lives here, per the house split.
 */

export interface FolderOption {
  id: string;
  label: string;
}

export interface FolderRow {
  id: string;
  name: string;
  version: number;
  visibility: string;
  effectiveVisibility: string;
  /** Restricted by an ancestor rather than by this folder itself. */
  inherited: boolean;
  /** The folder's own email address, when one has been switched on. */
  inboundAddress: string | null;
}

export function NewFolderButton({
  parentId,
  isOwner,
}: {
  parentId: string | null;
  isOwner: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [ownersOnly, setOwnersOnly] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit() {
    if (name.trim().length === 0) {
      toast.error("Give the folder a name");
      return;
    }
    startTransition(async () => {
      const result = await createFolderAction({
        parentId,
        name,
        visibility: ownersOnly ? "owners" : "members",
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Folder created");
      setOpen(false);
      setName("");
      setOwnersOnly(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <FolderPlus className="size-4" />
        New folder
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New folder</DialogTitle>
            <DialogDescription>
              Folders can be nested up to ten levels deep.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="folder-name">Name</Label>
              <Input
                id="folder-name"
                value={name}
                maxLength={120}
                onChange={(e) => setName(e.target.value)}
                placeholder="Job photos"
                autoFocus
              />
            </div>
            {isOwner && (
              <div className="flex items-start justify-between gap-4 rounded-md border p-3">
                <div className="space-y-1">
                  <Label htmlFor="folder-private">Owners only</Label>
                  <p className="text-xs text-muted-foreground">
                    Hidden from staff, including everything filed inside it.
                  </p>
                </div>
                <Switch
                  id="folder-private"
                  checked={ownersOnly}
                  onCheckedChange={setOwnersOnly}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function FolderRowMenu({
  folder,
  isOwner,
  moveTargets,
  shareMaxTtlDays,
}: {
  folder: FolderRow;
  isOwner: boolean;
  moveTargets: FolderOption[];
  shareMaxTtlDays?: number;
}) {
  const router = useRouter();
  const [renaming, setRenaming] = useState(false);
  const [moving, setMoving] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [mailbox, setMailbox] = useState(false);
  const [address, setAddress] = useState<string | null>(folder.inboundAddress);
  const [deleting, setDeleting] = useState(false);
  const [name, setName] = useState(folder.name);
  const [target, setTarget] = useState<string>("__root__");
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<{ ok: true } | { error: string }>, msg: string) {
    startTransition(async () => {
      const result = await fn();
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(msg);
      setRenaming(false);
      setMoving(false);
      setDeleting(false);
      router.refresh();
    });
  }

  const restrictedHere = folder.visibility === "owners";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Folder actions">
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setRenaming(true)}>
            <Pencil className="size-4" />
            Rename
          </DropdownMenuItem>
          {/* Owners-only folders are refused server-side; hiding the option
              here keeps people from discovering that by failing. */}
          {shareMaxTtlDays !== undefined &&
            folder.effectiveVisibility !== "owners" && (
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  setSharing(true);
                }}
              >
                <Link2 className="size-4" />
                Share link…
              </DropdownMenuItem>
            )}
          {isOwner && (
            <>
              <DropdownMenuItem onSelect={() => setMoving(true)}>
                Move to…
              </DropdownMenuItem>
              {/* Owners-only folders are refused server-side; not offering it
                  keeps people from discovering that by failing. */}
              {folder.effectiveVisibility !== "owners" && (
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    setMailbox(true);
                  }}
                >
                  <Mail className="size-4" />
                  Email files here…
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onSelect={() =>
                  run(
                    () =>
                      setFolderVisibilityAction({
                        folderId: folder.id,
                        visibility: restrictedHere ? "members" : "owners",
                        expectedVersion: folder.version,
                      }),
                    restrictedHere
                      ? "Folder is visible to everyone"
                      : "Folder is owners only",
                  )
                }
              >
                {restrictedHere ? (
                  <>
                    <Unlock className="size-4" />
                    Make visible to everyone
                  </>
                ) : (
                  <>
                    <Lock className="size-4" />
                    Make owners only
                  </>
                )}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => setDeleting(true)}
              >
                <Trash2 className="size-4" />
                Delete
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {shareMaxTtlDays !== undefined && (
        <ShareDialog
          open={sharing}
          onOpenChange={setSharing}
          scope="folder"
          targetId={folder.id}
          targetName={folder.name}
          maxTtlDays={shareMaxTtlDays}
        />
      )}

      <Dialog open={mailbox} onOpenChange={setMailbox}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Email files into “{folder.name}”</DialogTitle>
            <DialogDescription>
              Give this address to a subcontractor or supplier and anything they
              attach lands straight in this folder. Nobody needs a login.
            </DialogDescription>
          </DialogHeader>

          {address === null ? (
            <p className="text-sm text-muted-foreground">
              No address yet. Anyone who has the address can put files in this
              folder, so only share it with people who should be able to.
            </p>
          ) : (
            <div className="space-y-2">
              <Label>Address</Label>
              <div className="flex items-center gap-2">
                <Input readOnly value={address} className="font-mono text-xs" />
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Copy address"
                  onClick={() => {
                    void navigator.clipboard.writeText(address);
                    toast.success("Address copied");
                  }}
                >
                  <Copy className="size-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Turning this off stops delivery immediately. Switching it on
                again issues a different address — the old one stops working.
              </p>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setMailbox(false)}>
              Close
            </Button>
            {address === null ? (
              <Button
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const result = await enableFolderInboundAction({
                      folderId: folder.id,
                    });
                    if ("error" in result) {
                      toast.error(result.error);
                      return;
                    }
                    setAddress(result.data?.address ?? null);
                    toast.success("Address created");
                    router.refresh();
                  })
                }
              >
                {pending && <Loader2 className="size-4 animate-spin" />}
                Create address
              </Button>
            ) : (
              <Button
                variant="destructive"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const result = await disableFolderInboundAction({
                      folderId: folder.id,
                    });
                    if ("error" in result) {
                      toast.error(result.error);
                      return;
                    }
                    setAddress(null);
                    toast.success("Address turned off");
                    router.refresh();
                  })
                }
              >
                {pending && <Loader2 className="size-4 animate-spin" />}
                Turn off
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={renaming} onOpenChange={setRenaming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename folder</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor={`rename-${folder.id}`}>Name</Label>
            <Input
              id={`rename-${folder.id}`}
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenaming(false)}>
              Cancel
            </Button>
            <Button
              disabled={pending}
              onClick={() =>
                run(
                  () =>
                    renameFolderAction({
                      folderId: folder.id,
                      name,
                      expectedVersion: folder.version,
                    }),
                  "Folder renamed",
                )
              }
            >
              {pending && <Loader2 className="size-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={moving} onOpenChange={setMoving}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move folder</DialogTitle>
            <DialogDescription>
              Everything inside moves with it.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>New location</Label>
            <Select value={target} onValueChange={setTarget}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__root__">Top level</SelectItem>
                {moveTargets.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoving(false)}>
              Cancel
            </Button>
            <Button
              disabled={pending}
              onClick={() =>
                run(
                  () =>
                    moveFolderAction({
                      folderId: folder.id,
                      newParentId: target === "__root__" ? null : target,
                      expectedVersion: folder.version,
                    }),
                  "Folder moved",
                )
              }
            >
              {pending && <Loader2 className="size-4 animate-spin" />}
              Move
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleting} onOpenChange={setDeleting}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete “{folder.name}”?</DialogTitle>
            <DialogDescription>
              Anything inside moves up one level rather than being deleted —
              files are never destroyed here.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() =>
                run(
                  () =>
                    deleteFolderAction({
                      folderId: folder.id,
                      expectedVersion: folder.version,
                      strategy: "move_to_parent",
                    }),
                  "Folder deleted",
                )
              }
            >
              {pending && <Loader2 className="size-4 animate-spin" />}
              Delete folder
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
