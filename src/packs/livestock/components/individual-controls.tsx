"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { splitIntoIndividualsAction } from "../actions";
import { IDENTIFIER_KINDS, identifierKindLabel } from "../vocabulary";

/** One per line, blanks dropped. How somebody actually has a list of animals. */
function parseNames(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * **RECORD SOME OF A LOT AS INDIVIDUALS.**
 *
 * The founder's question on 2026-08-27 was *"I don't see how you track each
 * individual animal in the lot"*, and the answer — an individual is a lot of one
 * — was true, supported, and completely undiscoverable: ten named cows meant ten
 * trips through the Split dialog, inventing a code each time. This is that, once.
 *
 * **A TEXTAREA RATHER THAN N FIELDS**, because a list of animals arrives as a
 * list: off a clipboard, out of a notebook, or read aloud off ten ear tags in a
 * row. Ten separate inputs would be the friction this exists to remove.
 */
export function SplitIntoIndividualsForm({
  livestockLotId,
  lotCode,
  balance,
  today,
}: {
  livestockLotId: string;
  lotCode: string;
  balance: number;
  today: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [text, setText] = useState("");
  const [kind, setKind] = useState("name");

  const names = parseNames(text);
  // Told BEFORE the button is pressed rather than as a refusal afterwards. The
  // server checks the same thing — this is the courtesy, not the rule.
  const tooMany = names.length > balance;
  const duplicate = (() => {
    const seen = new Set<string>();
    for (const name of names) {
      const key = name.toLowerCase();
      if (seen.has(key)) return name;
      seen.add(key);
    }
    return null;
  })();
  const canSubmit = names.length > 0 && !tooMany && !duplicate;

  function submit(formData: FormData) {
    if (!canSubmit) return;
    startTransition(async () => {
      const result = await splitIntoIndividualsAction({
        livestockLotId,
        names,
        identifierKind: kind,
        occurredOn: String(formData.get("occurredOn") ?? today),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(
        result.count === 1
          ? "1 animal recorded on its own"
          : `${result.count} animals recorded on their own`,
      );
      setOpen(false);
      setText("");
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Record as individuals
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form action={submit}>
          <DialogHeader>
            <DialogTitle>Record animals individually</DialogTitle>
            <DialogDescription>
              Each one becomes a record of its own, carrying this lot&rsquo;s
              species, birth date, breeding and parents across. From then on its
              weights, treatments, photos and calves are its own rather than the
              group&rsquo;s.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="individual-names">
                One per line — a name, a tag number, whatever they are called
              </Label>
              <Textarea
                id="individual-names"
                rows={6}
                autoFocus
                value={text}
                placeholder={"Bluebell\nDaisy\n47\n48"}
                onChange={(e) => setText(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {names.length === 0
                  ? `${balance} head in ${lotCode}.`
                  : tooMany
                    ? `Only ${balance} head in ${lotCode} — you have named ${names.length}.`
                    : duplicate
                      ? `“${duplicate}” is on the list twice.`
                      : `${names.length} named · ${balance - names.length} head stay in ${lotCode}.`}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="individual-kind">These are</Label>
                <Select value={kind} onValueChange={setKind}>
                  <SelectTrigger id="individual-kind">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {IDENTIFIER_KINDS.map((k) => (
                      <SelectItem key={k} value={k}>
                        {identifierKindLabel(k)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="individual-when">When</Label>
                <Input
                  id="individual-when"
                  name="occurredOn"
                  type="date"
                  defaultValue={today}
                  required
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending || !canSubmit}>
              {pending
                ? "Recording…"
                : names.length > 0 && !tooMany && !duplicate
                  ? `Record ${names.length}`
                  : "Record"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
