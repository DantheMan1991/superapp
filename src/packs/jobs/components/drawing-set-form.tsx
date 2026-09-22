"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { uploadPresigned } from "@vercel/blob/client";
import { FileText, FolderOpen, Loader2, Paperclip, Pencil, Plus, RefreshCw, Search, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MAX_FILE_BYTES } from "@/modules/documents/allowlist";
import { sheetThumbPath as thumbPath } from "@/lib/blob-paths";
import { pickDocumentsAction, type PickableDocument } from "@/modules/documents/picker-actions";
import { formatBytes } from "@/modules/documents/lib/format";
import {
  attachDrawingDocumentAction,
  attachDrawingFileAction,
  createDrawingSetAction,
  deleteDrawingSetAction,
  detachDrawingFileAction,
  indexSheetsAction,
  updateDrawingSetAction,
} from "../actions";
import { guessSheet, normaliseSheetNumber, tickedByDefault } from "../drawings-math";
import { readPdf, type ReadPdf } from "./pdf-reading";
import { PageLoupe } from "./page-loupe";

const NONE = "__none__";

/** How many page pictures upload at once. Enough to be quick; few enough not to be a stampede. */
const THUMB_LANES = 4;

/** A canvas's `data:image/jpeg;base64,…` as bytes, without a fetch. Null when it is not one. */
function jpegFromDataUrl(dataUrl: string): Blob | null {
  const comma = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:image/jpeg;base64,") || comma === -1) return null;
  try {
    const raw = atob(dataUrl.slice(comma + 1));
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return new Blob([bytes], { type: "image/jpeg" });
  } catch {
    return null;
  }
}

export interface EditableDrawingSet {
  id: string;
  version: number;
  name: string;
  issuedOn: string;
  fromPartyId: string | null;
  notes: string;
}

export interface IndexedSheet {
  pageNumber: number;
  sheetNumber: string;
  title: string;
  revision: string;
}

interface SheetDraft {
  pageNumber: number;
  include: boolean;
  sheetNumber: string;
  title: string;
  revision: string;
  hint: string;
  thumbnail: string | null;
}

/**
 * A set of drawings arrives: the set (its name and the date on the
 * drawings), then its file, then the file read into sheets — the browser
 * reads each page's title block and proposes the number and title, the
 * person corrects what it got wrong, and the server stores what was
 * confirmed (ADR 0072). One dialog, three steps, because the person who
 * has the PDF in hand wants the sheets on the job in one sitting.
 */
export function AddDrawingSetDialog({
  projectId,
  tenantId,
  parties,
  today,
  trigger,
}: {
  projectId: string;
  tenantId: string;
  parties: Array<{ id: string; name: string }>;
  today: string;
  trigger?: ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"set" | "file" | "sheets">("set");
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [issuedOn, setIssuedOn] = useState(today);
  const [fromPartyId, setFromPartyId] = useState(NONE);
  const [notes, setNotes] = useState("");
  const [setId, setSetId] = useState<string | null>(null);
  const [file, setFile] = useState<{ documentId: string; fileName: string; read: ReadPdf; bytes: Uint8Array } | null>(null);

  function reset() {
    setStep("set");
    setName("");
    setIssuedOn(today);
    setFromPartyId(NONE);
    setNotes("");
    setSetId(null);
    setFile(null);
  }

  function createSet() {
    startTransition(async () => {
      const result = await createDrawingSetAction({
        projectId,
        name: name.trim(),
        issuedOn,
        fromPartyId: fromPartyId === NONE ? "" : fromPartyId,
        notes: notes.trim(),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setSetId(result.id);
      setStep("file");
      router.refresh();
    });
  }

  return (
    <>
      {trigger ? (
        <span onClick={() => setOpen(true)}>{trigger}</span>
      ) : (
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="mr-1.5 size-4" /> Add a set
        </Button>
      )}
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) reset();
        }}
      >
        <DialogContent className={step === "sheets" ? "max-h-[92vh] overflow-y-auto sm:max-w-3xl" : "sm:max-w-lg"}>
          <DialogHeader>
            <DialogTitle>{step === "set" ? "Add a set of drawings" : step === "file" ? `${name.trim()} · the file` : `${name.trim()} · the sheets`}</DialogTitle>
            <DialogDescription>
              {step === "set"
                ? "An issue of drawings: the permit set, the construction set, an ASI with two sheets, an addendum."
                : step === "file"
                  ? "A PDF of the set. Each page that carries a sheet number becomes a sheet on the job."
                  : "What each page is. The numbers and titles were read off the title blocks; fix any that are wrong, and untick a page that is not a sheet."}
            </DialogDescription>
          </DialogHeader>

          {step === "set" && (
            <SetFields
              name={name}
              issuedOn={issuedOn}
              fromPartyId={fromPartyId}
              notes={notes}
              parties={parties}
              onName={setName}
              onIssuedOn={setIssuedOn}
              onFromPartyId={setFromPartyId}
              onNotes={setNotes}
            />
          )}
          {step === "file" && setId && (
            <FileStep
              setId={setId}
              tenantId={tenantId}
              onRead={(documentId, fileName, read, bytes) => {
                setFile({ documentId, fileName, read, bytes });
                setStep("sheets");
              }}
            />
          )}
          {step === "sheets" && setId && file && (
            <SheetIndexTable
              setId={setId}
              tenantId={tenantId}
              documentId={file.documentId}
              fileName={file.fileName}
              read={file.read}
              bytes={file.bytes}
              existing={[]}
              onDone={() => {
                setOpen(false);
                reset();
                router.refresh();
              }}
            />
          )}

          {step === "set" && (
            <DialogFooter>
              <Button onClick={createSet} disabled={pending || name.trim() === "" || issuedOn === ""}>
                {pending ? "Saving…" : "Next: the file"}
              </Button>
            </DialogFooter>
          )}
          {step === "file" && (
            <DialogFooter className="sm:justify-start">
              <p className="text-xs text-muted-foreground">The set is saved; a file can be added later from its row too.</p>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function SetFields({
  name,
  issuedOn,
  fromPartyId,
  notes,
  parties,
  onName,
  onIssuedOn,
  onFromPartyId,
  onNotes,
}: {
  name: string;
  issuedOn: string;
  fromPartyId: string;
  notes: string;
  parties: Array<{ id: string; name: string }>;
  onName: (v: string) => void;
  onIssuedOn: (v: string) => void;
  onFromPartyId: (v: string) => void;
  onNotes: (v: string) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_11rem]">
        <div className="space-y-1.5">
          <Label htmlFor="ds-name">Set</Label>
          <Input id="ds-name" value={name} onChange={(e) => onName(e.target.value)} placeholder="Permit set" maxLength={200} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ds-date">Dated</Label>
          <Input id="ds-date" type="date" value={issuedOn} onChange={(e) => onIssuedOn(e.target.value)} />
          <p className="text-xs text-muted-foreground">The date on the drawings; it orders the issues.</p>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ds-from">From</Label>
        <Select value={fromPartyId} onValueChange={onFromPartyId}>
          <SelectTrigger className="w-full" id="ds-from">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Nobody in particular</SelectItem>
            {parties.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ds-notes">Notes</Label>
        <Textarea id="ds-notes" value={notes} onChange={(e) => onNotes(e.target.value)} rows={2} maxLength={4000} placeholder="Reissued for the revised footing detail." />
      </div>
    </div>
  );
}

/**
 * The file: uploaded from the phone or the desk, or a PDF already in the
 * cabinet. Either way the bytes are read HERE, in the browser — an upload
 * is read from the file the person picked, a cabinet file is fetched once
 * — and the reading is the same code the sheet index step consumes.
 */
function FileStep({
  setId,
  tenantId,
  onRead,
}: {
  setId: string;
  tenantId: string;
  /**
   * The BYTES go with the read. The loupe re-renders a page at a readable
   * size, and re-fetching a 50MB set to do it — when the browser has just
   * had it in hand — is the slow way round.
   */
  onRead: (documentId: string, fileName: string, read: ReadPdf, bytes: Uint8Array) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  async function onFile(list: FileList | null) {
    const picked = list?.[0];
    if (!picked) return;
    if (picked.type !== "application/pdf") {
      toast.error(`${picked.name}: a set is a PDF`);
      return;
    }
    if (picked.size > MAX_FILE_BYTES) {
      toast.error(`${picked.name}: up to ${Math.round(MAX_FILE_BYTES / 1024 / 1024)}MB`);
      return;
    }
    setBusy("Uploading…");
    try {
      const bytes = new Uint8Array(await picked.arrayBuffer());
      const blob = await uploadPresigned(`docs/${tenantId}/files/${picked.name}`, picked, {
        access: "private",
        handleUploadUrl: "/api/documents/blob/upload",
      });
      const attached = await attachDrawingFileAction({ entityId: setId, pathname: blob.pathname });
      if ("error" in attached) {
        toast.error(attached.error);
        return;
      }
      const read = await readPdf(bytes, (done, total) => setBusy(`Reading page ${done} of ${total}…`));
      onRead(attached.documentId, picked.name, read, bytes);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function onPicked(doc: PickableDocument) {
    setPicking(false);
    setBusy("Attaching…");
    try {
      const attached = await attachDrawingDocumentAction({ entityId: setId, documentId: doc.id });
      if ("error" in attached) {
        toast.error(attached.error);
        return;
      }
      const bytes = await fetchBytes(doc.id, setBusy);
      const read = await readPdf(bytes, (done, total) => setBusy(`Reading page ${done} of ${total}…`));
      onRead(doc.id, doc.fileName, read, bytes);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not read the file");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <input ref={fileRef} type="file" accept="application/pdf" className="hidden" onChange={(e) => void onFile(e.target.files)} />
      {busy ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> {busy}
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
            <Paperclip className="mr-1.5 size-4" /> Add a file
          </Button>
          <Button variant="outline" size="sm" onClick={() => setPicking(true)}>
            <FolderOpen className="mr-1.5 size-4" /> From Documents
          </Button>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        One PDF, up to {Math.round(MAX_FILE_BYTES / 1024 / 1024)}MB. A set that came as one file per sheet is added one file at a time from the set&apos;s row.
      </p>
      <DocumentPicker open={picking} onOpenChange={setPicking} onPick={(d) => void onPicked(d)} />
    </div>
  );
}

async function fetchBytes(documentId: string, setBusy: (s: string) => void): Promise<Uint8Array> {
  setBusy("Fetching the file…");
  const response = await fetch(`/api/documents/${documentId}/file`, { credentials: "same-origin" });
  if (!response.ok) throw new Error(`The file could not be fetched (${response.status}).`);
  return new Uint8Array(await response.arrayBuffer());
}

/** The cabinet's own search, in a dialog, PDFs only: a set is a PDF. */
function DocumentPicker({ open, onOpenChange, onPick }: { open: boolean; onOpenChange: (o: boolean) => void; onPick: (d: PickableDocument) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<PickableDocument[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      setSearching(true);
      void pickDocumentsAction({ q }).then((result) => {
        if (cancelled) return;
        setSearching(false);
        if ("error" in result) {
          toast.error(result.error);
          return;
        }
        setHits(result.hits.filter((h) => h.mimeType === "application/pdf"));
      });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, q]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>From Documents</DialogTitle>
          <DialogDescription>A PDF already in the cabinet — the set the architect emailed, filed from Mail.</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or contents" className="pl-8" autoFocus />
        </div>
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {searching && hits.length === 0 ? (
            <p className="px-1 py-2 text-xs text-muted-foreground">Searching…</p>
          ) : hits.length === 0 ? (
            <p className="px-1 py-2 text-xs text-muted-foreground">No PDF matches.</p>
          ) : (
            hits.map((h) => (
              <button
                key={h.id}
                type="button"
                onClick={() => onPick(h)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-secondary"
              >
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{h.title || h.fileName}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(h.sizeBytes)}</span>
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The index table: one row per page with the number and title the browser
 * read, editable, and a tick for whether the page is a sheet at all. A
 * page with no number found is unticked and says why; a scanned set says
 * there was no text and shows the thumbnail to read the number off.
 */
export function SheetIndexTable({
  setId,
  tenantId,
  documentId,
  fileName,
  read,
  bytes,
  existing,
  onDone,
}: {
  setId: string;
  /** Whose namespace a page's picture is stored under. */
  tenantId: string;
  documentId: string;
  fileName: string;
  read: ReadPdf;
  /** The file itself, so a page can be drawn big enough to read (the loupe). */
  bytes: Uint8Array;
  /** What this file was read into before, when it is being read again. */
  existing: IndexedSheet[];
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  /** The page open in the loupe, 1-based; null when the table is on show. */
  const [loupePage, setLoupePage] = useState<number | null>(null);
  const [rows, setRows] = useState<SheetDraft[]>(() =>
    read.pages.map((p) => {
      const prior = existing.find((e) => e.pageNumber === p.pageNumber);
      const guess = guessSheet(p.items, p.width, p.height);
      const reReading = existing.length > 0;
      const sheetNumber = prior?.sheetNumber ?? guess.sheetNumber;
      return {
        pageNumber: p.pageNumber,
        include: tickedByDefault(prior !== undefined, reReading, sheetNumber),
        sheetNumber,
        title: prior?.title ?? guess.title,
        revision: prior?.revision ?? "",
        hint: prior ? "as indexed before" : reReading ? "left out before" : guess.reason === "title block" ? "read off the title block" : guess.reason,
        thumbnail: p.thumbnail,
      };
    }),
  );

  const duplicates = useMemo(() => {
    const seen = new Map<string, number>();
    const dupes = new Set<number>();
    for (const r of rows) {
      if (!r.include) continue;
      const key = normaliseSheetNumber(r.sheetNumber);
      if (key === "") continue;
      const first = seen.get(key);
      if (first !== undefined) {
        dupes.add(first);
        dupes.add(r.pageNumber);
      } else seen.set(key, r.pageNumber);
    }
    return dupes;
  }, [rows]);
  /** The row the loupe is editing. A page out of range simply closes it. */
  const loupeRow = loupePage === null ? null : (rows.find((r) => r.pageNumber === loupePage) ?? null);
  const included = rows.filter((r) => r.include);
  const blank = included.filter((r) => normaliseSheetNumber(r.sheetNumber) === "");
  const ready = included.length > 0 && blank.length === 0 && duplicates.size === 0;

  function patch(pageNumber: number, change: Partial<SheetDraft>) {
    setRows((rs) => rs.map((r) => (r.pageNumber === pageNumber ? { ...r, ...change } : r)));
  }

  /**
   * **THE PICTURES ARE KEPT, NOT THROWN AWAY.** The browser has already drawn
   * one per page to put in this table; until now they died with the dialog,
   * and the drawings page showed cards with no picture on them at all — the
   * founder, looking at his own set: *"The drawings should show thumbnail."*
   *
   * Uploaded under a pathname derived from the FILE and the PAGE
   * (`sheetThumbPath`), so nothing has to wait for a sheet id and a re-read
   * overwrites rather than orphans. **Best effort, and after the sheets are
   * saved**: a picture that does not upload costs a card its thumbnail, and
   * losing the index over it would be the wrong trade by a distance.
   *
   * ── A FEW AT A TIME, TRIED TWICE, AND SAID ──────────────────────────────
   *
   * The first cut fired every page at once and swallowed every failure in a
   * `Promise.allSettled`. **It worked** — the founder re-read his 37-page set
   * on production and the pictures were there on a later look — but it also
   * could not have told anybody if it had not: thirty-seven simultaneous
   * token requests against a serverless route that authenticates and hits
   * the database per call, with every rejection thrown away, is a stampede
   * that reports success whatever happens. So, on principle rather than
   * because of an outage:
   *
   * - **`THUMB_LANES` uploads run at once**; the rest wait. A set still
   *   lands in seconds.
   * - **A failure is tried once more**, because the failure mode here would
   *   be load, and load passes.
   * - **What could not be kept is counted and said**, with the way to fix it
   *   (`Read again`). A best-effort step that reports nothing is
   *   indistinguishable from one that never ran.
   *
   * What the founder actually saw — cards with no pictures on the FIRST
   * look after a re-read, and pictures on the next — is not this function
   * failing. The likeliest cause is the page refreshing before the freshly
   * written blobs were readable, each `<img>` 404ing and hiding itself for
   * that page load. Unconfirmed, and left alone until it is seen again.
   *
   * The data URL is decoded here rather than `fetch()`ed: one fewer thing
   * that a content-security policy or a browser quirk can refuse silently.
   */
  async function keepThumbnails(): Promise<{ kept: number; lost: number }> {
    const withPictures = included.filter((r) => r.thumbnail !== null);
    let kept = 0;
    let lost = 0;
    const queue = [...withPictures];
    const lane = async () => {
      for (let r = queue.shift(); r; r = queue.shift()) {
        const body = jpegFromDataUrl(r.thumbnail!);
        if (!body) {
          lost++;
          continue;
        }
        const put = () =>
          uploadPresigned(thumbPath(tenantId, documentId, r.pageNumber), body, {
            access: "private",
            contentType: "image/jpeg",
            handleUploadUrl: "/api/jobs/sheet-thumbs/blob/upload",
          });
        try {
          await put();
          kept++;
        } catch {
          try {
            await put();
            kept++;
          } catch (err) {
            lost++;
            console.error(`sheet thumbnail for page ${r.pageNumber} could not be kept`, err);
          }
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(THUMB_LANES, queue.length) }, lane));
    return { kept, lost };
  }

  function save() {
    startTransition(async () => {
      const result = await indexSheetsAction({
        setId,
        documentId,
        sheets: included.map((r) => ({ pageNumber: r.pageNumber, sheetNumber: r.sheetNumber, title: r.title, revision: r.revision })),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      /** The sheets are on the job whatever happens to the pictures. */
      const pictures = await keepThumbnails().catch(() => ({ kept: 0, lost: included.length }));
      toast.success(`${result.count} ${result.count === 1 ? "sheet" : "sheets"} on the job`);
      if (pictures.lost > 0) {
        toast.warning(
          `${pictures.lost} ${pictures.lost === 1 ? "picture" : "pictures"} could not be kept. Open the set, Read again and Save to try them again.`,
          { duration: 12_000 },
        );
      }
      onDone();
    });
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {fileName} · {read.pageCount} {read.pageCount === 1 ? "page" : "pages"} · {included.length} ticked
        {blank.length > 0 ? ` · ${blank.length} ticked without a number` : ""}
        {duplicates.size > 0 ? " · the same number twice" : ""}
      </p>
      <div className="max-h-[52vh] overflow-y-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-card text-xs text-muted-foreground">
            <tr>
              <th className="px-2 py-1.5 text-left">Page</th>
              <th className="px-2 py-1.5 text-left">Sheet</th>
              <th className="px-2 py-1.5 text-left">Title</th>
              <th className="px-2 py-1.5 text-left">Rev</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const dupe = duplicates.has(r.pageNumber);
              return (
                <tr key={r.pageNumber} className={`border-t align-top ${r.include ? "" : "opacity-60"}`}>
                  <td className="px-2 py-1.5">
                    <div className="flex items-start gap-2">
                      <Checkbox checked={r.include} onCheckedChange={(v) => patch(r.pageNumber, { include: v === true })} aria-label={`Page ${r.pageNumber} is a sheet`} className="mt-0.5" />
                      <div>
                        {/**
                          * **THE THUMBNAIL IS A BUTTON.** It is 168px wide, so
                          * on a real set it shows that a page exists and
                          * nothing about what it is. Clicking draws the page
                          * at a size the title block can be read at, which is
                          * the only answer when the reading came back empty.
                          */}
                        <button
                          type="button"
                          onClick={() => setLoupePage(r.pageNumber)}
                          className="block rounded ring-offset-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                          title={`Look at page ${r.pageNumber}`}
                          aria-label={`Look at page ${r.pageNumber} to read its number`}
                        >
                          {r.thumbnail ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={r.thumbnail} alt="" className="w-24 rounded border bg-white transition-opacity hover:opacity-80" />
                          ) : (
                            <span className="flex h-16 w-24 items-center justify-center rounded border bg-muted text-xs hover:opacity-80">
                              p. {r.pageNumber}
                            </span>
                          )}
                        </button>
                        <p className="mt-0.5 text-[10px] text-muted-foreground">
                          p. {r.pageNumber} · {r.hint}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-2 py-1.5">
                    <Input
                      value={r.sheetNumber}
                      onChange={(e) => patch(r.pageNumber, { sheetNumber: e.target.value, include: e.target.value.trim() !== "" ? true : r.include })}
                      placeholder="A-101"
                      maxLength={40}
                      aria-invalid={dupe || (r.include && r.sheetNumber.trim() === "")}
                      className="h-8 w-28 font-mono text-xs uppercase"
                    />
                    {dupe && <p className="mt-0.5 text-[10px] text-destructive">Twice in this set.</p>}
                  </td>
                  <td className="px-2 py-1.5">
                    <Input value={r.title} onChange={(e) => patch(r.pageNumber, { title: e.target.value })} placeholder="First floor plan" maxLength={300} className="h-8 text-xs" />
                  </td>
                  <td className="px-2 py-1.5">
                    <Input value={r.revision} onChange={(e) => patch(r.pageNumber, { revision: e.target.value })} placeholder="—" maxLength={40} className="h-8 w-16 text-xs" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <DialogFooter>
        <Button onClick={save} disabled={pending || !ready}>
          {pending ? "Saving…" : `Save ${included.length} ${included.length === 1 ? "sheet" : "sheets"}`}
        </Button>
      </DialogFooter>

      {loupeRow && (
        <PageLoupe
          bytes={bytes}
          fileName={fileName}
          page={loupeRow.pageNumber}
          pageCount={read.pageCount}
          row={loupeRow}
          duplicate={duplicates.has(loupeRow.pageNumber)}
          onPage={setLoupePage}
          onPatch={(change) => patch(loupeRow.pageNumber, change)}
          onClose={() => setLoupePage(null)}
        />
      )}
    </div>
  );
}

/** The set's own row: its words, a file added later, a file read again, a file let go of, the set removed. */
export function EditDrawingSetDialog({
  projectId,
  tenantId,
  existing,
  files,
  parties,
}: {
  projectId: string;
  tenantId: string;
  existing: EditableDrawingSet;
  files: Array<{ documentId: string; fileName: string; sheets: number; isPdf: boolean; indexed: IndexedSheet[] }>;
  parties: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(existing.name);
  const [issuedOn, setIssuedOn] = useState(existing.issuedOn);
  const [fromPartyId, setFromPartyId] = useState(existing.fromPartyId ?? NONE);
  const [notes, setNotes] = useState(existing.notes);
  const [reading, setReading] = useState<{ documentId: string; fileName: string; read: ReadPdf; bytes: Uint8Array; indexed: IndexedSheet[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  // A read still in flight when the dialog closes must not reopen it into the table.
  const openRef = useRef(false);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  function save() {
    startTransition(async () => {
      const result = await updateDrawingSetAction({
        id: existing.id,
        projectId,
        version: existing.version,
        name: name.trim(),
        issuedOn,
        fromPartyId: fromPartyId === NONE ? "" : fromPartyId,
        notes: notes.trim(),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Set saved");
      setOpen(false);
      router.refresh();
    });
  }

  async function readAgain(f: { documentId: string; fileName: string; indexed: IndexedSheet[] }) {
    setBusy(`Fetching ${f.fileName}…`);
    try {
      const bytes = await fetchBytes(f.documentId, setBusy);
      const read = await readPdf(bytes, (done, total) => setBusy(`Reading page ${done} of ${total}…`));
      if (!openRef.current) return;
      setReading({ documentId: f.documentId, fileName: f.fileName, read, bytes, indexed: f.indexed });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not read the file");
    } finally {
      setBusy(null);
    }
  }

  function letGo(documentId: string) {
    startTransition(async () => {
      const result = await detachDrawingFileAction({ entityId: existing.id, documentId });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("File let go of — it stays in Documents");
      router.refresh();
    });
  }

  function remove() {
    startTransition(async () => {
      const result = await deleteDrawingSetAction({ id: existing.id, projectId });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Set removed — its files stay in Documents");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button variant="ghost" size="icon" onClick={() => setOpen(true)}>
        <Pencil className="size-4" />
        <span className="sr-only">Edit {existing.name}</span>
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            setReading(null);
            setArmed(false);
          }
        }}
      >
        <DialogContent className={reading ? "max-h-[92vh] overflow-y-auto sm:max-w-3xl" : "max-h-[92vh] overflow-y-auto sm:max-w-lg"}>
          <DialogHeader>
            <DialogTitle>{reading ? `${existing.name} · ${reading.fileName}` : existing.name}</DialogTitle>
            {reading && <DialogDescription>The file read again. What was indexed before is kept where the page still exists; fix what is wrong.</DialogDescription>}
          </DialogHeader>
          {reading ? (
            <SheetIndexTable
              setId={existing.id}
              tenantId={tenantId}
              documentId={reading.documentId}
              fileName={reading.fileName}
              read={reading.read}
              bytes={reading.bytes}
              existing={reading.indexed}
              onDone={() => {
                setReading(null);
                setOpen(false);
                router.refresh();
              }}
            />
          ) : (
            <>
              <SetFields
                name={name}
                issuedOn={issuedOn}
                fromPartyId={fromPartyId}
                notes={notes}
                parties={parties}
                onName={setName}
                onIssuedOn={setIssuedOn}
                onFromPartyId={setFromPartyId}
                onNotes={setNotes}
              />
              <div className="space-y-2">
                <p className="text-xs font-medium">Files</p>
                {files.length === 0 && <p className="text-xs text-muted-foreground">No file yet.</p>}
                {files.map((f) => (
                  <div key={f.documentId} className="flex flex-wrap items-center gap-2 rounded-md border px-2 py-1.5 text-xs">
                    <FileText className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">
                      {f.fileName} · {f.sheets} {f.sheets === 1 ? "sheet" : "sheets"}
                    </span>
                    {f.isPdf && (
                      <Button variant="ghost" size="sm" className="h-7" disabled={busy !== null || pending} onClick={() => void readAgain(f)}>
                        <RefreshCw className="mr-1 size-3.5" /> {f.sheets === 0 ? "Read the pages" : "Read again"}
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" className="h-7 text-destructive" disabled={busy !== null || pending} onClick={() => letGo(f.documentId)}>
                      <X className="mr-1 size-3.5" /> Let go
                    </Button>
                  </div>
                ))}
                {busy ? (
                  <p className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" /> {busy}
                  </p>
                ) : (
                  <AddFileToSet setId={existing.id} tenantId={tenantId} onRead={(documentId, fileName, read, bytes) => setReading({ documentId, fileName, read, bytes, indexed: [] })} />
                )}
              </div>
              <DialogFooter className="flex-row items-center justify-between sm:justify-between">
                {armed ? (
                  <Button type="button" variant="destructive" size="sm" disabled={pending} onClick={remove}>
                    Remove {existing.name}
                  </Button>
                ) : (
                  <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => setArmed(true)}>
                    <Trash2 className="mr-1.5 size-4" /> Remove
                  </Button>
                )}
                <Button onClick={save} disabled={pending || name.trim() === "" || issuedOn === ""}>
                  {pending ? "Saving…" : "Save"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

/** The file step again, inside the set's row, for a set that came one file per sheet. */
function AddFileToSet({ setId, tenantId, onRead }: { setId: string; tenantId: string; onRead: (documentId: string, fileName: string, read: ReadPdf, bytes: Uint8Array) => void }) {
  return <FileStep setId={setId} tenantId={tenantId} onRead={onRead} />;
}
