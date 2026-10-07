import "server-only";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { transcribeAudio } from "./providers";
import { SPEECH_MAX_BYTES, SpeechRefusal } from "./types";

/**
 * A RECORDING IN, A SENTENCE OUT: the handler behind every door that takes
 * dictation from a browser. The tell box's door is a business workspace's
 * (`/api/tell/transcribe`); Food's search is a personal space's
 * (`/api/food/transcribe`, ADR 0132). Each route keeps its own door and calls
 * this once it has let the caller in, so the size limit, the vendor and the
 * words a person sees are one.
 *
 * It writes nothing and keeps nothing: the audio arrives in memory, goes to
 * the vendor, and is dropped when the request ends; the transcript goes
 * straight back to the browser. No blob, no log line, no row.
 */

export function speechFail(status: number, message: string): NextResponse {
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

export async function transcribeRequest(req: NextRequest): Promise<NextResponse> {
  // Checked before the body is buffered, so an oversized upload costs a header
  // read rather than two megabytes of memory. The real check is in
  // `transcribeAudio`, because a client is free to lie about this one or omit it.
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > SPEECH_MAX_BYTES) {
    return speechFail(413, "That is too long. Say one thing at a time.");
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
    if (err instanceof SpeechRefusal) return speechFail(422, err.message);
    // A vendor outage is not something the person did. Its own message never
    // reaches them — it can carry their words back inside it.
    console.error("transcribe failed", err);
    return speechFail(502, "Yosher could not listen just now. Type it instead.");
  }
}
