import { authorizedClient } from "@/lib/email/oauth/accounts";
import { gateMailRoute, mailRouteNotFound } from "@/modules/email/route-auth";
import { buildCidMap, type InlinePart } from "@/modules/email/render/cid";
import { buildMessageFrame, EMPTY_BODY_HTML } from "@/modules/email/render/frame";
import { messageFrameHeaders } from "@/modules/email/render/policy";
import { sanitizeMessageHtml } from "@/modules/email/render/sanitize";
import { renderTextBody } from "@/modules/email/render/text-to-html";
import { mailAttachmentPolicy } from "@/modules/email/render/attachment-policy";
import {
  blobExpiry,
  signBlobClaim,
  signImageClaim,
} from "@/modules/email/render/signing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The document an iframe loads to show one message.
 *
 * Served as its own response so it carries its own strict CSP — the whole
 * reason the reading pane frames a URL rather than injecting markup. A
 * `srcdoc` document would inherit the embedder's CSP, and this app has none.
 *
 * No signature is needed here: the account is proved to be the caller's by RLS
 * in `gateMailRoute`, so a fabricated `emailId` can only ever address the
 * caller's own mail. The blob URLs this page emits ARE signed, because those
 * carry the attachment policy's decision (`servedType`, `disposition`) and a
 * caller must not be able to ask for a nicer one.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ accountId: string; emailId: string }> },
): Promise<Response> {
  const { accountId, emailId } = await params;
  const gate = await gateMailRoute(accountId);
  if (!gate.ok) return gate.response;

  const client = await authorizedClient(gate.account);
  if (!client.ok) return mailRouteNotFound();

  const fetched = await client.data.getEmails([emailId], true);
  if (!fetched.ok || fetched.data.length === 0) return mailRouteNotFound();
  const message = fetched.data[0];

  const cidMap = buildCidMap(message.attachments);
  const expiresAt = blobExpiry();

  const inlineUrl = (part: InlinePart): string => {
    const policy = mailAttachmentPolicy(part.type, part.name, true);
    const claim = {
      tenantId: gate.tenantId,
      clerkUserId: gate.userId,
      mailAccountId: gate.account.id,
      blobId: part.blobId,
      servedType: policy.servedType,
      fileName: policy.fileName,
      disposition: policy.disposition,
      expiresAt,
    };
    const query = new URLSearchParams({
      type: policy.servedType,
      name: policy.fileName,
      disp: policy.disposition,
      exp: String(expiresAt),
      sig: signBlobClaim(claim),
    });
    return `/api/mail/${accountId}/blob/${encodeURIComponent(part.blobId)}?${query}`;
  };

  // Remote images are blocked unless this request asks for them, and asking is
  // per-request rather than stored: the reader re-decides each time they open a
  // message, which is the conservative default for something that reports back
  // to whoever sent it.
  const showImages = new URL(request.url).searchParams.get("images") === "1";

  const remoteUrl = (source: string): string => {
    const claim = {
      tenantId: gate.tenantId,
      clerkUserId: gate.userId,
      url: source,
      expiresAt,
    };
    const query = new URLSearchParams({
      u: source,
      exp: String(expiresAt),
      sig: signImageClaim(claim),
    });
    return `/api/mail/img?${query}`;
  };

  let bodyHtml: string;
  if (message.htmlBody && message.htmlBody.length > 0) {
    // Omitting `remoteUrl` IS the block — there is no separate blocking step to
    // forget. Even when unblocked, images go through our proxy rather than
    // direct, so the sender never learns the reader's IP and the frame's
    // `img-src 'self'` never has to be relaxed. Inline `cid:` images render
    // either way: they arrived in the same envelope and report to nobody.
    bodyHtml = sanitizeMessageHtml(message.htmlBody, {
      cidMap,
      inlineUrl,
      ...(showImages ? { remoteUrl } : {}),
    }).html;
  } else if (message.textBody && message.textBody.length > 0) {
    bodyHtml = renderTextBody(message.textBody);
  } else {
    bodyHtml = EMPTY_BODY_HTML;
  }

  return new Response(
    buildMessageFrame({ bodyHtml, truncated: message.bodyTruncated }),
    { status: 200, headers: messageFrameHeaders() },
  );
}
