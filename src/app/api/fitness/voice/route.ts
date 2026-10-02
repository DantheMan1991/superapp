import { recordLinesHandler } from "@/lib/speech/record-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** A first batch of 40 long lines, six at a time, is several seconds. */
export const maxDuration = 60;

/**
 * THE COACH'S LINES, RECORDED (ADR 0115; docs/modules/fitness.md, F2d).
 *
 * The workout screen asks for a session's lines while the person answers the
 * feel check, keeps what comes back on the phone, and asks again only for a
 * line it has never had. Workouts must be switched on for the space. The
 * handler, its door and what bounds its cost are shared with Food's cook mode:
 * `src/lib/speech/record-route.ts`. It writes nothing.
 */
export const POST = recordLinesHandler("fitness");
