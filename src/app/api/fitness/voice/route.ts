import { NextRequest, NextResponse } from "next/server";
import { resolvePersonalContext } from "@/lib/auth";
import { routeGate } from "@/lib/modules";
import { isSynthesisConfigured, synthesizeLines } from "@/lib/speech/synthesis";
import { packClips, recordRequestSchema } from "@/lib/speech/voices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** A first batch of 40 long lines, six at a time, is several seconds. */
export const maxDuration = 60;

/**
 * THE COACH'S LINES, RECORDED (ADR 0115; docs/modules/fitness.md, F2d).
 *
 * Lines in, recordings out, in one body (`packClips`). The workout screen asks
 * for a session's lines while the person answers the feel check, keeps what
 * comes back on the phone, and asks again only for a line it has never had.
 *
 * ── IT WRITES NOTHING ────────────────────────────────────────────────────────
 *
 * No row, no blob, no log of the words. The lines go to the vendor and the
 * recordings go back to the phone (`synthesis.ts` says what is sent). Nothing
 * here can change a space's data.
 *
 * ── THE DOOR ─────────────────────────────────────────────────────────────────
 *
 * The personal space's own (ADR 0111), for a route: `resolvePersonalContext`,
 * which answers 401 where `requirePersonalSpace` would redirect a `fetch` to a
 * sign-in page. Then the same gate the workout page applies: Workouts switched
 * on for the space. A business workspace never reaches it.
 *
 * ── WHAT BOUNDS THE COST ─────────────────────────────────────────────────────
 *
 * Every character is money. A signed-in person in their own space with
 * Workouts on; at most `RECORD_BATCH_MAX` lines of `RECORD_LINE_MAX`
 * characters a request; and the phone keeps every recording, so a program's
 * lines are paid for about once. There is no per-space counter, which would be
 * a table: an open item in the dossier before Workouts is opened to everyone.
 */

/** Forty lines of 300 characters, as JSON, with room to spare. */
const MAX_BODY_BYTES = 32_000;

const HEADERS = {
  "Cache-Control": "no-store, private",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

function fail(status: number, message: string): NextResponse {
  return NextResponse.json({ ok: false, error: message }, { status, headers: HEADERS });
}

export async function POST(req: NextRequest): Promise<Response> {
  const ctx = await resolvePersonalContext();
  if (!ctx) return fail(401, "Sign in first.");
  const refused = await routeGate(ctx.tenant.id, "fitness");
  if (refused) return refused;
  if (!isSynthesisConfigured()) return fail(503, "The coach's voice is not set up here.");

  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return fail(413, "Too many lines at once.");
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return fail(413, "Too many lines at once.");
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return fail(400, "That is not a list of lines.");
  }
  const parsed = recordRequestSchema.safeParse(body);
  if (!parsed.success) return fail(400, "That is not a list of lines.");

  const clips = await synthesizeLines(parsed.data.lines, parsed.data.voice);
  if (clips.every((clip) => clip === null)) return fail(502, "The coach's voice could not be reached.");
  return new Response(packClips(clips), {
    headers: { ...HEADERS, "Content-Type": "application/octet-stream" },
  });
}
