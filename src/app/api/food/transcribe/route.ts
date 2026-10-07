import type { NextRequest } from "next/server";
import { resolvePersonalContext } from "@/lib/auth";
import { routeGate } from "@/lib/modules";
import { speechFail, transcribeRequest } from "@/lib/speech/transcribe-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * WHAT WAS EATEN, SAID INSTEAD OF TYPED (the redesign's microphone in Food's
 * search, his call 2026-10-06; ADR 0132).
 *
 * The tell box's dictation, behind a personal space's door: the tell box's
 * own route answers a business workspace only (`resolveTenantContext`), so a
 * personal space needs this one. `resolvePersonalContext` answers 401 where a
 * page's door would redirect a `fetch` to a sign-in page, and Food must be
 * switched on for the space, the same gate its pages apply.
 *
 * The words go into the search box for the person to read; nothing is logged
 * until they choose a food. The clip goes to the speech vendor and nothing is
 * kept (`src/lib/speech/transcribe-route.ts`, which also holds the size limit).
 */
export async function POST(req: NextRequest) {
  const ctx = await resolvePersonalContext();
  if (!ctx) return speechFail(401, "Sign in first.");
  const refused = await routeGate(ctx.tenant.id, "food");
  if (refused) return refused;
  return transcribeRequest(req);
}
