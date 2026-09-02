import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveTenantContext } from "@/lib/auth";
import {
  canReadGuide,
  findGuideFor,
  guideVocabulary,
  localiseGuide,
  toGuideView,
} from "@/lib/guides";
import type { HelpPayload } from "@/lib/guides-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The help panel's one request: "which guide is this screen?" The button sends
 * the pathname and query string it is on; this answers with the guide, already
 * in the tenant's own words, or `null` when nothing covers that screen.
 *
 * A GET rather than a server action on purpose. `PageHeader` renders the
 * button on every page and is imported by client files, and a `"use server"`
 * module reached through it would put an action reference in every page's
 * manifest. A read that returns prose is a GET, guarded the way every other
 * route here is: `resolveTenantContext()` for the caller, then the same
 * enablement gate the module page applies.
 */
const Query = z.object({
  path: z.string().max(2048).default(""),
  search: z.string().max(2048).default(""),
});

export async function GET(req: NextRequest): Promise<NextResponse> {
  const ctx = await resolveTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const parsed = Query.safeParse({
    path: req.nextUrl.searchParams.get("path") ?? "",
    search: req.nextUrl.searchParams.get("search") ?? "",
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const guide = await findGuideFor(parsed.data.path, parsed.data.search);
  const payload: HelpPayload = {
    guide:
      guide && (await canReadGuide(ctx, guide))
        ? toGuideView(localiseGuide(guide, guideVocabulary(ctx.tenant)))
        : null,
  };
  return NextResponse.json(payload, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
