"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { FileDown, Loader2 } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { TemplateField } from "../doc-templates/fields";
import { generateDocumentAction } from "../template-actions";
import type { FolderChoice } from "./document-controls";

/**
 * Fill in a published template and file the PDF.
 *
 * Only offered when something is published: generation always uses the newest
 * PUBLISHED version, never the draft, so a half-written waiver cannot leave the
 * building. The button is absent rather than disabled-with-an-explanation when
 * there is nothing to generate from.
 */
export function GenerateButton({
  templateId,
  templateName,
  publishedVersionNo,
  fields,
  folders,
}: {
  templateId: string;
  templateName: string;
  publishedVersionNo: number | null;
  fields: TemplateField[];
  folders: FolderChoice[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [folderId, setFolderId] = useState("__inbox__");
  const [title, setTitle] = useState("");
  const [pending, startTransition] = useTransition();

  if (publishedVersionNo === null) return null;

  const missing = fields
    .filter((f) => f.required)
    .filter((f) => (values[f.name] ?? "").trim().length === 0);

  function generate() {
    startTransition(async () => {
      const result = await generateDocumentAction({
        templateId,
        values,
        folderId: folderId === "__inbox__" ? null : folderId,
        title,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`Created #${result.data?.number}`);
      setOpen(false);
      setValues({});
      setTitle("");
      router.refresh();
    });
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <FileDown className="size-4" />
        Make a document
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{templateName}</DialogTitle>
            <DialogDescription>
              Uses the published v{publishedVersionNo}. The PDF is filed in your
              cabinet and can be shared or emailed like any other file.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {fields.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                This template has no fields — it will generate as written.
              </p>
            ) : (
              fields.map((field) => (
                <div key={field.name} className="space-y-2">
                  <Label htmlFor={`gen-${field.name}`}>
                    {field.label}
                    {!field.required && (
                      <span className="ml-1 text-muted-foreground">
                        (optional)
                      </span>
                    )}
                  </Label>
                  <Input
                    id={`gen-${field.name}`}
                    value={values[field.name] ?? ""}
                    maxLength={2000}
                    onChange={(e) =>
                      setValues((p) => ({ ...p, [field.name]: e.target.value }))
                    }
                  />
                </div>
              ))
            )}

            <div className="space-y-2 border-t pt-4">
              <Label htmlFor="gen-title">
                Title <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="gen-title"
                value={title}
                maxLength={200}
                placeholder={`${templateName} …`}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>File it into</Label>
              <Select value={folderId} onValueChange={setFolderId}>
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
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={pending || missing.length > 0} onClick={generate}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {missing.length > 0
                ? `${missing.length} field${missing.length === 1 ? "" : "s"} to fill`
                : "Make the PDF"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
