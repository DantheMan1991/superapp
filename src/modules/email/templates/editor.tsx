"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Loader2, Plus, Save, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  RichTextEditor,
  type RichTextEditorHandle,
} from "../components/rich-text-editor";
import { deleteTemplateAction, saveTemplateAction } from "./actions";
import { MAX_TEMPLATE_NAME, MAX_TEMPLATE_SUBJECT } from "./validate";

export interface EditorTemplate {
  id: string;
  name: string;
  subject: string;
  bodyHtml: string;
}

/**
 * Managing canned responses, in the reading pane.
 *
 * Same shape as the rules editor and the signature form: it takes the pane
 * rather than floating over it, so the inbox stays visible behind the decision.
 *
 * IT IS THE COMPOSER'S OWN EDITOR, for the reason the signature slice recorded:
 * a template written in a different control from the one it appears in is how a
 * template ends up looking wrong only in real messages. The picture button is
 * absent because `accountId`/`mailboxId` are not passed — a `cid:` is minted
 * per message, so an image stored in a template would break on every mail it
 * was later inserted into.
 *
 * A list and ONE editor rather than an editable list. Templates are edited
 * rarely and read often, and a pane full of open rich-text editors is both slow
 * and a place to lose track of which one is being saved.
 */
export function TemplatesEditor({
  templates,
  closeHref,
}: {
  templates: EditorTemplate[];
  closeHref: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<EditorTemplate | null>(null);
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const editor = useRef<RichTextEditorHandle | null>(null);
  /**
   * Remounts the editor when a different template is opened.
   *
   * `initialHtml` is applied ONCE on mount by design — React must never
   * re-render a contenteditable's children or it fights the browser for the
   * caret — so switching templates means giving the editor a new identity.
   */
  const [instance, setInstance] = useState(0);

  function open(template: EditorTemplate | null) {
    setEditing(template ?? { id: "", name: "", subject: "", bodyHtml: "" });
    setName(template?.name ?? "");
    setSubject(template?.subject ?? "");
    setInstance((n) => n + 1);
  }

  function save() {
    if (!editing) return;
    const html = editor.current?.html() ?? "";
    startTransition(async () => {
      const result = await saveTemplateAction({
        ...(editing.id ? { id: editing.id } : {}),
        name,
        subject,
        html,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Template saved.");
      setEditing(null);
      router.refresh();
    });
  }

  function remove(template: EditorTemplate) {
    startTransition(async () => {
      const result = await deleteTemplateAction({ id: template.id });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`Deleted "${template.name}".`);
      if (editing?.id === template.id) setEditing(null);
      router.refresh();
    });
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-2.5">
        <span className="text-sm font-medium">Templates</span>
        <Link
          href={closeHref}
          className="ml-auto text-sm text-muted-foreground hover:text-foreground"
        >
          Close
        </Link>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-4">
        {/* Said once, at the top, because it is the thing most likely to
            surprise: unlike rules, the signature and the auto-reply, a template
            belongs to the BUSINESS rather than to the person editing it. */}
        <p className="flex gap-2.5 rounded-md border px-3 py-2.5 text-xs text-muted-foreground">
          <Users className="mt-0.5 size-4 shrink-0" />
          <span>
            Templates are shared with everyone in the business, so a reply
            somebody writes once can be used by all of you. They are stored in
            Yosher rather than on the mail server, which means they do not
            appear on your phone or in Outlook.
          </span>
        </p>

        {!editing && (
          <>
            {templates.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No templates yet. Save the reply you find yourself writing over
                and over.
              </p>
            ) : (
              <ul className="divide-y rounded-md border">
                {templates.map((template) => (
                  <li
                    key={template.id}
                    className="flex items-center gap-2 px-3 py-2"
                  >
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => open(template)}
                    >
                      <span className="block truncate text-sm font-medium">
                        {template.name}
                      </span>
                      {template.subject && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {template.subject}
                        </span>
                      )}
                    </button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      aria-label={`Delete ${template.name}`}
                      onClick={() => remove(template)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <Button size="sm" disabled={pending} onClick={() => open(null)}>
              <Plus className="size-4" />
              New template
            </Button>
          </>
        )}

        {editing && (
          <>
            <div className="space-y-1.5">
              <label htmlFor="template-name" className="text-xs text-muted-foreground">
                Name
              </label>
              <Input
                id="template-name"
                value={name}
                maxLength={MAX_TEMPLATE_NAME}
                placeholder="Payment terms"
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="template-subject"
                className="text-xs text-muted-foreground"
              >
                Subject (optional)
              </label>
              <Input
                id="template-subject"
                value={subject}
                maxLength={MAX_TEMPLATE_SUBJECT}
                placeholder="Leave empty to keep whatever is already there"
                onChange={(e) => setSubject(e.target.value)}
              />
              {/* Stated rather than left to be discovered, because the
                  alternative reading — "this template will set the subject" —
                  is the one that would quietly rewrite a reply's "Re: …". */}
              <p className="text-xs text-muted-foreground">
                Only used when the message has no subject yet, so applying a
                template to a reply never changes it.
              </p>
            </div>

            <RichTextEditor
              key={instance}
              initialHtml={editing.bodyHtml}
              editorRef={editor}
              disabled={pending}
              ariaLabel="Template body"
            />

            <p className="text-xs text-muted-foreground">
              Inserted where your cursor is, so it adds to what you have written
              rather than replacing it.
            </p>

            <div className="flex items-center gap-2 pt-1">
              <Button onClick={save} disabled={pending} size="sm">
                {pending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Save className="size-4" />
                )}
                Save template
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => setEditing(null)}
              >
                Cancel
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
