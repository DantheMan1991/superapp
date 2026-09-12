import { NextRequest, NextResponse } from "next/server";
import { resolveTenantContext } from "@/lib/auth";
import { transcribeAudio } from "@/lib/speech/providers";
import { SPEECH_MAX_BYTES, SpeechRefusal } from "@/lib/speech/types";

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

function fail(status: number, message: string): NextResponse {
  return NextResponse.json(
    { ok: false, error: message },
    {
      status,
      headers: {
        "Cache-Control": "no-store, private",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = await resolveTenantContext();
  if (!ctx) return fail(401, "Sign in first.");

  // A support view is a READ of somebody else's workspace (back-office slice
  // 4). Dictating into it would be typing on their behalf, and this is a POST,
  // which that view refuses everywhere else too.
  if (ctx.support) return fail(403, "Not while viewing a client's workspace.");

  // Checked before the body is buffered, so an oversized upload costs a header
  // read rather than two megabytes of memory. The real check is below, because
  // a client is free to lie about this one or omit it.
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > SPEECH_MAX_BYTES) {
    return fail(413, "That is too long. Say one thing at a time.");
  }

  const mimeType = req.headers.get("content-type") ?? "";
  const audio = await req.arrayBuffer();

  try {
    const text = await transcribeAudio({ audio, mimeType });
    return NextResponse.json(
      { ok: true, text },
      {
        headers: {
          "Cache-Control": "no-store, private",
          "Referrer-Policy": "no-referrer",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  } catch (err) {
    if (err instanceof SpeechRefusal) return fail(422, err.message);
    // A vendor outage is not something the person did. Its own message never
    // reaches them — it can carry their words back inside it.
    console.error("transcribe failed", err);
    return fail(502, "Yosher could not listen just now. Type it instead.");
  }
}
