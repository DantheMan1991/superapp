"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, Plus } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { archiveTemplateAction, createTemplateAction } from "../template-actions";
// From ./fields, never ./template-ops — that module is server-only.
import { TEMPLATE_NAME_MAX } from "../doc-templates/fields";

export function NewTemplateButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [pending, startTransition] = useTransition();

  function create() {
    startTransition(async () => {
      const result = await createTemplateAction({
        name,
        description,
        docKind: "",
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setOpen(false);
      setName("");
      setDescription("");
      // Straight into the editor — a template with no body is not useful yet.
      router.push(
        `/dashboard/m/documents/templates/${result.data?.templateId}`,
      );
    });
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        New template
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New template</DialogTitle>
            <DialogDescription>
              Name it after the document it produces — &ldquo;Lien
              Waiver&rdquo;, &ldquo;Change Order&rdquo;.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="tpl-name">Name</Label>
              <Input
                id="tpl-name"
                value={name}
                maxLength={TEMPLATE_NAME_MAX}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tpl-desc">
                Description <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Textarea
                id="tpl-desc"
                value={description}
                rows={2}
                maxLength={2000}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={pending || name.trim().length === 0}
              onClick={create}
            >
              {pending && <Loader2 className="size-4 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Archive, never delete: a generated document names the template it came from,
 * and a missing template turns that into a dangling reference nobody can
 * explain a year later.
 */
export function ArchiveTemplateButton({
  templateId,
  version,
  archived,
}: {
  templateId: string;
  version: number;
  archived: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await archiveTemplateAction({
            templateId,
            expectedVersion: version,
            archived: !archived,
          });
          if ("error" in result) {
            toast.error(result.error);
            return;
          }
          toast.success(archived ? "Template restored" : "Template archived");
          router.refresh();
        })
      }
    >
      {pending && <Loader2 className="size-4 animate-spin" />}
      {archived ? "Restore" : "Archive"}
    </Button>
  );
}
