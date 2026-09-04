"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
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
import { GripVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Panel } from "@/components/app/panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { normalizePagePath, pagePathReasonMessage } from "@/lib/sites/pages";
import { addPageAction, deletePageAction, reorderPagesAction } from "../page-actions";

export interface PageRowView {
  id: string;
  path: string;
  title: string;
  sections: number;
  published: boolean;
}

/**
 * The site's pages on the Website screen: drag to set the menu order, open
 * the editor, add and remove. The order and the menu are live on the site;
 * a page's words wait for Publish (see page-actions.ts).
 */
export function PagesPanel({
  pages,
  slug,
  canWrite,
}: {
  pages: PageRowView[];
  slug: string;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [order, setOrder] = useState(pages);
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [path, setPath] = useState("");
  const pathCheck = normalizePagePath(path || title);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = order.findIndex((p) => p.id === active.id);
    const to = order.findIndex((p) => p.id === over.id);
    const next = arrayMove(order, from, to);
    setOrder(next);
    startTransition(async () => {
      const result = await reorderPagesAction({ order: next.map((p) => p.id) });
      if ("error" in result) {
        toast.error(result.error);
        setOrder(pages);
        return;
      }
      toast.success("Menu order saved.");
      router.refresh();
    });
  }

  function add() {
    if (!pathCheck.ok) return;
    startTransition(async () => {
      const result = await addPageAction({ title, path: pathCheck.path });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Page added. Write it, then publish when it reads right.");
      router.push(`/dashboard/m/marketing/website/pages/${result.data?.pageId}`);
    });
  }

  function remove(page: PageRowView) {
    if (
      !window.confirm(
        `Delete the ${page.title} page? It comes off the internet at once, with its history. This cannot be undone.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const result = await deletePageAction({ pageId: page.id });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setOrder((list) => list.filter((p) => p.id !== page.id));
      toast.success("Page deleted.");
      router.refresh();
    });
  }

  return (
    <Panel className="divide-y divide-divider">
      {/* `id` pins dnd-kit's accessibility ids so server and client agree (see page-editor.tsx). */}
      <DndContext id="site-pages" sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={order.map((p) => p.id)} strategy={verticalListSortingStrategy}>
          <ul className="divide-y divide-divider">
            {order.map((page) => (
              <PageRow
                key={page.id}
                page={page}
                slug={slug}
                canWrite={canWrite}
                pending={pending}
                onRemove={() => remove(page)}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      {canWrite && (
        <div className="p-4">
          {adding ? (
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <div className="space-y-2">
                <Label htmlFor="new-page-title">Title</Label>
                <Input id="new-page-title" value={title} maxLength={80} placeholder="Services" onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-page-path">Address</Label>
                <Input id="new-page-path" value={path} maxLength={120} className="font-mono" placeholder={pathCheck.ok ? pathCheck.path : "/services"} onChange={(e) => setPath(e.target.value)} />
                <p className={cn("text-xs", pathCheck.ok ? "text-muted-foreground" : "text-destructive")}>
                  {pathCheck.ok ? `Will be at ${pathCheck.path}` : pagePathReasonMessage(pathCheck.reason)}
                </p>
              </div>
              <div className="flex gap-2">
                <Button onClick={add} disabled={pending || title.trim() === "" || !pathCheck.ok}>
                  {pending ? "Adding…" : "Add page"}
                </Button>
                <Button variant="ghost" onClick={() => setAdding(false)} disabled={pending}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
              <Plus className="size-4" />
              Add a page
            </Button>
          )}
        </div>
      )}
    </Panel>
  );
}

function PageRow({
  page,
  slug,
  canWrite,
  pending,
  onRemove,
}: {
  page: PageRowView;
  slug: string;
  canWrite: boolean;
  pending: boolean;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: page.id,
    disabled: !canWrite,
  });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const previewHref = `/sites/${slug}/draft${page.path === "/" ? "" : page.path}`;
  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn("flex flex-wrap items-center justify-between gap-3 px-4 py-3", isDragging && "bg-muted opacity-80")}
    >
      <div className="flex min-w-0 items-center gap-2">
        {canWrite && (
          <button
            type="button"
            className="cursor-grab touch-none text-muted-foreground"
            aria-label={`Drag to move ${page.title}`}
            {...attributes}
            {...listeners}
          >
            <GripVertical className="size-4" />
          </button>
        )}
        <div className="min-w-0">
          <div className="font-medium">{page.title}</div>
          <div className="text-xs text-muted-foreground">
            <span className="font-mono">{page.path}</span>
            {" · "}
            {page.sections} section{page.sections === 1 ? "" : "s"}
            {page.published ? " · published" : " · draft only"}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <Button asChild variant="ghost" size="sm">
          <Link href={previewHref} target="_blank" rel="noreferrer">
            Preview
          </Link>
        </Button>
        {canWrite && (
          <>
            <Button asChild variant="outline" size="sm">
              <Link href={`/dashboard/m/marketing/website/pages/${page.id}`}>
                <Pencil className="size-4" />
                Edit
              </Link>
            </Button>
            {page.path !== "/" && (
              <Button variant="ghost" size="sm" aria-label={`Delete ${page.title}`} disabled={pending} onClick={onRemove}>
                <Trash2 className="size-4" />
              </Button>
            )}
          </>
        )}
      </div>
    </li>
  );
}
