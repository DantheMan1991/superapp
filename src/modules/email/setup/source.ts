import "server-only";
import { schema, type Tx } from "@/db";
import { hasAny } from "@/lib/setup-sources/has-any";
import type { SetupCtx, SetupSource, SetupStep } from "@/lib/setup-sources/types";

/**
 * What Mail is waiting for: a mailbox.
 *
 * Mail reads and sends through mailboxes hosted on the business's own domain
 * (docs/modules/mail-infrastructure.md); a connected account is a person's
 * session against one of those, so the mailbox row is the prerequisite either
 * way. Until one exists the module renders an inbox with nothing behind it.
 *
 * The sending domain — what invoices and notifications go out AS — is not a
 * step. It is platform-level, works from a Yosher address before any domain is
 * added, and belongs to every tenant whether or not they bought Mail.
 */
export const emailSetupSource: SetupSource = {
  slug: "email-mailbox",
  moduleSlug: "email",
  label: "Mail",

  async collect(tx: Tx, ctx: SetupCtx): Promise<SetupStep[]> {
    if (await hasAny(tx, schema.mailboxes, ctx.tenantId)) return [];
    return [
      {
        key: "email.mailbox",
        title: "Set up your mailboxes",
        detail:
          "Mail has nothing to show until an address on your own domain exists here. Add the domain, then the addresses.",
        href: "/dashboard/email",
        cta: "Open Email setup",
        guide: "settings/email-setup",
      },
    ];
  },
};
