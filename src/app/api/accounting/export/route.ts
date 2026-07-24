import { NextRequest, NextResponse } from "next/server";
import { get } from "@vercel/blob";
import { withTenant } from "@/db";
import { resolveTenantContext } from "@/lib/auth";
import { isModuleEnabled } from "@/lib/modules";
import { blobToken } from "@/lib/blob";
import { LedgerError, getSettings, type LedgerCtx } from "@/modules/accounting/core";
import { todayInTimezone } from "@/modules/accounting/lib/money";
import {
  gatherBooksExport,
  type BooksExportGathered,
} from "@/modules/accounting/export/books-export";
import { createBooksZipStream } from "@/modules/accounting/export/zip-stream";

export const runtime = "nodejs";
// Streaming a full books archive (CSVs + document blobs) can take minutes.
export const maxDuration = 300;

/**
 * Full-books export: streaming zip download (a server action can't carry
 * this — 4MB body cap). Owner + expert only; staff refused (bulk surface
 * with no workflow need). The gather tx commits — including the cooldown
 * claim and the books.exported audit row — BEFORE any blob streaming
 * begins, so no DB transaction ever spans blob-store I/O.
 */
export async function GET(req: NextRequest): Promise<NextResponse | Response> {
  const ctx = await resolveTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (ctx.role === "staff") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!(await isModuleEnabled(ctx.tenant.id, "accounting"))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const includeFiles = req.nextUrl.searchParams.get("files") === "1";
  const ledgerCtx: LedgerCtx = {
    tenantId: ctx.tenant.id,
    userId: ctx.userId,
    role: ctx.role,
  };

  let gathered: BooksExportGathered;
  let todayIso = "";
  try {
    gathered = await withTenant(ctx.tenant.id, async (tx) => {
      const settings = await getSettings(tx, ctx.tenant.id);
      todayIso = todayInTimezone(settings.bookkeepingTimezone);
      return gatherBooksExport(tx, ledgerCtx, {
        includeFiles,
        todayIso,
        tenantName: ctx.tenant.name,
      });
    });
  } catch (err) {
    if (err instanceof LedgerError && err.code === "EXPORT_COOLDOWN") {
      return NextResponse.json(
        { error: "An export just ran — try again in a minute." },
        { status: 429 },
      );
    }
    throw err;
  }

  const stream = createBooksZipStream(
    {
      readme: gathered.readme,
      manifestCsv: gathered.manifestCsv,
      csvFiles: gathered.csvFiles,
      docs: gathered.docs,
    },
    async (pathname) => {
      const result = await get(pathname, {
        access: "private",
        token: blobToken(),
      });
      return result && result.statusCode === 200 ? result.stream : null;
    },
  );

  const filename = `yosher-books-${ctx.tenant.slug}-${todayIso}.zip`;
  return new Response(stream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
