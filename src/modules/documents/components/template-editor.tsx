"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Loader2, Save, Send } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  extractMergeFields,
  injectValues,
  missingFields,
  type MdNode,
} from "../doc-templates/merge";
// From ./fields, never ./template-ops — that module is server-only.
import type { TemplateField } from "../doc-templates/fields";
import {
  publishTemplateAction,
  saveTemplateDraftAction,
} from "../template-actions";

/**
 * The remark plugin that does the merge.
 *
 * This is the same `injectValues` the server uses. react-markdown hands the
 * plugin an ALREADY-PARSED tree, so a value can only ever become the `value` of
 * a text node — it never passes through the Markdown parser, and a client
 * literally named `# ACME` renders as those five characters rather than a
 * heading. Never replace this with a string substitution on `body`.
 */
function remarkMerge(values: Record<string, string>) {
  return () => (tree: MdNode) => {
    injectValues(tree, values);
  };
}

export function TemplateEditor({
  templateId,
  templateName,
  initialBody,
  initialFields,
  publishedVersionNo,
  draftVersionNo,
}: {
  templateId: string;
  templateName: string;
  initialBody: string;
  initialFields: TemplateField[];
  /** Newest published version, or null when nothing is published yet. */
  publishedVersionNo: number | null;
  draftVersionNo: number | null;
}) {
  const router = useRouter();
  const [body, setBody] = useState(initialBody);
  const [labels, setLabels] = useState<Record<string, string>>(() =>
    Object.fromEntries(initialFields.map((f) => [f.name, f.label])),
  );
  const [required, setRequired] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(initialFields.map((f) => [f.name, f.required])),
  );
  const [sample, setSample] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  // Derived from the body on every keystroke — the same rule the server
  // enforces, so the designer can never show a field the document lacks.
  const fieldNames = useMemo(() => extractMergeFields(body), [body]);
  const stillMissing = useMemo(
    () => missingFields(body, sample),
    [body, sample],
  );
  const plugins = useMemo(
    () => [remarkGfm, remarkMerge(sample)],
    [sample],
  );

  function collectFields(): TemplateField[] {
    return fieldNames.map((name) => ({
      name,
      label: labels[name]?.trim() || name,
      required: required[name] ?? true,
    }));
  }

  function save(then?: () => void) {
    startTransition(async () => {
      const result = await saveTemplateDraftAction({
        templateId,
        body,
        fields: collectFields(),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`Saved as draft v${result.data?.versionNo}`);
      router.refresh();
      then?.();
    });
  }

  function publish() {
    startTransition(async () => {
      // Always save first: publishing what is on screen, not what was last
      // saved, is the only behaviour that matches the button's label.
      const saved = await saveTemplateDraftAction({
        templateId,
        body,
        fields: collectFields(),
      });
      if ("error" in saved) {
        toast.error(saved.error);
        return;
      }
      const result = await publishTemplateAction({ templateId });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`Published v${result.data?.versionNo}`);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            {templateName}
          </h1>
          {publishedVersionNo !== null && (
            <Badge variant="secondary">Published v{publishedVersionNo}</Badge>
          )}
          {draftVersionNo !== null && (
            <Badge variant="outline">Draft v{draftVersionNo}</Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" disabled={pending} onClick={() => save()}>
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            Save draft
          </Button>
          <Button disabled={pending} onClick={publish}>
            <Send className="size-4" />
            Publish
          </Button>
        </div>
      </div>

      {publishedVersionNo !== null && (
        <p className="rounded-md border bg-secondary/40 px-4 py-3 text-sm text-muted-foreground">
          v{publishedVersionNo} is published and can never change. Saving here
          keeps a separate draft; publishing it creates v
          {(draftVersionNo ?? publishedVersionNo + 1)}.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="template-body">
            Template — write in Markdown, and use{" "}
            <code className="text-xs">{"{{field_name}}"}</code> where a value
            goes
          </Label>
          <Textarea
            id="template-body"
            value={body}
            rows={20}
            className="font-mono text-sm"
            placeholder={"# Lien Waiver\n\nReceived from {{payer}} the sum of {{amount}}."}
            onChange={(e) => setBody(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label>Preview</Label>
          <div className="prose prose-sm dark:prose-invert max-w-none rounded-md border px-4 py-3">
            <ReactMarkdown remarkPlugins={plugins}>{body}</ReactMarkdown>
          </div>
          {stillMissing.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Unfilled fields show as{" "}
              <code className="text-xs">[name]</code> so a gap is never silent.
            </p>
          )}
        </div>
      </div>

      <div className="space-y-3">
        <h2 className="text-lg font-medium">Fields</h2>
        {fieldNames.length === 0 ? (
          <p className="rounded-md border px-4 py-6 text-center text-sm text-muted-foreground">
            No fields yet. Add <code className="text-xs">{"{{like_this}}"}</code>{" "}
            to the template and they appear here.
          </p>
        ) : (
          <div className="divide-y rounded-md border">
            {fieldNames.map((name) => (
              <div
                key={name}
                className="flex flex-wrap items-center gap-3 px-4 py-3"
              >
                <code className="w-40 shrink-0 text-xs">{`{{${name}}}`}</code>
                <Input
                  aria-label={`Label for ${name}`}
                  className="max-w-56"
                  placeholder="Label"
                  value={labels[name] ?? ""}
                  onChange={(e) =>
                    setLabels((p) => ({ ...p, [name]: e.target.value }))
                  }
                />
                <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={required[name] ?? true}
                    onChange={(e) =>
                      setRequired((p) => ({ ...p, [name]: e.target.checked }))
                    }
                  />
                  Required
                </label>
                <Input
                  aria-label={`Sample value for ${name}`}
                  className="ml-auto max-w-56"
                  placeholder="Sample value (preview only)"
                  value={sample[name] ?? ""}
                  onChange={(e) =>
                    setSample((p) => ({ ...p, [name]: e.target.value }))
                  }
                />
              </div>
            ))}
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Sample values are for the preview only — they are never saved with the
          template. Try typing <code className="text-xs"># ACME</code> into one:
          it stays text, because values are placed into the parsed document
          rather than into its source.
        </p>
      </div>
    </div>
  );
}
