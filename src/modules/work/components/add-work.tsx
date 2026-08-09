"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ListOption } from "../core/row";
import { createItemAction } from "../actions";
import { useWorkAction } from "./item-controls";

/**
 * One row for adding work: a title, and everything else optional.
 *
 * conventions §8 — a real share of usage is one-handed, in the field. The
 * cheapest possible capture is what stops work going to a sticky note, so the
 * only required field is the one nobody can supply for you.
 */
export function AddWork({
  lists,
  defaultListId,
  assignToSelf,
  currentUserId,
}: {
  lists: ListOption[];
  defaultListId: string | null;
  /**
   * True on a per-person view. Work added from "my work" lands on you; work
   * added while looking at a list lands unassigned, because a list is the pile
   * somebody picks from.
   */
  assignToSelf: boolean;
  currentUserId: string;
}) {
  const { pending, run } = useWorkAction();
  const [title, setTitle] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [listId, setListId] = useState(defaultListId ?? "");

  function add() {
    const trimmed = title.trim();
    if (!trimmed) return;
    if (!listId) {
      toast.error("Make a list first.");
      return;
    }
    run(async () => {
      const result = await createItemAction({
        listId,
        title: trimmed,
        dueOn: dueOn || null,
        assignee: assignToSelf ? currentUserId : null,
      });
      if ("ok" in result) {
        setTitle("");
        setDueOn("");
      }
      return result;
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border p-2">
      <Input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") add();
        }}
        placeholder="What needs doing?"
        className="h-9 min-w-[12rem] flex-1"
        aria-label="What needs doing?"
      />
      <Input
        type="date"
        value={dueOn}
        onChange={(event) => setDueOn(event.target.value)}
        className="h-9 w-[10rem]"
        aria-label="Due date"
      />
      <Select value={listId} onValueChange={setListId}>
        <SelectTrigger className="h-9 w-[150px]">
          <SelectValue placeholder="List" />
        </SelectTrigger>
        <SelectContent>
          {lists.map((list) => (
            <SelectItem key={list.id} value={list.id}>
              {list.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button size="sm" onClick={add} disabled={pending || !title.trim()}>
        <Plus className="mr-1 h-4 w-4" />
        Add
      </Button>
    </div>
  );
}
