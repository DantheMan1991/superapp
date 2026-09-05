"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronLeft, GripVertical, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Panel } from "@/components/app/panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  SECTION_TYPES,
  altNudge,
  moveItem,
  newSection,
  normalizePagePath,
  pagePathReasonMessage,
  sectionLabel,
  sectionSummary,
  undescribedPhotos,
  undescribedPhotosOnPage,
} from "@/lib/sites/pages";
import { PageContentSchema, type PageContent, type Section, type SectionType } from "@/lib/sites/schema";
import type { SitePhotoView } from "../image-actions";
import { restorePageVersionAction, savePageAction } from "../page-actions";
import { SectionForm } from "./section-forms";

/**
 * The page editor: settings, the sections in order, the form for the one
 * that is selected, and history — beside a live preview of the draft.
 *
 * Every edit is local until Save. The preview is the draft route in an
 * iframe, reloaded after each save, so what the owner sees is exactly what
 * the renderer draws — there is no second rendering of a section anywhere.
 * Drag to reorder with dnd-kit (pointer and keyboard); the arrow buttons do
 * the same for anyone dragging cannot serve.
 */
export interface VersionView {
  id: string;
  kind: "save" | "publish" | "restore";
  /** ISO string, serialised by the server page. */
  createdAt: string;
}

interface Row {
  key: string;
  section: Section;
}

let nextKey = 1;
const keyed = (section: Section): Row => ({ key: `s${nextKey++}`, section });

const KIND_LABEL: Record<VersionView["kind"], string> = {
  save: "Saved",
  publish: "Published",
  restore: "Restored",
};

export function PageEditor({
  pageId,
  slug,
  isHome,
  initial,
  versions,
  tenantId,
  photos,
}: {
  pageId: string;
  slug: string;
  isHome: boolean;
  initial: { title: string; path: string; inNav: boolean; content: PageContent };
  versions: VersionView[];
  tenantId: string;
  /** The site's photo library, as loaded; the editor keeps it current as photos are added and removed. */
  photos: SitePhotoView[];
}) {
  const router = useRouter();
  const [library, setLibrary] = useState(photos);
  const [title, setTitle] = useState(initial.title);
  const [path, setPath] = useState(initial.path);
  const [inNav, setInNav] = useState(initial.inNav);
  const [description, setDescription] = useState(initial.content.description);
  const [rows, setRows] = useState<Row[]>(() => initial.content.sections.map(keyed));
  // Follows the unsaved rows, so typing a description clears it at once.
  const pageNudge = altNudge(undescribedPhotosOnPage({ sections: rows.map((r) => r.section) }));
  const [selected, setSelected] = useState<string | null>(rows[0]?.key ?? null);
  const [saved, setSaved] = useState(() => JSON.stringify({ title: initial.title, path: initial.path, inNav: initial.inNav, content: initial.content }));
  const [previewKey, setPreviewKey] = useState(0);
  const [savedPath, setSavedPath] = useState(initial.path);
  const [pending, startTransition] = useTransition();

  const content: PageContent = useMemo(
    () => ({ description, sections: rows.map((r) => r.section) }),
    [description, rows],
  );
  const current = JSON.stringify({ title, path, inNav, content });
  const dirty = current !== saved;
  const pathCheck = isHome ? ({ ok: true, path: "/" } as const) : normalizePagePath(path);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setRows((list) => {
      const from = list.findIndex((r) => r.key === active.id);
      const to = list.findIndex((r) => r.key === over.id);
      return arrayMove(list, from, to);
    });
  }

  function add(type: SectionType) {
    const row = keyed(newSection(type));
    setRows((list) => {
      const at = selected ? list.findIndex((r) => r.key === selected) + 1 : list.length;
      const next = [...list];
      next.splice(at === 0 ? list.length : at, 0, row);
      return next;
    });
    setSelected(row.key);
  }

  function remove(key: string) {
    setRows((list) => list.filter((r) => r.key !== key));
    if (selected === key) setSelected(null);
  }

  function update(key: string, section: Section) {
    setRows((list) => list.map((r) => (r.key === key ? { ...r, section } : r)));
  }

  function save() {
    const parsed = PageContentSchema.safeParse(content);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const [, index, field] = issue.path;
      toast.error(
        typeof index === "number"
          ? `Section ${index + 1}: ${String(field ?? "")} ${/small|required/i.test(issue.message) ? "is missing" : "is too long"}.`
          : "Check the sections and try again.",
      );
      return;
    }
    if (!pathCheck.ok) {
      toast.error(pagePathReasonMessage(pathCheck.reason));
      return;
    }
    startTransition(async () => {
      const result = await savePageAction({
        pageId,
        title,
        path: isHome ? null : path,
        inNav,
        content: parsed.data,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setSaved(current);
      setSavedPath(pathCheck.ok ? pathCheck.path : savedPath);
      setPreviewKey((k) => k + 1);
      toast.success("Page saved. Publish from the Website page when it reads right.");
      router.refresh();
    });
  }

  function restore(versionId: string) {
    if (
      !window.confirm(
        "Put this version back into the draft? Anything you have not saved on this page is lost.",
      )
    ) {
      return;
    }
    startTransition(async () => {
      const result = await restorePageVersionAction({ pageId, versionId });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Version restored into the draft.");
      router.refresh();
    });
  }

  const selectedRow = rows.find((r) => r.key === selected) ?? null;
  const previewSrc = `/sites/${slug}/draft${savedPath === "/" ? "" : savedPath}`;
  // Both DndContexts in the module carry an `id`: without one dnd-kit numbers
  // its accessibility ids from a counter that runs differently on the server
  // and the client, and React reports a hydration mismatch on aria-describedby.

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/dashboard/m/marketing/website"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4" /> Back to the website
        </Link>
        <div className="flex items-center gap-3">
          {dirty && !pending && (
            <span className="text-xs text-muted-foreground">Unsaved changes</span>
          )}
          <Button onClick={save} disabled={pending || !dirty}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[26rem_minmax(0,1fr)]">
        <div className="space-y-4">
          <Panel className="space-y-4 p-5">
            <h2 className="font-heading text-base font-semibold tracking-heading">Page</h2>
            <div className="space-y-2">
              <Label htmlFor="page-title">Title</Label>
              <Input id="page-title" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />
              <p className="text-xs text-muted-foreground">Shown in the menu and in the browser tab.</p>
            </div>
            {!isHome && (
              <div className="space-y-2">
                <Label htmlFor="page-path">Address</Label>
                <Input id="page-path" value={path} maxLength={120} className="font-mono" onChange={(e) => setPath(e.target.value)} />
                <p className={cn("text-xs", pathCheck.ok ? "text-muted-foreground" : "text-destructive")}>
                  {pathCheck.ok ? `This page is at ${pathCheck.path}` : pagePathReasonMessage(pathCheck.reason)}
                </p>
              </div>
            )}
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="page-in-nav">In the menu</Label>
              <Switch id="page-in-nav" checked={isHome ? true : inNav} disabled={isHome} onCheckedChange={setInNav} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="page-description">Description for search engines</Label>
              <Textarea id="page-description" value={description} maxLength={200} rows={2} onChange={(e) => setDescription(e.target.value)} />
              <p className="text-xs text-muted-foreground">One or two sentences, up to 200 characters. Blank uses your tagline.</p>
            </div>
          </Panel>

          <Panel className="space-y-3 p-5">
            <h2 className="font-heading text-base font-semibold tracking-heading">Sections</h2>
            {pageNudge && (
              <p className="text-xs text-amber-700">
                {pageNudge} Screen readers and search engines say the description instead of the picture; add one under each photo.
              </p>
            )}
            {rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No sections yet. Add one below.</p>
            ) : (
              <DndContext id="site-sections" sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                <SortableContext items={rows.map((r) => r.key)} strategy={verticalListSortingStrategy}>
                  <ul className="space-y-1">
                    {rows.map((row, i) => (
                      <SortableRow
                        key={row.key}
                        row={row}
                        index={i}
                        count={rows.length}
                        selected={row.key === selected}
                        onSelect={() => setSelected(row.key)}
                        onMove={(to) => setRows((list) => moveItem(list, i, to))}
                        onRemove={() => remove(row.key)}
                      />
                    ))}
                  </ul>
                </SortableContext>
              </DndContext>
            )}
            <div className="space-y-2 border-t border-divider pt-3">
              <p className="text-xs text-muted-foreground">Add a section after the selected one</p>
              <div className="flex flex-wrap gap-2">
                {SECTION_TYPES.map((s) => (
                  <Button
                    key={s.type}
                    type="button"
                    variant="outline"
                    size="sm"
                    title={s.hint}
                    disabled={rows.length >= 12}
                    onClick={() => add(s.type)}
                  >
                    {s.label}
                  </Button>
                ))}
              </div>
            </div>
          </Panel>

          {selectedRow && (
            <Panel className="space-y-4 p-5">
              <div className="flex items-center justify-between">
                <h2 className="font-heading text-base font-semibold tracking-heading">
                  {sectionLabel(selectedRow.section.type)}
                </h2>
                <Button type="button" variant="ghost" size="sm" onClick={() => remove(selectedRow.key)}>
                  <Trash2 className="size-4" />
                  Remove section
                </Button>
              </div>
              <SectionForm
                idPrefix={selectedRow.key}
                section={selectedRow.section}
                onChange={(next) => update(selectedRow.key, next)}
                photos={{ tenantId, library, onLibraryChange: setLibrary }}
              />
            </Panel>
          )}

          <Panel className="space-y-3 p-5">
            <h2 className="font-heading text-base font-semibold tracking-heading">History</h2>
            {versions.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing saved yet. Every save, publish and restore is kept here, the last thirty.</p>
            ) : (
              <ul className="divide-y divide-divider text-sm">
                {versions.map((v, i) => (
                  <li key={v.id} className="flex items-center justify-between gap-3 py-2">
                    <div>
                      <span className="font-medium">{KIND_LABEL[v.kind]}</span>
                      <span className="text-muted-foreground"> · {new Date(v.createdAt).toLocaleString()}</span>
                      {i === 0 && <span className="text-xs text-muted-foreground"> · latest</span>}
                    </div>
                    {i > 0 && (
                      <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => restore(v.id)}>
                        Restore
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="lg:sticky lg:top-4 lg:self-start">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Preview of the saved draft{dirty ? " (save to see your changes)" : ""}
            </p>
            <Button type="button" variant="ghost" size="sm" onClick={() => setPreviewKey((k) => k + 1)}>
              <RefreshCw className="size-4" />
              Reload
            </Button>
          </div>
          <iframe
            key={previewKey}
            src={previewSrc}
            title="Draft preview"
            className="h-[75vh] w-full rounded-2xl bg-white shadow-elevation-1"
          />
        </div>
      </div>
    </div>
  );
}

function SortableRow({
  row,
  index,
  count,
  selected,
  onSelect,
  onMove,
  onRemove,
}: {
  row: Row;
  index: number;
  count: number;
  selected: boolean;
  onSelect: () => void;
  onMove: (to: number) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: row.key });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const nudge = altNudge(undescribedPhotos(row.section));
  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-2 rounded-xl px-2 py-2",
        selected ? "bg-module-accent/10 ring-1 ring-module-accent/40" : "hover:bg-muted",
        isDragging && "opacity-70 shadow-elevation-1",
      )}
    >
      <button
        type="button"
        className="cursor-grab touch-none text-muted-foreground"
        aria-label={`Drag to move section ${index + 1}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" />
      </button>
      <button type="button" className="min-w-0 flex-1 text-left" onClick={onSelect}>
        <div className="text-sm font-medium">{sectionLabel(row.section.type)}</div>
        <div className="truncate text-xs text-muted-foreground">{sectionSummary(row.section) || "Empty"}</div>
        {nudge && <div className="text-xs text-amber-700">{nudge}</div>}
      </button>
      <div className="flex items-center gap-1">
        <Button type="button" variant="ghost" size="sm" aria-label="Move up" disabled={index === 0} onClick={() => onMove(index - 1)}>
          ↑
        </Button>
        <Button type="button" variant="ghost" size="sm" aria-label="Move down" disabled={index === count - 1} onClick={() => onMove(index + 1)}>
          ↓
        </Button>
        <Button type="button" variant="ghost" size="sm" aria-label="Remove section" onClick={onRemove}>
          <Trash2 className="size-4" />
        </Button>
      </div>
    </li>
  );
}
