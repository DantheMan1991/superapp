"use client";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { uploadPresigned } from "@vercel/blob/client";
import { ImageUp, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  BRAND_LOGO_MAX_BYTES,
  isBrandLogoMimeType,
} from "@/lib/brand/core";
import { removeBrandLogoAction, setBrandLogoAction } from "../actions";

interface LogoView {
  src: string;
  width: number;
  height: number;
  mimeType: string;
}

/**
 * The logo half of a kit: what is there now, and the two things an owner can
 * do about it. Same upload shape as Documents' record photos — presigned
 * upload straight to the store, then one action that registers the pathname —
 * against this module's own token route, so the Documents gate is never the
 * thing that lets a logo in.
 */
export function LogoControls({
  tenantId,
  entityId,
  logo,
  canWrite,
}: {
  tenantId: string;
  entityId: string | null;
  logo: LogoView | null;
  canWrite: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();

  async function onPick(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    // The same checks the server applies, done first so a wrong file is
    // refused before a byte is uploaded. The server re-checks the real bytes.
    if (!isBrandLogoMimeType(file.type)) {
      toast.error("Choose a PNG or JPEG image.");
      return;
    }
    if (file.size > BRAND_LOGO_MAX_BYTES) {
      toast.error("That file is over 2MB. Export the logo smaller and try again.");
      return;
    }
    setBusy(true);
    try {
      const blob = await uploadPresigned(
        `brand/${tenantId}/logos/${file.name}`,
        file,
        { access: "private", handleUploadUrl: "/api/marketing/brand/upload" },
      );
      const result = await setBrandLogoAction({ entityId, pathname: blob.pathname });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Logo updated.");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function onRemove() {
    if (!window.confirm("Remove the logo? Documents go back to the name on its own.")) return;
    startTransition(async () => {
      const result = await removeBrandLogoAction({ entityId });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Logo removed.");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-4">
        {logo ? (
          // Sized from the stored dimensions so the box is right before the
          // bytes arrive. Our own signed-in route; see brand-kit-panel.tsx.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logo.src}
            alt="Logo"
            width={logo.width}
            height={logo.height}
            className="max-h-16 w-auto max-w-48 rounded-md bg-white object-contain p-1 ring-1 ring-foreground/10"
          />
        ) : (
          <div className="flex h-16 w-32 items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground">
            No logo yet
          </div>
        )}
        <div className="text-sm">
          <div className="font-medium">Logo</div>
          <div className="text-xs text-muted-foreground">
            {logo
              ? `${logo.width} × ${logo.height} ${logo.mimeType === "image/png" ? "PNG" : "JPEG"}`
              : "PNG or JPEG, up to 2MB. A wide logo suits the top of an invoice best."}
          </div>
        </div>
      </div>
      {canWrite && (
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg"
            className="hidden"
            onChange={(e) => void onPick(e.target.files)}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={busy || pending}
            onClick={() => inputRef.current?.click()}
          >
            <ImageUp className="size-4" />
            {busy ? "Uploading…" : logo ? "Replace logo" : "Upload logo"}
          </Button>
          {logo && (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy || pending}
              onClick={onRemove}
            >
              <Trash2 className="size-4" />
              Remove
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
