"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { compareDisciplines, disciplineLabel } from "../drawings-math";
import { setDisciplineOrderAction } from "../discipline-settings";

/** One sheet, flattened for the client — no rows, no dates as objects. */
export interface CurrentSheet {
  id: string;
  sheetNumber: string;
  title: string;
  revision: string;
  discipline: string;
  documentId: string;
  pageNumber: number;
  setName: string;
  issuedOn: string;
  issues: number;
}

/**
 * THE CURRENT SET, AS A WALL OF DRAWINGS.
 *
 * Two things the founder asked for after reading his first real set in:
 * *"The drawings should show thumbnail. Also, I should be able to organize
 * the categories. architectural, then structural etc. right now structural
 * shows first but I would not want that."*
 *
 * **THE PICTURE IS THE POINT.** A sheet card carrying only `A1.2` and
 * `Main floor plan` makes you read every card; a builder knows his own
 * drawings by sight. The picture is the one the browser already drew when
 * the set was indexed, stored per PAGE and streamed from
 * `/api/jobs/sheet-thumbs/...`. A set read before that shipped has none, and
 * the card falls back to the number and title it always had.
 *
 * **THE ORDER IS THE BUSINESS'S.** `DISCIPLINE_ORDER` is the US National CAD
 * Standard's, which really does put Structural before Architectural. Drag a
 * heading and it is saved for every job — owner-only, because it changes what
 * the whole team sees.
 */
export function CurrentSet({
  projectId,
  sheets,
  order,
  canReorder,
}: {
  projectId: string;
  sheets: CurrentSheet[];
  /** The business's saved order; empty means the standard's. */
  order: string[];
  canReorder: boolean;
}) {
  const [live, setLive] = useState(order);
  const [pending, startTransition] = useTransition();

  const groups = useMemo(() => {
    const map = new Map<string, CurrentSheet[]>();
    for (const s of sheets) {
      const list = map.get(s.discipline) ?? [];
      list.push(s);
      map.set(s.discipline, list);
    }
    return map;
  }, [sheets]);

  const disciplines = useMemo(
    () => [...groups.keys()].sort((a, b) => compareDisciplines(a, b, live)),
    [groups, live],
  );

  const sensors = useSensors(
    // 4px, so a click through to a sheet is never read as the start of a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = disciplines.indexOf(String(active.id));
    const to = disciplines.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    const moved = [...disciplines];
    moved.splice(to, 0, ...moved.splice(from, 1));
    /**
     * **WHAT IS SAVED IS THE WHOLE VISIBLE ORDER, not the one heading that
     * moved.** A saved list of one would leave everything else to the
     * standard, and the next job with a discipline this one has not got would
     * read in an order nobody chose.
     */
    setLive(moved);
    startTransition(async () => {
      const result = await setDisciplineOrderAction({ order: moved });
      if ("error" in result) {
        toast.error(result.error);
        setLive(order);
        return;
      }
      toast.success(`${disciplineLabel(String(active.id))} moved`);
    });
  }

  if (sheets.length === 0) return null;

  const sections = disciplines.map((d) => (
    <DisciplineSection
      key={d}
      id={d}
      projectId={projectId}
      sheets={groups.get(d)!}
      draggable={canReorder && disciplines.length > 1}
      busy={pending}
    />
  ));

  if (!canReorder || disciplines.length < 2) {
    return <div className="space-y-5">{sections}</div>;
  }

  return (
    <DndContext id="drawing-disciplines" sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={disciplines} strategy={verticalListSortingStrategy}>
        <div className="space-y-5">{sections}</div>
      </SortableContext>
    </DndContext>
  );
}

function DisciplineSection({
  id,
  projectId,
  sheets,
  draggable,
  busy,
}: {
  id: string;
  projectId: string;
  sheets: CurrentSheet[];
  draggable: boolean;
  busy: boolean;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: !draggable,
  });

  return (
    <section
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={isDragging ? "opacity-50" : undefined}
    >
      <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {draggable && (
          <button
            type="button"
            ref={setActivatorNodeRef}
            disabled={busy}
            /**
              * **ALWAYS VISIBLE, NOT ON HOVER.** The first cut faded it in on
              * hover the way the estimate grid's grip does — and a phone has
              * no hover, so on the screen where a builder actually stands the
              * only way to reorder anything was invisible. It is a 14px mark
              * beside a small heading; showing it costs nothing.
              */
            className="-ml-1 cursor-grab touch-none rounded text-subtle-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="size-3.5" />
            <span className="sr-only">Drag to put {disciplineLabel(id)} somewhere else in the order</span>
          </button>
        )}
        {disciplineLabel(id)} · {sheets.length}
      </h3>
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {sheets.map((s) => (
          <li key={s.id}>
            <Link
              href={`/dashboard/m/jobs/${projectId}/drawings/${s.id}`}
              className="flex h-full flex-col overflow-hidden rounded-lg border hover:bg-secondary/50"
            >
              {/**
                * **THE PICTURE IS THE CARD'S WIDTH, in a 3:2 box.** The first
                * cut was a fixed 112px strip with the drawing centred in it —
                * on a desktop card ~490px across that is a stamp with white
                * either side, and the founder said so: *"a fair amount of
                * wasted space... it would be nice if they were bigger."*
                * 3:2 is ARCH-D's own shape (36×24), so a plan fills the box;
                * a portrait detail sheet letterboxes, which is the honest way
                * to show a tall page in a grid every card of which is the
                * same height. `object-contain` keeps the drawing whole.
                *
                * eslint-disable: this is a private, authenticated route that
                * 404s for a page with no picture, which is the ordinary case.
                * `next/image` would need it whitelisted and would proxy it.
                */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/jobs/sheet-thumbs/${s.documentId}/${s.pageNumber}`}
                alt=""
                loading="lazy"
                className="aspect-[3/2] w-full bg-white object-contain"
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
              <span className="flex flex-col gap-1 px-3 py-2">
                <span className="flex items-center justify-between gap-2">
                  <span className="font-mono text-sm font-semibold">{s.sheetNumber}</span>
                  {s.issues > 1 && (
                    <Badge variant="secondary" className="text-[10px]">
                      {s.issues} issues
                    </Badge>
                  )}
                </span>
                <span className="text-sm">{s.title || <span className="text-muted-foreground">Untitled</span>}</span>
                <span className="text-xs text-muted-foreground">
                  {s.setName} · {s.issuedOn}
                  {s.revision ? ` · rev ${s.revision}` : ""}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
