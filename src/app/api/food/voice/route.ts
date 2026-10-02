import { recordLinesHandler } from "@/lib/speech/record-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** A recipe's first batch of 40 lines, six at a time, is several seconds. */
export const maxDuration = 60;

/**
 * A RECIPE, READ ALOUD (docs/modules/food.md, D1c; ADR 0124).
 *
 * Hands-free cook mode reads each step in the recorded voice the phone chose
 * for the workout coach (ADR 0115). It asks for the recipe's lines when
 * hands-free is turned on, keeps what comes back on the phone, and asks again
 * only for a line it has never had. Food must be switched on for the space.
 * The handler, its door and what bounds its cost are the coach's:
 * `src/lib/speech/record-route.ts`. It writes nothing.
 */
export const POST = recordLinesHandler("food");
