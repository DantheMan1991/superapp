import "server-only";
import type { MailAccount } from "@/db/schema";
import { authorizedClient } from "@/lib/email/oauth/accounts";
import type { VacationResponse } from "@/lib/email/jmap/client";

/**
 * The current out-of-office setting, or null if the mail server would not say.
 *
 * NULL RATHER THAN THROWING, deliberately. This is read on every mail page
 * load so the header can show whether a reply is going out, and a mail server
 * having a bad minute must not turn "your inbox" into an error page over a
 * question about holidays. The badge simply does not render, and the form says
 * it could not read the current setting rather than showing a confident blank
 * one somebody might save over the top of.
 */
export async function loadAutoReply(
  account: MailAccount,
): Promise<VacationResponse | null> {
  try {
    const client = await authorizedClient(account);
    if (!client.ok) return null;
    const response = await client.data.vacationResponse();
    return response.ok ? response.data : null;
  } catch {
    return null;
  }
}
