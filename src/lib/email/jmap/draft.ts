import type { JmapComposedMessage, JmapEmailAddress } from "./types";

/**
 * Building the request, as the mirror of `parse.ts` reading the response.
 *
 * PURE, and free of `server-only`, for exactly the reason that file is: the
 * shape of a composed message is the most consequential thing this client
 * decides, and it has to be assertable without a network. It is also what
 * `npm run mail:probe-compose` sends — a probe that verifies a hand-written
 * request proves nothing about the code that ships, so the probe imports THIS
 * and the tests assert the same function.
 */

/**
 * A composed message as a JMAP Email object.
 *
 * Bodies go in as `bodyValues` keyed by part id, with `textBody`/`htmlBody`
 * naming which part is which — RFC 8621 §4.1.4. Supplying both makes the server
 * build the `multipart/alternative` itself, which is the whole reason not to
 * assemble MIME by hand: getting boundaries, encodings and charsets right is a
 * job the server already does correctly.
 *
 * `$draft` is set on creation whether or not this is going straight out. A
 * message that exists on the server without it, before submission, is one that
 * shows up in the mailbox as ordinary mail if the send then fails.
 */
export function draftObject(message: JmapComposedMessage): Record<string, unknown> {
  const bodyValues: Record<string, { value: string }> = {
    text: { value: message.textBody },
  };
  const hasHtml = Boolean(message.htmlBody && message.htmlBody.trim().length > 0);
  if (hasHtml) bodyValues.html = { value: message.htmlBody! };

  const inline = message.inlineImages ?? [];
  const attachments = message.attachments ?? [];

  /**
   * TWO WAYS TO DESCRIBE A MESSAGE, and which one is used turns entirely on
   * whether there are inline images.
   *
   * The convenience properties (`textBody`/`htmlBody`/`attachments`) let the
   * server assemble the MIME, which is the whole reason not to do it by hand.
   * That is kept for the ordinary case — it is simpler and it is what every
   * message before inline images shipped with.
   *
   * **But `npm run mail:probe-compose` found that they cannot express an inline
   * image.** Handed an attachment with `disposition: "inline"` and a `cid`, the
   * server builds `multipart/MIXED` with the picture as a SIBLING of the
   * alternative. A `cid:` reference resolves against a `multipart/related`
   * (RFC 2387), so in that shape the recipient gets a broken image with the
   * file listed underneath as an attachment.
   *
   * RFC 8621 §4.1.4's other door is `bodyStructure`, which describes the tree
   * explicitly. The probe confirmed Stalwart honours it verbatim, and that the
   * html part is still discoverable through `Email/get` afterwards — so our own
   * reading pane still finds the body it just sent. Boundaries, encodings and
   * charsets stay the server's job, which is the part worth not hand-rolling;
   * only the SHAPE becomes ours.
   */
  if (inline.length === 0) {
    const body: Record<string, unknown> = {
      textBody: [{ partId: "text", type: "text/plain" }],
    };
    if (hasHtml) body.htmlBody = [{ partId: "html", type: "text/html" }];
    return draftEnvelope(message, bodyValues, {
      ...body,
      ...(attachments.length > 0
        ? {
            attachments: attachments.map((a) => ({
              blobId: a.blobId,
              type: a.type,
              name: a.name,
              disposition: "attachment",
            })),
          }
        : {}),
    });
  }

  const alternative = {
    type: "multipart/alternative",
    subParts: [
      { partId: "text", type: "text/plain" },
      { partId: "html", type: "text/html" },
    ],
  };
  // The pictures live INSIDE the related part, beside the alternative that
  // references them. Anything genuinely attached stays outside it — a PDF is
  // not a resource the body renders, and putting it in `related` invites
  // clients to hide it.
  const related = {
    type: "multipart/related",
    subParts: [
      alternative,
      ...inline.map((image) => ({
        blobId: image.blobId,
        type: image.type,
        name: image.name,
        disposition: "inline",
        cid: image.cid,
      })),
    ],
  };
  const bodyStructure =
    attachments.length > 0
      ? {
          type: "multipart/mixed",
          subParts: [
            related,
            ...attachments.map((a) => ({
              blobId: a.blobId,
              type: a.type,
              name: a.name,
              disposition: "attachment",
            })),
          ],
        }
      : related;

  return draftEnvelope(message, bodyValues, { bodyStructure });
}

/** Everything about a draft that does not depend on how the body is described. */
function draftEnvelope(
  message: JmapComposedMessage,
  bodyValues: Record<string, { value: string }>,
  body: Record<string, unknown>,
): Record<string, unknown> {

  return {
    mailboxIds: { [message.draftsMailboxId]: true },
    keywords: { $draft: true },
    from: [addressObject(message.from)],
    to: message.to.map(addressObject),
    ...(message.cc.length > 0 ? { cc: message.cc.map(addressObject) } : {}),
    ...(message.bcc.length > 0 ? { bcc: message.bcc.map(addressObject) } : {}),
    subject: message.subject,
    ...(message.inReplyTo && message.inReplyTo.length > 0
      ? { inReplyTo: message.inReplyTo }
      : {}),
    ...(message.references && message.references.length > 0
      ? { references: message.references }
      : {}),
    bodyValues,
    ...body,
  };
}

/** JMAP wants `name: null` rather than an absent key for a bare address. */
function addressObject(a: JmapEmailAddress): { name: string | null; email: string } {
  return { name: a.name && a.name.length > 0 ? a.name : null, email: a.email };
}
