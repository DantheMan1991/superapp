"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { ImagePlus, Pencil, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { saveRecipeAction } from "../actions";
import { readLine, showLine } from "../core/amounts";
import { RECIPE_PHOTO_BASE64_LIMIT, RECIPE_PHOTO_EDGE } from "../core/draft";
import { fromEditor, linesOfText, toEditor, type EditorRecipe } from "../core/editor";
import { FOOD_MESSAGES } from "../core/errors";
import { NUTRITION_KEYS, NUTRITION_LABELS, type RecipeInput } from "../core/recipe";
import { DiscardDraftButton } from "./discard-draft-button";
import { previewOf, shrinkToFit } from "./shrink-photo";

const HOME = "/personal/m/food";

/** Tags offered before the person has any of their own. */
const STARTER_TAGS = ["Breakfast", "Lunch", "Dinner", "Snack", "Dessert", "High protein", "Quick"];

export type EditorMode =
  | { kind: "new" }
  | { kind: "draft"; importId: string; from: string; photoUrl: string | null }
  | { kind: "edit"; recipeId: string; photoUrl: string | null };

type PhotoState = { kind: "keep"; url: string | null } | { kind: "none" } | { kind: "new"; jpeg: string; preview: string };

/**
 * THE RECIPE EDITOR (docs/help/food/editor.md): typing a recipe in, checking a
 * draft that was read from a link, a paste or photos, and editing a saved one.
 * Nothing is saved until Save recipe; a draft waits in the recipes until it
 * is saved or discarded.
 */
export function RecipeEditor({
  initial,
  mode,
  tags: knownTags,
}: {
  initial: RecipeInput;
  mode: EditorMode;
  tags: string[];
}) {
  const router = useRouter();
  const [form, setForm] = useState<EditorRecipe>(() => toEditor(initial));
  const [photo, setPhoto] = useState<PhotoState>(() =>
    mode.kind === "new" ? { kind: "none" } : { kind: "keep", url: mode.photoUrl },
  );
  const [photoBusy, setPhotoBusy] = useState(false);
  const [editingLines, setEditingLines] = useState(initial.ingredients.length === 0);
  const [tagDraft, setTagDraft] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  const set = <K extends keyof EditorRecipe>(key: K, value: EditorRecipe[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const shownPhoto = photo.kind === "new" ? photo.preview : photo.kind === "keep" ? photo.url : null;
  const lines = linesOfText(form.ingredients, "ingredient");
  const suggestions = (knownTags.length > 0 ? knownTags : STARTER_TAGS)
    .filter((tag) => !form.tags.some((chosen) => chosen.toLowerCase() === tag.toLowerCase()))
    .slice(0, 8);

  async function choosePhoto(file: File | undefined) {
    if (!file) return;
    setPhotoBusy(true);
    try {
      const shrunk = await shrinkToFit(file, RECIPE_PHOTO_EDGE, RECIPE_PHOTO_BASE64_LIMIT);
      if (!shrunk) throw new Error("too large");
      setPhoto({ kind: "new", jpeg: shrunk.jpeg, preview: previewOf(shrunk) });
    } catch {
      toast.error(FOOD_MESSAGES.PHOTO);
    } finally {
      setPhotoBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function addTag(raw: string) {
    const parts = raw
      .split(",")
      .map((part) => part.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    if (parts.length === 0) return;
    setForm((prev) => {
      const next = [...prev.tags];
      for (const part of parts) {
        if (!next.some((tag) => tag.toLowerCase() === part.toLowerCase())) next.push(part);
      }
      return { ...prev, tags: next };
    });
    setTagDraft("");
  }

  function save() {
    const checked = fromEditor({ ...form, tags: tagDraft.trim() ? [...form.tags, tagDraft.trim()] : form.tags });
    if (!checked.ok) {
      setProblems(checked.problems);
      toast.error(checked.problems[0]);
      return;
    }
    setProblems([]);
    const recipe = checked.recipe;
    startTransition(async () => {
      const outcome = await saveRecipeAction({
        recipeId: mode.kind === "edit" ? mode.recipeId : null,
        importId: mode.kind === "draft" ? mode.importId : null,
        recipe,
        photo:
          photo.kind === "new"
            ? { kind: "new", jpeg: photo.jpeg }
            : photo.kind === "keep" && photo.url
              ? { kind: "keep" }
              : { kind: "none" },
      });
      if ("error" in outcome) {
        toast.error(outcome.error);
        return;
      }
      toast.success("Recipe saved");
      router.push(`${HOME}/recipes/${outcome.recipeId}`);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6 pb-24">
      {mode.kind === "draft" && (
        <p className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          Read from {mode.from}. Check it, then Save recipe. Nothing is saved yet.
        </p>
      )}

      <section className="space-y-4 rounded-2xl bg-card p-4 shadow-elevation-1 sm:p-5">
        <div className="space-y-2">
          <Label>Photo</Label>
          {shownPhoto ? (
            // eslint-disable-next-line @next/next/no-img-element -- a private photo or a local preview, not an optimizable asset
            <img src={shownPhoto} alt="" className="aspect-[4/3] w-full rounded-xl object-cover sm:max-w-md" />
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={photoBusy}
              onClick={() => fileInput.current?.click()}
            >
              <ImagePlus aria-hidden /> {shownPhoto ? "Change photo" : "Add a photo"}
            </Button>
            {shownPhoto && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setPhoto({ kind: "none" })}>
                <X aria-hidden /> Remove photo
              </Button>
            )}
          </div>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(event) => void choosePhoto(event.target.files?.[0])}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="recipe-title">Name</Label>
          <Input
            id="recipe-title"
            value={form.title}
            onChange={(event) => set("title", event.target.value)}
            placeholder="Lemon herb chicken"
          />
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="recipe-yield">Makes</Label>
            <div className="flex gap-2">
              <Input
                id="recipe-yield"
                inputMode="decimal"
                className="w-20"
                value={form.yieldAmount}
                onChange={(event) => set("yieldAmount", event.target.value)}
                placeholder="4"
              />
              <Input
                aria-label="What it makes"
                value={form.yieldUnit}
                onChange={(event) => set("yieldUnit", event.target.value)}
                placeholder="servings"
              />
            </div>
          </div>
          {(["prep", "cook", "total"] as const).map((key) => (
            <div key={key} className="space-y-1.5">
              <Label htmlFor={`recipe-${key}`}>{key === "prep" ? "Prep" : key === "cook" ? "Cook" : "Total"} (min)</Label>
              <Input
                id={`recipe-${key}`}
                inputMode="numeric"
                value={form[key]}
                onChange={(event) => set(key, event.target.value)}
              />
            </div>
          ))}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="recipe-tag">Tags</Label>
          <div className="flex flex-wrap items-center gap-1.5">
            {form.tags.map((tag) => (
              <span key={tag} className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-0.5 text-sm">
                {tag}
                <button
                  type="button"
                  aria-label={`Remove ${tag}`}
                  className="rounded-full text-muted-foreground hover:text-foreground"
                  onClick={() => set("tags", form.tags.filter((t) => t !== tag))}
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </span>
            ))}
            <Input
              id="recipe-tag"
              className="h-8 w-40"
              value={tagDraft}
              placeholder="Add a tag"
              onChange={(event) => {
                // A comma ends a tag. Read from the text, not the key: a phone's
                // keyboard often sends no key for a character (Android), and a
                // paste brings several at once.
                const value = event.target.value;
                const cut = value.lastIndexOf(",");
                if (cut < 0) {
                  setTagDraft(value);
                  return;
                }
                addTag(value.slice(0, cut));
                setTagDraft(value.slice(cut + 1).trimStart());
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addTag(tagDraft);
                }
              }}
              onBlur={() => addTag(tagDraft)}
            />
          </div>
          {suggestions.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className="rounded-full border border-dashed border-border px-2.5 py-0.5 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => addTag(tag)}
                >
                  + {tag}
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="space-y-2 rounded-2xl bg-card p-4 shadow-elevation-1 sm:p-5">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="recipe-ingredients">Ingredients</Label>
          {!editingLines && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditingLines(true)}>
              <Pencil aria-hidden /> Edit the lines
            </Button>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          One per line. A line that ends with a colon, like <span className="font-medium">For the sauce:</span>, starts
          a group.
        </p>
        {editingLines ? (
          <>
            <Textarea
              id="recipe-ingredients"
              rows={Math.min(18, Math.max(6, lines.length + 2))}
              value={form.ingredients}
              onChange={(event) => set("ingredients", event.target.value)}
              placeholder={"1 ½ lb chicken thighs\n2 tbsp olive oil\n1 lemon, juiced"}
            />
            {lines.length > 0 && (
              <Button type="button" variant="outline" size="sm" onClick={() => setEditingLines(false)}>
                Done
              </Button>
            )}
          </>
        ) : (
          <ul className="space-y-1 rounded-xl border border-border px-3 py-2 text-sm">
            {lines.map((line, i) =>
              line.heading ? (
                <li key={i} className="pt-1 font-medium">
                  {line.text}
                </li>
              ) : (
                <IngredientReadBack key={i} text={line.text} />
              ),
            )}
          </ul>
        )}
      </section>

      <section className="space-y-2 rounded-2xl bg-card p-4 shadow-elevation-1 sm:p-5">
        <Label htmlFor="recipe-steps">Steps</Label>
        <p className="text-sm text-muted-foreground">One step per line, in order. A line that ends with a colon starts a group.</p>
        <Textarea
          id="recipe-steps"
          rows={8}
          value={form.steps}
          onChange={(event) => set("steps", event.target.value)}
          placeholder={"Mix the oil, lemon and garlic.\nCoat the chicken and rest it 10 minutes.\nRoast at 425°F for 20 minutes."}
        />
      </section>

      <section className="space-y-4 rounded-2xl bg-card p-4 shadow-elevation-1 sm:p-5">
        <div className="space-y-1.5">
          <Label htmlFor="recipe-notes">Notes</Label>
          <Textarea
            id="recipe-notes"
            rows={3}
            value={form.notes}
            onChange={(event) => set("notes", event.target.value)}
            placeholder="Swaps, what you changed, how long it keeps."
          />
        </div>

        <div className="space-y-1.5">
          <p className="text-sm font-medium">Nutrition per serving</p>
          <p className="text-sm text-muted-foreground">As the recipe states it. Leave these empty if it doesn&apos;t say.</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {NUTRITION_KEYS.map((key) => (
              <div key={key} className="space-y-1">
                <Label htmlFor={`recipe-${key}`} className="text-xs text-muted-foreground">
                  {NUTRITION_LABELS[key].label} ({NUTRITION_LABELS[key].unit})
                </Label>
                <Input
                  id={`recipe-${key}`}
                  inputMode="decimal"
                  value={form.nutrition[key]}
                  onChange={(event) => set("nutrition", { ...form.nutrition, [key]: event.target.value })}
                />
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="recipe-source">Source link</Label>
          <Input
            id="recipe-source"
            type="url"
            inputMode="url"
            value={form.sourceUrl}
            onChange={(event) => set("sourceUrl", event.target.value)}
            placeholder="https://"
          />
        </div>
      </section>

      {problems.length > 0 && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
          <p className="font-medium text-destructive">Fix these before saving:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-destructive">
            {problems.slice(0, 8).map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-end gap-2 border-t border-border bg-background/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-2xl sm:border">
        {mode.kind === "draft" ? (
          <DiscardDraftButton importId={mode.importId} />
        ) : (
          <Button asChild variant="ghost">
            <Link href={mode.kind === "edit" ? `${HOME}/recipes/${mode.recipeId}` : `${HOME}/recipes`}>Cancel</Link>
          </Button>
        )}
        <Button onClick={save} disabled={pending || photoBusy}>
          {pending ? "Saving…" : "Save recipe"}
        </Button>
      </div>
    </div>
  );
}

/** One ingredient line as the app reads it: the amount marked, or that it does not scale. */
function IngredientReadBack({ text }: { text: string }) {
  const read = readLine(text);
  return (
    <li>
      {showLine(read, 1).map((part, i) =>
        part.amount ? (
          <span key={i} className="font-medium text-module-accent">
            {part.text}
          </span>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
      {!read.scales && <span className="ml-2 text-xs text-muted-foreground">does not scale</span>}
    </li>
  );
}
