import { NextRequest } from "next/server";
import { authorizedClient } from "@/lib/email/oauth/accounts";
import { sanitizeFileName } from "@/lib/file-headers";
import { gateMailRoute, mailRouteNotFound } from "@/modules/email/route-auth";

/**
 * `POST /api/mail/[accountId]/upload` — put an attachment in the mail server's
 * blob store and hand back its id.
 *
 * WHY A ROUTE AND NOT A SERVER ACTION. Next caps a server action's request body
 * at 4 MB by default. Routing attachments through one would silently make that
 * the attachment limit for the whole product — a limit nobody chose, that does
 * not match the mail server's own, and that would show up as an inexplicable
 * failure on a normal-sized set of drawings. A route handler streams.
 *
 * The bytes never touch our storage. They go straight to the mail server, which
 * is the only place a draft's attachment can live, and we keep nothing but the
 * blobId the composer echoes back on send.
 */

export const dynamic = "force-dynamic";
/** Well above a normal attachment; the mail server's own limit still applies. */
const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ accountId: string }> },
) {
  const { accountId } = await context.params;
  const gate = await gateMailRoute(accountId);
  if (!gate.ok) return gate.response;

  // Refused on the declared length before a single byte is read, so an oversized
  // upload costs no memory and no round trip to the mail server.
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES) {
    return Response.json(
      { error: "That attachment is too large." },
      { status: 413 },
    );
  }

  const type = request.headers.get("x-file-type") ?? "application/octet-stream";
  // The name is display metadata that ends up in a header on the way out, so it
  // gets the same treatment every other filename in this module does.
  const name = sanitizeFileName(request.headers.get("x-file-name") ?? "attachment");

  const body = await request.arrayBuffer();
  const bytes = new Uint8Array(body);
  if (bytes.byteLength === 0) {
    return Response.json({ error: "That file is empty." }, { status: 400 });
  }
  // Checked again against what actually arrived: the first check trusted a
  // header the client set.
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    return Response.json(
      { error: "That attachment is too large." },
      { status: 413 },
    );
  }

  const client = await authorizedClient(gate.account);
  if (!client.ok) return mailRouteNotFound();

  const uploaded = await client.data.uploadBlob(bytes, type);
  if (!uploaded.ok) {
    // The mail server's own sentence, which is more specific than anything we
    // could invent — it knows its size limits and its quota.
    return Response.json({ error: uploaded.message }, { status: 502 });
  }

  return Response.json({
    blobId: uploaded.data.blobId,
    // The type the SERVER settled on, not the one the client claimed.
    type: uploaded.data.type,
    size: uploaded.data.size,
    name,
  });
}
