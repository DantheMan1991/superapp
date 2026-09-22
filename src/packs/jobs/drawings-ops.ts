import "server-only";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { JobDrawingSet, JobSheet } from "@/db/schema";
import { detachAllForEntity, detachDocumentFromRecord } from "@/modules/documents/attachments";
import { isDateString } from "@/lib/timezone";
import { JobsError, getProject, requireWrite, type JobsCtx } from "./ops";
import {
  compareSheetNumbers,
  currentIssues,
  disciplineOf,
  isNewer,
  normaliseSheetNumber,
  summariseDrawings,
  type DrawingsSummary,
} from "./drawings-math";
import { DRAWING_SET_ENTITY, PACK } from "./vocabulary";

/**
 * A job's drawings (ADR 0072). THE FILE IS DOCUMENTS' — a set's PDFs are
 * cabinet documents hung on the set through `document_attachments`, put
 * there by the pack's attach actions — and the pack keeps what the cabinet
 * does not know: which page of which file is which sheet, and which issue
 * it came in. The current set is never stored; `currentIssues` derives it
 * from the sets' dates every time it is read.
 *
 * Kept by whoever runs the job (`member`): the person indexing a set on the
 * day it arrives is the office, not the owner.
 */

// ---------------------------------------------------------------- the sets

export interface DrawingSetInput {
  projectId: string;
  name: string;
  issuedOn: string;
  fromPartyId?: string | null;
  notes?: string;
}

function validateSet(input: Partial<DrawingSetInput>): void {
  if (input.name !== undefined && input.name.trim() === "") {
    throw new JobsError("INVALID_VALUE", "a set needs a name: Permit set, ASI 3, Addendum 2");
  }
  if (input.name !== undefined && input.name.length > 200) {
    throw new JobsError("INVALID_VALUE", "a set's name is at most 200 characters");
  }
  if (input.issuedOn !== undefined && !isDateString(input.issuedOn)) {
    throw new JobsError("INVALID_VALUE", "the issue date must be a real date");
  }
  if (input.notes !== undefined && input.notes.length > 4000) {
    throw new JobsError("INVALID_VALUE", "notes are at most 4,000 characters");
  }
}

export async function createDrawingSet(tx: Tx, ctx: JobsCtx, input: DrawingSetInput): Promise<JobDrawingSet> {
  requireWrite(ctx, "member");
  validateSet(input);
  const project = await getProject(tx, ctx.tenantId, input.projectId);
  if (!project) throw new JobsError("NOT_FOUND", `project ${input.projectId} not found`);
  const rows = await tx
    .insert(schema.jobDrawingSets)
    .values({
      tenantId: ctx.tenantId,
      projectId: project.id,
      name: input.name.trim(),
      issuedOn: input.issuedOn,
      fromPartyId: input.fromPartyId ?? null,
      notes: input.notes?.trim() ?? "",
      createdByClerkUserId: ctx.userId,
    })
    .returning();
  return rows[0];
}

export async function getDrawingSet(tx: Tx, tenantId: string, id: string): Promise<JobDrawingSet | null> {
  const rows = await tx
    .select()
    .from(schema.jobDrawingSets)
    .where(and(eq(schema.jobDrawingSets.tenantId, tenantId), eq(schema.jobDrawingSets.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

export async function updateDrawingSet(
  tx: Tx,
  ctx: JobsCtx,
  id: string,
  patch: Partial<Omit<DrawingSetInput, "projectId">> & { version?: number },
): Promise<JobDrawingSet> {
  requireWrite(ctx, "member");
  validateSet(patch);
  const current = await getDrawingSet(tx, ctx.tenantId, id);
  if (!current) throw new JobsError("NOT_FOUND", `drawing set ${id} not found`);
  if (patch.version !== undefined && patch.version !== current.version) {
    throw new JobsError("STALE_VERSION", "the set changed while you were editing it");
  }
  const rows = await tx
    .update(schema.jobDrawingSets)
    .set({
      name: patch.name !== undefined ? patch.name.trim() : current.name,
      issuedOn: patch.issuedOn ?? current.issuedOn,
      fromPartyId: patch.fromPartyId !== undefined ? patch.fromPartyId : current.fromPartyId,
      notes: patch.notes !== undefined ? patch.notes.trim() : current.notes,
      version: current.version + 1,
      updatedAt: new Date(),
    })
    .where(and(eq(schema.jobDrawingSets.tenantId, ctx.tenantId), eq(schema.jobDrawingSets.id, id)))
    .returning();
  return rows[0];
}

/**
 * A set removed takes its sheets (the database cascades) and lets go of its
 * files, which STAY in the cabinet: the drawings were sent to the business
 * and are its record whether or not the pack indexes them.
 */
export async function deleteDrawingSet(tx: Tx, ctx: JobsCtx, id: string): Promise<{ sheets: number }> {
  requireWrite(ctx, "member");
  const current = await getDrawingSet(tx, ctx.tenantId, id);
  if (!current) throw new JobsError("NOT_FOUND", `drawing set ${id} not found`);
  const sheets = await tx
    .select({ id: schema.jobSheets.id })
    .from(schema.jobSheets)
    .where(and(eq(schema.jobSheets.tenantId, ctx.tenantId), eq(schema.jobSheets.setId, id)));
  await detachAllForEntity(tx, ctx.tenantId, setTarget(id));
  await tx.delete(schema.jobDrawingSets).where(and(eq(schema.jobDrawingSets.tenantId, ctx.tenantId), eq(schema.jobDrawingSets.id, id)));
  return { sheets: sheets.length };
}

/**
 * A file let go of by the set: its sheets in this set go with it (a sheet
 * is a page of a file the set holds), and the file itself STAYS in the
 * cabinet, as every detach in the platform leaves the document alone.
 */
export async function detachSetFile(tx: Tx, ctx: JobsCtx, setId: string, documentId: string): Promise<void> {
  requireWrite(ctx, "member");
  const set = await getDrawingSet(tx, ctx.tenantId, setId);
  if (!set) throw new JobsError("NOT_FOUND", `drawing set ${setId} not found`);
  await tx
    .delete(schema.jobSheets)
    .where(and(eq(schema.jobSheets.tenantId, ctx.tenantId), eq(schema.jobSheets.setId, setId), eq(schema.jobSheets.documentId, documentId)));
  await detachDocumentFromRecord(tx, { tenantId: ctx.tenantId, userId: ctx.userId, role: ctx.role }, { documentId, target: setTarget(setId) });
}

export function setTarget(setId: string): { extensionSlug: string; entityType: string; entityId: string } {
  return { extensionSlug: PACK, entityType: DRAWING_SET_ENTITY, entityId: setId };
}

export interface SetFile {
  documentId: string;
  fileName: string;
  title: string;
  mimeType: string;
  sizeBytes: number;
  /** Pages of this file indexed as sheets in this set. */
  sheets: number;
}

export interface DrawingSetRow {
  set: JobDrawingSet;
  fromPartyName: string | null;
  files: SetFile[];
  sheets: number;
}

/** Every set of a job, newest issue first, with its files and how many sheets each was read into. */
export async function listDrawingSets(tx: Tx, tenantId: string, projectId: string): Promise<DrawingSetRow[]> {
  const sets = await tx
    .select({ set: schema.jobDrawingSets, fromPartyName: schema.parties.displayName })
    .from(schema.jobDrawingSets)
    .leftJoin(schema.parties, and(eq(schema.parties.tenantId, schema.jobDrawingSets.tenantId), eq(schema.parties.id, schema.jobDrawingSets.fromPartyId)))
    .where(and(eq(schema.jobDrawingSets.tenantId, tenantId), eq(schema.jobDrawingSets.projectId, projectId)))
    .orderBy(desc(schema.jobDrawingSets.issuedOn), desc(schema.jobDrawingSets.createdAt));
  if (sets.length === 0) return [];
  const ids = sets.map((s) => s.set.id);
  const [attachments, sheets] = await Promise.all([
    tx
      .select({
        setId: schema.documentAttachments.entityId,
        documentId: schema.documents.id,
        fileName: schema.documents.fileName,
        title: schema.documents.title,
        mimeType: schema.documents.mimeType,
        sizeBytes: schema.documents.sizeBytes,
        attachedAt: schema.documentAttachments.createdAt,
      })
      .from(schema.documentAttachments)
      .innerJoin(
        schema.documents,
        and(eq(schema.documents.tenantId, schema.documentAttachments.tenantId), eq(schema.documents.id, schema.documentAttachments.documentId)),
      )
      .where(
        and(
          eq(schema.documentAttachments.tenantId, tenantId),
          eq(schema.documentAttachments.extensionSlug, PACK),
          eq(schema.documentAttachments.entityType, DRAWING_SET_ENTITY),
          inArray(schema.documentAttachments.entityId, ids),
        ),
      )
      .orderBy(asc(schema.documentAttachments.createdAt)),
    tx
      .select({ setId: schema.jobSheets.setId, documentId: schema.jobSheets.documentId })
      .from(schema.jobSheets)
      .where(and(eq(schema.jobSheets.tenantId, tenantId), inArray(schema.jobSheets.setId, ids))),
  ]);
  const perFile = new Map<string, number>();
  const perSet = new Map<string, number>();
  for (const s of sheets) {
    perFile.set(`${s.setId}:${s.documentId}`, (perFile.get(`${s.setId}:${s.documentId}`) ?? 0) + 1);
    perSet.set(s.setId, (perSet.get(s.setId) ?? 0) + 1);
  }
  return sets.map((row) => ({
    set: row.set,
    fromPartyName: row.fromPartyName ?? null,
    files: attachments
      .filter((a) => a.setId === row.set.id)
      .map((a) => ({
        documentId: a.documentId,
        fileName: a.fileName,
        title: a.title,
        mimeType: a.mimeType,
        sizeBytes: a.sizeBytes,
        sheets: perFile.get(`${row.set.id}:${a.documentId}`) ?? 0,
      })),
    sheets: perSet.get(row.set.id) ?? 0,
  }));
}

// -------------------------------------------------------------- the sheets

export interface SheetPageInput {
  pageNumber: number;
  sheetNumber: string;
  title?: string;
  revision?: string;
}

export interface IndexInput {
  setId: string;
  documentId: string;
  sheets: SheetPageInput[];
}

/**
 * The set's file read into sheets: one row per page that carries a number.
 * Re-reading is the correction, and since 9b a sheet's row is a thing other
 * rows hold on to — its markups, its scale — so a page read again KEEPS its
 * row (the number, title and revision updated), a page left out this time
 * loses its row, and a page new to the reading gets one.
 *
 * The file must already hang on the set (the attach actions prove the set
 * exists and the cabinet's own rule allowed the write) and be a PDF, because
 * a page number means nothing on a photograph. The server takes the page
 * count on trust — the browser read the file — and checks only that pages
 * are positive and numbers present and unique within the set.
 */
export async function indexSheets(tx: Tx, ctx: JobsCtx, input: IndexInput): Promise<JobSheet[]> {
  requireWrite(ctx, "member");
  const set = await getDrawingSet(tx, ctx.tenantId, input.setId);
  if (!set) throw new JobsError("NOT_FOUND", `drawing set ${input.setId} not found`);
  const attached = await tx
    .select({ mimeType: schema.documents.mimeType })
    .from(schema.documentAttachments)
    .innerJoin(
      schema.documents,
      and(eq(schema.documents.tenantId, schema.documentAttachments.tenantId), eq(schema.documents.id, schema.documentAttachments.documentId)),
    )
    .where(
      and(
        eq(schema.documentAttachments.tenantId, ctx.tenantId),
        eq(schema.documentAttachments.entityType, DRAWING_SET_ENTITY),
        eq(schema.documentAttachments.entityId, set.id),
        eq(schema.documentAttachments.documentId, input.documentId),
      ),
    )
    .limit(1);
  if (attached.length === 0) throw new JobsError("INVALID_VALUE", "that file is not one of the set's");
  if (attached[0].mimeType !== "application/pdf") throw new JobsError("INVALID_VALUE", "only a PDF has pages to read into sheets");

  const seen = new Map<string, number>();
  const pages = new Set<number>();
  const rows = input.sheets.map((s) => {
    const sheetNumber = normaliseSheetNumber(s.sheetNumber);
    if (sheetNumber === "") throw new JobsError("INVALID_VALUE", `page ${s.pageNumber} needs a sheet number, or leave it out`);
    if (sheetNumber.length > 40) throw new JobsError("INVALID_VALUE", `page ${s.pageNumber}: a sheet number is at most 40 characters`);
    if (!Number.isInteger(s.pageNumber) || s.pageNumber < 1) throw new JobsError("INVALID_VALUE", "a page is a whole number from 1");
    if (pages.has(s.pageNumber)) throw new JobsError("INVALID_VALUE", `page ${s.pageNumber} is listed twice`);
    pages.add(s.pageNumber);
    const before = seen.get(sheetNumber);
    if (before !== undefined) throw new JobsError("SHEET_TAKEN", `${sheetNumber} is on page ${before} and page ${s.pageNumber}`);
    seen.set(sheetNumber, s.pageNumber);
    if ((s.title ?? "").length > 300) throw new JobsError("INVALID_VALUE", `page ${s.pageNumber}: a title is at most 300 characters`);
    if ((s.revision ?? "").length > 40) throw new JobsError("INVALID_VALUE", `page ${s.pageNumber}: a revision mark is at most 40 characters`);
    return {
      tenantId: ctx.tenantId,
      projectId: set.projectId,
      setId: set.id,
      documentId: input.documentId,
      pageNumber: s.pageNumber,
      sheetNumber,
      title: s.title?.trim() ?? "",
      revision: s.revision?.trim() ?? "",
      createdByClerkUserId: ctx.userId,
    };
  });
  // A number the set already carries on ANOTHER file is the same refusal as twice on this one.
  const elsewhere = await tx
    .select({ sheetNumber: schema.jobSheets.sheetNumber, pageNumber: schema.jobSheets.pageNumber, documentId: schema.jobSheets.documentId })
    .from(schema.jobSheets)
    .where(and(eq(schema.jobSheets.tenantId, ctx.tenantId), eq(schema.jobSheets.setId, set.id)));
  for (const e of elsewhere) {
    if (e.documentId !== input.documentId && seen.has(e.sheetNumber)) {
      throw new JobsError("SHEET_TAKEN", `${e.sheetNumber} is already in this set, on another file's page ${e.pageNumber}`);
    }
  }
  const held = await tx
    .select({ id: schema.jobSheets.id, pageNumber: schema.jobSheets.pageNumber })
    .from(schema.jobSheets)
    .where(and(eq(schema.jobSheets.tenantId, ctx.tenantId), eq(schema.jobSheets.setId, set.id), eq(schema.jobSheets.documentId, input.documentId)));
  const byPage = new Map(held.map((h) => [h.pageNumber, h.id]));
  const gone = held.filter((h) => !pages.has(h.pageNumber)).map((h) => h.id);
  if (gone.length > 0) {
    await tx.delete(schema.jobSheets).where(and(eq(schema.jobSheets.tenantId, ctx.tenantId), inArray(schema.jobSheets.id, gone)));
  }
  const out: JobSheet[] = [];
  for (const row of rows) {
    const id = byPage.get(row.pageNumber);
    if (id) {
      const updated = await tx
        .update(schema.jobSheets)
        .set({ sheetNumber: row.sheetNumber, title: row.title, revision: row.revision, updatedAt: new Date() })
        .where(and(eq(schema.jobSheets.tenantId, ctx.tenantId), eq(schema.jobSheets.id, id)))
        .returning();
      out.push(updated[0]);
    } else {
      const inserted = await tx.insert(schema.jobSheets).values(row).returning();
      out.push(inserted[0]);
    }
  }
  return out.sort((a, b) => a.pageNumber - b.pageNumber);
}

export async function getSheet(tx: Tx, tenantId: string, id: string): Promise<JobSheet | null> {
  const rows = await tx
    .select()
    .from(schema.jobSheets)
    .where(and(eq(schema.jobSheets.tenantId, tenantId), eq(schema.jobSheets.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

export async function updateSheet(
  tx: Tx,
  ctx: JobsCtx,
  id: string,
  patch: { sheetNumber?: string; title?: string; revision?: string; version?: number },
): Promise<JobSheet> {
  requireWrite(ctx, "member");
  const current = await getSheet(tx, ctx.tenantId, id);
  if (!current) throw new JobsError("NOT_FOUND", `sheet ${id} not found`);
  if (patch.version !== undefined && patch.version !== current.version) {
    throw new JobsError("STALE_VERSION", "the sheet changed while you were editing it");
  }
  const sheetNumber = patch.sheetNumber !== undefined ? normaliseSheetNumber(patch.sheetNumber) : current.sheetNumber;
  if (sheetNumber === "") throw new JobsError("INVALID_VALUE", "a sheet needs a number");
  if (sheetNumber.length > 40) throw new JobsError("INVALID_VALUE", "a sheet number is at most 40 characters");
  if ((patch.title ?? "").length > 300) throw new JobsError("INVALID_VALUE", "a title is at most 300 characters");
  if ((patch.revision ?? "").length > 40) throw new JobsError("INVALID_VALUE", "a revision mark is at most 40 characters");
  if (sheetNumber !== current.sheetNumber) {
    const clash = await tx
      .select({ pageNumber: schema.jobSheets.pageNumber })
      .from(schema.jobSheets)
      .where(and(eq(schema.jobSheets.tenantId, ctx.tenantId), eq(schema.jobSheets.setId, current.setId), eq(schema.jobSheets.sheetNumber, sheetNumber)))
      .limit(1);
    if (clash.length > 0) throw new JobsError("SHEET_TAKEN", `${sheetNumber} is already in this set, on page ${clash[0].pageNumber}`);
  }
  const rows = await tx
    .update(schema.jobSheets)
    .set({
      sheetNumber,
      title: patch.title !== undefined ? patch.title.trim() : current.title,
      revision: patch.revision !== undefined ? patch.revision.trim() : current.revision,
      version: current.version + 1,
      updatedAt: new Date(),
    })
    .where(and(eq(schema.jobSheets.tenantId, ctx.tenantId), eq(schema.jobSheets.id, id)))
    .returning();
  return rows[0];
}

/** A page read as a sheet by mistake — the cover, a legend — taken back out; the file is untouched. */
export async function deleteSheet(tx: Tx, ctx: JobsCtx, id: string): Promise<void> {
  requireWrite(ctx, "member");
  const current = await getSheet(tx, ctx.tenantId, id);
  if (!current) throw new JobsError("NOT_FOUND", `sheet ${id} not found`);
  await tx.delete(schema.jobSheets).where(and(eq(schema.jobSheets.tenantId, ctx.tenantId), eq(schema.jobSheets.id, id)));
}

export interface SheetRow {
  sheet: JobSheet;
  setName: string;
  issuedOn: string;
  setCreatedAt: string;
  fileName: string;
  discipline: string;
  /** The newest issue of this number. */
  isCurrent: boolean;
  /** When superseded: the sheet that is current for this number. */
  currentId: string | null;
  /** How many issues of this number the job has had. */
  issues: number;
}

/**
 * Every sheet of a job, in reading order — discipline, then number, then
 * newest issue first — with which issue of each number is current.
 */
/**
 * The set, sorted the way THIS business reads it. `order` comes from pack
 * config and is empty for a business that has said nothing, which is the
 * standard's order — see `disciplineRank`.
 */
export async function listSheets(
  tx: Tx,
  tenantId: string,
  projectId: string,
  order: readonly string[] = [],
): Promise<SheetRow[]> {
  const rows = await tx
    .select({
      sheet: schema.jobSheets,
      setName: schema.jobDrawingSets.name,
      issuedOn: schema.jobDrawingSets.issuedOn,
      setCreatedAt: schema.jobDrawingSets.createdAt,
      fileName: schema.documents.fileName,
    })
    .from(schema.jobSheets)
    .innerJoin(schema.jobDrawingSets, and(eq(schema.jobDrawingSets.tenantId, schema.jobSheets.tenantId), eq(schema.jobDrawingSets.id, schema.jobSheets.setId)))
    .innerJoin(schema.documents, and(eq(schema.documents.tenantId, schema.jobSheets.tenantId), eq(schema.documents.id, schema.jobSheets.documentId)))
    .where(and(eq(schema.jobSheets.tenantId, tenantId), eq(schema.jobSheets.projectId, projectId)));
  const issues = rows.map((r) => ({
    id: r.sheet.id,
    sheetNumber: r.sheet.sheetNumber,
    issuedOn: r.issuedOn,
    setCreatedAt: r.setCreatedAt.toISOString(),
  }));
  const current = currentIssues(issues);
  const counts = new Map<string, number>();
  for (const i of issues) counts.set(i.sheetNumber, (counts.get(i.sheetNumber) ?? 0) + 1);
  const byId = new Map(issues.map((i) => [i.id, i]));
  return rows
    .map((r) => {
      const head = current.get(r.sheet.sheetNumber);
      return {
        sheet: r.sheet,
        setName: r.setName,
        issuedOn: r.issuedOn,
        setCreatedAt: r.setCreatedAt.toISOString(),
        fileName: r.fileName,
        discipline: disciplineOf(r.sheet.sheetNumber),
        isCurrent: head?.id === r.sheet.id,
        currentId: head && head.id !== r.sheet.id ? head.id : null,
        issues: counts.get(r.sheet.sheetNumber) ?? 1,
      };
    })
    .sort((a, b) => {
      const byNumber = compareSheetNumbers(a.sheet.sheetNumber, b.sheet.sheetNumber, order);
      if (byNumber !== 0) return byNumber;
      const ia = byId.get(a.sheet.id)!;
      const ib = byId.get(b.sheet.id)!;
      return isNewer(ia, ib) ? -1 : isNewer(ib, ia) ? 1 : 0;
    });
}

export async function drawingsSummary(tx: Tx, tenantId: string, projectId: string): Promise<DrawingsSummary> {
  const [sheets, sets] = await Promise.all([
    tx
      .select({
        id: schema.jobSheets.id,
        sheetNumber: schema.jobSheets.sheetNumber,
        issuedOn: schema.jobDrawingSets.issuedOn,
        setCreatedAt: schema.jobDrawingSets.createdAt,
      })
      .from(schema.jobSheets)
      .innerJoin(schema.jobDrawingSets, and(eq(schema.jobDrawingSets.tenantId, schema.jobSheets.tenantId), eq(schema.jobDrawingSets.id, schema.jobSheets.setId)))
      .where(and(eq(schema.jobSheets.tenantId, tenantId), eq(schema.jobSheets.projectId, projectId))),
    tx
      .select({ name: schema.jobDrawingSets.name, issuedOn: schema.jobDrawingSets.issuedOn, createdAt: schema.jobDrawingSets.createdAt })
      .from(schema.jobDrawingSets)
      .where(and(eq(schema.jobDrawingSets.tenantId, tenantId), eq(schema.jobDrawingSets.projectId, projectId))),
  ]);
  return summariseDrawings(
    sheets.map((s) => ({ ...s, setCreatedAt: s.setCreatedAt.toISOString() })),
    sets.map((s) => ({ ...s, createdAt: s.createdAt.toISOString() })),
  );
}
