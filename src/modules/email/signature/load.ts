import "server-only";
import type { MailAccount } from "@/db/schema";
import { authorizedClient } from "@/lib/email/oauth/accounts";
import type { JmapIdentity } from "@/lib/email/jmap/types";

export interface LoadedSignature {
  identityId: string;
  /** The address this signature belongs to, so the form can say whose it is. */
  address: string;
  htmlSignature: string;
  textSignature: string;
  /** More than one identity exists; see the open item in the dossier. */
  hasOthers: boolean;
}

/**
 * The signature on the identity the COMPOSER would use.
 *
 * Picked by the same rule as `read.ts` — the identity matching the mailbox's own
 * address, else the first — and that agreement is the point: editing a signature
 * the composer would not have chosen is worse than not offering the feature,
 * because it saves successfully and changes nothing anybody can see.
 *
 * NULL RATHER THAN THROWING, like `loadAutoReply`. A mail server having a bad
 * minute must not turn a settings page into an error page; the form says it
 * could not read the current signature rather than showing a confident blank one
 * somebody might save over the top of.
 */
export async function loadSignature(
  account: MailAccount,
): Promise<LoadedSignature | null> {
  try {
    const client = await authorizedClient(account);
    if (!client.ok) return null;
    const identities = await client.data.identities();
    if (!identities.ok || identities.data.length === 0) return null;

    const self = client.data.session.username.trim().toLowerCase();
    const identity: JmapIdentity =
      identities.data.find((i) => i.email.trim().toLowerCase() === self) ??
      identities.data[0];

    return {
      identityId: identity.id,
      address: identity.email,
      htmlSignature: identity.htmlSignature,
      textSignature: identity.textSignature,
      hasOthers: identities.data.length > 1,
    };
  } catch {
    return null;
  }
}
