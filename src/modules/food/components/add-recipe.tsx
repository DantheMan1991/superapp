"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Camera, ClipboardList, Link2, Loader2, Pencil, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { discardImportAction, readLinkAction, readPhotosAction, readTextAction } from "../actions";
import {
  PAGE_PHOTO_EDGE,
  PASTE_LIMIT,
  PICTURES_BASE64_LIMIT,
  PICTURES_MAX,
  PICTURE_BASE64_LIMIT,
} from "../core/draft";
import { FOOD_MESSAGES } from "../core/errors";
import { shrinkToFit } from "./shrink-photo";

type Way = "link" | "text" | "photo";

const WAYS: ReadonlyArray<{ way: Way; title: string; hint: string; Icon: typeof Link2 }> = [
  { way: "link", title: "From a link", hint: "A recipe page's address", Icon: Link2 },
  { way: "text", title: "Paste the text", hint: "From a note, a message, a caption", Icon: ClipboardList },
  { way: "photo", title: "A photo of a page", hint: "A cookbook page or a recipe card", Icon: Camera },
];

interface Chosen {
  id: string;
  file: File;
  preview: string;
}

/**
 * ADD A RECIPE (docs/help/food/add.md): from a link, pasted text, photos of a
 * page, or typed in. A read opens the draft to check; nothing is saved until
 * Save recipe. A read that fails says why here, and leaves nothing behind.
 */
export function AddRecipe() {
  const router = useRouter();
  const [way, setWay] = useState<Way>("link");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [chosen, setChosen] = useState<Chosen[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  function addFiles(list: FileList | null) {
    if (!list) return;
    const room = PICTURES_MAX - chosen.length;
    const added = [...list].slice(0, Math.max(0, room)).map((file) => ({
      id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
      file,
      preview: URL.createObjectURL(file),
    }));
    if (list.length > room) setError(FOOD_MESSAGES.PICTURES);
    setChosen((prev) => [...prev, ...added]);
    if (fileInput.current) fileInput.current.value = "";
  }

  function removeFile(id: string) {
    setChosen((prev) => {
      const gone = prev.find((item) => item.id === id);
      if (gone) URL.revokeObjectURL(gone.preview);
      return prev.filter((item) => item.id !== id);
    });
  }

  function read() {
    setError(null);
    startTransition(async () => {
      let outcome: { ok: true; importId: string } | { error: string; importId?: string };
      if (way === "link") {
        outcome = await readLinkAction({ url });
      } else if (way === "text") {
        outcome = await readTextAction({ text });
      } else {
        if (chosen.length === 0) {
          setError(FOOD_MESSAGES.PICTURES);
          return;
        }
        const each = Math.min(PICTURE_BASE64_LIMIT, Math.floor(PICTURES_BASE64_LIMIT / chosen.length));
        const pictures: Array<{ jpeg: string }> = [];
        for (const item of chosen) {
          let shrunk: Awaited<ReturnType<typeof shrinkToFit>> = null;
          try {
            shrunk = await shrinkToFit(item.file, PAGE_PHOTO_EDGE, each);
          } catch {
            shrunk = null;
          }
          if (!shrunk) {
            setError(FOOD_MESSAGES.PHOTO);
            return;
          }
          pictures.push({ jpeg: shrunk.jpeg });
        }
        outcome = await readPhotosAction({ pictures });
      }
      if ("error" in outcome) {
        setError(outcome.error);
        // The person has seen why; a failed draft need not wait in their recipes too.
        if (outcome.importId) void discardImportAction({ importId: outcome.importId });
        return;
      }
      for (const item of chosen) URL.revokeObjectURL(item.preview);
      router.push(`/personal/m/food/drafts/${outcome.importId}`);
    });
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-2 sm:grid-cols-2">
        {WAYS.map(({ way: value, title, hint, Icon }) => (
          <button
            key={value}
            type="button"
            aria-pressed={way === value}
            disabled={pending}
            onClick={() => {
              setWay(value);
              setError(null);
            }}
            className={cn(
              "flex items-start gap-3 rounded-2xl border bg-card p-4 text-left shadow-elevation-1 transition-colors",
              way === value ? "border-module-accent ring-1 ring-module-accent" : "border-transparent hover:border-border",
            )}
          >
            <Icon className="mt-0.5 size-5 shrink-0 text-module-accent" aria-hidden />
            <span>
              <span className="block font-medium">{title}</span>
              <span className="block text-sm text-muted-foreground">{hint}</span>
            </span>
          </button>
        ))}
        <Link
          href="/personal/m/food/new"
          className="flex items-start gap-3 rounded-2xl border border-transparent bg-card p-4 shadow-elevation-1 hover:border-border"
        >
          <Pencil className="mt-0.5 size-5 shrink-0 text-module-accent" aria-hidden />
          <span>
            <span className="block font-medium">Type it in</span>
            <span className="block text-sm text-muted-foreground">The editor, empty</span>
          </span>
        </Link>
      </div>

      <section className="space-y-3 rounded-2xl bg-card p-4 shadow-elevation-1 sm:p-5">
        {way === "link" && (
          <div className="space-y-1.5">
            <Label htmlFor="add-link">Link</Label>
            <Input
              id="add-link"
              type="url"
              inputMode="url"
              value={url}
              disabled={pending}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://"
            />
            <p className="text-sm text-muted-foreground">
              Copy the address of the recipe&apos;s page and paste it here.
            </p>
          </div>
        )}
        {way === "text" && (
          <div className="space-y-1.5">
            <Label htmlFor="add-text">The recipe</Label>
            <Textarea
              id="add-text"
              rows={10}
              value={text}
              disabled={pending}
              onChange={(event) => setText(event.target.value)}
              placeholder="Paste the recipe here: its name, the ingredients and the steps."
            />
            <p className="text-sm text-muted-foreground">
              {text.length.toLocaleString("en-US")} of {PASTE_LIMIT.toLocaleString("en-US")} characters.
            </p>
          </div>
        )}
        {way === "photo" && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Photos</p>
            <p className="text-sm text-muted-foreground">
              Up to {PICTURES_MAX}, in order, when a recipe runs over pages. They are read and not kept.
            </p>
            {chosen.length > 0 && (
              <ul className="flex flex-wrap gap-2">
                {chosen.map((item, i) => (
                  <li key={item.id} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element -- a local preview of a file not yet sent */}
                    <img src={item.preview} alt={`Photo ${i + 1}`} className="size-24 rounded-lg object-cover" />
                    <button
                      type="button"
                      aria-label={`Remove photo ${i + 1}`}
                      disabled={pending}
                      onClick={() => removeFile(item.id)}
                      className="absolute top-1 right-1 rounded-full bg-background/90 p-0.5"
                    >
                      <X className="size-4" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {chosen.length < PICTURES_MAX && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => fileInput.current?.click()}
              >
                <Camera aria-hidden /> {chosen.length === 0 ? "Choose photos" : "Add another"}
              </Button>
            )}
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              onChange={(event) => addFiles(event.target.files)}
            />
          </div>
        )}

        {error && (
          <p className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={read} disabled={pending}>
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {pending ? "Reading…" : "Read it"}
          </Button>
          {pending && (
            <p className="text-sm text-muted-foreground">
              This can take up to a minute. You can leave: the draft will wait in your recipes.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
