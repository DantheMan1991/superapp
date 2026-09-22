"use client";

import { useRef } from "react";
import { toast } from "sonner";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { decodeScheduleBytes } from "../bim-schedule";

/**
 * A SCHEDULE, DROPPED OR PASTED (X14, X15).
 *
 * The one place a file off the model becomes text, shared by the measure-up
 * and the takeoff so there is one decoder to keep right: Revit writes
 * UTF-16, and read as UTF-8 that is a NUL between every letter and a parser
 * that finds nothing — which looks exactly like *this tool does not work*.
 * The text goes to the server, which reads it for the preview and again for
 * the write; nothing the browser holds describes a row.
 */
export function ScheduleInput({
  text,
  fileName,
  pending,
  showRead,
  onChange,
  onRead,
  placeholder,
}: {
  text: string;
  fileName: string;
  pending: boolean;
  /** The *Read it* button, shown until a preview is on screen. */
  showRead: boolean;
  /** New text, and the file it came from ("" when typed); `read` asks for a preview at once. */
  onChange: (text: string, fileName: string, read: boolean) => void;
  onRead: () => void;
  placeholder: string;
}) {
  const fileInput = useRef<HTMLInputElement>(null);

  async function takeFile(file: File) {
    try {
      const decoded = decodeScheduleBytes(new Uint8Array(await file.arrayBuffer()));
      onChange(decoded, file.name, true);
    } catch {
      toast.error("That file could not be read.");
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={fileInput}
          type="file"
          accept=".txt,.csv,.tsv,text/plain,text/csv,text/tab-separated-values"
          className="hidden"
          aria-label="The schedule file"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void takeFile(file);
            e.target.value = "";
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => fileInput.current?.click()}
        >
          <Upload className="mr-1.5 size-4" /> Choose the file
        </Button>
        <span className="text-xs text-muted-foreground">
          {fileName !== "" ? fileName : "or paste it below"}
        </span>
      </div>

      <Textarea
        value={text}
        onChange={(e) => onChange(e.target.value, "", false)}
        rows={5}
        className="font-mono text-xs"
        maxLength={500_000}
        aria-label="The schedule, pasted"
        placeholder={placeholder}
      />
      {showRead && (
        <Button type="button" size="sm" disabled={pending || text.trim() === ""} onClick={onRead}>
          {pending ? "Reading…" : "Read it"}
        </Button>
      )}
    </div>
  );
}
