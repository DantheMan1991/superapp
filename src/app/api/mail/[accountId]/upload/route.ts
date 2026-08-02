import { NextRequest } from "next/server";
import { authorizedClient } from "@/lib/email/oauth/accounts";
import { sanitizeFileName } from "@/lib/file-headers";
import { gateMailRoute, mailRouteNotFound } from "@/modules/email/route-auth";
import {
  isInlineImageType,
  MAX_INLINE_IMAGE_BYTES,
  mintCid,
} from "@/modules/email/compose/inline";
import { inlinePreviewUrl } from "@/modules/email/render/signing";

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

  /**
   * An inline image gets two extra things: a Content-ID, and a URL the editor
   * can actually display.
   *
   * THE CID IS MINTED HERE rather than in the browser. It ends up in a MIME
   * header and inside a `cid:` URL in the body, so a client-chosen value would
   * be untrusted input everywhere it is later used. Minted server-side it is
   * ours, and the send action's format check is an assertion rather than a
   * guard.
   *
   * The caller asks for this with `x-inline: 1`. Asking is not enough — the
   * TYPE the mail server settled on has to be an image we allow inline, and the
   * size has to be under the inline cap, which is far below the attachment one.
   * A file that fails either comes back as an ordinary attachment rather than
   * an error: the person attached something, and it did attach.
   */
  const wantsInline = request.headers.get("x-inline") === "1";
  const inlineOk =
    wantsInline &&
    isInlineImageType(uploaded.data.type) &&
    uploaded.data.size <= MAX_INLINE_IMAGE_BYTES;

  if (!inlineOk) {
    return Response.json({
      blobId: uploaded.data.blobId,
      // The type the SERVER settled on, not the one the client claimed.
      type: uploaded.data.type,
      size: uploaded.data.size,
      name,
      inline: false,
    });
  }

  const cid = mintCid();
  return Response.json({
    blobId: uploaded.data.blobId,
    type: uploaded.data.type,
    size: uploaded.data.size,
    name,
    inline: true,
    cid,
    previewUrl: inlinePreviewUrl({
      tenantId: gate.tenantId,
      clerkUserId: gate.userId,
      mailAccountId: gate.account.id,
      blobId: uploaded.data.blobId,
      type: uploaded.data.type,
      fileName: name,
    }),
  });
}
