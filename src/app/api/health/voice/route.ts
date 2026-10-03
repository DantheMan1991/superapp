import { recordLinesHandler } from "@/lib/speech/record-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** A handful of short lines, but a cold first batch is seconds. */
export const maxDuration = 60;

/**
 * THE PROGRESS PHOTOS' COUNTDOWN, SAID ALOUD (docs/modules/health.md, H2b;
 * ADR 0128).
 *
 * The phone stands across the room on a timer, so the photo screen says what
 * comes next ("Turn to your side") in the recorded voice the phone chose for
 * the workout coach (ADR 0115). It asks for its few lines when the camera
 * opens, keeps what comes back on the phone, and never asks again. Only the
 * words go: no picture is ever sent here or anywhere. Health must be switched
 * on for the space. The handler, its door and what bounds its cost are the
 * coach's: `src/lib/speech/record-route.ts`. It writes nothing.
 */
export const POST = recordLinesHandler("health");
