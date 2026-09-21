"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { DoorOpen, Ruler, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatQuantity } from "../billing-math";
import { MeasureOnADrawing } from "./measure-on-a-drawing";
import {
  addRoomsAction,
  deleteRoomAction,
  setRoomAreaAction,
  type RoomView,
} from "../room-actions";

/**
 * THE ROOMS IN THE BUILDING (X8).
 *
 * The founder: *"identify the rooms on every floor. probably do the area
 * takeoff and label the room... then the estimate questions can start asking
 * questions like what type of flooring in Master bedroom."*
 *
 * ── THE LIST ARRIVES WHOLE ──────────────────────────────────────────────────
 *
 * A fifteen-room house typed into fifteen forms is a feature nobody uses
 * twice, so the first thing this screen shows is a paste box. The areas come
 * after, one row at a time, and only for the rooms whose cost depends on
 * one — which is floors, which is why a room has a floor area and nothing
 * else.
 *
 * ── AND A ROOM WITHOUT AN AREA IS FINE ──────────────────────────────────────
 *
 * The NAME is most of the value: it is what lets a question say *"what tile
 * in the master bath?"* and what lets the bid be checked for a room nobody
 * priced. Holding the walk up until every room has a number would be the
 * tool getting in the way of the thing it is for.
 */
export function RoomsDialog({
  projectId,
  rooms,
  onChanged,
  trigger = "The rooms",
}: {
  projectId: string;
  rooms: RoomView[];
  onChanged: (rooms: RoomView[]) => void;
  trigger?: string;
}) {
  const [open, setOpen] = useState(false);
  const [paste, setPaste] = useState("");
  const [pending, startTransition] = useTransition();

  const withArea = rooms.filter((r) => r.areaThousandths !== null).length;
  const total = rooms.reduce((n, r) => n + (r.areaThousandths ?? 0), 0);
  /** Floors in the order they were added, so a heading cannot appear twice. */
  const levels: string[] = [];
  for (const r of rooms) if (!levels.includes(r.level)) levels.push(r.level);

  function run(what: Promise<{ error: string } | { ok: true; rooms: RoomView[] }>) {
    startTransition(async () => {
      try {
        const result = await what;
        if ("error" in result) {
          toast.error(result.error);
          return;
        }
        onChanged(result.rooms);
      } catch {
        toast.error("That did not get through. Try again.");
      }
    });
  }

  function addPasted() {
    if (paste.trim() === "") return;
    startTransition(async () => {
      try {
        const result = await addRoomsAction({ projectId, text: paste });
        if ("error" in result) {
          toast.error(result.error);
          return;
        }
        onChanged(result.rooms);
        setPaste("");
        const bits = [`${result.added} added`];
        if (result.alreadyThere > 0) bits.push(`${result.alreadyThere} already there`);
        if (result.withArea > 0) bits.push(`${result.withArea} with an area`);
        toast.success(bits.join(", "));
        /** Nothing disappears quietly — a line it could not read is named. */
        if (result.skipped.length > 0) {
          toast.message(
            `Could not read ${result.skipped.length} ${result.skipped.length === 1 ? "line" : "lines"}`,
            { description: result.skipped.slice(0, 3).join(" · ") },
          );
        }
      } catch {
        toast.error("That did not get through. Try again.");
      }
    });
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <DoorOpen className="mr-1.5 size-4" /> {trigger}
        {rooms.length > 0 && (
          <span className="ml-1.5 text-muted-foreground">{rooms.length}</span>
        )}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>The rooms</DialogTitle>
            <DialogDescription>
              {rooms.length === 0
                ? "Paste the list — one a line. Put a floor on its own line ending in a colon to group them."
                : `${rooms.length} ${rooms.length === 1 ? "room" : "rooms"}, ${withArea} with an area${
                    total > 0 ? ` · ${formatQuantity(total)} sf in all` : ""
                  }. Every question after the measure-up can name these.`}
            </DialogDescription>
          </DialogHeader>

          {rooms.length > 0 && (
            <ul className="max-h-[50vh] divide-y overflow-y-auto rounded-md border">
              {levels.map((level) => (
                <li key={level || "__none__"}>
                  {level.trim() !== "" && (
                    <p className="bg-muted/50 px-3 py-1.5 text-xs font-medium">{level}</p>
                  )}
                  <ul className="divide-y">
                    {rooms
                      .filter((r) => r.level === level)
                      .map((room) => (
                        <RoomRowView
                          key={room.id}
                          projectId={projectId}
                          room={room}
                          busy={pending}
                          onRun={run}
                        />
                      ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}

          <div>
            <Textarea
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              rows={4}
              maxLength={20_000}
              placeholder={"Main floor:\nKitchen\t310\nGreat room\t420\nUpstairs:\nMaster bedroom\t224"}
              aria-label="Rooms to add"
            />
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <Button
                type="button"
                size="sm"
                disabled={pending || paste.trim() === ""}
                onClick={addPasted}
              >
                Add them
              </Button>
              <span className="text-xs text-muted-foreground">
                An area after a tab, a comma or a wide gap. 310, 24 x 40 and 18&apos;-6&quot; all read.
              </span>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function RoomRowView({
  projectId,
  room,
  busy,
  onRun,
}: {
  projectId: string;
  room: RoomView;
  busy: boolean;
  onRun: (what: Promise<{ error: string } | { ok: true; rooms: RoomView[] }>) => void;
}) {
  const [said, setSaid] = useState("");
  const [armed, setArmed] = useState(false);

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
      <span className="min-w-0 flex-1 text-sm">{room.name}</span>

      {room.areaThousandths === null ? (
        <form
          className="flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (said.trim() === "") return;
            onRun(setRoomAreaAction({ projectId, roomId: room.id, said }));
            setSaid("");
          }}
        >
          <Input
            value={said}
            onChange={(e) => setSaid(e.target.value)}
            className="h-8 w-28"
            placeholder="sf"
            aria-label={`Floor area of ${room.name}`}
            maxLength={200}
          />
        </form>
      ) : (
        <span className="flex items-center gap-1.5 text-sm">
          {formatQuantity(room.areaThousandths)} {room.areaUnit}
          {room.measured && (
            <Ruler className="size-3 text-muted-foreground" aria-label="off a drawing" />
          )}
        </span>
      )}

      <MeasureOnADrawing
        projectId={projectId}
        measure={{ name: room.name, unit: room.areaUnit || "sf", kind: "area" }}
        label={room.areaThousandths === null ? "Measure" : "Re-measure"}
        onUse={async (valueThousandths, markupId, note, sheetId) => {
          const result = await setRoomAreaAction({
            projectId,
            roomId: room.id,
            said: String(valueThousandths / 1000),
            sheetId,
            markupId: markupId ?? undefined,
          });
          if ("error" in result) {
            toast.error(result.error);
            throw new Error(result.error);
          }
          onRun(Promise.resolve(result));
          toast.success(`${room.name} — ${note}`);
        }}
      />

      {armed ? (
        <Button
          type="button"
          variant="destructive"
          size="sm"
          className="h-8"
          disabled={busy}
          onClick={() => onRun(deleteRoomAction({ projectId, roomId: room.id }))}
        >
          Take it off
        </Button>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8"
          disabled={busy}
          onClick={() => setArmed(true)}
          aria-label={`Take ${room.name} off the list`}
        >
          <Trash2 className="size-3.5" />
        </Button>
      )}
    </li>
  );
}
