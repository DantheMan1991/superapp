import "server-only";
import { head } from "@vercel/blob";
import { schema, type Tx } from "@/db";
import { blobToken, feedbackPathPrefix, isTenantBlobPath } from "@/lib/blob";
import {
  isAllowedAttachment,
  MAX_ATTACHMENTS_PER_MESSAGE,
  sanitizeFileName,
} from "./attachments";

/**
 * Turning uploaded blobs into rows on a message.
 *
 * ── THE BROWSER IS NOT BELIEVED ABOUT ANYTHING ───────────────────────────────
 *
 * The client sends PATHNAMES and nothing else. Not the type, not the size, not
 * the name: every one of those is read back from the stored blob with `head()`
 * and re-checked against the allowlist here. The upload door already bound the
 * type and the cap when it minted the token, and this is the second net — the
 * arrangement `src/modules/documents/ingest.ts` set, and the reason a forged
 * `mimeType: "image/png"` on a submitted form buys nothing.
 *
 * ── IT RUNS INSIDE THE CALLER'S TRANSACTION ──────────────────────────────────
 *
 * Takes a `tx` rather than opening one, so a message and the files that came
 * with it commit together. A message whose attachments failed halfway would
 * render as a sentence pointing at pictures that are not there.
 *
 * `head()` IS A NETWORK CALL AND IT IS INSIDE THAT TRANSACTION, which the
 * house rule normally forbids. The alternative is worse in a way that matters
 * here: validating first and inserting after leaves a window where the message
 * commits and the rows do not. Three heads against a blob store, on a path a
 * person waits on once, is the cheaper side of that trade — and it is capped at
 * three by `MAX_ATTACHMENTS_PER_MESSAGE` precisely so the window is bounded.
 */

export class FeedbackAttachError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FeedbackAttachError";
  }
}

export interface AttachInput {
  tenantId: string;
  reportId: string;
  messageId: string;
  clerkUserId: string;
  /** Blob pathnames the upload door minted for this tenant. */
  pathnames: readonly string[];
}

export async function attachToMessage(
  tx: Tx,
  input: AttachInput,
): Promise<number> {
  const pathnames = [...new Set(input.pathnames)].filter(Boolean);
  if (pathnames.length === 0) return 0;
  if (pathnames.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    throw new FeedbackAttachError(
      `Up to ${MAX_ATTACHMENTS_PER_MESSAGE} files on one message.`,
    );
  }

  for (const pathname of pathnames) {
    // Its own namespace and nothing else — restated here rather than trusted
    // from the door, because this function is reachable from a second action
    // and a check that lives only at one entrance is a check with a side door.
    if (
      !pathname.startsWith(feedbackPathPrefix(input.tenantId)) ||
      !isTenantBlobPath(input.tenantId, pathname)
    ) {
      throw new FeedbackAttachError("That file is not yours.");
    }

    let meta;
    try {
      meta = await head(pathname, { token: blobToken() });
    } catch {
      // Either it was never uploaded, or somebody guessed a pathname. The
      // message is the same on purpose: a probe learns nothing from it.
      throw new FeedbackAttachError("That file could not be found.");
    }

    const mimeType = meta.contentType ?? "";
    if (!isAllowedAttachment(mimeType, meta.size)) {
      throw new FeedbackAttachError("That file type is not accepted here.");
    }

    await tx.insert(schema.feedbackAttachments).values({
      tenantId: input.tenantId,
      reportId: input.reportId,
      messageId: input.messageId,
      blobPathname: pathname,
      // The stored name, cleaned. Never rendered raw and never trusted as a
      // path — it came off somebody's phone.
      fileName: sanitizeFileName(
        pathname.slice(pathname.lastIndexOf("/") + 1),
      ),
      mimeType,
      byteSize: meta.size,
      clerkUserId: input.clerkUserId,
    });
  }

  return pathnames.length;
}
