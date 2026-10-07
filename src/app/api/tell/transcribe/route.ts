import type { NextRequest, NextResponse } from "next/server";
import { resolveTenantContext } from "@/lib/auth";
import { speechFail, transcribeRequest } from "@/lib/speech/transcribe-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A recording in, a sentence out. The SERVER half of the speech seam — only
 * ever reached by a browser, because the app uses the phone's own engine and
 * uploads nothing (`src/lib/speech/types.ts`).
 *
 * ── IT WRITES NOTHING, AND KEEPS NOTHING ─────────────────────────────────────
 *
 * The audio arrives in memory, goes to the vendor, and is dropped when the
 * request ends. No blob storage, no log line, no database row — and the
 * transcript is not kept either. It goes straight back to the browser, which
 * puts it in the textarea for a person to read and edit before anything is
 * proposed. **Nothing here can change a tenant's data**, which is what makes
 * this route a much smaller thing than `/api/device/tell` next door.
 *
 * ── AUTH IS A SESSION, NOT A GRANT ───────────────────────────────────────────
 *
 * `resolveTenantContext()` rather than `requireTenant()`: this is a fetch from
 * a page, and `requireTenant` answers an unauthenticated caller with a redirect
 * to the sign-in page, which a `fetch` would receive as an HTML body and a 200.
 * A route that returns a login page where a transcript was expected is worse
 * than one that says 401.
 *
 * No module gate and no role check. Dictation is typing — what the words then
 * DO is decided by `tell-sources`, whose own verbs refuse whoever they refuse.
 * A gate here would be a second opinion, and the one that drifted would be
 * this one.
 *
 * ── WHAT BOUNDS THE COST ─────────────────────────────────────────────────────
 *
 * Every call is money. Three things hold it down: a signed-in session is
 * required, the audio is capped at `SPEECH_MAX_BYTES`, and the browser stops
 * recording at `SPEECH_MAX_SECONDS`. There is no durable per-tenant counter —
 * that would be a table, and a table is a migration for something a person has
 * to hold a button to do. Recorded as an open item in the dossier rather than
 * left to be discovered.
 */

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = await resolveTenantContext();
  if (!ctx) return speechFail(401, "Sign in first.");

  // A support view is a READ of somebody else's workspace (back-office slice
  // 4). Dictating into it would be typing on their behalf, and this is a POST,
  // which that view refuses everywhere else too.
  if (ctx.support) return speechFail(403, "Not while viewing a client's workspace.");

  // The size check, the vendor and the answer are shared with Food's search
  // (`src/lib/speech/transcribe-route.ts`); this file keeps the door.
  return transcribeRequest(req);
}
